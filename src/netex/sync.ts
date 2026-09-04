import { prisma, getActiveSource, getMetaId } from '../db.js'
import { getSourceConfig } from '../config.js'
import { cleanupTmp, downloadAndExtract, fetchRfuInfo, fetchZipMetadata } from './downloader.js'
import { importGtfsToDb } from '../gtfs/importer.js'
import { isImportRunning, setImportRunning, setDownloadProgress } from '../import-state.js'
import { buildNetexDataset } from './parser.js'

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

export async function syncNetex(
  triggeredBy: 'manual' | 'scheduler' = 'manual',
  force = false,
  extractDirOverride?: string,
) {
  if (isImportRunning()) {
    throw new Error('Un import est déjà en cours')
  }
  if (getActiveSource() !== 'netex') {
    throw new Error('Activez la source NeTEx avant d’importer')
  }

  setImportRunning(true)
  const src = getSourceConfig('netex')
  const metaId = getMetaId('netex')

  const job = await prisma.importJob.create({
    data: { status: 'PENDING', triggeredBy, source: 'netex' },
  })

  try {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: 'DOWNLOADING', startedAt: new Date() },
    })

    let extractDir = extractDirOverride
    let rfuUpdatedAt: string | null = null
    let rfuVersion: string | null = null

    if (!extractDir) {
      const rfuInfo = await fetchRfuInfo('netex')
      const zipMeta = await fetchZipMetadata('netex').catch(() => null)
      rfuUpdatedAt =
        extractRfuTimestamp(rfuInfo ?? {}) ?? zipMeta?.etag ?? zipMeta?.lastModified ?? null
      rfuVersion = rfuInfo?.version ? String(rfuInfo.version) : zipMeta?.etag ?? null

      const meta = await prisma.datasetMeta.findUnique({ where: { id: metaId } })
      if (!force && meta?.rfuUpdatedAt && rfuUpdatedAt && meta.rfuUpdatedAt === rfuUpdatedAt) {
        await appendLog(job.id, 'Données NeTEx inchangées — import ignoré')
        await prisma.importJob.update({
          where: { id: job.id },
          data: { status: 'SKIPPED', completedAt: new Date(), stats: meta.stats },
        })
        return job.id
      }

      await appendLog(job.id, `Téléchargement NeTEx depuis ${src.zipUrl}…`)
      extractDir = await downloadAndExtract(job.id, 'netex')
    } else {
      await appendLog(job.id, `Import NeTEx depuis le dossier local ${extractDir}`)
      rfuUpdatedAt = `local:${Date.now()}`
      rfuVersion = 'local'
    }

    await prisma.importJob.update({ where: { id: job.id }, data: { status: 'PARSING' } })
    setDownloadProgress({ phase: 'parsing', percent: null, etaSeconds: null, speedBps: null })
    await appendLog(job.id, 'Parsing NeTEx…')
    const dataset = buildNetexDataset(extractDir, (msg) => appendLog(job.id, msg))

    await prisma.importJob.update({ where: { id: job.id }, data: { status: 'IMPORTING' } })
    setDownloadProgress({ phase: 'importing', percent: null, etaSeconds: null, speedBps: null })
    const stats = await importGtfsToDb(dataset, (msg) => appendLog(job.id, msg), {
      routeExtras: dataset.routeExtras,
      stopExtras: dataset.stopExtras,
      fareZoneExtras: dataset.fareZoneExtras,
    })

    await prisma.datasetMeta.upsert({
      where: { id: metaId },
      create: {
        id: metaId,
        lastImport: new Date(),
        rfuVersion,
        rfuUpdatedAt,
        stats: JSON.stringify(stats),
        format: 'netex',
      },
      update: {
        lastImport: new Date(),
        rfuVersion,
        rfuUpdatedAt,
        stats: JSON.stringify(stats),
        format: 'netex',
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
    await appendLog(job.id, `Import NeTEx terminé : ${stats.routes} lignes, ${stats.stops} arrêts`)
    if (!extractDirOverride) cleanupTmp(job.id)
    return job.id
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await appendLog(job.id, `Erreur : ${message}`)
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', completedAt: new Date(), errorMessage: message },
    })
    if (!extractDirOverride) cleanupTmp(job.id)
    throw err
  } finally {
    setImportRunning(false)
  }
}
