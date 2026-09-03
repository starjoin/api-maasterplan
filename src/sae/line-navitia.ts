import { prisma } from '../db.js'
import { modeFromGtfsType } from './modes.js'

type RouteRow = {
  routeId: string
  shortName: string | null
  longName: string | null
  desc: string | null
  type: number
  color: string | null
  textColor: string | null
  url: string | null
  agencyId: string | null
  sortOrder: number | null
}

type BuildOptions = {
  /** Inclure les géométries (coûteux en liste) — défaut true pour le détail */
  includeGeojson?: boolean
}

const CO2_BY_PHYSICAL: Record<string, number> = {
  Metro: 3.5,
  Tramway: 5,
  Bus: 103.5,
  Trolleybus: 20,
  Train: 6,
  Funicular: 5,
  CableCar: 5,
  Ferry: 120,
  Monorail: 5,
}

function stripColor(color: string | null | undefined): string | null {
  if (!color) return null
  return color.replace(/^#/, '').toUpperCase()
}

/** HH:MM:SS ou H:MM:SS → HHMMSS (style Navitia) */
function toNavitiaTime(t: string | null | undefined): string | null {
  if (!t) return null
  const parts = t.trim().split(':')
  if (parts.length < 2) return t.replace(/\D/g, '').padStart(6, '0').slice(0, 6)
  const h = parts[0].padStart(2, '0')
  const m = (parts[1] ?? '00').padStart(2, '0')
  const s = (parts[2] ?? '00').padStart(2, '0')
  return `${h}${m}${s}`
}

function compareGtfsTime(a: string, b: string): number {
  const na = toNavitiaTime(a) ?? '000000'
  const nb = toNavitiaTime(b) ?? '000000'
  return na.localeCompare(nb)
}

export function resolveCommercialMode(route: RouteRow): { id: string; name: string } {
  const code = (route.shortName ?? '').toUpperCase()
  const name = (route.longName ?? '').toLowerCase()

  if (route.type === 1 || /^[ABCD]$/.test(code)) {
    return { id: 'commercial_mode:Métro', name: 'Métro' }
  }
  if (/^TB\d+/i.test(code) || name.includes('trambus')) {
    return { id: 'commercial_mode:Trambus', name: 'Trambus' }
  }
  if (/^JD/i.test(code) || name.includes('junior') || name.includes('collège') || name.includes('lycée')) {
    return { id: 'commercial_mode:BusJD', name: 'Junior Direct' }
  }
  if (route.type === 0) {
    return { id: 'commercial_mode:Tramway', name: 'Tramway' }
  }
  if (route.type === 2) {
    return { id: 'commercial_mode:Train', name: 'Train' }
  }
  if (route.type === 7) {
    return { id: 'commercial_mode:Funiculaire', name: 'Funiculaire' }
  }
  if (route.type === 11) {
    return { id: 'commercial_mode:Trolleybus', name: 'Trolleybus' }
  }

  const phys = modeFromGtfsType(route.type)
  return { id: `commercial_mode:${phys.name}`, name: phys.name }
}

function directionType(directionId: number | null | undefined): 'outbound' | 'inbound' | 'forward' {
  if (directionId === 1) return 'inbound'
  if (directionId === 0) return 'outbound'
  return 'forward'
}

async function shapeFeatureCollection(
  shapeId: string,
  props: Record<string, unknown>,
): Promise<{
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: { type: 'LineString'; coordinates: number[][] }
} | null> {
  const points = await prisma.shape.findMany({
    where: { shapeId },
    orderBy: { ptSequence: 'asc' },
  })
  if (points.length < 2) return null
  return {
    type: 'Feature',
    properties: props,
    geometry: {
      type: 'LineString',
      coordinates: points.map((p) => [p.ptLon, p.ptLat]),
    },
  }
}

async function buildDirectionRoute(
  route: RouteRow,
  directionId: number | null,
  trips: Array<{ tripId: string; headsign: string | null; shapeId: string | null; directionId: number | null }>,
  includeGeojson: boolean,
) {
  const dirType = directionType(directionId)
  const tripIds = trips.map((t) => t.tripId)

  const counts = await prisma.stopTime.groupBy({
    by: ['tripId'],
    where: { tripId: { in: tripIds } },
    _count: { tripId: true },
    orderBy: { _count: { tripId: 'desc' } },
    take: 1,
  })

  const bestTripId = counts[0]?.tripId ?? trips[0].tripId
  const bestTrip = trips.find((t) => t.tripId === bestTripId) ?? trips[0]

  const stopTimes = await prisma.stopTime.findMany({
    where: { tripId: bestTrip.tripId },
    orderBy: { stopSequence: 'asc' },
  })

  const firstStopId = stopTimes[0]?.stopId
  const lastStopId = stopTimes[stopTimes.length - 1]?.stopId
  const terminusIds = [firstStopId, lastStopId].filter(Boolean) as string[]
  const terminusStops = terminusIds.length
    ? await prisma.stop.findMany({ where: { stopId: { in: terminusIds } } })
    : []
  const stopMap = new Map(terminusStops.map((s) => [s.stopId, s]))
  const lastStop = lastStopId ? stopMap.get(lastStopId) : undefined
  const firstStop = firstStopId ? stopMap.get(firstStopId) : undefined

  const routeName =
    bestTrip.headsign ||
    (firstStop && lastStop ? `${firstStop.name} - ${lastStop.name}` : route.longName) ||
    route.shortName ||
    route.routeId

  let geojson: { type: 'FeatureCollection'; features: unknown[] } = {
    type: 'FeatureCollection',
    features: [],
  }

  if (includeGeojson && bestTrip.shapeId) {
    const feature = await shapeFeatureCollection(bestTrip.shapeId, {
      route_id: `route:${route.routeId}-${dirType}`,
      line_id: `line:${route.routeId}`,
      direction_type: dirType,
      color: stripColor(route.color),
    })
    if (feature) geojson = { type: 'FeatureCollection', features: [feature] }
  }

  const codes = [
    { type: 'gtfs_trip_id', value: bestTrip.tripId },
    ...(bestTrip.shapeId ? [{ type: 'gtfs_shape_id', value: bestTrip.shapeId }] : []),
    { type: 'source', value: 'gtfs' },
    { type: 'direction_id', value: String(directionId ?? 0) },
  ]

  return {
    id: `route:${route.routeId}-${dirType}`,
    name: routeName,
    direction_type: dirType,
    is_frequence: 'False',
    links: [] as unknown[],
    codes,
    direction: lastStop
      ? {
          id: `stop_area:${lastStop.parentStation || lastStop.stopId}`,
          name: lastStop.name,
          quality: 0,
          embedded_type: lastStop.locationType === 1 ? 'stop_area' : 'stop_point',
          stop_area: {
            id: lastStop.parentStation || lastStop.stopId,
            name: lastStop.name,
            label: lastStop.name,
            coord:
              lastStop.lat != null && lastStop.lon != null
                ? { lat: lastStop.lat, lon: lastStop.lon }
                : null,
          },
        }
      : {
          id: `direction:${route.routeId}-${dirType}`,
          name: bestTrip.headsign ?? routeName,
          quality: 0,
          embedded_type: 'stop_area',
        },
    geojson,
  }
}

/**
 * Construit un objet ligne au format Navitia (sans journey planner).
 */
export async function buildNavitiaLine(route: RouteRow, options: BuildOptions = {}) {
  const includeGeojson = options.includeGeojson !== false

  const agency = route.agencyId
    ? await prisma.agency.findFirst({
        where: { OR: [{ agencyId: route.agencyId }, { agencyId: route.agencyId.replace(/^network:/, '') }] },
      })
    : await prisma.agency.findFirst({ orderBy: { name: 'asc' } })

  const phys = modeFromGtfsType(route.type)
  const commercial = resolveCommercialMode(route)
  const co2 = CO2_BY_PHYSICAL[phys.id] ?? 103.5

  const trips = await prisma.trip.findMany({
    where: { routeId: route.routeId },
    select: { tripId: true, headsign: true, shapeId: true, directionId: true },
    take: 800,
  })

  // Opening / closing : min départ / max arrivée sur un échantillon de courses
  let opening_time: string | null = null
  let closing_time: string | null = null

  if (trips.length > 0) {
    const sampleTripIds = trips.slice(0, 120).map((t) => t.tripId)
    const [minDep, maxArr] = await Promise.all([
      prisma.stopTime.findFirst({
        where: { tripId: { in: sampleTripIds } },
        orderBy: { departureTime: 'asc' },
        select: { departureTime: true },
      }),
      prisma.stopTime.findFirst({
        where: { tripId: { in: sampleTripIds } },
        orderBy: { arrivalTime: 'desc' },
        select: { arrivalTime: true },
      }),
    ])
    opening_time = toNavitiaTime(minDep?.departureTime)
    closing_time = toNavitiaTime(maxArr?.arrivalTime)

    // Si max < min (services après minuit stockés >24h), garder tel quel
    if (opening_time && closing_time && compareGtfsTime(closing_time, opening_time) < 0) {
      // déjà au format navitia ; rien à faire
    }
  }

  const byDir = new Map<number | null, typeof trips>()
  for (const t of trips) {
    const key = t.directionId
    if (!byDir.has(key)) byDir.set(key, [])
    byDir.get(key)!.push(t)
  }

  // Ordre outbound puis inbound
  const dirKeys = [...byDir.keys()].sort((a, b) => {
    const aa = a ?? 99
    const bb = b ?? 99
    return aa - bb
  })

  const routes = []
  for (const dir of dirKeys) {
    routes.push(await buildDirectionRoute(route, dir, byDir.get(dir)!, includeGeojson))
  }

  // GeoJSON ligne = union des features des routes
  const lineFeatures = routes.flatMap((r) => (r.geojson?.features as unknown[]) ?? [])
  const geojson = {
    type: 'FeatureCollection' as const,
    features: lineFeatures,
  }

  const networkId = agency?.agencyId ?? route.agencyId ?? 'TCL'
  const networkName = agency?.name ?? 'TCL'

  const lineId = `line:${route.routeId}`
  const code = route.shortName ?? route.routeId

  const codes = [
    { type: 'gtfs_id', value: route.routeId },
    { type: 'gtfs_short_name', value: code },
    { type: 'source', value: 'gtfs' },
    { type: 'external_code', value: code },
    ...(route.url ? [{ type: 'url', value: route.url }] : []),
  ]

  const properties = [
    ...(route.desc ? [{ name: 'description', value: route.desc }] : []),
    ...(route.sortOrder != null ? [{ name: 'sort_order', value: String(route.sortOrder) }] : []),
  ]

  return {
    id: lineId,
    code,
    name: route.longName ?? route.shortName ?? route.routeId,
    color: stripColor(route.color),
    text_color: stripColor(route.textColor),
    opening_time,
    closing_time,
    links: [] as unknown[],
    codes,
    properties,
    commercial_mode: commercial,
    physical_modes: [
      {
        id: `physical_mode:${phys.name}`,
        name: phys.name,
        co2_emission_rate: {
          unit: 'gCO₂e/passenger-km',
          value: co2,
        },
      },
    ],
    network: {
      id: `network:${networkId}`,
      name: networkName,
      links: [] as unknown[],
      codes: [
        { type: 'gtfs_id', value: networkId },
        { type: 'source', value: 'gtfs' },
        ...(agency?.url ? [{ type: 'url', value: agency.url }] : []),
        ...(agency?.phone ? [{ type: 'phone', value: agency.phone }] : []),
        ...(agency?.timezone ? [{ type: 'timezone', value: agency.timezone }] : []),
        ...(agency?.lang ? [{ type: 'lang', value: agency.lang }] : []),
        { type: 'external_code', value: networkId },
      ],
    },
    routes,
    geojson,
  }
}

export async function buildNavitiaLines(routes: RouteRow[], options: BuildOptions = {}) {
  const out = []
  for (const r of routes) {
    out.push(await buildNavitiaLine(r, options))
  }
  return out
}
