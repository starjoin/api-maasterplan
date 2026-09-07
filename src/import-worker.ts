import os from 'node:os'
import { isDataSource } from './config.js'
import { bindSourceInProcess, disconnectDatabases, prisma } from './db.js'
import { validateDataset } from './validation.js'
import { reportImportActivity } from './import-state.js'

async function main() {
  const source = process.argv[2]
  if (!isDataSource(source)) throw new Error('Source invalide')
  if (!process.env.IMPORT_DATABASE_URL || !process.env.IMPORT_JOB_ID) throw new Error('Import uniquement via le superviseur')
  try { os.setPriority(0, 10) } catch { /* platform dependent */ }
  process.on('disconnect', () => process.exit(1))
  const heartbeat = setInterval(() => process.send?.({ type: 'heartbeat', rss: process.memoryUsage().rss }), 1000)
  try {
    await bindSourceInProcess(source)
    const previous = JSON.parse(process.env.IMPORT_PREVIOUS_META ?? 'null')
    if (previous) await prisma.datasetMeta.update({ where: { id: source }, data: { rfuUpdatedAt: previous.rfuUpdatedAt, rfuVersion: previous.rfuVersion, stats: previous.stats } })
    const trigger = process.argv[3] === 'scheduler' ? 'scheduler' : 'manual'
    const force = process.argv[4] === 'true'
    const localDir = process.argv[5] || undefined
    const jobId = source === 'netex'
      ? await (await import('./netex/sync.js')).syncNetex(trigger, force, localDir)
      : await (await import('./gtfs/sync.js')).syncGtfs(trigger, force, source, localDir)
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })
    if (job.status !== 'SKIPPED') {
      await prisma.importJob.update({ where: { id: jobId }, data: { status: 'VALIDATING', completedAt: null } })
      reportImportActivity('Début des contrôles de cohérence', {
        phase: 'validating',
        phasePercent: 0,
        detail: 'Vérification de la base et des relations',
      })
      await validateDataset(source)
      reportImportActivity('Données cohérentes, préparation des résumés', {
        phase: 'summarizing',
        phasePercent: 0,
        detail: 'Calcul des lignes représentatives et des amplitudes horaires',
      })
      await (await import('./line-summary.js')).buildLineSummaries()
      reportImportActivity('Résumés calculés', {
        phase: 'summarizing',
        phasePercent: 90,
        detail: 'Synchronisation finale de la base sur disque',
      })
      await prisma.$executeRawUnsafe('PRAGMA synchronous = FULL')
      await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)')
      reportImportActivity('Base synchronisée sur disque', {
        phase: 'summarizing',
        phasePercent: 100,
        detail: 'Le serveur va publier la nouvelle version',
      })
    }
    await disconnectDatabases()
  } finally { clearInterval(heartbeat) }
}
main().then(() => process.exit(0)).catch(error => {
  console.error('[Import]', error instanceof Error ? error.message : error)
  process.send?.({ type: 'error', message: error instanceof Error ? error.message : String(error) }, () => process.exit(1))
  if (!process.send) process.exit(1)
})
