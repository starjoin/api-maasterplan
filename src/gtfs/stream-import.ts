import path from 'node:path'
import fs from 'node:fs'
import { prisma } from '../db.js'
import { config } from '../config.js'
import { listFiles } from '../archive.js'
import { Inventory } from '../inventory.js'
import { forEachCsvBatch } from './parser.js'
import { importGtfsToDb } from './importer.js'
import { EMPTY_STATS } from '../netex/types.js'
import type { GtfsFiles, ImportStats } from './types.js'
import { reportImportActivity, setDownloadProgress } from '../import-state.js'
const normalized = new Set(['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt', 'shapes.txt', 'fare_zones.txt', 'fare_attributes.txt', 'fare_rules.txt', 'transfers.txt'])
export async function importGtfsDirectory(dir: string, log: (m: string) => Promise<void>): Promise<ImportStats> {
  const stats = { ...EMPTY_STATS }
  const inventory = new Inventory()
  const seen = new Set<string>()
  const files: string[] = []
  for await (const file of listFiles(dir)) files.push(file)
  const sizes = new Map<string, number>()
  let totalBytes = 0
  for (const file of files) {
    const size = (await fs.promises.stat(path.join(dir, file))).size
    sizes.set(file, size)
    totalBytes += size
  }
  reportImportActivity(`Archive GTFS inspectée : ${files.length} fichier(s)`, {
    phase: 'indexing',
    phasePercent: 100,
    detail: `${formatCount(totalBytes)} octets détectés, début de l’import en flux`,
    counters: { filesTotal: files.length, filesRead: 0, rawRecords: 0 },
  })
  let completedBytes = 0
  let totalRecords = 0
  for (const [fileIndex, file] of files.entries()) {
    const name = path.basename(file).toLowerCase()
    const fileSize = sizes.get(file) ?? 0
    let count = 0
    if (/\.(txt|csv)$/i.test(file)) {
      if (normalized.has(name) && seen.has(name)) throw new Error(`Table GTFS ambiguë : ${name} apparaît plusieurs fois`)
      seen.add(name)
      await log(`Import intégral en flux : ${file}`)
      reportImportActivity(`Lecture de ${file}`, {
        phase: 'importing',
        phasePercent: totalBytes ? (completedBytes / totalBytes) * 100 : 0,
        detail: `Fichier ${fileIndex + 1}/${files.length} — 0 ligne traitée`,
        currentItem: file,
        processed: completedBytes,
        total: totalBytes,
        unit: 'octets',
        counters: { filesRead: fileIndex, rawRecords: totalRecords },
      })
      let lastReportedCount = 0
      let fileRows = 0
      count = await forEachCsvBatch(path.join(dir, file), config.IMPORT_BATCH_SIZE, async rows => {
        for (const row of rows) {
          const idKey = Object.keys(row).find(key => key.endsWith('_id'))
          await inventory.record(file, name, idKey ? row[idKey] : undefined, row)
        }
        if (normalized.has(name)) {
          const batchStats = await importGtfsToDb({ [name]: rows } as GtfsFiles, () => {}, {}, false)
          for (const key of Object.keys(stats) as (keyof ImportStats)[]) stats[key] += batchStats[key]
        }
        fileRows += rows.length
        const processedRows = fileRows
        const reportEvery = name === 'stop_times.txt' || name === 'shapes.txt' ? 10_000 : 2_000
        if (processedRows - lastReportedCount >= reportEvery) {
          lastReportedCount = processedRows
          reportImportActivity(`${formatCount(processedRows)} ligne(s) traitée(s) dans ${file}`, {
            phase: 'importing',
            detail: progressDetail(name, processedRows, stats),
            currentItem: file,
            counters: statsCounters(stats, totalRecords + processedRows),
          })
        } else {
          setDownloadProgress({
            phase: 'importing',
            detail: progressDetail(name, processedRows, stats),
            currentItem: file,
            counters: statsCounters(stats, totalRecords + processedRows),
          })
        }
        if (name === 'routes.txt') {
          for (const row of rows) {
            const lineName = row.route_short_name || row.route_long_name || row.route_id
            reportImportActivity(`Ligne ajoutée : ${lineName}`, {
              phase: 'importing',
              currentItem: lineName,
              counters: statsCounters(stats, totalRecords + processedRows),
            })
          }
        }
      }, (bytesRead) => {
        setDownloadProgress({
          phase: 'importing',
          phasePercent: totalBytes ? ((completedBytes + bytesRead) / totalBytes) * 100 : 100,
          processed: completedBytes + bytesRead,
          total: totalBytes,
          unit: 'octets',
        })
      })
      await log(`  ${count} enregistrements : ${file}`)
    } else reportImportActivity(`Fichier annexe conservé : ${file}`, { phase: 'importing' })
    await inventory.saveFile(dir, file, count)
    completedBytes += fileSize
    totalRecords += count
    reportImportActivity(`${file} terminé : ${formatCount(count)} enregistrement(s)`, {
      phase: 'importing',
      phasePercent: totalBytes ? (completedBytes / totalBytes) * 100 : 100,
      detail: `${fileIndex + 1}/${files.length} fichier(s) terminé(s) — ${statsSummary(stats)}`,
      currentItem: file,
      processed: completedBytes,
      total: totalBytes,
      unit: 'octets',
      counters: { ...statsCounters(stats, totalRecords), filesRead: fileIndex + 1 },
    })
  }
  for (const name of ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']) {
    if (!seen.has(name)) throw new Error(`Fichier GTFS requis absent : ${name}`)
  }
  if (!seen.has('calendar.txt') && !seen.has('calendar_dates.txt')) throw new Error('Aucun calendrier GTFS')
  await inventory.finish()
  reportImportActivity(`Import GTFS terminé : ${statsSummary(stats)}`, {
    phase: 'importing',
    phasePercent: 100,
    detail: `${files.length} fichier(s) intégralement archivés et indexés`,
    currentItem: null,
    counters: { ...statsCounters(stats, totalRecords), filesRead: files.length },
  })
  return stats
}

function statsCounters(stats: ImportStats, rawRecords = 0): Record<string, number> {
  return {
    rawRecords,
    agencies: stats.agencies,
    routes: stats.routes,
    stops: stats.stops,
    trips: stats.trips,
    stopTimes: stats.stopTimes,
    shapes: stats.shapes,
    calendars: stats.calendars + stats.calendarDates,
    fareZones: stats.fareZones,
    transfers: stats.transfers,
    pois: stats.pois,
  }
}

function progressDetail(filename: string, rows: number, stats: ImportStats) {
  if (filename === 'stop_times.txt') return `${formatCount(stats.stopTimes)} horaires ajoutés`
  if (filename === 'routes.txt') return `${formatCount(stats.routes)} lignes ajoutées`
  if (filename === 'stops.txt') return `${formatCount(stats.stops)} arrêts ajoutés`
  if (filename === 'trips.txt') return `${formatCount(stats.trips)} courses ajoutées`
  if (filename === 'shapes.txt') return `${formatCount(stats.shapes)} points de tracé ajoutés`
  return `${formatCount(rows)} enregistrement(s) traité(s)`
}

function statsSummary(stats: ImportStats) {
  return `${formatCount(stats.routes)} lignes, ${formatCount(stats.stops)} arrêts, ${formatCount(stats.trips)} courses, ${formatCount(stats.stopTimes)} horaires`
}

function formatCount(value: number) {
  return value.toLocaleString('fr-FR')
}
