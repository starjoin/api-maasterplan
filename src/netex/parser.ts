import fs from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import {
  directionToGtfs,
  transportModeToGtfsType,
  transportModeToRouteDesc,
  type NetexExtras,
  type NetexMapped,
} from './types.js'
import type {
  GtfsAgencyRow,
  GtfsCalendarRow,
  GtfsFareZoneRow,
  GtfsRouteRow,
  GtfsStopRow,
  GtfsStopTimeRow,
  GtfsTripRow,
} from '../gtfs/types.js'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  isArray: (name) =>
    [
      'members',
      'Line',
      'Route',
      'ServiceJourney',
      'ServiceJourneyPattern',
      'JourneyPattern',
      'StopPointInJourneyPattern',
      'TimetabledPassingTime',
      'PassengerStopAssignment',
      'ScheduledStopPoint',
      'StopPlace',
      'Quay',
      'Operator',
      'DayType',
      'KeyValue',
      'PointOnRoute',
      'DayTypeRef',
      'PointOfInterest',
      'FareZone',
      'Network',
      'LineRef',
      'FareZoneRef',
      'TopographicProjectionRef',
      'PointOfInterestClassificationView',
      'AvailabilityCondition',
      'Timeband',
    ].includes(name),
})

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return asArray(value as Record<string, unknown> | Record<string, unknown>[] | undefined | null)
}

function text(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && value !== null && '#text' in value) {
    return String((value as { '#text': unknown })['#text'])
  }
  return undefined
}

function attr(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!obj) return undefined
  return text(obj[`@_${key}`]) ?? text(obj[key])
}

function keyListMap(node: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const list = node?.keyList as { KeyValue?: unknown } | undefined
  for (const kv of asArray(list?.KeyValue as Record<string, unknown>[])) {
    const k = text(kv.Key)
    const v = text(kv.Value)
    if (k && v) out[k] = v
  }
  return out
}

function refOf(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return text(node)
  return attr(node as Record<string, unknown>, 'ref') ?? text(node)
}

function deepMembers(doc: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const n of node) walk(n)
      return
    }
    const rec = node as Record<string, unknown>
    if (rec.members) {
      for (const m of asArray(rec.members)) {
        if (m && typeof m === 'object') out.push(m as Record<string, unknown>)
        walk(m)
      }
    }
    for (const [k, v] of Object.entries(rec)) {
      if (k === 'members') continue
      if (v && typeof v === 'object') walk(v)
    }
  }
  walk(doc)
  return out
}

function collectByTag(members: Record<string, unknown>[], tag: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const m of members) {
    if (m[tag]) out.push(...asRecordArray(m[tag]))
  }
  for (const m of members) {
    for (const [k, v] of Object.entries(m)) {
      if (k === tag) out.push(...asRecordArray(v))
    }
  }
  return out
}

/** Collecte récursive de tous les nœuds ayant une certaine forme / tag local. */
function findAll(doc: unknown, tag: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const n of node) walk(n)
      return
    }
    const rec = node as Record<string, unknown>
    if (tag in rec) {
      out.push(...asRecordArray(rec[tag]))
    }
    for (const v of Object.values(rec)) {
      if (v && typeof v === 'object') walk(v)
    }
  }
  walk(doc)
  return out
}

export function parseNetexFile(filePath: string): unknown {
  const xml = fs.readFileSync(filePath, 'utf8')
  try {
    return parser.parse(xml)
  } finally {
    // xml tombe hors scope — aide le GC sur les gros fichiers Coolify
  }
}

function firstFareZoneId(node: Record<string, unknown>): string | undefined {
  const zones = node.tariffZones as { FareZoneRef?: unknown } | undefined
  for (const z of asArray(zones?.FareZoneRef as Record<string, unknown>[])) {
    const id = refOf(z) ?? attr(z, 'ref')
    if (id) return id
  }
  return undefined
}

