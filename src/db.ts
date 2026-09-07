import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AsyncLocalStorage } from 'node:async_hooks'
import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { getSourceConfig, isDataSource, type DataSource } from './config.js'

const exec = promisify(execFile)
export function fileUrlToPath(url: string) {
  return path.resolve(url.replace(/^file:/, '').split('?')[0])
}
export function controlUrl(source: DataSource) {
  const raw = getSourceConfig(source).databaseUrl
  const canonical = fileUrlToPath(raw)
  // Older Prisma clients resolved relative SQLite URLs from prisma/schema.prisma.
  const legacy = path.resolve('prisma', raw.replace(/^file:/, '').split('?')[0])
  if (!path.isAbsolute(raw.replace(/^file:/, '')) && !fs.existsSync(canonical) && fs.existsSync(legacy)) return `file:${legacy}`
  return `file:${canonical}`
}
const legacySettings = path.resolve('data/app-settings.json')
const settingsPath = fs.existsSync(legacySettings) && process.env.NODE_ENV !== 'test' ? legacySettings : path.join(path.dirname(fileUrlToPath(controlUrl('gtfs'))), 'app-settings.json')
let activeSource: DataSource = 'gtfs'
try {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  if (isDataSource(settings.activeSource)) activeSource = settings.activeSource
} catch { /* first boot */ }

export function atomicJson(filename: string, value: unknown) {
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  const temp = `${filename}.tmp`
  const fd = fs.openSync(temp, 'w')
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temp, filename)
  const dir = fs.openSync(path.dirname(filename), 'r')
  try { fs.fsyncSync(dir) } finally { fs.closeSync(dir) }
}
export function generationRoot(source: DataSource) { return `${fileUrlToPath(controlUrl(source))}.versions` }
function manifestPath(source: DataSource) { return `${fileUrlToPath(controlUrl(source))}.active.json` }
export function servingUrl(source: DataSource) {
  if (process.env.IMPORT_WORKER === '1' && process.env.IMPORT_DATABASE_URL) return process.env.IMPORT_DATABASE_URL
  if (!fs.existsSync(manifestPath(source))) return controlUrl(source)
  const { databaseUrl } = JSON.parse(fs.readFileSync(manifestPath(source), 'utf8'))
  if (typeof databaseUrl !== 'string' || !fs.existsSync(fileUrlToPath(databaseUrl))) {
    throw new Error(`Version publiée introuvable (${source})`)
  }
  return databaseUrl as string
}
export function createClient(url: string) {
  return new PrismaClient({ datasources: { db: { url: `${url.split('?')[0]}?connection_limit=1&socket_timeout=30` } } })
}
export async function configureClient(client: PrismaClient) {
  await client.$connect()
  await client.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  await client.$executeRawUnsafe('PRAGMA synchronous = FULL')
  await client.$executeRawUnsafe('PRAGMA cache_size = -8192')
  await client.$executeRawUnsafe('PRAGMA temp_store = FILE')
  await client.$queryRawUnsafe('PRAGMA busy_timeout = 5000')
}
const migrations = new Map<string, Promise<void>>()

function expectedMigrationNames() {
  const root = path.resolve('prisma/migrations')
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'migration.sql')))
    .map(entry => entry.name)
    .sort()
}

/**
 * Prisma Migrate prend un verrou d'écriture même si aucune migration ne reste.
 * Pendant un rolling update Coolify, l'ancien conteneur utilise encore SQLite :
 * une simple lecture de la table Prisma évite ce verrou inutile.
 */
async function databaseAlreadyMigrated(url: string) {
  const filename = fileUrlToPath(url)
  if (!fs.existsSync(filename) || fs.statSync(filename).size === 0) return false
  const client = createClient(url)
  try {
    const rows = await client.$queryRawUnsafe<Array<{
      migration_name: string
      finished_at: Date | string | null
      rolled_back_at: Date | string | null
    }>>('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations')
    const applied = new Set(
      rows
        .filter(row => row.finished_at != null && row.rolled_back_at == null)
        .map(row => row.migration_name),
    )
    return expectedMigrationNames().every(name => applied.has(name))
  } catch {
    return false
  } finally {
    await client.$disconnect()
  }
}

