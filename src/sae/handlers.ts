import { prisma } from '../db.js'
import { getDatasetStats } from '../gtfs/sync.js'
import { gtfsTypesForModeId, hexColor, modeFromGtfsType, PHYSICAL_MODES } from './modes.js'
import { buildNavitiaLine, buildNavitiaLines } from './line-navitia.js'

type Query = Record<string, string | undefined>

function parseLimit(q: Query, def = 50, max = 200) {
  return Math.min(parseInt(q.limit ?? String(def), 10) || def, max)
}

function parseOffset(q: Query) {
  return Math.max(parseInt(q.offset ?? '0', 10) || 0, 0)
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatLine(r: {
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
}) {
  const mode = modeFromGtfsType(r.type)
  return {
    id: r.routeId,
    name: r.longName ?? r.shortName ?? r.routeId,
    code: r.shortName,
    direction: r.longName,
    description: r.desc,
    color: hexColor(r.color),
    text_color: hexColor(r.textColor),
    url: r.url,
    agency_id: r.agencyId,
    sort_order: r.sortOrder,
    physical_mode: { id: mode.id, name: mode.name },
    commercial_mode: { id: mode.id, name: mode.name },
  }
}

function formatStop(s: {
  stopId: string
  code: string | null
  name: string
  desc: string | null
  lat: number | null
  lon: number | null
  locationType: number | null
  parentStation: string | null
  wheelchairBoarding: number | null
  zoneId: string | null
  url: string | null
}) {
  const isArea = s.locationType === 1
  return {
    id: s.stopId,
    name: s.name,
    label: s.name,
    code: s.code,
    description: s.desc,
    coord: s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null,
    location_type: s.locationType ?? 0,
    embedded_type: isArea ? 'stop_area' : 'stop_point',
    parent_station: s.parentStation,
    wheelchair_boarding: s.wheelchairBoarding,
    zone_id: s.zoneId,
    url: s.url,
  }
}

export async function coverage() {
  const stats = await getDatasetStats()
  const meta = await prisma.datasetMeta.findUnique({ where: { id: 'default' } })
  return {
    coverage: {
      id: 'sytral-rfu',
      name: 'Sytral Mobilités — RFU',
      dataset_created_at: meta?.lastImport?.toISOString() ?? null,
      rfu_version: meta?.rfuVersion ?? null,
      rfu_updated_at: meta?.rfuUpdatedAt ?? null,
    },
    datasets: {
      lines: stats.routes,
      stop_points: stats.stops,
      vehicle_journeys: stats.trips,
      stop_times: stats.stopTimes,
      agencies: stats.agencies,
      shapes: stats.shapes,
    },
    links: [
      { rel: 'lines', href: '/api/v1/lines' },
      { rel: 'stop_points', href: '/api/v1/stop_points' },
      { rel: 'places', href: '/api/v1/places' },
      { rel: 'places_nearby', href: '/api/v1/places_nearby' },
      { rel: 'poi', href: '/api/v1/poi' },
      { rel: 'physical_modes', href: '/api/v1/physical_modes' },
    ],
  }
}

export async function physicalModes() {
  const counts = await prisma.route.groupBy({ by: ['type'], _count: true })
  const countByType = new Map(counts.map((c) => [c.type, c._count]))

  return {
    physical_modes: PHYSICAL_MODES.map((m) => ({
      id: m.id,
      name: m.name,
      gtfs_types: m.gtfsTypes,
      lines_count: m.gtfsTypes.reduce((sum, t) => sum + (countByType.get(t) ?? 0), 0),
    })).filter((m) => m.lines_count > 0),
  }
}

export async function listLines(q: Query) {
  const limit = parseLimit(q)
  const offset = parseOffset(q)
  const where: Record<string, unknown> = {}

  if (q.physical_mode || q.mode || q.type) {
    if (q.type) {
      where.type = parseInt(q.type, 10)
    } else {
      const types = gtfsTypesForModeId(q.physical_mode ?? q.mode ?? '')
      if (types) where.type = { in: types }
      else return { lines: [], pagination: { total: 0, limit, offset, hasMore: false } }
    }
  }

  if (q.q || q.name) {
    const term = q.q ?? q.name!
    where.OR = [
      { shortName: { contains: term } },
      { longName: { contains: term } },
      { routeId: { contains: term } },
    ]
  }

  if (q.agency_id) where.agencyId = q.agency_id

  const [rows, total] = await Promise.all([
    prisma.route.findMany({ where, take: limit, skip: offset, orderBy: [{ sortOrder: 'asc' }, { shortName: 'asc' }] }),
    prisma.route.count({ where }),
  ])

  // Même structure Navitia que le détail. geojson=false pour alléger si besoin.
  const includeGeojson = q.geojson !== 'false'
  const lines = await buildNavitiaLines(rows, { includeGeojson })

  return {
    lines,
    pagination: { total, limit, offset, hasMore: offset + limit < total },
  }
}

export async function getLine(routeId: string, q: Query = {}) {
  const row = await prisma.route.findUnique({ where: { routeId } })
  if (!row) return null
  const includeGeojson = q.geojson !== 'false'
  // Navitia renvoie l'objet ligne à la racine (pas enveloppe { line })
  return buildNavitiaLine(row, { includeGeojson })
}

/** Thermomètre : séquence d'arrêts d'une ligne (par direction) */
export async function lineThermometer(routeId: string, q: Query) {
  const route = await prisma.route.findUnique({ where: { routeId } })
  if (!route) return null

  const directionId = q.direction_id !== undefined ? parseInt(q.direction_id, 10) : undefined

  const trips = await prisma.trip.findMany({
    where: {
      routeId,
      ...(directionId !== undefined && !Number.isNaN(directionId) ? { directionId } : {}),
    },
    select: { tripId: true, directionId: true, headsign: true, shapeId: true },
    take: 500,
  })

  if (trips.length === 0) {
    return { line: formatLine(route), directions: [] }
  }

  // Grouper par direction
  const byDir = new Map<number | null, typeof trips>()
  for (const t of trips) {
    const key = t.directionId
    if (!byDir.has(key)) byDir.set(key, [])
    byDir.get(key)!.push(t)
  }

  const directions = []

  for (const [dir, dirTrips] of byDir) {
    const tripIds = dirTrips.map((t) => t.tripId)
    const counts = await prisma.stopTime.groupBy({
      by: ['tripId'],
      where: { tripId: { in: tripIds } },
      _count: { tripId: true },
      orderBy: { _count: { tripId: 'desc' } },
      take: 1,
    })

    const bestTripId = counts[0]?.tripId ?? dirTrips[0].tripId
    const bestTrip = dirTrips.find((t) => t.tripId === bestTripId) ?? dirTrips[0]

    const stopTimes = await prisma.stopTime.findMany({
      where: { tripId: bestTrip.tripId },
      orderBy: { stopSequence: 'asc' },
    })

    const stopIds = stopTimes.map((st) => st.stopId)
    const stops = await prisma.stop.findMany({ where: { stopId: { in: stopIds } } })
    const stopMap = new Map(stops.map((s) => [s.stopId, s]))

    directions.push({
      direction_id: dir,
      headsign: bestTrip.headsign,
      shape_id: bestTrip.shapeId,
      trip_id: bestTrip.tripId,
      stop_points: stopTimes.map((st) => {
        const s = stopMap.get(st.stopId)
        return {
          order: st.stopSequence,
          stop_point: s ? formatStop(s) : { id: st.stopId, name: st.stopId },
          arrival_time: st.arrivalTime,
          departure_time: st.departureTime,
        }
      }),
    })
  }

  return {
    line: formatLine(route),
    directions,
  }
}

/** Tracé GeoJSON d'une ligne */
export async function lineGeojson(routeId: string, q: Query) {
  const route = await prisma.route.findUnique({ where: { routeId } })
  if (!route) return null

  const directionId = q.direction_id !== undefined ? parseInt(q.direction_id, 10) : undefined

  const trips = await prisma.trip.findMany({
    where: {
      routeId,
      shapeId: { not: null },
      ...(directionId !== undefined && !Number.isNaN(directionId) ? { directionId } : {}),
    },
    select: { shapeId: true, directionId: true, headsign: true },
    distinct: ['shapeId'],
    take: 20,
  })

  const features = []

  for (const trip of trips) {
    if (!trip.shapeId) continue
    const points = await prisma.shape.findMany({
      where: { shapeId: trip.shapeId },
      orderBy: { ptSequence: 'asc' },
    })
    if (points.length < 2) continue

    features.push({
      type: 'Feature',
      properties: {
        line_id: route.routeId,
        line_code: route.shortName,
        line_name: route.longName,
        color: hexColor(route.color),
        shape_id: trip.shapeId,
        direction_id: trip.directionId,
        headsign: trip.headsign,
      },
      geometry: {
        type: 'LineString',
        coordinates: points.map((p) => [p.ptLon, p.ptLat]),
      },
    })
  }

  return {
    type: 'FeatureCollection',
    features,
    line: formatLine(route),
  }
}

/** Horaires / route_schedules d'une ligne */
export async function lineSchedules(routeId: string, q: Query) {
  const route = await prisma.route.findUnique({ where: { routeId } })
  if (!route) return null

  const limit = parseLimit(q, 100, 500)
  const fromTime = q.from_datetime?.slice(11, 19) ?? q.from_time
  const stopId = q.stop_point_id ?? q.stop_id

  const trips = await prisma.trip.findMany({
    where: { routeId },
    select: { tripId: true, headsign: true, directionId: true, serviceId: true },
    take: 200,
  })

  const tripMap = new Map(trips.map((t) => [t.tripId, t]))
  const tripIds = trips.map((t) => t.tripId)

  const where: Record<string, unknown> = { tripId: { in: tripIds } }
  if (stopId) where.stopId = stopId
  if (fromTime) where.departureTime = { gte: fromTime }

  const stopTimes = await prisma.stopTime.findMany({
    where,
    orderBy: [{ departureTime: 'asc' }],
    take: limit,
  })

  const stopIds = [...new Set(stopTimes.map((st) => st.stopId))]
  const stops = await prisma.stop.findMany({ where: { stopId: { in: stopIds } } })
  const stopMap = new Map(stops.map((s) => [s.stopId, s]))

  return {
    line: formatLine(route),
    route_schedules: stopTimes.map((st) => {
      const trip = tripMap.get(st.tripId)
      const stop = stopMap.get(st.stopId)
      return {
        stop_point: stop ? formatStop(stop) : { id: st.stopId },
        vehicle_journey_id: st.tripId,
        headsign: trip?.headsign ?? st.headsign,
        direction_id: trip?.directionId,
        service_id: trip?.serviceId,
        arrival_time: st.arrivalTime,
        departure_time: st.departureTime,
        stop_sequence: st.stopSequence,
      }
    }),
  }
}

export async function listStopPoints(q: Query) {
  const limit = parseLimit(q)
  const offset = parseOffset(q)
  const where: Record<string, unknown> = {}

  if (q.q || q.name) {
    const term = q.q ?? q.name!
    where.OR = [{ name: { contains: term } }, { stopId: { contains: term } }, { code: { contains: term } }]
  }

  if (q.location_type !== undefined) {
    where.locationType = parseInt(q.location_type, 10)
  } else if (q.stop_areas_only === 'true') {
    where.locationType = 1
  } else if (q.stop_points_only === 'true') {
    where.OR = [{ locationType: 0 }, { locationType: null }]
  }

  const [rows, total] = await Promise.all([
    prisma.stop.findMany({ where, take: limit, skip: offset, orderBy: { name: 'asc' } }),
    prisma.stop.count({ where }),
  ])

  return {
    stop_points: rows.map(formatStop),
    pagination: { total, limit, offset, hasMore: offset + limit < total },
  }
}

export async function getStopPoint(stopId: string) {
  const row = await prisma.stop.findUnique({ where: { stopId } })
  if (!row) return null

  // Lignes desservant cet arrêt
  const stopTimes = await prisma.stopTime.findMany({
    where: { stopId },
    select: { tripId: true },
    distinct: ['tripId'],
    take: 500,
  })
  const tripIds = stopTimes.map((st) => st.tripId)
  const trips = await prisma.trip.findMany({
    where: { tripId: { in: tripIds } },
    select: { routeId: true },
    distinct: ['routeId'],
  })
  const routes = await prisma.route.findMany({
    where: { routeId: { in: trips.map((t) => t.routeId) } },
    orderBy: { sortOrder: 'asc' },
  })

  return {
    stop_point: formatStop(row),
    lines: routes.map(formatLine),
  }
}

/** Horaires / départs d'un arrêt */
export async function stopSchedules(stopId: string, q: Query) {
  const stop = await prisma.stop.findUnique({ where: { stopId } })
  if (!stop) return null

  const limit = parseLimit(q, 50, 300)
  const fromTime = q.from_datetime?.slice(11, 19) ?? q.from_time
  const routeId = q.line_id ?? q.route_id

  let tripFilter: string[] | undefined
  if (routeId) {
    const trips = await prisma.trip.findMany({
      where: { routeId },
      select: { tripId: true },
    })
    tripFilter = trips.map((t) => t.tripId)
    if (tripFilter.length === 0) {
      return { stop_point: formatStop(stop), stop_schedules: [] }
    }
  }

  const where: Record<string, unknown> = { stopId }
  if (tripFilter) where.tripId = { in: tripFilter }
  if (fromTime) where.departureTime = { gte: fromTime }

  const stopTimes = await prisma.stopTime.findMany({
    where,
    orderBy: { departureTime: 'asc' },
    take: limit,
  })

  const trips = await prisma.trip.findMany({
    where: { tripId: { in: stopTimes.map((st) => st.tripId) } },
  })
  const tripMap = new Map(trips.map((t) => [t.tripId, t]))

  const routeIds = [...new Set(trips.map((t) => t.routeId))]
  const routes = await prisma.route.findMany({ where: { routeId: { in: routeIds } } })
  const routeMap = new Map(routes.map((r) => [r.routeId, r]))

  return {
    stop_point: formatStop(stop),
    stop_schedules: stopTimes.map((st) => {
      const trip = tripMap.get(st.tripId)
      const route = trip ? routeMap.get(trip.routeId) : undefined
      return {
        departure_time: st.departureTime,
        arrival_time: st.arrivalTime,
        stop_sequence: st.stopSequence,
        headsign: trip?.headsign ?? st.headsign,
        direction_id: trip?.directionId,
        vehicle_journey_id: st.tripId,
        line: route ? formatLine(route) : null,
      }
    }),
  }
}

/** Autocomplétion lieux (arrêts + lignes) — style Navitia places */
export async function places(q: Query) {
  const term = (q.q ?? q.name ?? '').trim()
  if (!term || term.length < 2) {
    return { places: [], message: 'Paramètre q requis (min 2 caractères)' }
  }

  const limit = parseLimit(q, 20, 50)
  const types = (q.type ?? 'stop_point,line').split(',').map((t) => t.trim())

  const placesOut: Array<Record<string, unknown>> = []

  if (types.includes('stop_point') || types.includes('stop_area') || types.includes('poi')) {
    const stops = await prisma.stop.findMany({
      where: {
        OR: [{ name: { contains: term } }, { code: { contains: term } }, { stopId: { contains: term } }],
      },
      take: limit,
      orderBy: { name: 'asc' },
    })
    for (const s of stops) {
      placesOut.push({
        id: s.stopId,
        name: s.name,
        quality: 100,
        embedded_type: s.locationType === 1 ? 'stop_area' : 'stop_point',
        stop_point: formatStop(s),
      })
    }
  }

  if (types.includes('line')) {
    const lines = await prisma.route.findMany({
      where: {
        OR: [
          { shortName: { contains: term } },
          { longName: { contains: term } },
          { routeId: { contains: term } },
        ],
      },
      take: Math.ceil(limit / 2),
      orderBy: { shortName: 'asc' },
    })
    for (const r of lines) {
      placesOut.push({
        id: r.routeId,
        name: r.shortName ? `${r.shortName} — ${r.longName ?? ''}` : (r.longName ?? r.routeId),
        quality: 90,
        embedded_type: 'line',
        line: formatLine(r),
      })
    }
  }

  return { places: placesOut.slice(0, limit) }
}

/** Lieux à proximité — style Navitia places_nearby */
export async function placesNearby(q: Query) {
  const lat = parseFloat(q.lat ?? '')
  const lon = parseFloat(q.lon ?? q.lng ?? '')
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return { error: 'Paramètres lat et lon requis' }
  }

  const distance = Math.min(parseInt(q.distance ?? '500', 10) || 500, 5000)
  const limit = parseLimit(q, 30, 100)

  // Bounding box approximatif (~111km/°)
  const dLat = distance / 111_000
  const dLon = distance / (111_000 * Math.cos((lat * Math.PI) / 180))

  const candidates = await prisma.stop.findMany({
    where: {
      lat: { gte: lat - dLat, lte: lat + dLat },
      lon: { gte: lon - dLon, lte: lon + dLon },
    },
    take: 800,
  })

  const scored = candidates
    .filter((s) => s.lat != null && s.lon != null)
    .map((s) => ({
      stop: s,
      distance: haversineMeters(lat, lon, s.lat!, s.lon!),
    }))
    .filter((x) => x.distance <= distance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)

  return {
    places_nearby: scored.map(({ stop, distance: d }) => ({
      distance: Math.round(d),
      embedded_type: stop.locationType === 1 ? 'stop_area' : 'stop_point',
      stop_point: formatStop(stop),
    })),
    pagination: { total: scored.length, limit, offset: 0 },
  }
}

