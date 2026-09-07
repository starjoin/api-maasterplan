export type DownloadProgress = {
  phase:
    | 'idle'
    | 'preparing'
    | 'downloading'
    | 'extracting'
    | 'indexing'
    | 'parsing'
    | 'importing'
    | 'validating'
    | 'summarizing'
    | 'publishing'
  percent: number | null
  phasePercent: number | null
  phaseLabel: string | null
  detail: string | null
  currentItem: string | null
  processed: number | null
  total: number | null
  unit: string | null
  counters: Record<string, number>
  recentEvents: Array<{ at: number; message: string }>
  bytesReceived: number
  bytesTotal: number | null
  speedBps: number | null
  etaSeconds: number | null
  startedAt: number
  lastActivityAt: number
  heartbeatAt: number
  workerRssBytes: number | null
  updatedAt: number
}

const IDLE: DownloadProgress = {
  phase: 'idle',
  percent: null,
  phasePercent: null,
  phaseLabel: null,
  detail: null,
  currentItem: null,
  processed: null,
  total: null,
  unit: null,
  counters: {},
  recentEvents: [],
  bytesReceived: 0,
  bytesTotal: null,
  speedBps: null,
  etaSeconds: null,
  startedAt: 0,
  lastActivityAt: 0,
  heartbeatAt: 0,
  workerRssBytes: null,
  updatedAt: 0,
}

const PHASE_RANGES: Record<Exclude<DownloadProgress['phase'], 'idle' | 'parsing'>, [number, number]> = {
  preparing: [0, 3],
  downloading: [3, 18],
  extracting: [18, 22],
  indexing: [22, 45],
  importing: [45, 82],
  validating: [82, 91],
  summarizing: [91, 97],
  publishing: [97, 100],
}

const PHASE_LABELS: Record<DownloadProgress['phase'], string> = {
  idle: 'En attente',
  preparing: 'Préparation',
  downloading: 'Téléchargement',
  extracting: 'Extraction',
  indexing: 'Inventaire des données sources',
  parsing: 'Lecture des données',
  importing: 'Import en base',
  validating: 'Contrôles de cohérence',
  summarizing: 'Optimisation des lignes',
  publishing: 'Publication de la nouvelle version',
}

let importRunning = false
let downloadProgress: DownloadProgress = { ...IDLE }
let lastWorkerProgressSentAt = 0
let lastWorkerProgressPhase: DownloadProgress['phase'] = 'idle'

export function isImportRunning() {
  return importRunning
}

export function setImportRunning(value: boolean) {
  importRunning = value
  if (value) {
    const now = Date.now()
    downloadProgress = {
      ...IDLE,
      phase: 'preparing',
      percent: 0,
      phasePercent: 0,
      phaseLabel: PHASE_LABELS.preparing,
      detail: 'Création d’une version isolée pour le nouvel import',
      startedAt: now,
      lastActivityAt: now,
      heartbeatAt: now,
      updatedAt: now,
    }
  } else {
    downloadProgress = { ...IDLE }
  }
}

export function getDownloadProgress(): DownloadProgress {
  return downloadProgress
}

export function setDownloadProgress(partial: Partial<DownloadProgress>, activity?: string) {
  const now = Date.now()
  const requestedPhase = partial.phase ?? downloadProgress.phase
  const phase = requestedPhase === 'parsing' ? 'indexing' : requestedPhase
  let phasePercent = partial.phasePercent
  if (phasePercent == null && partial.percent != null && phase === 'downloading') {
    phasePercent = partial.percent
  }
  if (phasePercent == null && phase !== downloadProgress.phase) phasePercent = 0
  const range = phase === 'idle' ? null : PHASE_RANGES[phase]
  const overallPercent =
    range && phasePercent != null
      ? range[0] + (range[1] - range[0]) * (Math.min(100, Math.max(0, phasePercent)) / 100)
      : partial.percent ?? downloadProgress.percent
  const recentEvents = partial.recentEvents
    ? partial.recentEvents.slice(-40)
    : activity
    ? [...downloadProgress.recentEvents, { at: now, message: activity }].slice(-40)
    : downloadProgress.recentEvents

  downloadProgress = {
    ...downloadProgress,
    ...partial,
    phase,
    percent: overallPercent == null ? null : Math.round(overallPercent * 10) / 10,
    phasePercent: phasePercent ?? downloadProgress.phasePercent,
    phaseLabel: partial.phaseLabel ?? PHASE_LABELS[phase],
    counters: partial.counters
      ? { ...downloadProgress.counters, ...partial.counters }
      : downloadProgress.counters,
    recentEvents,
    lastActivityAt: activity || Object.keys(partial).some((key) => key !== 'heartbeatAt' && key !== 'workerRssBytes')
      ? now
      : downloadProgress.lastActivityAt,
    heartbeatAt: partial.heartbeatAt ?? downloadProgress.heartbeatAt,
    updatedAt: now,
  }
  // Remonter la progression au process HTTP parent (worker d’import)
  if (process.env.IMPORT_WORKER === '1' && typeof process.send === 'function') {
    const phaseChanged = phase !== lastWorkerProgressPhase
    // Le tableau de bord interroge l’API chaque seconde : plafonner les IPC évite
    // qu’un flux de milliers de lignes/POI ne ralentisse le worker.
    const forceSend = phaseChanged || phasePercent === 100
    if (!forceSend && now - lastWorkerProgressSentAt < 200) return
    try {
      process.send({ type: 'progress', progress: { ...downloadProgress } })
      lastWorkerProgressSentAt = now
      lastWorkerProgressPhase = phase
    } catch {
      /* ignore */
    }
  }
}

export function reportImportActivity(
  message: string,
  partial: Partial<DownloadProgress> = {},
) {
  setDownloadProgress(partial, message)
}

export function setImportHeartbeat(workerRssBytes?: number) {
  const now = Date.now()
  downloadProgress = {
    ...downloadProgress,
    heartbeatAt: now,
    workerRssBytes: workerRssBytes ?? downloadProgress.workerRssBytes,
    updatedAt: now,
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
