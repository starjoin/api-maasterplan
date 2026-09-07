import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config, type DataSource } from './config.js'
import { generationRoot, publishGeneration, withSourcePrisma, pruneGenerations, servingUrl } from './db.js'
import {
  isImportRunning,
  reportImportActivity,
  setImportHeartbeat,
  setImportRunning,
  setDownloadProgress,
  type DownloadProgress,
} from './import-state.js'

let child: ChildProcess | undefined
export function stopImportWorker() { child?.kill('SIGTERM') }
export async function runImportInWorker(source: DataSource, triggeredBy: 'manual' | 'scheduler', force: boolean, localDir?: string): Promise<string> {
  if (isImportRunning()) throw new Error('Un import est déjà en cours')
  setImportRunning(true)
  let generationDir: string | undefined
  let jobId: string | undefined
  let published = false
  try {
    const job = await withSourcePrisma(source, client => client.importJob.create({ data: { source, triggeredBy, status: 'PENDING', startedAt: new Date() } }))
    jobId = job.id
    reportImportActivity(`Préparation de l’import ${source.toUpperCase()}`, {
      phase: 'preparing',
      phasePercent: 15,
      detail: 'Nettoyage des anciennes versions temporaires',
    })
    await pruneGenerations(source)
    generationDir = path.join(generationRoot(source), randomUUID())
    fs.mkdirSync(generationDir, { recursive: true })
    const disk = await fs.promises.statfs(generationDir)
    if (disk.bavail * disk.bsize < 256 * 1024 ** 2) throw new Error('Moins de 256 Mo de disque libre ; import refusé')
    const databaseUrl = `file:${path.join(generationDir, 'dataset.db')}`
    reportImportActivity('Base temporaire créée', {
      phase: 'preparing',
      phasePercent: 60,
      detail: 'Lecture des métadonnées de la version actuellement publiée',
    })
    const meta = await withSourcePrisma(source, client => client.datasetMeta.findUnique({ where: { id: source } }))
    const development = !__filename.endsWith('.js')
    const script = path.resolve(development ? 'src/import-worker.ts' : 'dist/import-worker.js')
    await new Promise<void>((resolve, reject) => {
      let failure: Error | undefined
      let lastBeat = Date.now()
      const started = Date.now()
      const terminate = (message: string) => { failure ??= new Error(message); child?.kill('SIGKILL') }
      child = fork(script, [source, triggeredBy, String(force), localDir ?? ''], {
        execArgv: [`--max-old-space-size=${config.IMPORT_HEAP_MB}`, ...(development ? ['--import', 'tsx'] : [])],
        env: { ...process.env, IMPORT_DATABASE_URL: databaseUrl, IMPORT_WORKER: '1', IMPORT_JOB_ID: job.id,
          IMPORT_PREVIOUS_META: JSON.stringify(meta), NODE_OPTIONS: '', UV_THREADPOOL_SIZE: '1' },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      })
      const watchdog = setInterval(() => {
        if (Date.now() - lastBeat > 180_000) terminate('Worker sans activité depuis 180 secondes')
        if (Date.now() - started > config.IMPORT_MAX_MINUTES * 60_000) terminate('Durée maximale d’import atteinte')
        // Linux RSS includes native allocations and buffers, unlike the V8 heap limit.
        if (process.platform === 'linux' && child?.pid) {
          try {
            const status = fs.readFileSync(`/proc/${child.pid}/status`, 'utf8')
            const kb = Number(status.match(/VmRSS:\s+(\d+)/)?.[1] ?? 0)
            if (kb > config.IMPORT_RSS_MB * 1024) terminate('Budget mémoire de l’import dépassé ; ancienne version conservée')
          } catch { /* process exiting */ }
        }
      }, 1000)
      child.on('message', (message: { type?: string; message?: string; progress?: DownloadProgress; rss?: number }) => {
        lastBeat = Date.now()
        if (message.type === 'progress' && message.progress) setDownloadProgress(message.progress)
        if (message.type === 'heartbeat') setImportHeartbeat(message.rss)
        if (message.type === 'error') failure = new Error(message.message ?? 'Échec import')
        if (message.rss && message.rss > config.IMPORT_RSS_MB * 1024 ** 2) terminate('Budget mémoire de l’import dépassé')
      })
      child.once('error', error => { clearInterval(watchdog); reject(error) })
      child.once('exit', (code, signal) => {
        clearInterval(watchdog)
        child = undefined
        if (failure || code !== 0) reject(failure ?? new Error(`Worker interrompu (${signal ?? code}) ; ancienne version conservée`))
        else resolve()
      })
    })
    const result = await withSourcePrisma(source, client => client.importJob.findUniqueOrThrow({ where: { id: job.id } }))
    if (result.status !== 'SKIPPED') {
      if (result.status !== 'VALIDATING') throw new Error('Le worker n’a pas validé le nouvel import')
      reportImportActivity('Tous les contrôles sont passés', {
        phase: 'publishing',
        phasePercent: 20,
        detail: 'Bascule atomique vers la nouvelle version',
      })
      await publishGeneration(source, databaseUrl, job.id)
      published = true
      reportImportActivity('Nouvelle version publiée', {
        phase: 'publishing',
        phasePercent: 100,
        detail: 'Finalisation du journal d’import',
      })
      await withSourcePrisma(source, client => client.importJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', completedAt: new Date() } }))
    }
    return job.id
  } catch (error) {
    if (jobId && !published) await withSourcePrisma(source, client => client.importJob.update({ where: { id: jobId }, data: {
      status: 'FAILED', completedAt: new Date(), errorMessage: error instanceof Error ? error.message : String(error),
    } })).catch(console.error)
    throw error
  } finally {
    if (generationDir && !published && servingUrl(source) !== `file:${path.join(generationDir, 'dataset.db')}`) await fs.promises.rm(generationDir, { recursive: true, force: true }).catch(console.error)
    if (jobId) await fs.promises.rm(path.join(config.TMP_DIR, jobId), { recursive: true, force: true }).catch(console.error)
    setImportRunning(false)
    setDownloadProgress({ phase: 'idle', percent: null })
  }
}
export function shouldUseImportWorker(_source: DataSource = 'gtfs') { return process.env.IMPORT_WORKER !== '1' }