/** POI = arrêts / stations exposés comme points d'intérêt */
export async function listPoi(q: Query) {
  const limit = parseLimit(q)
  const offset = parseOffset(q)
  const where: Record<string, unknown> = {}

  if (q.q) {
    where.OR = [{ name: { contains: q.q } }, { stopId: { contains: q.q } }]
  }

  // Stations / POI : location_type 1 (station) par défaut, sinon tous
  if (q.all !== 'true') {
    where.locationType = q.poi_type === 'stop' ? 0 : 1
  }

  const [rows, total] = await Promise.all([
    prisma.stop.findMany({ where, take: limit, skip: offset, orderBy: { name: 'asc' } }),
    prisma.stop.count({ where }),
  ])

  return {
    poi: rows.map((s) => ({
      id: s.stopId,
      name: s.name,
      label: s.name,
      poi_type: s.locationType === 1 ? 'stop_area' : 'stop_point',
      coord: s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null,
      stop_point: formatStop(s),
    })),
    pagination: { total, limit, offset, hasMore: offset + limit < total },
  }
}

export async function getPoi(id: string) {
  const stop = await prisma.stop.findUnique({ where: { stopId: id } })
  if (!stop) return null
  return {
    poi: {
      id: stop.stopId,
      name: stop.name,
      label: stop.name,
      poi_type: stop.locationType === 1 ? 'stop_area' : 'stop_point',
      coord: stop.lat != null && stop.lon != null ? { lat: stop.lat, lon: stop.lon } : null,
      stop_point: formatStop(stop),
    },
  }
}

