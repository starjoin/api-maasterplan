import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { SaxesParser } from 'saxes'
import { prisma, fileUrlToPath } from './db.js'
import { listFiles } from './archive.js'
import { config } from './config.js'
import { reportImportActivity, setDownloadProgress } from './import-state.js'

type Row = { file: string; kind: string; entityId?: string; data: string }
export class Inventory {
  private kinds = new Map<string, { count: number; fields: Record<string, number> }>()
  private pending: Row[] = []
  private pendingBytes = 0
  private bytes = 0
  async record(file: string, kind: string, entityId: string | undefined, data: Record<string, unknown>) {
    this.queue(file, kind, entityId, data)
    if (this.pending.length >= config.IMPORT_BATCH_SIZE || this.pendingBytes >= 1024 * 1024) await this.flush()
  }
  queue(file: string, kind: string, entityId: string | undefined, data: Record<string, unknown>) {
    const encoded = JSON.stringify(data)
    if (encoded.length > 4 * 1024 * 1024) throw new Error(`Entité trop volumineuse : ${kind} ${entityId}; ancienne version conservée`)
    this.pending.push({ file, kind, entityId, data: encoded })
    this.pendingBytes += encoded.length
    const summary = this.kinds.get(kind) ?? { count: 0, fields: Object.create(null) }
    summary.count++
    const paths = new Set<string>()
    function visit(node: unknown, prefix: string) {
      if (Array.isArray(node)) { for (const item of node) visit(item, prefix); return }
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) visit(value, prefix ? `${prefix}.${key}` : key)
      } else if (node !== '' && node != null) paths.add(prefix)
    }
    visit(data, '')
    for (const field of paths) summary.fields[field] = (summary.fields[field] ?? 0) + 1
    this.kinds.set(kind, summary)
  }
  async flushIfReady() {
    if (this.pending.length >= config.IMPORT_BATCH_SIZE || this.pendingBytes >= 1024 * 1024) await this.flush()
  }
  async flush() {
    if (this.pending.length) await prisma.sourceRecord.createMany({ data: this.pending })
    this.pending = []; this.pendingBytes = 0
  }
  async saveFile(dir: string, name: string, records: number) {
    const root = process.env.IMPORT_DATABASE_URL
    if (!root) throw new Error('Archivage hors worker interdit')
    const destination = path.join(path.dirname(fileUrlToPath(root)), 'sources', name)
    await fs.promises.mkdir(path.dirname(destination), { recursive: true })
    const hash = createHash('sha256')
    let bytes = 0
    const meter = new Transform({ transform: (chunk, _encoding, cb) => {
      bytes += chunk.length; this.bytes += chunk.length; hash.update(chunk)
      cb(this.bytes > config.IMPORT_MAX_BYTES ? new Error('Limite de taille des sources dépassée') : null, chunk)
    } })
    await pipeline(fs.createReadStream(path.join(dir, name)), meter, fs.createWriteStream(destination, { flags: 'wx' }))
    await prisma.sourceFile.create({ data: { name, bytes: BigInt(bytes), sha256: hash.digest('hex'), records, fields: '{}' } })
  }
  async finish() {
    await this.flush()
    for (const [kind, summary] of this.kinds) await prisma.sourceKind.create({ data: { kind, count: summary.count, fields: JSON.stringify(summary.fields) } })
  }
}

