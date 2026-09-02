import fs from 'node:fs'
import path from 'node:path'
import { config as dotenvConfig } from 'dotenv'
import { z } from 'zod'

const envLocal = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envLocal)) {
  dotenvConfig({ path: envLocal, override: true })
}
dotenvConfig()

const envSchema = z.object({
  DATABASE_URL: z.string().default('file:./data/maasterplan.db'),
  RFU_API_TOKEN: z.string().min(1, 'RFU_API_TOKEN est requis'),
  RFU_GTFS_URL: z
    .string()
    .default('https://chouette.enroute.mobi/api/v1/datas/SYTRALMOBILITES_RFU_STANDARD/gtfs.zip'),
  RFU_GTFS_INFO_URL: z
    .string()
    .default('https://chouette.enroute.mobi/api/v1/datas/SYTRALMOBILITES_RFU_STANDARD'),
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
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Variables d\'environnement invalides :')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const config = parsed.data

// Prisma lit DATABASE_URL depuis process.env
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = config.DATABASE_URL
}

export type Config = typeof config