export function parseStopsFile(filePath: string): {
  stops: GtfsStopRow[]
  stopExtras: Record<string, NetexExtras>
} {
  const doc = parseNetexFile(filePath)
  const stops: GtfsStopRow[] = []
  const stopExtras: Record<string, NetexExtras> = {}

  const places = findAll(doc, 'StopPlace')
  for (const sp of places) {
    const id = attr(sp, 'id')
    if (!id) continue
    const name = text(sp.Name) ?? id
    const loc = (sp.Centroid as { Location?: Record<string, unknown> } | undefined)?.Location
    const lat = text(loc?.Latitude)
    const lon = text(loc?.Longitude)
    const keys = keyListMap(sp)
    const code = text(sp.PrivateCode) ?? keys.REF ?? keys.external
    const addr = sp.PostalAddress as Record<string, unknown> | undefined
    const zoneId = firstFareZoneId(sp)

    stops.push({
      stop_id: id,
      stop_code: code,
      stop_name: name,
      stop_lat: lat,
      stop_lon: lon,
      zone_id: zoneId,
      location_type: '1',
    })
    stopExtras[id] = {
      keys,
      address: addr
        ? {
            line: text(addr.AddressLine1),
            town: text(addr.Town),
            postcode: text(addr.PostCode),
            region: text(addr.PostalRegion),
          }
        : undefined,
      netex_type: 'StopPlace',
      fare_zone: zoneId,
    }

    const quays = asArray(
      (sp.quays as { Quay?: Record<string, unknown> | Record<string, unknown>[] } | undefined)?.Quay,
    )
    for (const q of quays) {
      const qid = attr(q, 'id')
      if (!qid) continue
      const qloc = (q.Centroid as { Location?: Record<string, unknown> } | undefined)?.Location
      const qkeys = keyListMap(q)
      const qZone = firstFareZoneId(q) ?? zoneId
      stops.push({
        stop_id: qid,
        stop_code: text(q.PrivateCode) ?? qkeys.REF ?? qkeys.external ?? qid,
        stop_name: text(q.Name) ?? name,
        stop_lat: text(qloc?.Latitude) ?? lat,
        stop_lon: text(qloc?.Longitude) ?? lon,
        zone_id: qZone,
        location_type: '0',
        parent_station: id,
      })
      stopExtras[qid] = { keys: qkeys, netex_type: 'Quay', parent: id, fare_zone: qZone }
    }
  }

  // Quays orphelins éventuels au top-level
  for (const q of findAll(doc, 'Quay')) {
    const qid = attr(q, 'id')
    if (!qid || stopExtras[qid]) continue
    const qloc = (q.Centroid as { Location?: Record<string, unknown> } | undefined)?.Location
    const qkeys = keyListMap(q)
    const qZone = firstFareZoneId(q)
    stops.push({
      stop_id: qid,
      stop_code: text(q.PrivateCode) ?? qkeys.REF ?? qid,
      stop_name: text(q.Name) ?? qid,
      stop_lat: text(qloc?.Latitude),
      stop_lon: text(qloc?.Longitude),
      zone_id: qZone,
      location_type: '0',
    })
    stopExtras[qid] = { keys: qkeys, netex_type: 'Quay', fare_zone: qZone }
  }

  return { stops, stopExtras }
}

/** POI NeTEx → Stop location_type=3 (generic node GTFS) */
export function parsePoiFile(filePath: string): {
  stops: GtfsStopRow[]
  stopExtras: Record<string, NetexExtras>
} {
  if (!fs.existsSync(filePath)) return { stops: [], stopExtras: {} }
  const doc = parseNetexFile(filePath)
  const stops: GtfsStopRow[] = []
  const stopExtras: Record<string, NetexExtras> = {}

  for (const poi of findAll(doc, 'PointOfInterest')) {
    const id = attr(poi, 'id')
    if (!id) continue
    const loc = (poi.Centroid as { Location?: Record<string, unknown> } | undefined)?.Location
    const keys = keyListMap(poi)
    const addr = poi.PostalAddress as Record<string, unknown> | undefined
    const classifications = asArray(
      (poi.classifications as { PointOfInterestClassificationView?: unknown } | undefined)
        ?.PointOfInterestClassificationView as Record<string, unknown>[],
    )
      .map((c) => text(c.Name))
      .filter((n): n is string => !!n)

    const name = text(poi.Name) ?? id
    stops.push({
      stop_id: id,
      stop_code: keys.external ?? keys.REF ?? id,
      stop_name: name,
      stop_desc: classifications[0],
      stop_lat: text(loc?.Latitude),
      stop_lon: text(loc?.Longitude),
      location_type: '3',
    })
    stopExtras[id] = {
      keys,
      netex_type: 'PointOfInterest',
      classifications,
      address: addr
        ? {
            line: text(addr.AddressLine1),
            town: text(addr.Town),
            postcode: text(addr.PostCode),
            region: text(addr.PostalRegion),
          }
        : undefined,
    }
  }

  return { stops, stopExtras }
}

