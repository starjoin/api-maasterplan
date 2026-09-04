/**
 * Vérifie bascule GTFS↔NeTEx + import NeTEx local (échantillon).
 * Usage: npx tsx scripts/verify-source-switch.mts
 */
import { ensureSourceDatabase, getActiveSource, initDatabase, prisma, setActiveSource } from '../src/db.js'
import { DATA_SOURCES } from '../src/config.js'
import { syncNetex } from '../src/netex/sync.js'
import { getDatasetStats } from '../src/gtfs/sync.js'

const SAMPLE = process.env.NETEX_SAMPLE_DIR || '/tmp/netex-sample'

async function main() {
  for (const s of DATA_SOURCES) await ensureSourceDatabase(s)
  await initDatabase()

  console.log('1) Source initiale:', getActiveSource())
  const gtfsBefore = await setActiveSource('gtfs')
  console.log('   GTFS routes:', await prisma.route.count())

  console.log('2) Bascule NeTEx…')
  await setActiveSource('netex')
  console.log('   Active:', getActiveSource())

  console.log('3) Import local', SAMPLE)
  const jobId = await syncNetex('manual', true, SAMPLE)
  const stats = await getDatasetStats()
  console.log('   Job:', jobId)
  console.log('   Stats:', stats)

  if (stats.routes < 1 || stats.stops < 1) {
    throw new Error('Import NeTEx insuffisant (routes/stops)')
  }

  const sampleRoute = await prisma.route.findFirst({ where: { extras: { not: null } } })
  console.log('   Route avec extras:', sampleRoute?.routeId, sampleRoute?.extras?.slice(0, 120))

  console.log('4) Bascule retour GTFS…')
  await setActiveSource('gtfs')
  console.log('   Active:', getActiveSource(), 'routes:', await prisma.route.count())

  console.log('5) Retour NeTEx (sans réimport)…')
  await setActiveSource('netex')
  console.log('   Active:', getActiveSource(), 'routes:', await prisma.route.count(), 'trips:', await prisma.trip.count())

  // Restaurer GTFS pour le dev quotidien
  await setActiveSource(gtfsBefore)
  console.log('OK — bascule + import NeTEx validés')
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('FAIL', err)
  process.exit(1)
})