export async function migrateDatabase(url: string) {
  if (!migrations.has(url)) migrations.set(url, (async () => {
    fs.mkdirSync(path.dirname(fileUrlToPath(url)), { recursive: true })
    if (await databaseAlreadyMigrated(url)) {
      console.log(`[DB] Migrations déjà appliquées : ${path.basename(fileUrlToPath(url))}`)
      return
    }
    // Explicit creation avoids Prisma 5 schema-engine failures on an absent SQLite file.
    fs.closeSync(fs.openSync(fileUrlToPath(url), 'a'))
    await exec(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url }, maxBuffer: 4 * 1024 * 1024,
    })
  })())
  return migrations.get(url)!
}
type Generation = { client: PrismaClient; url: string; users: number; retired: boolean }
const generations = new Map<DataSource, Generation>()
const controls = new Map<DataSource, PrismaClient>()
const retired = new Set<Generation>()
const context = new AsyncLocalStorage<{ source: DataSource; generation: Generation }>()
const controlModels = new Set<PropertyKey>(['importJob', 'apiEndpoint', 'apiParam'])
function sourceClient(source: DataSource, generation = generations.get(source)!): PrismaClient {
  return new Proxy(generation.client, { get(target, property) {
    const owner = controlModels.has(property) ? controls.get(source)! : target
    const value = Reflect.get(owner, property)
    return typeof value === 'function' ? value.bind(owner) : value
  } })
}
export const prisma = new Proxy({} as PrismaClient, { get(_target, property) {
  const scope = context.getStore()
  const source = scope?.source ?? activeSource
  return Reflect.get(sourceClient(source, scope?.generation), property)
} })
export function getActiveSource() { return context.getStore()?.source ?? activeSource }
export function getMetaId(source: DataSource = getActiveSource()) { return source }
export async function ensureSourceDatabase(source: DataSource) {
  if (generations.has(source)) return
  const ctlUrl = controlUrl(source)
  if (controlUrl('gtfs') === controlUrl('netex')) throw new Error('GTFS et NeTEx doivent utiliser deux fichiers SQLite distincts')
  if (process.env.IMPORT_WORKER !== '1') await migrateDatabase(ctlUrl)
  const control = createClient(ctlUrl)
  await configureClient(control)
  controls.set(source, control)
  const url = servingUrl(source)
  await migrateDatabase(url)
  const client = url === ctlUrl ? control : createClient(url)
  if (client !== control) await configureClient(client)
  if (process.env.IMPORT_WORKER === '1') await client.$executeRawUnsafe('PRAGMA synchronous = NORMAL')
  generations.set(source, { client, url, users: 0, retired: false })
  await client.datasetMeta.upsert({ where: { id: source }, create: { id: source, format: source }, update: {} })
  const legacy = await client.datasetMeta.findUnique({ where: { id: 'default' } })
  if (legacy?.lastImport) {
    const current = await client.datasetMeta.findUnique({ where: { id: source } })
    if (!current?.lastImport) await client.datasetMeta.update({ where: { id: source }, data: {
      lastImport: legacy.lastImport, stats: legacy.stats, rfuVersion: legacy.rfuVersion, rfuUpdatedAt: legacy.rfuUpdatedAt,
    } })
  }
}
export async function initDatabase() { await ensureSourceDatabase(activeSource) }
export async function bindSourceInProcess(source: DataSource) {
  activeSource = source
  await ensureSourceDatabase(source)
  return source
}
export async function setActiveSource(source: DataSource) {
  await ensureSourceDatabase(source)
  atomicJson(settingsPath, { activeSource: source })
  activeSource = source
  const scope = context.getStore()
  if (scope) { scope.source = source; scope.generation = generations.get(source)! }
  return source
}
function release(g: Generation) {
  g.users--
  if (g.retired && g.users === 0) {
    retired.delete(g)
    if (![...controls.values()].includes(g.client)) void g.client.$disconnect().catch(console.error)
  }
}
export async function withSourcePrisma<T>(source: DataSource, fn: (client: PrismaClient) => Promise<T>): Promise<T> {
  await ensureSourceDatabase(source)
  const scope = context.getStore()
  const generation = scope?.source === source ? scope.generation : generations.get(source)!
  generation.users++
  try { return await context.run({ source, generation }, () => fn(sourceClient(source, generation))) } finally { release(generation) }
}
/** Every request keeps the same dataset, including across awaited queries during publication. */
export function registerDatabaseScope(app: FastifyInstance) {
  const scopes = new WeakMap<object, Generation>()
  app.addHook('onRequest', (req, _reply, done) => {
    const generation = generations.get(activeSource)!
    generation.users++
    scopes.set(req, generation)
    context.run({ source: activeSource, generation }, done)
  })
  app.addHook('onResponse', (req, _reply, done) => {
    const generation = scopes.get(req)
    if (generation) { scopes.delete(req); release(generation) }
    done()
  })
}
export async function publishGeneration(source: DataSource, databaseUrl: string, jobId?: string) {
  const client = createClient(databaseUrl)
  try {
    await configureClient(client)
    const meta = await client.datasetMeta.findUnique({ where: { id: source } })
    if (!meta?.lastImport) throw new Error('Import non terminé : publication refusée')
    // Commit on disk before changing the in-process pointer. Existing requests retain their client.
    try {
      atomicJson(manifestPath(source), { databaseUrl, previousUrl: generations.get(source)!.url, jobId, publishedAt: new Date().toISOString() })
    } catch (error) {
      if (servingUrl(source) !== databaseUrl) throw error
      console.error('Manifest committed, directory sync failed:', error)
    }
  } catch (error) { await client.$disconnect(); throw error }
  const old = generations.get(source)!
  generations.set(source, { client, url: databaseUrl, users: 0, retired: false })
  old.retired = true
  retired.add(old)
  old.users++
  release(old)
}
export async function disconnectDatabases() {
  await Promise.all([...new Set([...controls.values(), ...[...generations.values()].map(g => g.client)])].map(c => c.$disconnect()))
}

