import { prisma } from '../db.js'
import { geometryFromRouteExtras } from '../navitia/line-geometries.js'
import { hexColor } from './modes.js'

/**
 * Vue d'une ligne pour un jour d'exploitation : courses qui circulent ce jour-là,
 * arrêts réellement desservis (thermomètre), horaires et tracé correspondant.
 */

type StopRow = {
  stopId: string
  code: string | null
  name: string
  lat: number | null
  lon: number | null
  locationType: number | null
  parentStation: string | null
  wheelchairBoarding: number | null
}

type DayTrip = {
  tripId: string
  serviceId: string
  directionId: number | null
  headsign: string | null
  shapeId: string | null
  /** 0 = course du jour J, 24 = course du jour J+1 rattachée à la nuit de J */
  offset?: number
}

type DayStopTime = {
  tripId: string
  stopId: string
  stopSequence: number
  arrivalTime: string
  departureTime: string
  pickupType: number | null
  dropOffType: number | null
}

type LineFeature = {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: { type: 'LineString'; coordinates: number[][] }
}

/** YYYY-MM-DD ou YYYYMMDD → YYYYMMDD (date de service GTFS) */
export function parseServiceDate(input: string | undefined | null): string | null {
  if (!input) return null
  const compact = input.trim().replace(/-/g, '')
  if (!/^\d{8}$/.test(compact)) return null
  const d = new Date(`${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T00:00:00Z`)
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10).replace(/-/g, '') !== compact) return null
  return compact
}

/** Date du jour à Paris (YYYYMMDD) */
export function todayServiceDate(): string {
  const parts = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return parts.replace(/-/g, '')
}

function isoDate(compact: string) {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
}

/**
 * Journée d'exploitation : de 04:00 au jour J à 03:59 le lendemain. Les courses
 * du jour J qui partent avant 04:00 appartiennent à la nuit de la veille.
 */
const SERVICE_DAY_START = '04:00:00'

function shiftServiceDate(compact: string, days: number) {
  const d = new Date(`${isoDate(compact)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

/** Décale une heure GTFS de `hours` heures (03:10:00 + 24 → 27:10:00) */
function shiftTime(t: string | null, hours: number): string | null {
  if (!t || !hours) return t
  const [h, m, s] = t.split(':')
  return `${String(Number(h) + hours).padStart(2, '0')}:${m}:${s}`
}

/** H:MM:SS → HH:MM:SS (tri lexical correct, y compris > 24h) */
function normTime(t: string | null | undefined): string | null {
  if (!t) return null
  const [h = '0', m = '0', s = '0'] = t.trim().split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`
}

const WEEKDAY_FIELDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/**
 * Services actifs à une date : calendar.txt (jours + période) puis calendar_dates.txt
 * (1 = ajout, 2 = suppression). Renvoie aussi les services sans aucune règle connue.
 */
export async function resolveServicesForDate(serviceIds: string[], date: string) {
  const ids = [...new Set(serviceIds)]
  const weekday = WEEKDAY_FIELDS[new Date(`${isoDate(date)}T00:00:00Z`).getUTCDay()]

  const [calendars, exceptions, knownDates] = await Promise.all([
    prisma.calendar.findMany({ where: { serviceId: { in: ids } } }),
    prisma.calendarDate.findMany({ where: { serviceId: { in: ids }, date } }),
    prisma.calendarDate.groupBy({
      by: ['serviceId'],
      where: { serviceId: { in: ids } },
      _min: { date: true },
      _max: { date: true },
    }),
  ])

  const active = new Set<string>()
  for (const c of calendars) {
    if (c[weekday] && c.startDate <= date && date <= c.endDate) active.add(c.serviceId)
  }
  for (const e of exceptions) {
    if (e.exceptionType === 1) active.add(e.serviceId)
    else if (e.exceptionType === 2) active.delete(e.serviceId)
  }

  const known = new Set<string>([
    ...calendars.map((c) => c.serviceId),
    ...knownDates.map((k) => k.serviceId),
  ])
  const unresolved = new Set(ids.filter((id) => !known.has(id)))

  // Bornes de la période couverte (pour le sélecteur de date)
  let min: string | null = null
  let max: string | null = null
  const widen = (lo?: string | null, hi?: string | null) => {
    if (lo && (!min || lo < min)) min = lo
    if (hi && (!max || hi > max)) max = hi
  }
  for (const c of calendars) widen(c.startDate, c.endDate)
  for (const k of knownDates) widen(k._min.date, k._max.date)

  return { active, unresolved, range: { min, max } }
}

/**
 * Fusionne plusieurs séquences d'arrêts (variantes) en une seule séquence ordonnée :
 * on part de la plus longue et on insère les arrêts manquants à côté de leur voisin.
 */
function mergeSequences(patterns: string[][]): string[] {
  const sorted = [...patterns].sort((a, b) => b.length - a.length)
  const merged: string[] = []
  for (const pattern of sorted) {
    const seen = new Set<string>()
    pattern.forEach((stopId, i) => {
      if (seen.has(stopId)) return
      seen.add(stopId)
      if (merged.includes(stopId)) return
      // Insérer après le précédent connu, sinon avant le suivant connu
      for (let p = i - 1; p >= 0; p--) {
        const idx = merged.indexOf(pattern[p])
        if (idx >= 0) {
          merged.splice(idx + 1, 0, stopId)
          return
        }
      }
      for (let n = i + 1; n < pattern.length; n++) {
        const idx = merged.indexOf(pattern[n])
        if (idx >= 0) {
          merged.splice(idx, 0, stopId)
          return
        }
      }
      merged.push(stopId)
    })
  }
  return merged
}

// ─── Géométrie ───────────────────────────────────────────────────────────────

type Projection = { dist: number; seg: number; t: number; point: number[] }

function projectOnPolyline(coords: number[][], lon: number, lat: number): Projection {
  const k = Math.cos((lat * Math.PI) / 180)
  const toXY = (c: number[]) => [c[0] * 111320 * k, c[1] * 110540]
  const [px, py] = toXY([lon, lat])
  let best: Projection = { dist: Infinity, seg: 0, t: 0, point: coords[0] }
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = toXY(coords[i])
    const [bx, by] = toXY(coords[i + 1])
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
    const dist = Math.hypot(ax + t * dx - px, ay + t * dy - py)
    if (dist < best.dist) {
      best = {
        dist,
        seg: i,
        t,
        point: [
          coords[i][0] + t * (coords[i + 1][0] - coords[i][0]),
          coords[i][1] + t * (coords[i + 1][1] - coords[i][1]),
        ],
      }
    }
  }
  return best
}

