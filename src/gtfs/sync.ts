import { prisma, getActiveSource, getMetaId } from '../db.js'
import type { DataSource } from '../config.js'
import { getSourceConfig } from '../config.js'
import { cleanupTmp, downloadAndExtract, fetchRfuInfo, fetchZipMetadata } from './downloader.js'
import { importGtfsLargeFilesFromDir, importGtfsToDb } from './importer.js'
import { parseGtfsDirectory } from './parser.js'
import type { ImportStats } from './types.js'
import { syncNetex } from '../netex/sync.js'
import { isImportRunning, setImportRunning, setDownloadProgress } from '../import-state.js'
import { runImportInWorker, shouldUseImportWorker } from '../import-runner.js'

export { isImportRunning, setImportRunning }

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

/** Import de la source active (GTFS ou NeTEx). */
export async function syncDataset(
  triggeredBy: 'manual' | 'scheduler' = 'manual',
  force = false,
  source: DataSource = getActiveSource(),
) {
  // NeTEx / GTFS en process enfant en prod (évite OOM du HTTP Coolify à 512 Mo)
  if (shouldUseImportWorker(source)) {
    return runImportInWorker(source, triggeredBy, force)
  }
  if (source === 'netex') {
    return syncNetex(triggeredBy, force)
  }
  return syncGtfs(triggeredBy, force, source)
}

export async function syncGtfs(
  triggeredBy: 'manual' | 'scheduler' = 'manual',
  force = false,
  source: DataSource = 'gtfs',
) {
  if (isImportRunning()) {
    throw new Error('Un import est déjà en cours')
  }

  const skipActiveCheck = process.env.IMPORT_WORKER === '1'
  if (!skipActiveCheck && source !== getActiveSource()) {
    throw new Error('Activez la source GTFS avant d’importer')
  }

  setImportRunning(true)
  const src = getSourceConfig(source)
  const metaId = getMetaId(source)

  try {
    const job = await prisma.importJob.create({
      data: { status: 'PENDING', triggeredBy, source },
    })

    try {
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'DOWNLOADING', startedAt: new Date() },
      })

      const rfuInfo = await fetchRfuInfo(source)
      const zipMeta = await fetchZipMetadata(source).catch(() => null)

      const rfuUpdatedAt =
        extractRfuTimestamp(rfuInfo ?? {}) ?? zipMeta?.etag ?? zipMeta?.lastModified ?? null
      const rfuVersion = rfuInfo?.version ? String(rfuInfo.version) : zipMeta?.etag ?? null

      const meta = await prisma.datasetMeta.findUnique({ where: { id: metaId } })

      if (!force && meta?.rfuUpdatedAt && rfuUpdatedAt && meta.rfuUpdatedAt === rfuUpdatedAt) {
        await appendLog(job.id, `Données ${src.label} inchangées — import ignoré`)
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

      await appendLog(job.id, `Téléchargement ${src.label} depuis ${src.zipUrl}…`)
      setDownloadProgress({
        phase: 'downloading',
        percent: 0,
        bytesReceived: 0,
        bytesTotal: null,
        speedBps: null,
        etaSeconds: null,
      })
      const extractDir = await downloadAndExtract(job.id, source)

      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'PARSING' },
      })
      setDownloadProgress({ phase: 'parsing', percent: null, etaSeconds: null, speedBps: null })
      await appendLog(job.id, `Parsing des fichiers ${src.label} (léger)…`)
      const gtfs = parseGtfsDirectory(extractDir)

      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'IMPORTING' },
      })
      setDownloadProgress({ phase: 'importing', percent: null, etaSeconds: null, speedBps: null })

      const stats = await importGtfsToDb(gtfs, (msg) => appendLog(job.id, msg))
      await importGtfsLargeFilesFromDir(extractDir, stats, (msg) => appendLog(job.id, msg))

      await prisma.datasetMeta.upsert({
        where: { id: metaId },
        create: {
          id: metaId,
          lastImport: new Date(),
          rfuVersion,
          rfuUpdatedAt,
          stats: JSON.stringify(stats),
          format: source,
        },
        update: {
          lastImport: new Date(),
          rfuVersion,
          rfuUpdatedAt,
          stats: JSON.stringify(stats),
          format: source,
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
    }
  } finally {
    setImportRunning(false)
  }
}

export async function getDatasetStats(): Promise<ImportStats & { lastImport?: Date | null }> {
  const metaId = getMetaId()
  const [meta, routes, stops, trips, agencies, fareZones, fareAttributes, fareRules, transfers, pois] =
    await Promise.all([
      prisma.datasetMeta.findUnique({ where: { id: metaId } }),
      prisma.route.count(),
      prisma.stop.count(),
      prisma.trip.count(),
      prisma.agency.count(),
      prisma.fareZone.count(),
      prisma.fareAttribute.count(),
      prisma.fareRule.count(),
      prisma.transfer.count(),
      prisma.stop.count({ where: { locationType: 3 } }),
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
    fareZones,
    fareAttributes,
    fareRules,
    transfers,
    pois,
    lastImport: meta?.lastImport,
  }
}
