import { prisma } from './db.js'
import type { DataSource } from './config.js'
import { reportImportActivity } from './import-state.js'
export async function validateDataset(source: DataSource) {
  reportImportActivity('Contrôle d’intégrité SQLite', {
    phase: 'validating',
    phasePercent: 8,
    currentItem: 'Base SQLite',
  })
  const integrity = await prisma.$queryRawUnsafe<Record<string, string>[]>('PRAGMA quick_check')
  if (integrity.some(row => Object.values(row)[0] !== 'ok')) throw new Error('Intégrité SQLite invalide')
  reportImportActivity('Comptage des données importées', {
    phase: 'validating',
    phasePercent: 22,
    currentItem: 'Lignes, arrêts, courses et horaires',
  })
  const counts = { routes: await prisma.route.count(), stops: await prisma.stop.count(), trips: await prisma.trip.count(), stopTimes: await prisma.stopTime.count() }
  if (!counts.routes || !counts.stops || !counts.trips || !counts.stopTimes) throw new Error('Import vide ou incomplet : lignes, arrêts, courses et horaires requis')
  const relationChecks = [
    ['courses sans ligne', 'SELECT t.tripId FROM Trip t LEFT JOIN Route r ON r.routeId=t.routeId WHERE r.id IS NULL LIMIT 1'],
    ['horaires sans course', 'SELECT s.tripId FROM StopTime s LEFT JOIN Trip t ON t.tripId=s.tripId WHERE t.id IS NULL LIMIT 1'],
    ['horaires sans arrêt', 'SELECT s.stopId FROM StopTime s LEFT JOIN Stop t ON t.stopId=s.stopId WHERE t.id IS NULL LIMIT 1'],
  ] as const
  for (const [index, [label, sql]] of relationChecks.entries()) {
    reportImportActivity(`Contrôle : ${label}`, {
      phase: 'validating',
      phasePercent: 35 + index * 12,
      currentItem: label,
      counters: counts,
    })
    const errors = await prisma.$queryRawUnsafe<unknown[]>(sql)
    if (errors.length) throw new Error(`Import incomplet : ${label} (${JSON.stringify(errors[0])})`)
  }
  const unresolved = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT COUNT(*) AS count FROM Trip t WHERE NOT EXISTS (SELECT 1 FROM Calendar c WHERE c.serviceId=t.serviceId) AND NOT EXISTS (SELECT 1 FROM CalendarDate c WHERE c.serviceId=t.serviceId)`)
  if (source === 'gtfs' && Number(unresolved[0].count)) throw new Error('Courses GTFS sans calendrier')
  const meta = await prisma.datasetMeta.findUniqueOrThrow({ where: { id: source } })
  reportImportActivity('Contrôle des calendriers et des types d’arrêt', {
    phase: 'validating',
    phasePercent: 76,
    currentItem: 'Calendriers et arrêts',
    counters: counts,
  })
  const stopTypes = await prisma.stop.groupBy({ by: ['locationType'], _count: true })
  const stats = { ...JSON.parse(meta.stats ?? '{}'), ...counts, stopTypes: Object.fromEntries(stopTypes.map(t => [String(t.locationType ?? 0), t._count])), rawRecords: await prisma.sourceRecord.count(), sourceFiles: await prisma.sourceFile.count(),
    tripsWithoutCalendarProjection: Number(unresolved[0].count),
    projectionNotes: source === 'netex' ? ['Les extensions, géométries, tarifs et calendriers non projetés restent disponibles intégralement dans les entités et fichiers sources.', 'Les identifiants répétés sont conservés dans l’inventaire ; les tables normalisées dédupliquent ces identifiants.'] : [],
  }
  await prisma.datasetMeta.update({ where: { id: source }, data: { stats: JSON.stringify(stats) } })
  await prisma.importJob.update({ where: { id: process.env.IMPORT_JOB_ID }, data: { stats: JSON.stringify(stats) } })
  reportImportActivity('Création des index statistiques SQLite', {
    phase: 'validating',
    phasePercent: 92,
    currentItem: 'ANALYZE',
    counters: { ...counts, pois: Number(stats.pois ?? 0) },
  })
  await prisma.$executeRawUnsafe('ANALYZE')
  reportImportActivity('Validation terminée sans erreur', {
    phase: 'validating',
    phasePercent: 100,
    currentItem: null,
    counters: { ...counts, pois: Number(stats.pois ?? 0) },
  })
}