const STOP_MATCH_METERS = 80

/**
 * Parmi les variantes de la géométrie Navitia, garde celle qui passe par le plus
 * d'arrêts donnés, rognée entre le premier et le dernier arrêt.
 */
function navitiaGeometryForStops(
  parts: number[][][],
  stops: Array<{ lat: number; lon: number }>,
  minCoverage = 0.6,
) {
  if (stops.length < 2) return null
  let best: { coverage: number; coords: number[][]; span: number } | null = null

  for (const part of parts) {
    if (part.length < 2) continue
    const projections = stops.map((s) => projectOnPolyline(part, s.lon, s.lat))
    const matched = projections.filter((p) => p.dist <= STOP_MATCH_METERS)
    const coverage = matched.length / stops.length
    if (matched.length < 2) continue

    const pos = (p: Projection) => p.seg + p.t
    const ordered = [...matched].sort((a, b) => pos(a) - pos(b))
    const start = ordered[0]
    const end = ordered[ordered.length - 1]
    const coords = [start.point, ...part.slice(start.seg + 1, end.seg + 1), end.point]
    const span = pos(end) - pos(start)

    if (
      !best ||
      coverage > best.coverage + 0.001 ||
      (Math.abs(coverage - best.coverage) <= 0.001 && span < best.span)
    ) {
      best = { coverage, coords, span }
    }
  }

  return best && best.coverage >= minCoverage - 1e-9 ? best : null
}

/**
 * Tracé passant par une liste d'arrêts : shape GTFS si fournie, sinon variante
 * Navitia rognée, sinon arrêts reliés à vol d'oiseau.
 */
async function geometryForStops(
  shapeIds: string[],
  navitiaParts: number[][][] | null,
  stops: Array<{ lat: number; lon: number }>,
  props: Record<string, unknown>,
  /** Part minimale des arrêts devant être sur la variante Navitia (sinon vol d'oiseau) */
  minCoverage = 0.6,
) {
  const features: LineFeature[] = []
  for (const shapeId of shapeIds.slice(0, 12)) {
    const f = await gtfsShapeFeature(shapeId, { ...props, shape_id: shapeId })
    if (f) features.push(f)
  }
  if (features.length) return { source: 'gtfs_shapes' as const, features }

  if (navitiaParts) {
    const best = navitiaGeometryForStops(navitiaParts, stops, minCoverage)
    if (best) {
      features.push({
        type: 'Feature',
        properties: { ...props, geometry_source: 'navitia', coverage: Math.round(best.coverage * 100) / 100 },
        geometry: { type: 'LineString', coordinates: best.coords },
      })
      return { source: 'navitia' as const, features }
    }
  }
  if (stops.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { ...props, geometry_source: 'stops' },
      geometry: { type: 'LineString', coordinates: stops.map((c) => [c.lon, c.lat]) },
    })
    return { source: 'stops' as const, features }
  }
  return { source: null, features }
}

