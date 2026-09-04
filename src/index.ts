import { config, DATA_SOURCES } from './config.js'
import { buildServer } from './server.js'
import {
  ensureSourceDatabase,
  getActiveSource,
  getMetaId,
  initDatabase,
  prisma,
  setActiveSource,
  withSourcePrisma,
} from './db.js'
import { startScheduler } from './scheduler/index.js'
import { syncDataset } from './gtfs/sync.js'
import { seedDefaultEndpoints } from './seed.js'
import { startVehicleMonitoringPoller } from './siri/vehicle-monitoring.js'
import { listenDynamic } from './net/listen.js'
import { logStorageStatus } from './storage.js'

async function main() {
  logStorageStatus()
  for (const source of DATA_SOURCES) {
    await ensureSourceDatabase(source)
  }
  await setActiveSource(getActiveSource())
  await initDatabase()
  console.log(`[DB] Connecté (${getActiveSource()} / SQLite WAL)`)

  // Écouter tôt : Coolify / Traefik healthcheck → évite 503 pendant le seed
  const app = await buildServer()
  const port = await listenDynamic(app, config.PORT, config.HOST)
  console.log(`[Server] http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${port}`)

  console.log('[Seed] Synchronisation du catalogue SAE / Designer...')
  await seedDefaultEndpoints(prisma, getActiveSource())
  for (const source of DATA_SOURCES) {
    if (source === getActiveSource()) continue
    await withSourcePrisma(source, async (client) => {
      await seedDefaultEndpoints(client, source)
    })
  }

  startScheduler(app)
  startVehicleMonitoringPoller(app.log)

  if (config.AUTO_IMPORT_ON_START) {
    const meta = await prisma.datasetMeta.findUnique({ where: { id: getMetaId() } })
    const routeCount = await prisma.route.count()
    // Skip si déjà synchronisé OU si la base a déjà des données
    // (évite un re-téléchargement à chaque restart tsx watch)
    if (!meta?.lastImport && routeCount === 0) {
      console.log(`[Import] Premier démarrage (${getActiveSource()}) — import initial...`)
      syncDataset('manual').catch((err) => {
        app.log.error(err, '[Import] Import initial échoué')
      })
    } else if (!meta?.lastImport && routeCount > 0) {
      // Données présentes sans meta (migration dual-DB) — ne pas re-télécharger
      await prisma.datasetMeta.upsert({
        where: { id: getMetaId() },
        create: {
          id: getMetaId(),
          format: getActiveSource(),
          lastImport: new Date(),
          stats: JSON.stringify({ routes: routeCount }),
        },
        update: { lastImport: new Date(), format: getActiveSource() },
      })
      console.log(
        `[Import] Meta ${getActiveSource()} initialisée (${routeCount} lignes) — pas de re-téléchargement`,
      )
    }

    // Jobs interrompus par un restart → marquer FAILED
    const stuck = await prisma.importJob.updateMany({
      where: {
        status: { in: ['PENDING', 'DOWNLOADING', 'PARSING', 'IMPORTING'] },
      },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage: 'Interrompu (redémarrage serveur)',
      },
    })
    if (stuck.count > 0) {
      console.log(`[Import] ${stuck.count} job(s) interrompu(s) marqué(s) FAILED`)
    }
  }
}

main().catch((err) => {
  console.error('Erreur fatale :', err)
  process.exit(1)
})