/** Parse XML incrementally, retaining only the current entity, never a full frame/document. */
export async function indexNetexDirectory(dir: string, log: (message: string) => void | Promise<void>) {
  const inventory = new Inventory()
  const files: string[] = []
  for await (const file of listFiles(dir)) files.push(file)
  let xmlFiles = 0
  let totalBytes = 0
  for (const file of files) totalBytes += (await fs.promises.stat(path.join(dir, file))).size
  if (totalBytes > config.IMPORT_MAX_BYTES) throw new Error('Fichiers source trop volumineux')
  let processedBytes = 0
  let totalRecords = 0
  reportImportActivity(`Inventaire NeTEx démarré : ${files.length} fichier(s)`, {
    phase: 'indexing',
    phasePercent: 0,
    detail: `${formatCount(totalBytes)} octets à lire`,
    processed: 0,
    total: totalBytes,
    unit: 'octets',
    counters: { filesTotal: files.length, filesRead: 0, rawRecords: 0 },
  })
  for (const [fileIndex, file] of files.entries()) {
    const fileSize = (await fs.promises.stat(path.join(dir, file))).size
    let records = 0
    if (/\.xml$/i.test(file)) {
      xmlFiles++
      await log(`Inventaire XML : ${file}`)
      reportImportActivity(`Lecture du fichier XML ${fileIndex + 1}/${files.length} : ${file}`, {
        phase: 'indexing',
        detail: `Analyse XML en flux — ${formatCount(fileSize)} octets`,
        currentItem: file,
        counters: { filesRead: fileIndex, rawRecords: totalRecords },
      })
      const parser = new SaxesParser({ xmlns: true })
      type Node = { name: string; data?: Record<string, unknown>; id?: string; text: string; size: number }
      const stack: Node[] = []
      let entityBytes = 0
      parser.on('doctype', () => { throw new Error('DTD non supportée : import refusé') })
      parser.on('opentag', tag => {
        if (stack.length > 128) throw new Error('XML trop profond')
        const id = Object.values(tag.attributes).find(a => a.local === 'id')?.value
        const capture = !!stack.at(-1)?.data || (!!id && !/Frame$/.test(tag.local))
        const data: Record<string, unknown> | undefined = capture ? Object.create(null) : undefined
        if (data) for (const a of Object.values(tag.attributes)) if (a.prefix !== 'xmlns') { data[`@_${a.local}`] = a.value; entityBytes += a.value.length + a.local.length }
        stack.push({ name: tag.local, data, id, text: '', size: 0 })
      })
      const onText = (text: string) => {
        const node = stack.at(-1)
        if (node?.data) { node.text += text; entityBytes += text.length }
        if (entityBytes > 4 * 1024 * 1024) throw new Error('Entité XML supérieure à 4 Mo : import refusé')
      }
      parser.on('text', onText); parser.on('cdata', onText)
      parser.on('closetag', () => {
        const node = stack.pop()!
        if (!node.data) return
        if (node.text.trim()) node.data['#text'] = node.text.trim()
        if (node.id) { inventory.queue(file, node.name, node.id, node.data); records++ }
        const parent = stack.at(-1)
        if (parent?.data) {
          const value = Object.keys(node.data).length === 1 && '#text' in node.data ? node.data['#text'] : node.data
          if (!(node.name in parent.data)) parent.data[node.name] = value
          else if (Array.isArray(parent.data[node.name])) (parent.data[node.name] as unknown[]).push(value)
          else parent.data[node.name] = [parent.data[node.name], value]
          entityBytes += node.name.length + 32
        } else entityBytes = 0
      })
      // Tiny input chunks bound queued completed records between awaited SQLite writes.
      for await (const chunk of fs.createReadStream(path.join(dir, file), { encoding: 'utf8', highWaterMark: 16 * 1024 })) {
        parser.write(chunk)
        processedBytes += Buffer.byteLength(chunk)
        const currentRecords = totalRecords + records
        setDownloadProgress({
          phase: 'indexing',
          phasePercent: totalBytes ? (processedBytes / totalBytes) * 100 : 100,
          detail: `${formatCount(currentRecords)} entités trouvées — fichier ${fileIndex + 1}/${files.length}`,
          currentItem: file,
          processed: processedBytes,
          total: totalBytes,
          unit: 'octets',
          counters: { filesRead: fileIndex, rawRecords: currentRecords },
        })
        await inventory.flushIfReady()
      }
      parser.close()
      await inventory.flush()
    }
    await inventory.saveFile(dir, file, records)
    if (!/\.xml$/i.test(file)) processedBytes += fileSize
    totalRecords += records
    reportImportActivity(
      /\.xml$/i.test(file)
        ? `${file} inventorié : ${formatCount(records)} entités`
        : `${file} archivé : ${formatCount(fileSize)} octets`,
      {
        phase: 'indexing',
        phasePercent: totalBytes ? (processedBytes / totalBytes) * 100 : 100,
        detail: `${fileIndex + 1}/${files.length} fichier(s) terminé(s)`,
        currentItem: file,
        processed: processedBytes,
        total: totalBytes,
        unit: 'octets',
        counters: { filesRead: fileIndex + 1, rawRecords: totalRecords },
      },
    )
  }
  if (!xmlFiles) throw new Error('Aucun fichier XML NeTEx trouvé')
  await inventory.finish()
  reportImportActivity(`Inventaire NeTEx terminé : ${formatCount(totalRecords)} entités`, {
    phase: 'indexing',
    phasePercent: 100,
    detail: `${files.length} fichier(s) source conservé(s) intégralement`,
    currentItem: null,
    processed: totalBytes,
    total: totalBytes,
    unit: 'octets',
    counters: { filesRead: files.length, rawRecords: totalRecords },
  })
}

function formatCount(value: number) {
  return value.toLocaleString('fr-FR')
}