export async function listNetworks() {
  const agencies = await prisma.agency.findMany({ orderBy: { name: 'asc' } })
  return {
    networks: agencies.map((a) => ({
      id: a.agencyId,
      name: a.name,
      url: a.url,
      timezone: a.timezone,
      lang: a.lang,
      phone: a.phone,
      email: a.email,
    })),
  }
}

export async function listVehicleJourneys(q: Query) {
  const limit = parseLimit(q, 50, 200)
  const offset = parseOffset(q)
  const where: Record<string, unknown> = {}
  if (q.line_id || q.route_id) where.routeId = q.line_id ?? q.route_id
  if (q.direction_id !== undefined) where.directionId = parseInt(q.direction_id, 10)

  const [rows, total] = await Promise.all([
    prisma.trip.findMany({ where, take: limit, skip: offset, orderBy: { tripId: 'asc' } }),
    prisma.trip.count({ where }),
  ])

  const routeIds = [...new Set(rows.map((t) => t.routeId))]
  const routes = await prisma.route.findMany({ where: { routeId: { in: routeIds } } })
  const routeMap = new Map(routes.map((r) => [r.routeId, r]))

  return {
    vehicle_journeys: rows.map((t) => ({
      id: t.tripId,
      name: t.headsign ?? t.tripId,
      headsign: t.headsign,
      direction_id: t.directionId,
      service_id: t.serviceId,
      shape_id: t.shapeId,
      line: routeMap.get(t.routeId) ? formatLine(routeMap.get(t.routeId)!) : { id: t.routeId },
    })),
    pagination: { total, limit, offset, hasMore: offset + limit < total },
  }
}

export async function getVehicleJourney(tripId: string) {
  const trip = await prisma.trip.findUnique({ where: { tripId } })
  if (!trip) return null

  const route = await prisma.route.findUnique({ where: { routeId: trip.routeId } })
  const stopTimes = await prisma.stopTime.findMany({
    where: { tripId },
    orderBy: { stopSequence: 'asc' },
  })
  const stops = await prisma.stop.findMany({
    where: { stopId: { in: stopTimes.map((st) => st.stopId) } },
  })
  const stopMap = new Map(stops.map((s) => [s.stopId, s]))

  return {
    vehicle_journey: {
      id: trip.tripId,
      headsign: trip.headsign,
      direction_id: trip.directionId,
      service_id: trip.serviceId,
      shape_id: trip.shapeId,
      line: route ? formatLine(route) : null,
      stop_times: stopTimes.map((st) => ({
        arrival_time: st.arrivalTime,
        departure_time: st.departureTime,
        stop_sequence: st.stopSequence,
        stop_point: stopMap.get(st.stopId) ? formatStop(stopMap.get(st.stopId)!) : { id: st.stopId },
      })),
    },
  }
}
