import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { DataSource } from './config.js'
import { getSourceConfig } from './config.js'
import { withSourcePrisma } from './db.js'
import {
  isImportRunning,
  setImportRunning,
  setDownloadProgress,
  type DownloadProgress,
} from './import-state.js'

function workerScript(): string {
  return path.resolve(process.cwd(), 'dist', 'import-worker.js')
}

const WORKER_STALL_MS = 180_000

/**
 * Lance l’import dans un process enfant (surtout NeTEx).
 * Le serveur HTTP parent reste responsive.
 */
export async function runImportInWorker(
  source: DataSource,
  triggeredBy: 'manual' | 'scheduler',
  force: boolean,
): Promise<string> {
  if (isImportRunning()) {
    throw new Error('Un import est déjà en cours')
  }

  const script = workerScript()
  if (!fs.existsSync(script)) {
    throw new Error(`Worker introuvable: ${script} (npm run build requis)`)
  }

  setImportRunning(true)
  // Pas de faux "downloading" : on attend le 1er message worker
  setDownloadProgress({ phase: 'idle', percent: null })

  const src = getSourceConfig(source)
  let lastBeat = Date.now()
  let child: ChildProcess | null = null

  return new Promise<string>((resolve, reject) => {
    child = fork(script, [source, triggeredBy, String(force)], {
      execArgv: ['--max-old-space-size=3072'],
      env: {
        ...process.env,
        DATABASE_URL: src.databaseUrl,
        IMPORT_WORKER: '1',
        IMPORT_SKIP_MIGRATE: '1',
        NODE_OPTIONS: '',
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    })

    let settled = false
    let jobId: string | null = null

    const watchdog = setInterval(() => {
      if (settled) return
      if (Date.now() - lastBeat > WORKER_STALL_MS) {
        console.error(`[import-runner] Worker ${source} sans activité > ${WORKER_STALL_MS / 1000}s — kill`)
        child?.kill('SIGTERM')
        finish(new Error(`Import ${src.label} bloqué (aucune activité ${WORKER_STALL_MS / 1000}s)`))
      }
    }, 15_000)

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearInterval(watchdog)
      setImportRunning(false)
      setDownloadProgress({ phase: 'idle', percent: null })
      if (err) reject(err)
      else resolve(jobId ?? 'unknown')
    }

    child.on('spawn', () => {
      lastBeat = Date.now()
      console.log(`[import-runner] Worker ${source} démarré pid=${child?.pid}`)
      setDownloadProgress({ phase: 'downloading', percent: 0 })
    })

    child.on('message', (msg: unknown) => {
      lastBeat = Date.now()
      if (!msg || typeof msg !== 'object') return
      const m = msg as {
        type?: string
        jobId?: string
        message?: string
        progress?: DownloadProgress
      }
      if (m.type === 'heartbeat') return
      if (m.type === 'progress' && m.progress) {
        setDownloadProgress(m.progress)
      }
      if (m.type === 'done' && m.jobId) {
        jobId = m.jobId
      }
      if (m.type === 'error' && m.message) {
        finish(new Error(m.message))
      }
    })

    child.on('error', (err) => {
      finish(err)
    })

    child.on('exit', (code, signal) => {
      if (settled) return
      if (code === 0) {
        finish()
        return
      }
      const reason = signal
        ? `tué par signal ${signal} (souvent OOM / mémoire insuffisante)`
        : `code ${code}`
      void (async () => {
        try {
          await withSourcePrisma(source, async (client) => {
            await client.importJob.updateMany({
              where: {
                source,
                status: { in: ['PENDING', 'DOWNLOADING', 'PARSING', 'IMPORTING'] },
              },
              data: {
                status: 'FAILED',
                completedAt: new Date(),
                errorMessage: `Process import interrompu (${reason})`,
              },
            })
          })
        } catch {
          /* ignore */
        }
        finish(new Error(`Import ${src.label} interrompu (${reason})`))
      })()
    })
  })
}

/**
 * Worker process : utile pour NeTEx (RAM).
 * GTFS reste inline par défaut — le fork Coolify restait parfois bloqué avant le 1er octet.
 */
export function shouldUseImportWorker(source: DataSource = 'gtfs'): boolean {
  if (process.env.IMPORT_WORKER === '1') return false
  if (process.env.IMPORT_USE_WORKER === 'false') return false
  if (process.env.IMPORT_USE_WORKER === 'always') return true
  if (process.env.IMPORT_USE_WORKER === 'true' && source === 'netex') return true
  // Prod : NeTEx isolé seulement
  if (process.env.NODE_ENV === 'production' && source === 'netex') return true
  return false
}
