import { fork } from 'node:child_process'
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
  // Toujours résoudre depuis cwd (Docker WORKDIR=/app, dist/ à la racine)
  return path.resolve(process.cwd(), 'dist', 'import-worker.js')
}

/**
 * Lance l’import dans un process enfant.
 * Le serveur HTTP parent reste responsive (pas de freeze / OOM partagé).
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
  setDownloadProgress({ phase: 'downloading', percent: 0 })

  const src = getSourceConfig(source)

  return new Promise<string>((resolve, reject) => {
    const child = fork(script, [source, triggeredBy, String(force)], {
      // Ne pas hériter du --max-old-space-size=512 du serveur HTTP
      execArgv: ['--max-old-space-size=3072'],
      env: {
        ...process.env,
        DATABASE_URL: src.databaseUrl,
        IMPORT_WORKER: '1',
        NODE_OPTIONS: '',
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    })

    let settled = false
    let jobId: string | null = null

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      setImportRunning(false)
      setDownloadProgress({ phase: 'idle', percent: null })
      if (err) reject(err)
      else resolve(jobId ?? 'unknown')
    }

    child.on('message', (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return
      const m = msg as {
        type?: string
        jobId?: string
        message?: string
        progress?: DownloadProgress
      }
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

export function shouldUseImportWorker(): boolean {
  if (process.env.IMPORT_WORKER === '1') return false
  if (process.env.IMPORT_USE_WORKER === 'false') return false
  if (process.env.IMPORT_USE_WORKER === 'true') return true
  // Coolify / Docker : toujours isoler. En local tsx : inline (worker = dist/).
  return process.env.NODE_ENV === 'production'
}
