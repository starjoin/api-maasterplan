import { stopImportWorker } from './import-runner.js'
import { config, DATA_SOURCES } from './config.js'
import { buildServer } from './server.js'
import {
  ensureSourceDatabase,
  recoverImports,
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

  for (const source of DATA_SOURCES) await recoverImports(source)
  const shutdown = async () => {
    stopImportWorker()
    await app.close()
    process.exit(0)
  }
  process.once('SIGTERM', () => void shutdown())
  process.once('SIGINT', () => void shutdown())

  for (const source of DATA_SOURCES) await withSourcePrisma(source, () => import('./engine/index.js').then(engine => engine.reloadEndpoints(app)))
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


  }
}

main().catch((err) => {
  console.error('Erreur fatale :', err)
  process.exit(1)
})
