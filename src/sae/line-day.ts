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

// ─── Géométrie : tracé passant par les seuls arrêts desservis ────────────────

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

function meters(a: number[], b: number[]) {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  return Math.hypot((b[0] - a[0]) * 111320 * k, (b[1] - a[1]) * 110540)
}

function polylineLength(coords: number[][]) {
  let total = 0
  for (let i = 1; i < coords.length; i++) total += meters(coords[i - 1], coords[i])
  return total
}

/**
 * Construit le tracé du jour tronçon par tronçon : entre deux arrêts desservis
 * consécutifs, on suit la variante Navitia qui les relie (dans le bon sens et sans
 * détour excessif) ; sinon on les relie en ligne droite, marquée « approx ».
 * Le tracé passe ainsi uniquement par les arrêts desservis ce jour-là.
 */
function navitiaPathThroughStops(parts: number[][][], stops: Array<{ lat: number; lon: number }>) {
  const usable = parts.filter((p) => p.length >= 2)
  const projections = usable.map((part) => stops.map((s) => projectOnPolyline(part, s.lon, s.lat)))
  const pos = (p: Projection) => p.seg + p.t

  const segments: Array<{ coords: number[][]; approx: boolean }> = []
  let matched = 0
  for (let i = 0; i < stops.length - 1; i++) {
    const a = [stops[i].lon, stops[i].lat]
    const b = [stops[i + 1].lon, stops[i + 1].lat]
    const direct = meters(a, b)
    let best: number[][] | null = null
    let bestLength = Infinity
    usable.forEach((part, k) => {
      const pa = projections[k][i]
      const pb = projections[k][i + 1]
      if (pa.dist > STOP_MATCH_METERS || pb.dist > STOP_MATCH_METERS || pos(pb) <= pos(pa)) return
      const coords = [pa.point, ...part.slice(pa.seg + 1, pb.seg + 1), pb.point]
      const length = polylineLength(coords)
      // Un tronçon bien plus long que la distance directe trahit une boucle ou une autre branche
      if (length > direct * 3 + 400 || length >= bestLength) return
      best = coords
      bestLength = length
    })
    if (best) matched++
    segments.push({ coords: best ?? [a, b], approx: !best })
  }

  // Fusionne les tronçons consécutifs de même nature en LineStrings
  const merged: Array<{ coords: number[][]; approx: boolean }> = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (last && last.approx === seg.approx) last.coords.push(...seg.coords.slice(1))
    else merged.push({ coords: [...seg.coords], approx: seg.approx })
  }
  return { segments: merged, coverage: segments.length ? matched / segments.length : 0 }
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
  const trips = allTrips.filter((t) => active.has(t.serviceId))
  const unresolvedTrips = allTrips.filter((t) => unresolved.has(t.serviceId)).length

  // Horaires des courses du jour (par paquets pour rester sous la limite SQLite)
  const stopTimes: DayStopTime[] = []
  const tripIds = trips.map((t) => t.tripId)
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

  const stopIds = [...new Set(stopTimes.map((st) => st.stopId))]
  const stops = stopIds.length ? await prisma.stop.findMany({ where: { stopId: { in: stopIds } } }) : []
  const stopMap = new Map(stops.map((s) => [s.stopId, s]))

  const geometry = geometryFromRouteExtras(route.extras)
  const navitiaParts: number[][][] | null = geometry
    ? geometry.type === 'LineString'
      ? [geometry.coordinates as number[][]]
      : (geometry.coordinates as number[][][])
    : null

  // Arrêts de référence de chaque sens : tous ceux desservis par au moins une course, tous jours confondus
  const referenceRows = await prisma.$queryRaw<Array<{ directionId: number | null; stopId: string }>>`
    SELECT t.directionId AS directionId, st.stopId AS stopId
    FROM StopTime st JOIN Trip t ON t.tripId = st.tripId
    WHERE t.routeId = ${routeId} AND NOT (COALESCE(st.pickupType, 0) = 1 AND COALESCE(st.dropOffType, 0) = 1)
    GROUP BY t.directionId, st.stopId`
  const referenceStops = new Map<number | null, string[]>()
  for (const row of referenceRows) {
    const key = row.directionId == null ? null : Number(row.directionId)
    if (!referenceStops.has(key)) referenceStops.set(key, [])
    referenceStops.get(key)!.push(row.stopId)
  }
  const missingIds = [...new Set(referenceRows.map((r) => r.stopId))].filter((id) => !stopMap.has(id))
  const referenceStopMap = new Map(stopMap)
  for (let i = 0; i < missingIds.length; i += 500) {
    for (const st of await prisma.stop.findMany({ where: { stopId: { in: missingIds.slice(i, i + 500) } } })) {
      referenceStopMap.set(st.stopId, st)
    }
  }

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
          if (i !== undefined && times[i] === null) times[i] = normTime(st.departureTime || st.arrivalTime)
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

    // Tracé : shapes GTFS des courses du jour, sinon variantes Navitia entre arrêts desservis
    const features: LineFeature[] = []
    let geometrySource: 'gtfs_shapes' | 'navitia' | 'stops' | null = null
    const shapeIds = [...new Set(tripRows.map((r) => r.shape_id).filter((x): x is string => !!x))]
    for (const shapeId of shapeIds.slice(0, 12)) {
      const f = await gtfsShapeFeature(shapeId, { shape_id: shapeId, direction_id: dir })
      if (f) features.push(f)
    }
    if (features.length) geometrySource = 'gtfs_shapes'

    const stopCoords = stopPoints
      .map((sp) => sp.stop_point.coord)
      .filter((c): c is { lat: number; lon: number } => !!c)

    if (!features.length && stopCoords.length >= 2) {
      // Variantes Navitia suivies d'arrêt desservi en arrêt desservi, sinon vol d'oiseau
      const { segments, coverage } = navitiaParts
        ? navitiaPathThroughStops(navitiaParts, stopCoords)
        : { segments: [{ coords: stopCoords.map((c) => [c.lon, c.lat]), approx: true }], coverage: 0 }
      for (const seg of segments) {
        features.push({
          type: 'Feature',
          properties: { direction_id: dir, geometry_source: seg.approx ? 'stops' : 'navitia', approx: seg.approx },
          geometry: { type: 'LineString', coordinates: seg.coords },
        })
      }
      geometrySource = coverage >= 0.5 ? 'navitia' : 'stops'
    }

    // Arrêts de la ligne dans ce sens, desservis d'autres jours mais pas celui-ci
    const servedIds = new Set(sequence)
    const unservedStops = (referenceStops.get(dir) ?? [])
      .filter((id) => !servedIds.has(id))
      .map((id) => referenceStopMap.get(id))
      .filter((st): st is NonNullable<typeof st> => !!st && st.lat != null && st.lon != null)
      .map((st) => formatStop(st))

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
      unserved_stops: unservedStops,
      trips: tripRows.map(({ shape_id: _shape, ...rest }) => rest),
      geometry_source: geometrySource,
      geojson: { type: 'FeatureCollection' as const, features },
    })
  }

  return {
    line_id: route.routeId,
    color: hexColor(route.color),
    date: isoDate(date),
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
