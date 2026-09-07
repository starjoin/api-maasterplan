import fs from 'node:fs'
import path from 'node:path'
import yauzl from 'yauzl'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { config } from './config.js'

/** One entry at a time; never load the archive or a decompressed file into RAM. */
export function extractZip(zipPath: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(error)
      let total = 0
      let count = 0
      const fail = (error: unknown) => { zip.close(); reject(error) }
      zip.on('error', fail)
      zip.on('end', resolve)
      zip.on('entry', entry => {
        void (async () => {
          if (++count > 100_000) throw new Error('Archive : trop de fichiers')
          const target = path.resolve(destination, entry.fileName)
          if (!target.startsWith(path.resolve(destination) + path.sep)) throw new Error('Chemin ZIP invalide')
          if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('Liens symboliques interdits dans le ZIP')
          if (entry.fileName.endsWith('/')) { await fs.promises.mkdir(target, { recursive: true }); zip.readEntry(); return }
          if (total + entry.uncompressedSize > config.IMPORT_MAX_BYTES) throw new Error('Archive : taille décompressée maximale dépassée')
          await fs.promises.mkdir(path.dirname(target), { recursive: true })
          const input = await new Promise<NodeJS.ReadableStream>((res, rej) => zip.openReadStream(entry, (err, stream) => err || !stream ? rej(err) : res(stream)))
          const budget = new Transform({ transform(chunk, _encoding, callback) {
            total += chunk.length
            callback(total > config.IMPORT_MAX_BYTES ? new Error('Archive trop volumineuse') : null, chunk)
          } })
          await pipeline(input, budget, fs.createWriteStream(target, { flags: 'wx' }))
          zip.readEntry()
        })().catch(fail)
      })
      zip.readEntry()
    })
  })
}
export async function* listFiles(dir: string, prefix = ''): AsyncGenerator<string> {
  const entries = await fs.promises.readdir(path.join(dir, prefix), { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(prefix, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Lien symbolique interdit : ${name}`)
    if (entry.isDirectory()) yield* listFiles(dir, name)
    else if (entry.isFile()) yield name
  }
}
