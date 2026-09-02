import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

export async function initDatabase() {
  const dataDir = process.env.DATABASE_URL?.includes('/app/data')
    ? '/app/data'
    : './data'

  if (!process.env.DATABASE_URL?.startsWith('file:')) return

  const fs = await import('node:fs')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  await prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL')
  await prisma.$executeRawUnsafe('PRAGMA cache_size = -64000')
  await prisma.$executeRawUnsafe('PRAGMA temp_store = MEMORY')
}