export function parseFareFile(filePath: string): {
  zones: GtfsFareZoneRow[]
  fareZoneExtras: Record<string, NetexExtras>
} {
  if (!fs.existsSync(filePath)) return { zones: [], fareZoneExtras: {} }
  const doc = parseNetexFile(filePath)
  const zones: GtfsFareZoneRow[] = []
  const fareZoneExtras: Record<string, NetexExtras> = {}

  for (const z of findAll(doc, 'FareZone')) {
    const id = attr(z, 'id')
    if (!id) continue
    const projections = asArray(
      (z.projections as { TopographicProjectionRef?: unknown } | undefined)
        ?.TopographicProjectionRef as Record<string, unknown>[],
    )
      .map((p) => refOf(p) ?? attr(p, 'ref'))
      .filter((x): x is string => !!x)

    zones.push({
      fare_zone_id: id,
      fare_zone_name: text(z.Name) ?? id,
    })
    fareZoneExtras[id] = {
      netex_type: 'FareZone',
      topographic_projections: projections,
    }
  }

  return { zones, fareZoneExtras }
}

export function parseOperatorsFile(filePath: string): GtfsAgencyRow[] {
  if (!fs.existsSync(filePath)) return []
  const doc = parseNetexFile(filePath)
  const agencies: GtfsAgencyRow[] = []
  for (const op of findAll(doc, 'Operator')) {
    const id = attr(op, 'id')
    if (!id) continue
    agencies.push({
      agency_id: id,
      agency_name: text(op.Name) ?? id,
      agency_timezone: 'Europe/Paris',
    })
  }
  return agencies
}

/** Networks NeTEx → agences complémentaires */
export function parseNetworkFile(filePath: string): GtfsAgencyRow[] {
  if (!fs.existsSync(filePath)) return []
  const doc = parseNetexFile(filePath)
  const agencies: GtfsAgencyRow[] = []
  for (const net of findAll(doc, 'Network')) {
    const id = attr(net, 'id')
    if (!id) continue
    agencies.push({
      agency_id: id,
      agency_name: text(net.Name) ?? id,
      agency_timezone: 'Europe/Paris',
    })
  }
  return agencies
}

type PatternStop = { order: number; sspRef: string; stopPointInPatternId: string }

