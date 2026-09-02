import AdmZip from 'adm-zip'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import path from 'node:path'
import { config } from '../config.js'

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${config.RFU_API_TOKEN}`,
    Accept: 'application/json',
    ...extra,
  }
}

export async function fetchRfuInfo(): Promise<Record<string, unknown> | null> {
  try {
    return await fetchJson(config.RFU_GTFS_INFO_URL)
  } catch {
    return null
  }
}

export async function fetchGtfsMetadata(): Promise<{ etag?: string; lastModified?: string }> {
  return headRequest(config.RFU_GTFS_URL)
}

export async function downloadAndExtract(jobId: string): Promise<string> {
  const tmpDir = path.join(config.TMP_DIR, jobId)
  fs.mkdirSync(tmpDir, { recursive: true })

  const zipPath = path.join(tmpDir, 'gtfs.zip')
  await downloadFile(config.RFU_GTFS_URL, zipPath)

  const extractDir = path.join(tmpDir, 'extracted')
  fs.mkdirSync(extractDir, { recursive: true })

  const zip = new AdmZip(zipPath)
  zip.extractAllTo(extractDir, true)
  fs.unlinkSync(zipPath)

  return extractDir
}

export function cleanupTmp(jobId: string): void {
  const tmpDir = path.join(config.TMP_DIR, jobId)
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

function fetchJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http

    const request = proto.get(url, { headers: authHeaders() }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject)
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

function headRequest(url: string, redirects = 0): Promise<{ etag?: string; lastModified?: string }> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Trop de redirections'))

    const proto = url.startsWith('https') ? https : http
    const request = proto.request(url, { method: 'HEAD', headers: authHeaders() }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return headRequest(res.headers.location, redirects + 1).then(resolve).catch(reject)
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} HEAD ${url}`))
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

function downloadFile(url: string, dest: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Trop de redirections'))

    const proto = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(dest)

    const request = proto.get(url, { headers: authHeaders() }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(dest)
        return downloadFile(res.headers.location, dest, redirects + 1).then(resolve).catch(reject)
      }

      if (res.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        return reject(new Error(`HTTP ${res.statusCode} lors du téléchargement GTFS`))
      }

      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', (err) => {
        fs.unlinkSync(dest)
        reject(err)
      })
    })

    request.on('error', (err) => {
      fs.unlinkSync(dest)
      reject(err)
    })

    request.setTimeout(300_000, () => {
      request.destroy()
      reject(new Error('Timeout téléchargement GTFS'))
    })
  })
}
