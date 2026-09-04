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

const CONNECT_TIMEOUT_MS = 45_000
const IDLE_TIMEOUT_MS = 120_000
const MAX_REDIRECTS = 8

function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: '*/*',
    'User-Agent': 'maasterplan/1.0',
    ...extra,
  }
  if (token) {
    // Format documenté Chouette / Enroute
    headers.Authorization = `Token token="${token}"`
  }
  return headers
}

/** Ne pas renvoyer le token Enroute vers un CDN/S3 (sinon téléchargement qui pend). */
function tokenForRedirect(fromUrl: string, toUrl: string, token: string): string {
  try {
    const from = new URL(fromUrl)
    const to = new URL(toUrl, fromUrl)
    if (from.host === to.host) return token
  } catch {
    /* ignore */
  }
  return ''
}

function resolveRedirectUrl(fromUrl: string, location: string): string {
  return new URL(location, fromUrl).href
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

function attachTimeouts(
  request: http.ClientRequest,
  reject: (err: Error) => void,
  label: string,
): void {
  request.setTimeout(IDLE_TIMEOUT_MS, () => {
    request.destroy()
    reject(new Error(`Timeout inactivité ${label} (${IDLE_TIMEOUT_MS / 1000}s)`))
  })
  request.on('socket', (socket) => {
    socket.setTimeout(CONNECT_TIMEOUT_MS)
    socket.once('timeout', () => {
      request.destroy()
      reject(new Error(`Timeout connexion ${label} (${CONNECT_TIMEOUT_MS / 1000}s)`))
    })
  })
}

export async function fetchRfuInfo(source: DataSource = 'gtfs'): Promise<Record<string, unknown> | null> {
  const src = getSourceConfig(source)
  try {
    return await fetchJson(src.infoUrl, src.token)
  } catch (err) {
    console.warn(`[RFU] info ${source} indisponible:`, err instanceof Error ? err.message : err)
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

  console.log(`[Download] ${source} → ${src.zipUrl}`)
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

  const zipSize = fs.statSync(zipPath).size
  console.log(`[Download] OK ${zipName} (${(zipSize / (1024 * 1024)).toFixed(1)} Mo)`)

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

function fetchJson(url: string, token: string, redirects = 0): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) return reject(new Error('Trop de redirections'))

    const proto = url.startsWith('https') ? https : http
    const request = proto.get(url, { headers: authHeaders(token) }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = resolveRedirectUrl(url, res.headers.location)
        const nextToken = tokenForRedirect(url, next, token)
        res.resume()
        return fetchJson(next, nextToken, redirects + 1).then(resolve).catch(reject)
      }

      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} sur ${url}`))
      }

      const contentType = res.headers['content-type'] ?? ''
      if (!contentType.includes('json')) {
        res.resume()
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
    attachTimeouts(request, reject, `RFU info ${url}`)
  })
}

function headRequest(
  url: string,
  token: string,
  redirects = 0,
  source: DataSource = 'gtfs',
): Promise<{ etag?: string; lastModified?: string }> {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) return reject(new Error('Trop de redirections'))

    const proto = url.startsWith('https') ? https : http
    const request = proto.request(url, { method: 'HEAD', headers: authHeaders(token) }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = resolveRedirectUrl(url, res.headers.location)
        const nextToken = tokenForRedirect(url, next, token)
        res.resume()
        return headRequest(next, nextToken, redirects + 1, source).then(resolve).catch(reject)
      }

      // Certains CDN refusent HEAD → on n’échoue pas durement (métadonnées optionnelles)
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(httpErrorMessage(res.statusCode ?? 0, url, source)))
      }

      resolve({
        etag: res.headers.etag,
        lastModified: res.headers['last-modified'],
      })
    })

    request.on('error', reject)
    attachTimeouts(request, reject, `HEAD ${url}`)
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
    if (redirects > MAX_REDIRECTS) return reject(new Error('Trop de redirections'))

    const proto = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(dest)
    let settled = false

    const fail = (err: Error) => {
      if (settled) return
      settled = true
      file.close(() => {
        fs.unlink(dest, () => reject(err))
      })
    }

    const succeed = () => {
      if (settled) return
      settled = true
      resolve()
    }

    const request = proto.get(url, { headers: authHeaders(token) }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = resolveRedirectUrl(url, res.headers.location)
        const nextToken = tokenForRedirect(url, next, token)
        console.log(`[Download] redirect ${res.statusCode} → ${nextHost(next)} (auth=${nextToken ? 'oui' : 'non'})`)
        res.resume()
        file.close()
        fs.unlink(dest, () => {
          downloadFile(next, dest, nextToken, redirects + 1, source, onProgress)
            .then(succeed)
            .catch(fail)
        })
        return
      }

      if (res.statusCode !== 200) {
        res.resume()
        return fail(new Error(httpErrorMessage(res.statusCode ?? 0, url, source)))
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

      emit(true)

      res.on('data', (chunk: Buffer) => {
        bytesReceived += chunk.length
        emit()
      })

      res.pipe(file)
      file.on('finish', () => {
        emit(true)
        file.close(() => succeed())
      })
      file.on('error', (err) => fail(err))
      res.on('error', (err) => fail(err))
    })

    request.on('error', (err) => fail(err))
    attachTimeouts(request, fail, `GET ${url}`)
  })
}

function nextHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
