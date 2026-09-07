import { prisma } from '../db.js'
import { config } from '../config.js'
import { indexNetexDirectory } from '../inventory.js'
import { importGtfsToDb } from '../gtfs/importer.js'
import { parseStopsFile, parsePoiFile, parseFareFile, parseOperatorsFile, parseNetworkFile, parseLineFile } from './parser.js'
import { setDownloadProgress } from '../import-state.js'
import { EMPTY_STATS } from './types.js'
import type { GtfsFiles, ImportStats } from '../gtfs/types.js'

type Node = Record<string, any>
const array = (value: any): any[] => value == null ? [] : Array.isArray(value) ? value : [value]
const text = (value: any): string | undefined => value == null ? undefined : typeof value === 'object' ? value['#text'] : String(value)
const ref = (value: any): string | undefined => array(value)[0]?.['@_ref']
async function* records(kind: string) {
  let cursor = 0
  while (true) {
    const batch = await prisma.$queryRaw<import('@prisma/client').SourceRecord[]>`SELECT r.* FROM SourceRecord r WHERE r.kind=${kind} AND r.id>${cursor} AND NOT EXISTS (SELECT 1 FROM SourceRecord newer WHERE newer.kind=r.kind AND newer.entityId=r.entityId AND newer.id>r.id) ORDER BY r.id LIMIT 25`
    if (!batch.length) break
    for (const record of batch) { cursor = record.id; yield { ...record, node: JSON.parse(record.data) as Node } }
  }
}
const cache = new Map<string, Node | undefined>()
async function lookup(kind: string, id?: string): Promise<Node | undefined> {
  if (!id) return undefined
  const key = `${kind}:${id}`
  if (cache.has(key)) return cache.get(key)
  const row = await prisma.sourceRecord.findFirst({ where: { kind, entityId: id }, orderBy: { id: 'desc' } })
  const node = row ? JSON.parse(row.data) : undefined
  if (cache.size >= 128) cache.delete(cache.keys().next().value!)
  cache.set(key, node)
  return node
}
const tables = {
  'agency.txt': ['agency', 'agencyId', 'agency_id'],
  'stops.txt': ['stop', 'stopId', 'stop_id'],
  'routes.txt': ['route', 'routeId', 'route_id'],
  'trips.txt': ['trip', 'tripId', 'trip_id'],
  'fare_zones.txt': ['fareZone', 'zoneId', 'fare_zone_id'],
} as const

/** Raw entities are retained in full; transit projections resolve references from SQLite. */
export async function importNetexExtractDir(dir: string, log: (message: string) => void | Promise<void>): Promise<ImportStats> {
  cache.clear()
  await indexNetexDirectory(dir, log)
  const stats = { ...EMPTY_STATS }
  async function insert(files: GtfsFiles, extras = {}) {
    for (const [file, [model, column, field]] of Object.entries(tables)) {
      const rows = (files as any)[file] as Node[] | undefined
      if (!rows?.length) continue
      const unique = [...new Map(rows.map(row => [row[field], row])).values()]
      const existing = await (prisma[model] as any).findMany({ where: { [column]: { in: unique.map(row => row[field]) } }, select: { [column]: true } })
      const ids = new Set(existing.map((row: Node) => row[column]))
      ;(files as any)[file] = unique.filter(row => !ids.has(row[field]))
      if (file === 'trips.txt' && !(files as any)[file].length) files['stop_times.txt'] = []
    }
    const added = await importGtfsToDb(files, () => {}, extras, false)
    for (const key of Object.keys(stats) as (keyof ImportStats)[]) stats[key] += added[key]
  }
  for (const kind of ['StopPlace', 'PointOfInterest', 'FareZone', 'Operator', 'Network', 'Line']) {
    await log(`Projection ${kind}…`)
    for await (const { node } of records(kind)) {
      const doc = { [kind]: node }
      if (kind === 'StopPlace' || kind === 'PointOfInterest') {
        const parsed = kind === 'StopPlace' ? parseStopsFile('', doc) : parsePoiFile('', doc)
        await insert({ 'stops.txt': parsed.stops }, { stopExtras: parsed.stopExtras })
      } else if (kind === 'FareZone') {
        const parsed = parseFareFile('', doc)
        await insert({ 'fare_zones.txt': parsed.zones }, { fareZoneExtras: parsed.fareZoneExtras })
      } else if (kind === 'Operator' || kind === 'Network') {
        await insert({ 'agency.txt': kind === 'Operator' ? parseOperatorsFile('', doc) : parseNetworkFile('', doc) })
      } else {
        const parsed = parseLineFile('', doc)
        await insert({ 'routes.txt': parsed.routes }, { routeExtras: parsed.routeExtras })
      }
    }
  }
  // Standalone Quays are valid too (not only Quays nested inside a StopPlace).
  for await (const { node } of records('Quay')) {
    const id = node['@_id']
    if (await prisma.stop.findUnique({ where: { stopId: id }, select: { id: true } })) continue
    const loc = node.Centroid?.Location ?? node.Location
    await insert({ 'stops.txt': [{ stop_id: id, stop_name: text(node.Name) ?? id, stop_lat: text(loc?.Latitude), stop_lon: text(loc?.Longitude), location_type: '0', parent_station: ref(node.StopPlaceRef) }] }, { stopExtras: { [id]: { netex_type: 'Quay' } } })
  }
  for await (const { node } of records('PassengerStopAssignment')) {
    const key = ref(node.ScheduledStopPointRef)
    const value = ref(node.QuayRef) ?? ref(node.StopPlaceRef)
    if (key && value) await prisma.netexReference.upsert({ where: { key }, create: { key, value }, update: { value } })
  }
  // Index calendar assignments by DayType without retaining all dates in RAM.
  for await (const row of records('DayTypeAssignment')) {
    const key = ref(row.node.DayTypeRef)
    if (key) await prisma.netexReference.create({ data: { key: `day:${key}:${row.id}`, value: row.data } })
  }
  let journeys = 0
  for await (const row of records('ServiceJourney')) {
    const sj = row.node
    const jpId = ref(sj.JourneyPatternRef) ?? ref(sj.ServiceJourneyPatternRef)
    const jp = await lookup('ServiceJourneyPattern', jpId) ?? await lookup('JourneyPattern', jpId)
    const route = await lookup('Route', ref(jp?.RouteRef))
    let lineId = ref(sj.LineRef) ?? ref(route?.LineRef)
    if (!lineId) {
      const candidates = await prisma.sourceRecord.findMany({ where: { kind: 'Line', file: row.file }, take: 2 })
      if (candidates.length === 1) lineId = candidates[0].entityId ?? undefined
    }
    const line = await lookup('Line', lineId)
    if (!line) throw new Error(`Ligne non résolue pour ${row.entityId}`)
    const points = array(jp?.pointsInSequence?.StopPointInJourneyPattern)
    const ssps = points.map(point => ref(point.ScheduledStopPointRef)).filter((id): id is string => !!id)
    const assignments = ssps.length ? await prisma.netexReference.findMany({ where: { key: { in: ssps } } }) : []
    const doc = { ServiceJourney: sj, ServiceJourneyPattern: jp, Route: route, Line: line,
      PassengerStopAssignment: assignments.map(a => ({ ScheduledStopPointRef: { '@_ref': a.key }, QuayRef: { '@_ref': a.value } })) }
    const parsed = parseLineFile('', doc)
    const dayTypes = array(sj.dayTypes?.DayTypeRef).map(refNode => ref(refNode)).filter((id): id is string => !!id).sort()
    const serviceId = dayTypes.join('|') || `journey:${row.entityId}`
    for (const trip of parsed.trips) trip.service_id = serviceId
    await insert({ 'trips.txt': parsed.trips, 'stop_times.txt': parsed.stopTimes })
    // One calendar projection per distinct DayType combination. Unresolvable calendars stay raw.
    const calendarKey = `calendar:${serviceId}`
    if (!await prisma.netexReference.findUnique({ where: { key: calendarKey } })) {
      await projectCalendar(serviceId, dayTypes, stats)
      await prisma.netexReference.create({ data: { key: calendarKey, value: 'done' } })
    }
    if (++journeys % 100 === 0) { await log(`${journeys} courses projetées`); setDownloadProgress({ phase: 'importing', percent: null }) }
  }
  await log(`Projection terminée : ${stats.routes} lignes, ${stats.trips} courses, ${stats.pois} POI. Toutes les entités originales sont consultables dans l’inventaire.`)
  cache.clear()
  return stats
}

