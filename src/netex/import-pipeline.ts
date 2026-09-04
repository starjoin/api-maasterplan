import { prisma } from '../db.js'
import { config } from '../config.js'
import type { ImportStats } from '../gtfs/types.js'
import { EMPTY_STATS } from './types.js'
import {
  listLineFiles,
  parseFareFile,
  parseLineFile,
  parseNetworkFile,
  parseOperatorsFile,
  parsePoiFile,
  parseStopsFile,
} from './parser.js'
import path from 'node:path'
import fs from 'node:fs'
import { setDownloadProgress } from '../import-state.js'

type LogFn = (msg: string) => void | Promise<void>

async function logAwait(log: LogFn, msg: string) {
  await log(msg)
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function batchInsert<T>(
  items: T[],
  batchSize: number,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await fn(items.slice(i, i + batchSize))
    // Laisse respirer l’event loop (healthcheck Coolify)
    if (i > 0 && i % (batchSize * 5) === 0) await yieldEventLoop()
  }
}

async function clearTransitTables() {
  await prisma.$transaction([
    prisma.stopTime.deleteMany(),
    prisma.shape.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.calendarDate.deleteMany(),
    prisma.calendar.deleteMany(),
    prisma.fareRule.deleteMany(),
    prisma.fareAttribute.deleteMany(),
    prisma.fareZone.deleteMany(),
    prisma.transfer.deleteMany(),
    prisma.route.deleteMany(),
    prisma.stop.deleteMany(),
    prisma.agency.deleteMany(),
  ])
}

/**
 * Import NeTEx incrémental : parse + insert fichier par fichier,
 * sans accumuler tous les stop_times en RAM (évite OOM Coolify).
 */
