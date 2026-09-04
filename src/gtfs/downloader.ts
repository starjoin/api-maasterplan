import AdmZip from 'adm-zip'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import path from 'node:path'
import { config, getSourceConfig, type DataSource } from '../config.js'
import { setDownloadProgress } from '../import-state.js'

type ProgressCb = (info: {
  bytesReceived: number
  bytesTotal: number | null
  speedBps: number | null
  etaSeconds: number | null
  percent: number | null
}) => void

function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  // Format documenté Chouette / Enroute
  return {
    Authorization: `Token token="${token}"`,
    Accept: '*/*',
    ...extra,
  }
}

function httpErrorMessage(status: number, url: string, source: DataSource): string {
  if (status === 401 || status === 403) {
    const envKey = source === 'netex' ? 'RFU_API_TOKEN_NETEX' : 'RFU_API_TOKEN'
    return `HTTP ${status} — token RFU refusé pour ${source}. Vérifiez ${envKey} (clé d’accès Enroute de la publication ${source.toUpperCase()}).`
  }
  if (status === 404) {
    const envKey = source === 'netex' ? 'RFU_NETEX_URL' : 'RFU_GTFS_URL'
    return `HTTP 404 — archive introuvable : ${url}. La publication GTFS STANDARD n’expose souvent que gtfs.zip ; pour NeTEx il faut l’URL de la publication NeTEx (${envKey}) ou un import local.`
  }
  return `HTTP ${status} lors du téléchargement (${url})`
}

export async function fetchRfuInfo(source: DataSource = 'gtfs'): Promise<Record<string, unknown> | null> {
  const src = getSourceConfig(source)
  try {
    return await fetchJson(src.infoUrl, src.token)
  } catch {
    return null
  }
}

export async function fetchZipMetadata(
  source: DataSource = 'gtfs',
): Promise<{ etag?: string; lastModified?: string }> {
  const src = getSourceConfig(source)
  return headRequest(src.zipUrl, src.token, 0, source)
}

/** @deprecated use fetchZipMetadata */
export async function fetchGtfsMetadata(): Promise<{ etag?: string; lastModified?: string }> {
  return fetchZipMetadata('gtfs')
}

export async function downloadAndExtract(
  jobId: string,
  source: DataSource = 'gtfs',
): Promise<string> {
  const src = getSourceConfig(source)
  const tmpDir = path.join(config.TMP_DIR, jobId)
  fs.mkdirSync(tmpDir, { recursive: true })

  const zipName = source === 'netex' ? 'netex.zip' : 'gtfs.zip'
  const zipPath = path.join(tmpDir, zipName)

  setDownloadProgress({
    phase: 'downloading',
    percent: 0,
    bytesReceived: 0,
    bytesTotal: null,
    speedBps: null,
    etaSeconds: null,
  })

  await downloadFile(src.zipUrl, zipPath, src.token, 0, source, (info) => {
    setDownloadProgress({
      phase: 'downloading',
      ...info,
    })
  })

  setDownloadProgress({
    phase: 'extracting',
    percent: 100,
    etaSeconds: null,
    speedBps: null,
  })

  const extractDir = path.join(tmpDir, 'extracted')
  fs.mkdirSync(extractDir, { recursive: true })

  const zip = new AdmZip(zipPath)
  zip.extractAllTo(extractDir, true)
  fs.unlinkSync(zipPath)

  // Certains zips encapsulent un dossier racine
  const entries = fs.readdirSync(extractDir)
  if (entries.length === 1) {
    const only = path.join(extractDir, entries[0])
    if (fs.statSync(only).isDirectory()) return only
  }

  return extractDir
}

export function cleanupTmp(jobId: string): void {
  const tmpDir = path.join(config.TMP_DIR, jobId)
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

function fetchJson(url: string, token: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http

    const request = proto.get(url, { headers: authHeaders(token) }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location, token).then(resolve).catch(reject)
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} sur ${url}`))
      }

      const contentType = res.headers['content-type'] ?? ''
      if (!contentType.includes('json')) {
        return reject(new Error('Réponse non-JSON'))
      }

      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(new Error('Réponse RFU info invalide (JSON attendu)'))
        }
      })
    })

    request.on('error', reject)
    request.setTimeout(30_000, () => {
      request.destroy()
      reject(new Error(`Timeout RFU info : ${url}`))
    })
  })
}

function headRequest(
  url: string,
  token: string,
  redirects = 0,
  source: DataSource = 'gtfs',
): Promise<{ etag?: string; lastModified?: string }> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Trop de redirections'))

    const proto = url.startsWith('https') ? https : http
    const request = proto.request(url, { method: 'HEAD', headers: authHeaders(token) }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return headRequest(res.headers.location, token, redirects + 1, source)
          .then(resolve)
          .catch(reject)
      }

      if (res.statusCode !== 200) {
        return reject(new Error(httpErrorMessage(res.statusCode ?? 0, url, source)))
      }

      resolve({
        etag: res.headers.etag,
        lastModified: res.headers['last-modified'],
      })
    })

    request.on('error', reject)
    request.setTimeout(30_000, () => {
      request.destroy()
      reject(new Error(`Timeout HEAD ${url}`))
    })
    request.end()
  })
}

function downloadFile(
  url: string,
  dest: string,
  token: string,
  redirects = 0,
  source: DataSource = 'gtfs',
  onProgress?: ProgressCb,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Trop de redirections'))

    const proto = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(dest)

    const request = proto.get(url, { headers: authHeaders(token) }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(dest)
        return downloadFile(res.headers.location, dest, token, redirects + 1, source, onProgress)
          .then(resolve)
          .catch(reject)
      }

      if (res.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        return reject(new Error(httpErrorMessage(res.statusCode ?? 0, url, source)))
      }

      const totalHeader = res.headers['content-length']
      const bytesTotal = totalHeader ? parseInt(totalHeader, 10) : null
      let bytesReceived = 0
      const startedAt = Date.now()
      let lastEmit = 0

      const emit = (force = false) => {
        const now = Date.now()
        if (!force && now - lastEmit < 250) return
        lastEmit = now
        const elapsed = Math.max((now - startedAt) / 1000, 0.001)
        const speedBps = bytesReceived / elapsed
        const percent =
          bytesTotal && bytesTotal > 0
            ? Math.min(100, Math.round((bytesReceived / bytesTotal) * 1000) / 10)
            : null
        const remaining = bytesTotal != null ? Math.max(bytesTotal - bytesReceived, 0) : null
        const etaSeconds = remaining != null && speedBps > 0 ? remaining / speedBps : null
        onProgress?.({ bytesReceived, bytesTotal, speedBps, etaSeconds, percent })
      }

      res.on('data', (chunk: Buffer) => {
        bytesReceived += chunk.length
        emit()
      })

      res.pipe(file)
      file.on('finish', () => {
        emit(true)
        file.close(() => resolve())
      })
      file.on('error', (err) => {
        fs.unlinkSync(dest)
        reject(err)
      })
    })

    request.on('error', (err) => {
      fs.unlinkSync(dest)
      reject(err)
    })

    request.setTimeout(600_000, () => {
      request.destroy()
      reject(new Error('Timeout téléchargement archive'))
    })
  })
}