function navitiaPartsOf(extras: string | null) {
  const geometry = geometryFromRouteExtras(extras)
  if (!geometry) return null
  return geometry.type === 'LineString'
    ? [geometry.coordinates as number[][]]
    : (geometry.coordinates as number[][][])
}

async function gtfsShapeFeature(shapeId: string, props: Record<string, unknown>): Promise<LineFeature | null> {
  const points = await prisma.shape.findMany({ where: { shapeId }, orderBy: { ptSequence: 'asc' } })
  if (points.length < 2) return null
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'LineString', coordinates: points.map((p) => [p.ptLon, p.ptLat]) },
  }
}

function formatStop(s: StopRow) {
  return {
    id: s.stopId,
    name: s.name,
    label: s.name,
    code: s.code,
    coord: s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null,
    parent_station: s.parentStation,
    wheelchair_boarding: s.wheelchairBoarding,
  }
}

const notServed = (st: DayStopTime) => st.pickupType === 1 && st.dropOffType === 1

/** Ligne à une date : thermomètre, horaires et tracé des seules courses du jour. */
export async function lineDay(routeId: string, rawDate?: string) {
  const route = await prisma.route.findUnique({ where: { routeId } })
  if (!route) return null

  const date = parseServiceDate(rawDate) ?? todayServiceDate()

  const allTrips: DayTrip[] = await prisma.trip.findMany({
    where: { routeId },
    select: { tripId: true, serviceId: true, directionId: true, headsign: true, shapeId: true },
  })

  const { active, unresolved, range } = await resolveServicesForDate(
    allTrips.map((t) => t.serviceId),
    date,
  )
  // Courses du lendemain avant 04:00 : elles terminent la journée d'exploitation
  const next = await resolveServicesForDate(allTrips.map((t) => t.serviceId), shiftServiceDate(date, 1))
  const candidates: DayTrip[] = [
    ...allTrips.filter((t) => active.has(t.serviceId)).map((t) => ({ ...t, offset: 0 })),
    ...allTrips.filter((t) => next.active.has(t.serviceId)).map((t) => ({ ...t, offset: 24 })),
  ]
  const unresolvedTrips = allTrips.filter((t) => unresolved.has(t.serviceId)).length

  // Horaires des courses du jour (par paquets pour rester sous la limite SQLite)
  const stopTimes: DayStopTime[] = []
  const tripIds = [...new Set(candidates.map((t) => t.tripId))]
  for (let i = 0; i < tripIds.length; i += 500) {
    stopTimes.push(
      ...(await prisma.stopTime.findMany({
        where: { tripId: { in: tripIds.slice(i, i + 500) } },
        select: {
          tripId: true,
          stopId: true,
          stopSequence: true,
          arrivalTime: true,
          departureTime: true,
          pickupType: true,
          dropOffType: true,
        },
        orderBy: [{ tripId: 'asc' }, { stopSequence: 'asc' }],
      })),
    )
  }

  const byTrip = new Map<string, DayStopTime[]>()
  for (const st of stopTimes) {
    if (!byTrip.has(st.tripId)) byTrip.set(st.tripId, [])
    byTrip.get(st.tripId)!.push(st)
  }

  const firstServed = (tripId: string) => {
    const st = (byTrip.get(tripId) ?? []).find((x) => !notServed(x))
    return st ? normTime(st.departureTime || st.arrivalTime) : null
  }
  const trips = candidates.filter((t) => {
    const first = firstServed(t.tripId)
    if (!first) return false
    return t.offset ? first < SERVICE_DAY_START : first >= SERVICE_DAY_START
  })

  const stopIds = [...new Set(stopTimes.map((st) => st.stopId))]
  const stops = stopIds.length ? await prisma.stop.findMany({ where: { stopId: { in: stopIds } } }) : []
  const stopMap = new Map(stops.map((s) => [s.stopId, s]))

  const navitiaParts = navitiaPartsOf(route.extras)

  const byDir = new Map<number | null, DayTrip[]>()
  for (const t of trips) {
    if (!byDir.has(t.directionId)) byDir.set(t.directionId, [])
    byDir.get(t.directionId)!.push(t)
  }
  const dirKeys = [...byDir.keys()].sort((a, b) => (a ?? 99) - (b ?? 99))

  const directions = []
  for (const dir of dirKeys) {
    const dirTrips = byDir.get(dir)!
    const served = (t: DayTrip) => (byTrip.get(t.tripId) ?? []).filter((st) => !notServed(st))

    const patterns = new Map<string, string[]>()
    for (const t of dirTrips) {
      const seq = served(t).map((st) => st.stopId)
      if (seq.length) patterns.set(seq.join('>'), seq)
    }
    const sequence = mergeSequences([...patterns.values()])
    const index = new Map(sequence.map((id, i) => [id, i]))

    // Courses triées par heure de départ, horaires alignés sur la séquence
    const tripRows = dirTrips
      .map((t) => {
        const times: Array<string | null> = new Array(sequence.length).fill(null)
        for (const st of served(t)) {
          const i = index.get(st.stopId)
          if (i !== undefined && times[i] === null) times[i] = shiftTime(normTime(st.departureTime || st.arrivalTime), t.offset ?? 0)
        }
        const first = times.find((x) => x !== null) ?? null
        return { trip_id: t.tripId, headsign: t.headsign, shape_id: t.shapeId, first, times }
      })
      .filter((r) => r.first !== null)
      .sort((a, b) => (a.first! < b.first! ? -1 : a.first! > b.first! ? 1 : 0))

    const stopPoints = sequence.map((stopId, i) => {
      const departures = tripRows.map((r) => r.times[i]).filter((x): x is string => x !== null).sort()
      const s = stopMap.get(stopId)
      return {
        order: i,
        stop_point: s ? formatStop(s) : { id: stopId, name: stopId, label: stopId, coord: null },
        passages: departures.length,
        first_departure: departures[0] ?? null,
        last_departure: departures[departures.length - 1] ?? null,
        departures,
      }
    })

    // Tracé : shapes GTFS des courses du jour, sinon variante Navitia rognée
    const stopCoords = stopPoints
      .map((sp) => sp.stop_point.coord)
      .filter((c): c is { lat: number; lon: number } => !!c)
    const shapeIds = [...new Set(tripRows.map((r) => r.shape_id).filter((x): x is string => !!x))]
    const { source: geometrySource, features } = await geometryForStops(shapeIds, navitiaParts, stopCoords, {
      direction_id: dir,
    })

    const headsigns = [...new Set(tripRows.map((r) => r.headsign).filter((h): h is string => !!h))]
    const last = stopPoints[stopPoints.length - 1]?.stop_point

    directions.push({
      direction_id: dir,
      headsign: headsigns[0] ?? last?.name ?? null,
      headsigns,
      trip_count: tripRows.length,
      first_departure: tripRows[0]?.first ?? null,
      last_departure: tripRows[tripRows.length - 1]?.first ?? null,
      stop_points: stopPoints,
      trips: tripRows.map(({ shape_id: _shape, ...rest }) => rest),
      geometry_source: geometrySource,
      geojson: { type: 'FeatureCollection' as const, features },
    })
  }

  return {
    line_id: route.routeId,
    color: hexColor(route.color),
    date: isoDate(date),
    service_day: { start: `${isoDate(date)}T04:00:00`, end: `${isoDate(shiftServiceDate(date, 1))}T03:59:59` },
    service_range: {
      start: range.min ? isoDate(range.min) : null,
      end: range.max ? isoDate(range.max) : null,
    },
    trip_count: trips.length,
    total_trips: allTrips.length,
    unresolved_trips: unresolvedTrips,
    directions,
  }
}

