import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = path.resolve(process.cwd(), 'data')

export type StorageFileInfo = {
  name: string
  sizeBytes: number
  sizeLabel: string
}

export type StorageStatus = {
  dataDir: string
  /** true si /app/data (ou ./data) est un montage Docker/Coolify */
  volumeMounted: boolean
  exists: boolean
  writable: boolean
  files: StorageFileInfo[]
  hasGtfsDb: boolean
  hasNetexDb: boolean
  warning: string | null
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} Go`
}

/** Détecte si le dossier data est un volume monté (Coolify / Docker). */
export function isDataVolumeMounted(dataDir = DATA_DIR): boolean {
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8')
    const normalized = path.resolve(dataDir)
    for (const line of mounts.split('\n')) {
      const parts = line.split(' ')
      if (parts.length < 2) continue
      const mountPoint = parts[1]?.replace(/\\040/g, ' ')
      if (mountPoint === normalized) return true
    }
  } catch {
    /* hors Linux / pas de /proc */
  }
  return false
}

export function getStorageStatus(): StorageStatus {
  const dataDir = DATA_DIR
  const exists = fs.existsSync(dataDir)
  let writable = false
  if (exists) {
    try {
      fs.accessSync(dataDir, fs.constants.W_OK)
      writable = true
    } catch {
      writable = false
    }
  }

  const volumeMounted = isDataVolumeMounted(dataDir)
  const files: StorageFileInfo[] = []
  if (exists) {
    try {
      for (const name of fs.readdirSync(dataDir)) {
        const full = path.join(dataDir, name)
        const st = fs.statSync(full)
        if (!st.isFile()) continue
        files.push({ name, sizeBytes: st.size, sizeLabel: formatBytes(st.size) })
      }
    } catch {
      /* ignore */
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name))

  const hasGtfsDb = files.some(
    (f) => f.name === 'maasterplan.db' || f.name === 'gtfs.db',
  )
  const hasNetexDb = files.some((f) => f.name === 'netex.db')

  let warning: string | null = null
  if (process.env.NODE_ENV === 'production' && !volumeMounted) {
    warning =
      'Le dossier /app/data n’est pas un volume persistent Coolify. ' +
      'Chaque redéploiement efface GTFS/NeTEx. ' +
      'Dans Coolify → Storages : ajoutez un volume avec Destination Path = /app/data'
  } else if (process.env.NODE_ENV === 'production' && !hasGtfsDb && !hasNetexDb) {
    warning =
      'Aucune base SQLite trouvée dans /app/data. ' +
      'Si vous venez de redéployer et que vos imports ont disparu, ' +
      'ajoutez un Storage Coolify (Destination Path = /app/data), redéployez, puis réimportez. ' +
      'Au premier démarrage avec un volume déjà monté, lancez simplement un import.'
  } else if (!writable) {
    warning = `Le dossier data n’est pas accessible en écriture : ${dataDir}`
  }

  return {
    dataDir,
    volumeMounted,
    exists,
    writable,
    files,
    hasGtfsDb,
    hasNetexDb,
    warning,
  }
}

export function logStorageStatus(log: (msg: string) => void = console.log) {
  const s = getStorageStatus()
  log(`[Storage] dataDir=${s.dataDir}`)
  log(
    `[Storage] volume monté=${s.volumeMounted ? 'oui' : 'NON'} · writable=${s.writable ? 'oui' : 'non'}`,
  )
  if (s.files.length === 0) {
    log('[Storage] (aucun fichier — bases vides / premier démarrage)')
  } else {
    for (const f of s.files) {
      log(`[Storage]   ${f.name} (${f.sizeLabel})`)
    }
  }
  if (s.warning) {
    log(`[Storage] ⚠️  ${s.warning}`)
  }
}
