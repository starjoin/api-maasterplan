import { prisma } from './db.js'
import type { DataSource } from './config.js'
export async function validateDataset(source: DataSource) {
  const integrity = await prisma.$queryRawUnsafe<Record<string, string>[]>('PRAGMA quick_check')
  if (integrity.some(row => Object.values(row)[0] !== 'ok')) throw new Error('Intégrité SQLite invalide')
  const counts = { routes: await prisma.route.count(), stops: await prisma.stop.count(), trips: await prisma.trip.count(), stopTimes: await prisma.stopTime.count() }
  if (!counts.routes || !counts.stops || !counts.trips || !counts.stopTimes) throw new Error('Import vide ou incomplet : lignes, arrêts, courses et horaires requis')
  for (const [label, sql] of [
    ['courses sans ligne', 'SELECT t.tripId FROM Trip t LEFT JOIN Route r ON r.routeId=t.routeId WHERE r.id IS NULL LIMIT 1'],
    ['horaires sans course', 'SELECT s.tripId FROM StopTime s LEFT JOIN Trip t ON t.tripId=s.tripId WHERE t.id IS NULL LIMIT 1'],
    ['horaires sans arrêt', 'SELECT s.stopId FROM StopTime s LEFT JOIN Stop t ON t.stopId=s.stopId WHERE t.id IS NULL LIMIT 1'],
  ]) {
    const errors = await prisma.$queryRawUnsafe<unknown[]>(sql)
    if (errors.length) throw new Error(`Import incomplet : ${label} (${JSON.stringify(errors[0])})`)
  }
  const unresolved = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT COUNT(*) AS count FROM Trip t WHERE NOT EXISTS (SELECT 1 FROM Calendar c WHERE c.serviceId=t.serviceId) AND NOT EXISTS (SELECT 1 FROM CalendarDate c WHERE c.serviceId=t.serviceId)`)
  if (source === 'gtfs' && Number(unresolved[0].count)) throw new Error('Courses GTFS sans calendrier')
  const meta = await prisma.datasetMeta.findUniqueOrThrow({ where: { id: source } })
  const stopTypes = await prisma.stop.groupBy({ by: ['locationType'], _count: true })
  const stats = { ...JSON.parse(meta.stats ?? '{}'), ...counts, stopTypes: Object.fromEntries(stopTypes.map(t => [String(t.locationType ?? 0), t._count])), rawRecords: await prisma.sourceRecord.count(), sourceFiles: await prisma.sourceFile.count(),
    tripsWithoutCalendarProjection: Number(unresolved[0].count),
    projectionNotes: source === 'netex' ? ['Les extensions, géométries, tarifs et calendriers non projetés restent disponibles intégralement dans les entités et fichiers sources.', 'Les identifiants répétés sont conservés dans l’inventaire ; les tables normalisées dédupliquent ces identifiants.'] : [],
  }
  await prisma.datasetMeta.update({ where: { id: source }, data: { stats: JSON.stringify(stats) } })
  await prisma.importJob.update({ where: { id: process.env.IMPORT_JOB_ID }, data: { stats: JSON.stringify(stats) } })
  await prisma.$executeRawUnsafe('ANALYZE')
}
