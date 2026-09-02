import { config } from './config.js'
import { buildServer } from './server.js'
import { initDatabase, prisma } from './db.js'
import { startScheduler } from './scheduler/index.js'
import { syncGtfs } from './gtfs/sync.js'
import { seedDefaultEndpoints } from './seed.js'

async function seedIfNeeded() {
  const count = await prisma.apiEndpoint.count()
  if (count > 0) return

  console.log('[Seed] Initialisation des endpoints par défaut...')
  await seedDefaultEndpoints(prisma)
}

async function main() {
  await initDatabase()
  await prisma.$connect()
  console.log('[DB] Connecté (SQLite WAL)')

  await seedIfNeeded()

  const app = await buildServer()
  startScheduler(app)

  if (config.AUTO_IMPORT_ON_START) {
    const meta = await prisma.datasetMeta.findUnique({ where: { id: 'default' } })
    if (!meta?.lastImport) {
      console.log('[GTFS] Premier démarrage — import initial...')
      syncGtfs('manual').catch((err) => {
        app.log.error(err, '[GTFS] Import initial échoué')
      })
    }
  }

  await app.listen({ port: config.PORT, host: config.HOST })
  console.log(`[Server] http://${config.HOST}:${config.PORT}`)
}

main().catch((err) => {
  console.error('Erreur fatale :', err)
  process.exit(1)
})