export function parseLineFile(filePath: string): {
  routes: GtfsRouteRow[]
  trips: GtfsTripRow[]
  stopTimes: GtfsStopTimeRow[]
  calendars: GtfsCalendarRow[]
  routeExtras: Record<string, NetexExtras>
  sspToStop: Record<string, string>
} {
  const doc = parseNetexFile(filePath)
  const routes: GtfsRouteRow[] = []
  const trips: GtfsTripRow[] = []
  const stopTimes: GtfsStopTimeRow[] = []
  const calendars: GtfsCalendarRow[] = []
  const routeExtras: Record<string, NetexExtras> = {}
  const sspToStop: Record<string, string> = {}
  const calendarIds = new Set<string>()

  // PassengerStopAssignment : SSP → Quay
  for (const psa of findAll(doc, 'PassengerStopAssignment')) {
    const ssp = refOf(psa.ScheduledStopPointRef)
    const quay = refOf(psa.QuayRef) ?? refOf(psa.StopPlaceRef)
    if (ssp && quay) sspToStop[ssp] = quay
  }

  // Routes NeTEx (direction)
  const netexRoutes = findAll(doc, 'Route')
  const routeDirection = new Map<string, string>()
  for (const r of netexRoutes) {
    const id = attr(r, 'id')
    if (!id) continue
    routeDirection.set(id, text(r.DirectionType) ?? 'outbound')
  }

  // Journey patterns → ordered stops
  const patterns = new Map<string, PatternStop[]>()
  const patternRoute = new Map<string, string>()
  const patternName = new Map<string, string>()

  for (const tag of ['JourneyPattern', 'ServiceJourneyPattern']) {
    for (const jp of findAll(doc, tag)) {
      const id = attr(jp, 'id')
      if (!id) continue
      const routeRef = refOf(jp.RouteRef)
      if (routeRef) patternRoute.set(id, routeRef)
      if (text(jp.Name)) patternName.set(id, text(jp.Name)!)

      const points = asArray(
        (jp.pointsInSequence as { StopPointInJourneyPattern?: unknown } | undefined)
          ?.StopPointInJourneyPattern as Record<string, unknown>[],
      )
      const sequenced: PatternStop[] = []
      for (const pt of points) {
        const ssp = refOf(pt.ScheduledStopPointRef)
        const spijp = attr(pt, 'id')
        const order = Number(attr(pt, 'order') ?? sequenced.length + 1)
        if (ssp && spijp) sequenced.push({ order, sspRef: ssp, stopPointInPatternId: spijp })
      }
      sequenced.sort((a, b) => a.order - b.order)
      patterns.set(id, sequenced)

      // index stop point in pattern → ssp
      for (const s of sequenced) {
        // mapping used via TimetabledPassingTime refs
      }
    }
  }

  const spijpToSsp = new Map<string, string>()
  for (const stops of patterns.values()) {
    for (const s of stops) spijpToSsp.set(s.stopPointInPatternId, s.sspRef)
  }

  // Lines
  for (const line of findAll(doc, 'Line')) {
    const id = attr(line, 'id')
    if (!id) continue
    const keys = keyListMap(line)
    const mode = text(line.TransportMode)
    const sub =
      text((line.TransportSubmode as { BusSubmode?: unknown } | undefined)?.BusSubmode) ??
      text(line.TransportSubmode)
    const presentation = line.Presentation as Record<string, unknown> | undefined
    const publicCode = text(line.PublicCode) ?? keys.DOC ?? keys.external ?? id

    let desc = transportModeToRouteDesc(mode, sub)
    if (sub?.toLowerCase().includes('school') || publicCode.toUpperCase().startsWith('JD')) {
      desc = 'SCO'
    }

    routes.push({
      route_id: id,
      agency_id: refOf(line.OperatorRef),
      route_short_name: publicCode,
      route_long_name: text(line.Name),
      route_desc: desc,
      route_type: String(transportModeToGtfsType(mode, sub)),
      route_color: text(presentation?.Colour),
      route_text_color: text(presentation?.TextColour),
    })
    routeExtras[id] = {
      keys,
      transport_mode: mode,
      transport_submode: sub,
      netex_type: 'Line',
    }
  }

  const defaultLineId = routes[0]?.route_id

  // Service journeys
  for (const sj of findAll(doc, 'ServiceJourney')) {
    const tripId = attr(sj, 'id')
    if (!tripId) continue
    const jpRef = refOf(sj.JourneyPatternRef) ?? refOf(sj.ServiceJourneyPatternRef)
    const dayType =
      refOf(asArray((sj.dayTypes as { DayTypeRef?: unknown } | undefined)?.DayTypeRef)[0]) ??
      'ALWAYS'
    const lineRef = refOf(sj.LineRef) ?? defaultLineId
    if (!lineRef) continue

    const netexRouteId = jpRef ? patternRoute.get(jpRef) : undefined
    const direction = directionToGtfs(netexRouteId ? routeDirection.get(netexRouteId) : undefined)
    const headsign = text(sj.Name) ?? (jpRef ? patternName.get(jpRef) : undefined)

    if (!calendarIds.has(dayType)) {
      calendarIds.add(dayType)
      calendars.push({
        service_id: dayType,
        monday: '1',
        tuesday: '1',
        wednesday: '1',
        thursday: '1',
        friday: '1',
        saturday: '1',
        sunday: '1',
        start_date: '20240101',
        end_date: '20301231',
      })
    }

    trips.push({
      trip_id: tripId,
      route_id: lineRef,
      service_id: dayType,
      trip_headsign: headsign,
      trip_short_name: text(sj.PublicCode),
      direction_id: direction,
    })

    const passing = asArray(
      (sj.passingTimes as { TimetabledPassingTime?: unknown } | undefined)?.TimetabledPassingTime as Record<
        string,
        unknown
      >[],
    )

    let seq = 0
    for (const pt of passing) {
      const spijp = refOf(pt.StopPointInJourneyPatternRef)
      const ssp = spijp ? spijpToSsp.get(spijp) : undefined
      const stopId = ssp ? sspToStop[ssp] ?? ssp : undefined
      if (!stopId) continue
      seq += 1
      const arrival = text(pt.ArrivalTime) ?? text(pt.DepartureTime) ?? '00:00:00'
      const departure = text(pt.DepartureTime) ?? arrival
      stopTimes.push({
        trip_id: tripId,
        arrival_time: arrival.length === 5 ? `${arrival}:00` : arrival,
        departure_time: departure.length === 5 ? `${departure}:00` : departure,
        stop_id: stopId,
        stop_sequence: String(seq),
      })
    }
  }

  if (!calendarIds.has('ALWAYS') && trips.some((t) => t.service_id === 'ALWAYS')) {
    calendars.push({
      service_id: 'ALWAYS',
      monday: '1',
      tuesday: '1',
      wednesday: '1',
      thursday: '1',
      friday: '1',
      saturday: '1',
      sunday: '1',
      start_date: '20240101',
      end_date: '20301231',
    })
  }

  return { routes, trips, stopTimes, calendars, routeExtras, sspToStop }
}