export async function importNetexExtractDir(extractDir: string, log: LogFn): Promise<ImportStats> {
  const stats: ImportStats = { ...EMPTY_STATS }
  const batchSize = config.IMPORT_BATCH_SIZE

  await logAwait(log, 'Nettoyage des données existantes…')
  await clearTransitTables()
  await yieldEventLoop()

  const stopPath = path.join(extractDir, 'stop.xml')
  const resourcePath = path.join(extractDir, 'resource.xml')
  const networkPath = path.join(extractDir, 'network.xml')
  const poiPath = path.join(extractDir, 'poi.xml')
  const farePath = path.join(extractDir, 'fare.xml')

  await logAwait(log, 'Parsing stop.xml…')
  setDownloadProgress({ phase: 'parsing', percent: 5 })
  const { stops: stopRows, stopExtras } = fs.existsSync(stopPath)
    ? parseStopsFile(stopPath)
    : { stops: [], stopExtras: {} }
  await yieldEventLoop()

  await logAwait(log, 'Parsing poi.xml…')
  const { stops: poiRows, stopExtras: poiExtras } = parsePoiFile(poiPath)
  Object.assign(stopExtras, poiExtras)
  const stops = [...stopRows, ...poiRows]
  await logAwait(log, `  ${stopRows.length} arrêts + ${poiRows.length} POI`)
  await yieldEventLoop()

  if (stops.length > 0) {
    await logAwait(log, `Import de ${stops.length} arrêts / POI…`)
    await batchInsert(stops, batchSize, (chunk) =>
      prisma.stop.createMany({
        data: chunk.map((s) => ({
          stopId: s.stop_id,
          code: s.stop_code || null,
          name: s.stop_name,
          desc: s.stop_desc || null,
          lat: s.stop_lat ? parseFloat(s.stop_lat) : null,
          lon: s.stop_lon ? parseFloat(s.stop_lon) : null,
          zoneId: s.zone_id || null,
          url: s.stop_url || null,
          locationType: s.location_type ? parseInt(s.location_type, 10) : null,
          parentStation: s.parent_station || null,
          wheelchairBoarding: s.wheelchair_boarding ? parseInt(s.wheelchair_boarding, 10) : null,
          extras: stopExtras[s.stop_id] ? JSON.stringify(stopExtras[s.stop_id]) : null,
        })),
      }),
    )
    stats.stops = stops.length
    stats.pois = stops.filter((s) => s.location_type === '3').length
  }
  // Libérer les grosses structures
  stops.length = 0
  stopRows.length = 0
  poiRows.length = 0
  await yieldEventLoop()

  await logAwait(log, 'Parsing fare.xml…')
  const { zones, fareZoneExtras } = parseFareFile(farePath)
  await logAwait(log, `  ${zones.length} zones tarifaires`)
  if (zones.length > 0) {
    await batchInsert(zones, batchSize, (chunk) =>
      prisma.fareZone.createMany({
        data: chunk.map((z) => ({
          zoneId: z.fare_zone_id,
          name: z.fare_zone_name || null,
          extras: fareZoneExtras[z.fare_zone_id]
            ? JSON.stringify(fareZoneExtras[z.fare_zone_id])
            : null,
        })),
      }),
    )
    stats.fareZones = zones.length
  }
  await yieldEventLoop()

  await logAwait(log, 'Parsing resource.xml / network.xml (opérateurs)…')
  const byId = new Map<string, { agency_id?: string; agency_name: string; agency_timezone?: string }>()
  for (const a of [...parseOperatorsFile(resourcePath), ...parseNetworkFile(networkPath)]) {
    if (a.agency_id && !byId.has(a.agency_id)) byId.set(a.agency_id, a)
  }
  let agencies = [...byId.values()]
  if (agencies.length === 0) {
    agencies = [{ agency_id: 'TCL', agency_name: 'TCL', agency_timezone: 'Europe/Paris' }]
  }
  await prisma.agency.createMany({
    data: agencies.map((a, i) => ({
      agencyId: a.agency_id || String(i),
      name: a.agency_name,
      url: null,
      timezone: a.agency_timezone || null,
      lang: null,
      phone: null,
      email: null,
    })),
  })
  stats.agencies = agencies.length
  await yieldEventLoop()

  const lineFiles = listLineFiles(extractDir)
  await logAwait(log, `Import incrémental de ${lineFiles.length} fichiers ligne…`)
  setDownloadProgress({ phase: 'importing', percent: 15 })

  const routeSeen = new Set<string>()
  const calendarSeen = new Set<string>()
  let skipped = 0
  let i = 0

  for (const file of lineFiles) {
    i++
    try {
      const parsed = parseLineFile(file)

      const newRoutes = parsed.routes.filter((r) => {
        if (routeSeen.has(r.route_id)) return false
        routeSeen.add(r.route_id)
        return true
      })
      if (newRoutes.length > 0) {
        await prisma.route.createMany({
          data: newRoutes.map((r) => ({
            routeId: r.route_id,
            agencyId: r.agency_id || null,
            shortName: r.route_short_name || null,
            longName: r.route_long_name || null,
            desc: r.route_desc || null,
            type: parseInt(r.route_type, 10),
            url: r.route_url || null,
            color: r.route_color || null,
            textColor: r.route_text_color || null,
            sortOrder: r.route_sort_order ? parseInt(r.route_sort_order, 10) : null,
            extras: parsed.routeExtras[r.route_id]
              ? JSON.stringify(parsed.routeExtras[r.route_id])
              : null,
          })),
        })
        stats.routes += newRoutes.length
      }

      const newCals = parsed.calendars.filter((c) => {
        if (calendarSeen.has(c.service_id)) return false
        calendarSeen.add(c.service_id)
        return true
      })
      if (newCals.length > 0) {
        await prisma.calendar.createMany({
          data: newCals.map((c) => ({
            serviceId: c.service_id,
            monday: c.monday === '1',
            tuesday: c.tuesday === '1',
            wednesday: c.wednesday === '1',
            thursday: c.thursday === '1',
            friday: c.friday === '1',
            saturday: c.saturday === '1',
            sunday: c.sunday === '1',
            startDate: c.start_date,
            endDate: c.end_date,
          })),
        })
        stats.calendars += newCals.length
      }

      if (parsed.trips.length > 0) {
        await batchInsert(parsed.trips, batchSize, (chunk) =>
          prisma.trip.createMany({
            data: chunk.map((t) => ({
              tripId: t.trip_id,
              routeId: t.route_id,
              serviceId: t.service_id,
              headsign: t.trip_headsign || null,
              shortName: t.trip_short_name || null,
              directionId: t.direction_id ? parseInt(t.direction_id, 10) : null,
              blockId: t.block_id || null,
              shapeId: t.shape_id || null,
              wheelchairAccessible: t.wheelchair_accessible
                ? parseInt(t.wheelchair_accessible, 10)
                : null,
              bikesAllowed: t.bikes_allowed ? parseInt(t.bikes_allowed, 10) : null,
            })),
          }),
        )
        stats.trips += parsed.trips.length
      }

      if (parsed.stopTimes.length > 0) {
        await batchInsert(parsed.stopTimes, batchSize, (chunk) =>
          prisma.stopTime.createMany({
            data: chunk.map((st) => ({
              tripId: st.trip_id,
              arrivalTime: st.arrival_time,
              departureTime: st.departure_time,
              stopId: st.stop_id,
              stopSequence: parseInt(st.stop_sequence, 10),
              headsign: st.stop_headsign || null,
              pickupType: st.pickup_type ? parseInt(st.pickup_type, 10) : null,
              dropOffType: st.drop_off_type ? parseInt(st.drop_off_type, 10) : null,
              shapeDistTraveled: st.shape_dist_traveled
                ? parseFloat(st.shape_dist_traveled)
                : null,
              timepoint: st.timepoint ? parseInt(st.timepoint, 10) : null,
            })),
          }),
        )
        stats.stopTimes += parsed.stopTimes.length
      }
    } catch (err) {
      skipped++
      await logAwait(
        log,
        `  skip ${path.basename(file)} : ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // Libère le CPU pour /health et l’UI
    await yieldEventLoop()

    if (i % 25 === 0 || i === lineFiles.length) {
      const pct = 15 + Math.round((i / Math.max(lineFiles.length, 1)) * 80)
      setDownloadProgress({ phase: 'importing', percent: Math.min(pct, 95) })
      await logAwait(
        log,
        `  lignes ${i}/${lineFiles.length} — ${stats.routes} routes, ${stats.trips} trips, ${stats.stopTimes} stop_times`,
      )
    }
  }

  if (skipped) await logAwait(log, `  ${skipped} fichier(s) ligne ignoré(s)`)
  setDownloadProgress({ phase: 'importing', percent: 100 })
  return stats
}
