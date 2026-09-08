import { runImportInWorker } from '../import-runner.js'
import { prisma, getActiveSource, getMetaId } from '../db.js'
import { config, getSourceConfig } from '../config.js'
import { cleanupTmp, downloadAndExtract, fetchRfuInfo, fetchZipMetadata } from './downloader.js'
import { isImportRunning, reportImportActivity, setImportRunning, setDownloadProgress } from '../import-state.js'
import { importNetexExtractDir } from './import-pipeline.js'
import { importNavitiaLineGeometries } from '../navitia/line-geometries.js'

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
  await prisma.importJob.update({ where: { id: job.id }, data: { logs: JSON.stringify(logs) } })
}

export async function syncNetex(
  triggeredBy: 'manual' | 'scheduler' = 'manual',
  force = false,
  extractDirOverride?: string,
) {
  if (process.env.IMPORT_WORKER !== '1') return runImportInWorker('netex', triggeredBy, force, extractDirOverride)
  if (isImportRunning()) {
    throw new Error('Un import est déjà en cours')
  }
  // Le worker fixe activeSource en mémoire ; le serveur HTTP peut rester sur une autre source
  const skipActiveCheck = process.env.IMPORT_WORKER === '1'
  if (!skipActiveCheck && getActiveSource() !== 'netex') {
    throw new Error('Activez la source NeTEx avant d’importer')
  }

  setImportRunning(true)
  const src = getSourceConfig('netex')
  const metaId = getMetaId('netex')

  const job = process.env.IMPORT_JOB_ID
      ? await prisma.importJob.findUniqueOrThrow({ where: { id: process.env.IMPORT_JOB_ID } })
      : await prisma.importJob.create({
    data: { status: 'PENDING', triggeredBy, source: 'netex' },
  })

  try {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: 'DOWNLOADING', startedAt: new Date() },
    })

    reportImportActivity('Vérification de la publication NeTEx', {
      phase: 'preparing',
      phasePercent: 85,
      detail: extractDirOverride ? 'Import depuis un dossier local' : 'Lecture de la version distante',
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
      reportImportActivity('Dossier NeTEx local prêt', {
        phase: 'indexing',
        phasePercent: 0,
        detail: 'Détection des fichiers XML et des entités',
        currentItem: extractDir,
      })
      rfuUpdatedAt = `local:${Date.now()}`
      rfuVersion = 'local'
    }

    await prisma.importJob.update({ where: { id: job.id }, data: { status: 'IMPORTING' } })
    if (!extractDirOverride) reportImportActivity('Début de l’inventaire NeTEx', {
      phase: 'indexing',
      phasePercent: 0,
      detail: 'Lecture progressive de tous les fichiers XML',
      currentItem: null,
    })
    await appendLog(job.id, 'Parsing + import NeTEx incrémental (fichier par fichier)…')

    const stats = await importNetexExtractDir(extractDir, (msg) => appendLog(job.id, msg))

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
      await appendLog(job.id, `Tracés Navitia indisponibles : ${message}; données NeTEx conservées`)
      reportImportActivity('Échec des tracés Navitia, données NeTEx conservées', {
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
        status: 'VALIDATING',
        completedAt: new Date(),
        stats: JSON.stringify(stats),
      },
    })
    await appendLog(job.id, `Import NeTEx terminé : ${stats.routes} lignes, ${stats.stops} arrêts`)
    if (!extractDirOverride) cleanupTmp(job.id)
    return job.id
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await appendLog(job.id, `Erreur : ${message}`).catch(() => undefined)
    await prisma.importJob
      .update({
        where: { id: job.id },
        data: { status: 'FAILED', completedAt: new Date(), errorMessage: message },
      })
      .catch(() => undefined)
    if (!extractDirOverride) cleanupTmp(job.id)
    throw err
  } finally {
    setImportRunning(false)
  }
}