export function getDatasetPath() { return fileUrlToPath(context.getStore()?.generation.url ?? generations.get(activeSource)!.url) }

/** Keep current + previous generation, and any older generation still serving a request. */
export async function pruneGenerations(source: DataSource) {
  const keep = new Set<string>([servingUrl(source), ...[...retired].map(g => g.url)])
  try {
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath(source), 'utf8'))
    if (manifest.previousUrl) keep.add(manifest.previousUrl)
  } catch { /* no publication yet */ }
  const root = generationRoot(source)
  const dirs = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const dir of dirs) {
    if (!dir.isDirectory() || !/^[0-9a-f-]{36}$/.test(dir.name)) continue
    const full = path.join(root, dir.name)
    if (!keep.has(`file:${path.join(full, 'dataset.db')}`)) await fs.promises.rm(full, { recursive: true, force: true })
  }
}
export async function recoverImports(source: DataSource) {
  let publishedJob: string | undefined
  try { publishedJob = JSON.parse(await fs.promises.readFile(manifestPath(source), 'utf8')).jobId } catch { /* legacy */ }
  await withSourcePrisma(source, async client => {
    if (publishedJob) await client.importJob.updateMany({ where: { id: publishedJob, status: 'VALIDATING' }, data: { status: 'COMPLETED', completedAt: new Date() } })
    await client.importJob.updateMany({ where: { status: { in: ['PENDING','DOWNLOADING','PARSING','IMPORTING','VALIDATING'] } }, data: { status: 'FAILED', completedAt: new Date(), errorMessage: 'Interrompu par un redémarrage ; ancienne version conservée' } })
  })
  await pruneGenerations(source)
}