const days: Record<string, number[]> = { Monday: [1], Tuesday: [2], Wednesday: [3], Thursday: [4], Friday: [5], Saturday: [6], Sunday: [0], Weekdays: [1,2,3,4,5], Weekend: [0,6], Everyday: [0,1,2,3,4,5,6] }
const dateString = (value?: string) => value?.slice(0, 10).replace(/-/g, '')
async function projectCalendar(serviceId: string, dayTypes: string[], stats: ImportStats) {
  if (dayTypes.length !== 1) return // Combined DayTypes require profile-specific semantics.
  const dates = new Map<string, number>()
  for (const dayType of dayTypes) {
    const definition = await lookup('DayType', dayType)
    const properties = array(definition?.properties?.PropertyOfDay)
    const tokens = properties.flatMap(p => (text(p.DaysOfWeek) ?? '').split(/\s+/)).filter(Boolean)
    const supportedWeek = tokens.length > 0 && tokens.every(token => token in days) && properties.every(p => Object.keys(p).every(k => k === 'DaysOfWeek' || k.startsWith('@_')))
    const weekdays = new Set(supportedWeek ? tokens.flatMap(token => days[token]) : [])
    const assignments = await prisma.netexReference.findMany({ where: { key: { startsWith: `day:${dayType}:` } } })
    for (const assignment of assignments) {
      const node = JSON.parse(assignment.value)
      const available = text(node.isAvailable) !== 'false' && text(node.IsAvailable) !== 'false'
      const operatingDay = await lookup('OperatingDay', ref(node.OperatingDayRef))
      const single = dateString(text(node.Date) ?? text(operatingDay?.CalendarDate))
      if (single) { dates.set(single, available ? 1 : 2); continue }
      const period = await lookup('OperatingPeriod', ref(node.OperatingPeriodRef))
      const from = text(period?.FromDate); const to = text(period?.ToDate)
      if (!from || !to || !weekdays.size) continue
      const start = new Date(from.slice(0,10) + 'T00:00:00Z'); const end = new Date(to.slice(0,10) + 'T00:00:00Z')
      if (!Number.isFinite(+start) || !Number.isFinite(+end) || +end - +start > 3660 * 86400000) throw new Error(`Période NeTEx invalide : ${dayType}`)
      for (let date = +start; date <= +end; date += 86400000) {
        const d = new Date(date)
        if (weekdays.has(d.getUTCDay())) dates.set(dateString(d.toISOString())!, available ? 1 : 2)
      }
    }
  }
  const rows = [...dates].map(([date, exceptionType]) => ({ serviceId, date, exceptionType }))
  for (let i = 0; i < rows.length; i += config.IMPORT_BATCH_SIZE) await prisma.calendarDate.createMany({ data: rows.slice(i, i + config.IMPORT_BATCH_SIZE) })
  stats.calendarDates += rows.length
}
