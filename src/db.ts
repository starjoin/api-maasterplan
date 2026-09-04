import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import {
  config,
  getSourceConfig,
  isDataSource,
  type DataSource,
} from './config.js'

const SETTINGS_PATH = path.resolve(process.cwd(), 'data/app-settings.json')

type AppSettings = {
  activeSource: DataSource
}

function ensureDataDir() {
  const dir = path.resolve(process.cwd(), 'data')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function readSettings(): AppSettings {
  ensureDataDir()
  if (!fs.existsSync(SETTINGS_PATH)) {
    return { activeSource: 'gtfs' }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as AppSettings
    if (isDataSource(raw.activeSource)) return raw
  } catch {
    /* ignore */
  }
  return { activeSource: 'gtfs' }
}

function writeSettings(settings: AppSettings) {
  ensureDataDir()
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8')
}

function fileUrlToPath(url: string): string {
  const stripped = url.replace(/^file:/, '')
  return path.isAbsolute(stripped) ? stripped : path.resolve(process.cwd(), stripped)
}

function ensureDbFile(databaseUrl: string) {
  const filePath = fileUrlToPath(databaseUrl)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

const migratedUrls = new Set<string>()

function migrateDatabase(databaseUrl: string) {
  if (migratedUrls.has(databaseUrl)) return
  ensureDbFile(databaseUrl)
  try {
    execSync('npx prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr?: Buffer | string }).stderr ?? '')
        : ''
    throw new Error(
      `Migration Prisma échouée pour ${databaseUrl}: ${msg}${stderr ? `\n${stderr}` : ''}`,
    )
  }
  migratedUrls.add(databaseUrl)
}

function createClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  })
}

let activeSource: DataSource = readSettings().activeSource
let prismaRef: PrismaClient = createClient(getSourceConfig(activeSource).databaseUrl)

/** Client Prisma de la source active (binding live). */
export let prisma: PrismaClient = prismaRef

export function getActiveSource(): DataSource {
  return activeSource
}

export async function initDatabase(databaseUrl = getSourceConfig(activeSource).databaseUrl) {
  ensureDataDir()
  ensureDbFile(databaseUrl)

  // Compat : renommer l’ancienne DB unique vers gtfs si besoin
  const legacy = path.resolve(process.cwd(), 'data/maasterplan.db')
  const gtfsPath = fileUrlToPath(config.DATABASE_URL_GTFS)
  if (fs.existsSync(legacy) && !fs.existsSync(gtfsPath) && databaseUrl.includes('gtfs')) {
    fs.renameSync(legacy, gtfsPath)
  }

  // Worker d’import : migrations déjà faites par l’entrypoint / le process HTTP
  if (process.env.IMPORT_SKIP_MIGRATE !== '1') {
    migrateDatabase(databaseUrl)
  } else {
    ensureDbFile(databaseUrl)
  }

  process.env.DATABASE_URL = databaseUrl
  await prismaRef.$connect()
  await prismaRef.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  await prismaRef.$executeRawUnsafe('PRAGMA synchronous = NORMAL')
  await prismaRef.$executeRawUnsafe('PRAGMA cache_size = -64000')
  await prismaRef.$executeRawUnsafe('PRAGMA temp_store = MEMORY')

  await prismaRef.datasetMeta.upsert({
    where: { id: activeSource },
    create: { id: activeSource, format: activeSource },
    update: { format: activeSource },
  })

  // Migration legacy : DatasetMeta id "default" → source active
  try {
    const legacy = await prismaRef.datasetMeta.findUnique({ where: { id: 'default' } })
    if (legacy) {
      const current = await prismaRef.datasetMeta.findUnique({ where: { id: activeSource } })
      if (!current?.lastImport && legacy.lastImport) {
        await prismaRef.datasetMeta.update({
          where: { id: activeSource },
          data: {
            lastImport: legacy.lastImport,
            rfuVersion: legacy.rfuVersion,
            rfuUpdatedAt: legacy.rfuUpdatedAt,
            stats: legacy.stats,
            format: activeSource,
          },
        })
      }
      await prismaRef.datasetMeta.delete({ where: { id: 'default' } }).catch(() => undefined)
    }
  } catch {
    /* ignore */
  }
}

export async function ensureSourceDatabase(source: DataSource) {
  const { databaseUrl } = getSourceConfig(source)
  migrateDatabase(databaseUrl)
  const client = createClient(databaseUrl)
  try {
    await client.$connect()
    await client.datasetMeta.upsert({
      where: { id: source },
      create: { id: source, format: source },
      update: { format: source },
    })
  } finally {
    await client.$disconnect()
  }
}

export async function setActiveSource(source: DataSource): Promise<DataSource> {
  if (source === activeSource) return activeSource

  await prismaRef.$disconnect()

  activeSource = source
  writeSettings({ activeSource })

  const { databaseUrl } = getSourceConfig(source)
  process.env.DATABASE_URL = databaseUrl
  prismaRef = createClient(databaseUrl)
  prisma = prismaRef

  await initDatabase(databaseUrl)
  return activeSource
}

/**
 * Bind Prisma à une source sans écrire app-settings.json.
 * Utilisé par le process worker d’import (ne doit pas changer la source UI du serveur HTTP).
 */
export async function bindSourceInProcess(source: DataSource): Promise<DataSource> {
  const { databaseUrl } = getSourceConfig(source)
  if (source === activeSource && process.env.DATABASE_URL === databaseUrl) {
    await initDatabase(databaseUrl)
    return activeSource
  }

  await prismaRef.$disconnect().catch(() => undefined)
  activeSource = source
  process.env.DATABASE_URL = databaseUrl
  prismaRef = createClient(databaseUrl)
  prisma = prismaRef
  await initDatabase(databaseUrl)
  return activeSource
}

export async function withSourcePrisma<T>(
  source: DataSource,
  fn: (client: PrismaClient) => Promise<T>,
): Promise<T> {
  if (source === activeSource) return fn(prismaRef)

  const { databaseUrl } = getSourceConfig(source)
  migrateDatabase(databaseUrl)
  const client = createClient(databaseUrl)
  try {
    await client.$connect()
    return await fn(client)
  } finally {
    await client.$disconnect()
  }
}

export function getMetaId(source: DataSource = activeSource): string {
  return source
}