/** Tracé d'une seule course, limité aux arrêts qu'elle dessert. */
export async function tripGeometry(tripId: string) {
  const trip = await prisma.trip.findUnique({ where: { tripId } })
  if (!trip) return null
  const route = await prisma.route.findUnique({ where: { routeId: trip.routeId } })

  const stopTimes = await prisma.stopTime.findMany({
    where: { tripId },
    orderBy: { stopSequence: 'asc' },
    select: { stopId: true, pickupType: true, dropOffType: true },
  })
  const servedIds = stopTimes.filter((st) => !(st.pickupType === 1 && st.dropOffType === 1)).map((st) => st.stopId)
  const stops = await prisma.stop.findMany({ where: { stopId: { in: servedIds } } })
  const byId = new Map(stops.map((s) => [s.stopId, s]))
  const coords = servedIds
    .map((id) => byId.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s && s.lat != null && s.lon != null)
    .map((s) => ({ lat: s.lat!, lon: s.lon! }))

  const { source, features } = await geometryForStops(
    trip.shapeId ? [trip.shapeId] : [],
    navitiaPartsOf(route?.extras ?? null),
    coords,
    { trip_id: tripId, direction_id: trip.directionId },
    // Une course déviée (arrêts hors du tracé nominal) est tracée d'arrêt en arrêt
    1,
  )
  return {
    trip_id: tripId,
    direction_id: trip.directionId,
    geometry_source: source,
    geojson: { type: 'FeatureCollection' as const, features },
  }
}