export function listLineFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^line_.*\.xml$/i.test(f))
    .map((f) => path.join(dir, f))
    .sort()
}

export function buildNetexDataset(extractDir: string, log: (m: string) => void): NetexMapped {
  const stopPath = path.join(extractDir, 'stop.xml')
  const resourcePath = path.join(extractDir, 'resource.xml')
  const networkPath = path.join(extractDir, 'network.xml')
  const poiPath = path.join(extractDir, 'poi.xml')
  const farePath = path.join(extractDir, 'fare.xml')

  log('Parsing stop.xml…')
  const { stops: stopRows, stopExtras } = fs.existsSync(stopPath)
    ? parseStopsFile(stopPath)
    : { stops: [], stopExtras: {} }

  log('Parsing poi.xml…')
  const { stops: poiRows, stopExtras: poiExtras } = parsePoiFile(poiPath)
  Object.assign(stopExtras, poiExtras)
  const stops = [...stopRows, ...poiRows]
  log(`  ${stopRows.length} arrêts + ${poiRows.length} POI`)

  log('Parsing fare.xml…')
  const { zones, fareZoneExtras } = parseFareFile(farePath)
  log(`  ${zones.length} zones tarifaires`)

  log('Parsing resource.xml / network.xml (opérateurs)…')
  const byId = new Map<string, GtfsAgencyRow>()
  for (const a of [...parseOperatorsFile(resourcePath), ...parseNetworkFile(networkPath)]) {
    if (!byId.has(a.agency_id!)) byId.set(a.agency_id!, a)
  }
  let agencies = [...byId.values()]
  if (agencies.length === 0) {
    agencies = [{ agency_id: 'TCL', agency_name: 'TCL', agency_timezone: 'Europe/Paris' }]
  }

  const lineFiles = listLineFiles(extractDir)
  log(`Parsing ${lineFiles.length} fichiers ligne (bus, cars, trains…)…`)

  const routes: GtfsRouteRow[] = []
  const trips: GtfsTripRow[] = []
  const stopTimes: GtfsStopTimeRow[] = []
  const calendars: GtfsCalendarRow[] = []
  const routeExtras: Record<string, NetexExtras> = {}
  const calendarSeen = new Set<string>()
  const routeSeen = new Set<string>()

  let i = 0
  let skipped = 0
  for (const file of lineFiles) {
    i++
    if (i % 50 === 0 || i === lineFiles.length) log(`  lignes ${i}/${lineFiles.length}`)
    try {
      const parsed = parseLineFile(file)
      for (const r of parsed.routes) {
        if (routeSeen.has(r.route_id)) continue
        routeSeen.add(r.route_id)
        routes.push(r)
      }
      trips.push(...parsed.trips)
      stopTimes.push(...parsed.stopTimes)
      Object.assign(routeExtras, parsed.routeExtras)
      for (const c of parsed.calendars) {
        if (!calendarSeen.has(c.service_id)) {
          calendarSeen.add(c.service_id)
          calendars.push(c)
        }
      }
    } catch (err) {
      skipped++
      log(`  skip ${path.basename(file)} : ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (skipped) log(`  ${skipped} fichier(s) ligne ignoré(s)`)

  const modeCounts = new Map<string, number>()
  for (const r of routes) {
    const mode = String(routeExtras[r.route_id]?.transport_mode ?? `type:${r.route_type}`)
    modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1)
  }
  log(
    `  résumé modes : ${[...modeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([m, n]) => `${m}=${n}`)
      .join(', ')}`,
  )

  return {
    'agency.txt': agencies,
    'stops.txt': stops,
    'routes.txt': routes,
    'trips.txt': trips,
    'stop_times.txt': stopTimes,
    'calendar.txt': calendars,
    'fare_zones.txt': zones,
    routeExtras,
    stopExtras,
    fareZoneExtras,
  }
}
