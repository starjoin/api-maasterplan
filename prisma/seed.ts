import { PrismaClient } from '@prisma/client'
import { seedDefaultEndpoints } from '../src/seed'

const prisma = new PrismaClient()

seedDefaultEndpoints(prisma)
  .then(() => console.log('✓ Seed terminé'))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
