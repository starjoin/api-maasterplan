/**
 * Process enfant d’import GTFS/NeTEx.
 * Isolé du serveur HTTP : un OOM ou un parse lourd ne tue pas Coolify / Traefik.
 *
 * argv: [source, triggeredBy, force]
 */
import { getSourceConfig, isDataSource, type DataSource } from './config.js'
import { bindSourceInProcess } from './db.js'

async function main() {
  const sourceArg = process.argv[2] ?? 'gtfs'
  const triggeredBy = (process.argv[3] === 'scheduler' ? 'scheduler' : 'manual') as
    | 'manual'
    | 'scheduler'
  const force = process.argv[4] === 'true'

  if (!isDataSource(sourceArg)) {
    console.error(`[import-worker] source invalide: ${sourceArg}`)
    process.exit(1)
  }
  const source: DataSource = sourceArg

  process.env.IMPORT_WORKER = '1'
  const src = getSourceConfig(source)
  process.env.DATABASE_URL = src.databaseUrl

  const heartbeat = setInterval(() => {
    try {
      process.send?.({ type: 'heartbeat', ts: Date.now() })
    } catch {
      /* ignore */
    }
  }, 10_000)

  try {
    console.log(`[import-worker] Démarrage import ${src.label} (force=${force})`)
    process.send?.({ type: 'progress', progress: { phase: 'downloading', percent: 0, bytesReceived: 0, bytesTotal: null, speedBps: null, etaSeconds: null, updatedAt: Date.now() } })

    await bindSourceInProcess(source)

    if (source === 'netex') {
      const { syncNetex } = await import('./netex/sync.js')
      const jobId = await syncNetex(triggeredBy, force)
      console.log(`[import-worker] Terminé job=${jobId}`)
      process.send?.({ type: 'done', jobId })
    } else {
      const { syncGtfs } = await import('./gtfs/sync.js')
      const jobId = await syncGtfs(triggeredBy, force, 'gtfs')
      console.log(`[import-worker] Terminé job=${jobId}`)
      process.send?.({ type: 'done', jobId })
    }
    clearInterval(heartbeat)
    process.exit(0)
  } catch (err) {
    clearInterval(heartbeat)
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[import-worker] Échec: ${message}`)
    if (err instanceof Error && err.stack) console.error(err.stack)
    try {
      process.send?.({ type: 'error', message })
    } catch {
      /* ignore */
    }
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[import-worker] fatal', err)
  process.exit(1)
})
