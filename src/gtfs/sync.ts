import { prisma, getActiveSource, getMetaId } from '../db.js'
import type { DataSource } from '../config.js'
import { config, getSourceConfig } from '../config.js'
import { cleanupTmp, downloadAndExtract, fetchRfuInfo, fetchZipMetadata } from './downloader.js'
import { importGtfsDirectory } from './stream-import.js'
import type { ImportStats } from './types.js'
import { syncNetex } from '../netex/sync.js'
import { isImportRunning, reportImportActivity, setImportRunning, setDownloadProgress } from '../import-state.js'
import { runImportInWorker, shouldUseImportWorker } from '../import-runner.js'
import { importNavitiaLineGeometries } from '../navitia/line-geometries.js'

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
  if (logs.length > 300) logs.splice(0, logs.length - 300)
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
  extractDirOverride?: string,
) {
  if (process.env.IMPORT_WORKER !== '1') return runImportInWorker(source, triggeredBy, force, extractDirOverride)
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
    const job = process.env.IMPORT_JOB_ID
      ? await prisma.importJob.findUniqueOrThrow({ where: { id: process.env.IMPORT_JOB_ID } })
      : await prisma.importJob.create({
      data: { status: 'PENDING', triggeredBy, source },
    })

    try {
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'DOWNLOADING', startedAt: new Date() },
      })

      reportImportActivity(`Vérification de la publication ${src.label}`, {
        phase: 'preparing',
        phasePercent: 85,
        detail: extractDirOverride ? 'Import depuis un dossier local' : 'Lecture de la version distante',
      })

      const rfuInfo = extractDirOverride ? null : await fetchRfuInfo(source)
      const zipMeta = extractDirOverride ? null : await fetchZipMetadata(source).catch(() => null)

      const rfuUpdatedAt =
        extractRfuTimestamp(rfuInfo ?? {}) ?? zipMeta?.etag ?? zipMeta?.lastModified ?? null
      const rfuVersion = rfuInfo?.version ? String(rfuInfo.version) : zipMeta?.etag ?? null

      const meta = await prisma.datasetMeta.findUnique({ where: { id: metaId } })

      let previousStats: Record<string, unknown> = {}
      try {
        if (meta?.stats) previousStats = JSON.parse(meta.stats) as Record<string, unknown>
      } catch {
        previousStats = {}
      }
      const hasNavitiaGeometry = Number(previousStats.navitiaGeometries ?? 0) > 0
      const canReusePublishedVersion = Boolean(previousStats.sourceFiles)
        && (!config.NAVITIA_TOKEN || hasNavitiaGeometry)

      if (!force && canReusePublishedVersion && meta?.rfuUpdatedAt && rfuUpdatedAt && meta.rfuUpdatedAt === rfuUpdatedAt) {
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

      let extractDir: string
      if (extractDirOverride) {
        extractDir = extractDirOverride
        await appendLog(job.id, `Import ${src.label} depuis le dossier local ${extractDir}`)
        reportImportActivity('Dossier GTFS local prêt', {
          phase: 'indexing',
          phasePercent: 0,
          detail: 'Détection des fichiers CSV et de leur taille',
          currentItem: extractDir,
        })
      } else {
        await appendLog(job.id, `Téléchargement ${src.label} depuis ${src.zipUrl}…`)
        setDownloadProgress({
          phase: 'downloading',
          phasePercent: 0,
          detail: `Connexion à ${new URL(src.zipUrl).host}`,
          currentItem: src.zipUrl,
          bytesReceived: 0,
          bytesTotal: null,
          speedBps: null,
          etaSeconds: null,
        })
        extractDir = await downloadAndExtract(job.id, source)
      }

      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'PARSING' },
      })
      setDownloadProgress({ phase: 'parsing', percent: null, etaSeconds: null, speedBps: null })
      await appendLog(job.id, `Parsing des fichiers ${src.label} (léger)…`)


      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'IMPORTING' },
      })
      reportImportActivity('Début de la lecture des tables GTFS', {
        phase: 'indexing',
        phasePercent: 0,
        detail: 'Détection des fichiers et de leur taille',
        currentItem: null,
      })

      const stats = await importGtfsDirectory(extractDir, (msg) => appendLog(job.id, msg))

      try {
        const navitia = await importNavitiaLineGeometries((msg) => appendLog(job.id, msg))
        Object.assign(stats, {
          navitiaLinesFetched: navitia.fetched,
          navitiaLinesMatched: navitia.matched,
          navitiaGeometries: navitia.imported,
          navitiaLinesUnmatched: navitia.unmatched,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        Object.assign(stats, { navitiaError: message })
        await appendLog(job.id, `Tracés Navitia indisponibles : ${message}; shapes GTFS conservés`)
        reportImportActivity('Échec des tracés Navitia, shapes GTFS conservés', {
          phase: 'importing',
          detail: message,
          currentItem: null,
        })
      }

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
          status: 'VALIDATING',
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
  const published = await prisma.datasetMeta.findUnique({ where: { id: metaId } })
  if (published?.stats) {
    const stats = JSON.parse(published.stats)
    if (stats.sourceFiles !== undefined) return { ...stats, lastImport: published.lastImport }
  }
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
      prisma.stop.count({ where: { isPoi: true } }),
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
