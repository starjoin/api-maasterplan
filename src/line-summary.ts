import { prisma } from './db.js'
/** Calculated once by the worker; API requests need only indexed point lookups. */
export async function buildLineSummaries() {
  let cursor: string | undefined
  while (true) {
    const routes = await prisma.route.findMany({ orderBy: { routeId: 'asc' }, take: 100, ...(cursor ? { where: { routeId: { gt: cursor } } } : {}) })
    if (!routes.length) break
    for (const route of routes) {
      cursor = route.routeId
      const timings = await prisma.$queryRaw<{ openingTime: string | null; closingTime: string | null }[]>`SELECT MIN(s.departureTime) AS openingTime, MAX(s.arrivalTime) AS closingTime FROM Trip t JOIN StopTime s ON s.tripId=t.tripId WHERE t.routeId=${route.routeId}`
      const best = await prisma.$queryRaw<{ tripId: string }[]>`SELECT tripId FROM (SELECT t.tripId, ROW_NUMBER() OVER (PARTITION BY t.directionId ORDER BY COUNT(s.id) DESC, t.tripId) AS rank FROM Trip t LEFT JOIN StopTime s ON s.tripId=t.tripId WHERE t.routeId=${route.routeId} GROUP BY t.tripId) WHERE rank=1`
      await prisma.lineSummary.create({ data: { routeId: route.routeId, openingTime: timings[0].openingTime, closingTime: timings[0].closingTime, representatives: JSON.stringify(best.map(t => t.tripId)) } })
    }
  }
}
