import fs from 'node:fs'
import path from 'node:path'
import { config as dotenvConfig } from 'dotenv'
import { z } from 'zod'

const envLocal = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envLocal)) {
  dotenvConfig({ path: envLocal, override: true })
}
dotenvConfig()

export const DATA_SOURCES = ['gtfs', 'netex'] as const
export type DataSource = (typeof DATA_SOURCES)[number]

const DEFAULT_GTFS_URL =
  'https://chouette.enroute.mobi/api/v1/datas/SYTRALMOBILITES_RFU_STANDARD/gtfs.zip'
const DEFAULT_INFO_URL =
  'https://chouette.enroute.mobi/api/v1/datas/SYTRALMOBILITES_RFU_STANDARD'
/** Publication NeTEx distincte (RHONE) — pas STANDARD/netex.zip */
const DEFAULT_NETEX_URL =
  'https://chouette.enroute.mobi/api/v1/datas/SYTRALMOBILITES_RFU_RHONE/netex.zip'
const DEFAULT_NETEX_INFO_URL =
  'https://chouette.enroute.mobi/api/v1/datas/SYTRALMOBILITES_RFU_RHONE'

const envSchema = z.object({
  DATABASE_URL: z.string().default('file:./data/gtfs.db'),
  DATABASE_URL_GTFS: z.string().optional(),
  DATABASE_URL_NETEX: z.string().default('file:./data/netex.db'),
  RFU_API_TOKEN: z.string().min(1, 'RFU_API_TOKEN est requis'),
  RFU_API_TOKEN_NETEX: z.string().optional(),
  RFU_GTFS_URL: z.string().default(DEFAULT_GTFS_URL),
  RFU_GTFS_INFO_URL: z.string().default(DEFAULT_INFO_URL),
  RFU_NETEX_URL: z.string().default(DEFAULT_NETEX_URL),
  RFU_NETEX_INFO_URL: z.string().default(DEFAULT_NETEX_INFO_URL),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  IMPORT_CRON: z.string().default('0 3 * * *'),
  TMP_DIR: z.string().default('/tmp/maasterplan'),
  IMPORT_BATCH_SIZE: z.coerce.number().default(2000),
  AUTO_IMPORT_ON_START: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SIRI_VM_URL: z
    .string()
    .default('https://data.grandlyon.com/siri-lite/2.0/vehicle-monitoring.json'),
  SIRI_VM_USER: z.string().default('demo'),
  SIRI_VM_PASSWORD: z.string().default('demo4dev'),
  SIRI_VM_POLL_MS: z.coerce.number().default(10_000),
  SIRI_VM_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Variables d\'environnement invalides :')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

const raw = parsed.data

export type SourceRuntimeConfig = {
  source: DataSource
  token: string
  zipUrl: string
  infoUrl: string
  databaseUrl: string
  label: string
}

function resolveGtfsDatabaseUrl(): string {
  if (raw.DATABASE_URL_GTFS) return raw.DATABASE_URL_GTFS
  // Compat : ancien chemin unique
  const legacy = path.resolve(process.cwd(), 'data/maasterplan.db')
  if (fs.existsSync(legacy) && !fs.existsSync(path.resolve(process.cwd(), 'data/gtfs.db'))) {
    return 'file:./data/maasterplan.db'
  }
  if (raw.DATABASE_URL.includes('netex')) return 'file:./data/gtfs.db'
  return raw.DATABASE_URL || 'file:./data/gtfs.db'
}

const gtfsDb = resolveGtfsDatabaseUrl()
const netexDb = raw.DATABASE_URL_NETEX
const netexUrl = raw.RFU_NETEX_URL
const netexInfo = raw.RFU_NETEX_INFO_URL
const netexToken = raw.RFU_API_TOKEN_NETEX || raw.RFU_API_TOKEN

export const config = {
  ...raw,
  DATABASE_URL_GTFS: gtfsDb,
  DATABASE_URL_NETEX: netexDb,
  RFU_NETEX_URL: netexUrl,
  RFU_NETEX_INFO_URL: netexInfo,
  RFU_API_TOKEN_NETEX: netexToken,
}

export function getSourceConfig(source: DataSource): SourceRuntimeConfig {
  if (source === 'netex') {
    return {
      source: 'netex',
      token: config.RFU_API_TOKEN_NETEX,
      zipUrl: config.RFU_NETEX_URL,
      infoUrl: config.RFU_NETEX_INFO_URL,
      databaseUrl: config.DATABASE_URL_NETEX,
      label: 'NeTEx',
    }
  }
  return {
    source: 'gtfs',
    token: config.RFU_API_TOKEN,
    zipUrl: config.RFU_GTFS_URL,
    infoUrl: config.RFU_GTFS_INFO_URL,
    databaseUrl: config.DATABASE_URL_GTFS,
    label: 'GTFS',
  }
}

export function isDataSource(value: string): value is DataSource {
  return (DATA_SOURCES as readonly string[]).includes(value)
}

// Prisma lit DATABASE_URL depuis process.env — fixé au boot / bascule
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = config.DATABASE_URL_GTFS
}

export type Config = typeof config
