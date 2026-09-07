import path from 'node:path'
import { prisma } from '../db.js'
import { config } from '../config.js'
import { listFiles } from '../archive.js'
import { Inventory } from '../inventory.js'
import { forEachCsvBatch } from './parser.js'
import { importGtfsToDb } from './importer.js'
import { EMPTY_STATS } from '../netex/types.js'
import type { GtfsFiles, ImportStats } from './types.js'
const normalized = new Set(['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt', 'shapes.txt', 'fare_zones.txt', 'fare_attributes.txt', 'fare_rules.txt', 'transfers.txt'])
export async function importGtfsDirectory(dir: string, log: (m: string) => Promise<void>): Promise<ImportStats> {
  const stats = { ...EMPTY_STATS }
  const inventory = new Inventory()
  const seen = new Set<string>()
  for await (const file of listFiles(dir)) {
    const name = path.basename(file).toLowerCase()
    let count = 0
    if (/\.(txt|csv)$/i.test(file)) {
      if (normalized.has(name) && seen.has(name)) throw new Error(`Table GTFS ambiguë : ${name} apparaît plusieurs fois`)
      seen.add(name)
      await log(`Import intégral en flux : ${file}`)
      count = await forEachCsvBatch(path.join(dir, file), config.IMPORT_BATCH_SIZE, async rows => {
        for (const row of rows) {
          const idKey = Object.keys(row).find(key => key.endsWith('_id'))
          await inventory.record(file, name, idKey ? row[idKey] : undefined, row)
        }
        if (normalized.has(name)) {
          const batchStats = await importGtfsToDb({ [name]: rows } as GtfsFiles, () => {}, {}, false)
          for (const key of Object.keys(stats) as (keyof ImportStats)[]) stats[key] += batchStats[key]
        }
      })
      await log(`  ${count} enregistrements : ${file}`)
    }
    await inventory.saveFile(dir, file, count)
  }
  for (const name of ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']) {
    if (!seen.has(name)) throw new Error(`Fichier GTFS requis absent : ${name}`)
  }
  if (!seen.has('calendar.txt') && !seen.has('calendar_dates.txt')) throw new Error('Aucun calendrier GTFS')
  await inventory.finish()
  return stats
}
