import { prisma } from '../db.js'
import { cleanupTmp, downloadAndExtract, fetchGtfsMetadata, fetchRfuInfo } from './downloader.js'
import { importGtfsToDb } from './importer.js'
import { parseGtfsDirectory } from './parser.js'
import type { ImportStats } from './types.js'

let importRunning = false

function extractRfuTimestamp(info: Record<string, unknown>): string | null {
  const candidates = [
    info.updated_at,
    info.updatedAt,
    info.lastModified,
    info.last_modified,
    info.version,
  ]
  for (const c of candidates) {
    if (c !== undefined && c !== null) return String(c)
  }
  return null
}

async function appendLog(jobId: string, message: string) {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } })
  if (!job) return
  const logs = JSON.parse(job.logs) as string[]
  logs.push(`[${new Date().toISOString()}] ${message}`)
  await prisma.importJob.update({ where: { id: jobId }, data: { logs: JSON.stringify(logs) } })
}

export async function syncGtfs(triggeredBy: 'manual' | 'scheduler' = 'manual', force = false) {
  if (importRunning) {
    throw new Error('Un import est déjà en cours')
  }

  importRunning = true

  const job = await prisma.importJob.create({
    data: { status: 'PENDING', triggeredBy },
  })

  try {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: 'DOWNLOADING', startedAt: new Date() },
    })

    const rfuInfo = await fetchRfuInfo()
    const gtfsMeta = await fetchGtfsMetadata().catch(() => null)

    const rfuUpdatedAt =
      extractRfuTimestamp(rfuInfo ?? {}) ??
      gtfsMeta?.etag ??
      gtfsMeta?.lastModified ??
      null
    const rfuVersion = rfuInfo?.version ? String(rfuInfo.version) : gtfsMeta?.etag ?? null

    const meta = await prisma.datasetMeta.findUnique({ where: { id: 'default' } })

    if (!force && meta?.rfuUpdatedAt && rfuUpdatedAt && meta.rfuUpdatedAt === rfuUpdatedAt) {
      await appendLog(job.id, 'Données RFU inchangées — import ignoré')
      await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: 'SKIPPED',
          completedAt: new Date(),
          stats: meta.stats,
        },
      })
      return job.id
    }

    await appendLog(job.id, 'Téléchargement du GTFS depuis le RFU...')
    const extractDir = await downloadAndExtract(job.id)

    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: 'PARSING' },
    })
    await appendLog(job.id, 'Parsing des fichiers GTFS...')
    const gtfs = parseGtfsDirectory(extractDir)

    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: 'IMPORTING' },
    })

    const stats = await importGtfsToDb(gtfs, (msg) => appendLog(job.id, msg))

    await prisma.datasetMeta.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        lastImport: new Date(),
        rfuVersion,
        rfuUpdatedAt,
        stats: JSON.stringify(stats),
      },
      update: {
        lastImport: new Date(),
        rfuVersion,
        rfuUpdatedAt,
        stats: JSON.stringify(stats),
      },
    })

    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        stats: JSON.stringify(stats),
      },
    })

    await appendLog(job.id, `Import terminé : ${stats.routes} lignes, ${stats.stops} arrêts`)
    cleanupTmp(job.id)

    return job.id
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await appendLog(job.id, `Erreur : ${message}`)
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage: message,
      },
    })
    cleanupTmp(job.id)
    throw err
  } finally {
    importRunning = false
  }
}

export function isImportRunning() {
  return importRunning
}

export async function getDatasetStats(): Promise<ImportStats & { lastImport?: Date | null }> {
  const [meta, routes, stops, trips, agencies] = await Promise.all([
    prisma.datasetMeta.findUnique({ where: { id: 'default' } }),
    prisma.route.count(),
    prisma.stop.count(),
    prisma.trip.count(),
    prisma.agency.count(),
  ])

  const stored = meta?.stats ? (JSON.parse(meta.stats) as ImportStats) : null

  return {
    agencies,
    routes,
    stops,
    trips,
    stopTimes: stored?.stopTimes ?? 0,
    calendars: stored?.calendars ?? 0,
    calendarDates: stored?.calendarDates ?? 0,
    shapes: stored?.shapes ?? 0,
    lastImport: meta?.lastImport,
  }
}
