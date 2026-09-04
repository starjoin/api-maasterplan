export type DownloadProgress = {
  phase: 'idle' | 'downloading' | 'extracting' | 'parsing' | 'importing'
  percent: number | null
  bytesReceived: number
  bytesTotal: number | null
  speedBps: number | null
  etaSeconds: number | null
  updatedAt: number
}

const IDLE: DownloadProgress = {
  phase: 'idle',
  percent: null,
  bytesReceived: 0,
  bytesTotal: null,
  speedBps: null,
  etaSeconds: null,
  updatedAt: 0,
}

let importRunning = false
let downloadProgress: DownloadProgress = { ...IDLE }

export function isImportRunning() {
  return importRunning
}

export function setImportRunning(value: boolean) {
  importRunning = value
  if (!value) {
    downloadProgress = { ...IDLE }
  }
}

export function getDownloadProgress(): DownloadProgress {
  return downloadProgress
}

export function setDownloadProgress(partial: Partial<DownloadProgress>) {
  downloadProgress = {
    ...downloadProgress,
    ...partial,
    updatedAt: Date.now(),
  }
  // Remonter la progression au process HTTP parent (worker d’import)
  if (process.env.IMPORT_WORKER === '1' && typeof process.send === 'function') {
    try {
      process.send({ type: 'progress', progress: { ...downloadProgress } })
    } catch {
      /* ignore */
    }
  }
}

export function clearDownloadProgress() {
  downloadProgress = { ...IDLE }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} Go`
}

export function formatEta(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null
  if (seconds < 60) return `${Math.ceil(seconds)} s`
  const m = Math.floor(seconds / 60)
  const s = Math.ceil(seconds % 60)
  if (m < 60) return `${m} min ${s.toString().padStart(2, '0')} s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h} h ${rm} min`
}
