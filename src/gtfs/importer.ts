import { prisma } from '../db.js'
import { config } from '../config.js'
import type { GtfsFiles, ImportStats } from './types.js'

type LogFn = (msg: string) => void

export async function importGtfsToDb(
  gtfs: GtfsFiles,
  log: LogFn = console.log,
): Promise<ImportStats> {
  const stats: ImportStats = {
    agencies: 0,
    stops: 0,
    routes: 0,
    trips: 0,
    stopTimes: 0,
    calendars: 0,
    calendarDates: 0,
    shapes: 0,
  }

  const batchSize = config.IMPORT_BATCH_SIZE

  log('Nettoyage des données GTFS existantes...')
  await prisma.$transaction([
    prisma.stopTime.deleteMany(),
    prisma.shape.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.calendarDate.deleteMany(),
    prisma.calendar.deleteMany(),
    prisma.route.deleteMany(),
    prisma.stop.deleteMany(),
    prisma.agency.deleteMany(),
  ])

  const agencies = gtfs['agency.txt'] ?? []
  if (agencies.length > 0) {
    log(`Import de ${agencies.length} agences...`)
    await prisma.agency.createMany({
      data: agencies.map((a, i) => ({
        agencyId: a.agency_id || String(i),
        name: a.agency_name,
        url: a.agency_url || null,
        timezone: a.agency_timezone || null,
        lang: a.agency_lang || null,
        phone: a.agency_phone || null,
        email: a.agency_email || null,
      })),
    })
    stats.agencies = agencies.length
  }

  const stops = gtfs['stops.txt'] ?? []
  if (stops.length > 0) {
    log(`Import de ${stops.length} arrêts...`)
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
        })),
      }),
    )
    stats.stops = stops.length
  }

  const routes = gtfs['routes.txt'] ?? []
  if (routes.length > 0) {
    log(`Import de ${routes.length} lignes...`)
    await batchInsert(routes, batchSize, (chunk) =>
      prisma.route.createMany({
        data: chunk.map((r) => ({
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
        })),
      }),
    )
    stats.routes = routes.length
  }

  const calendars = gtfs['calendar.txt'] ?? []
  if (calendars.length > 0) {
    log(`Import de ${calendars.length} calendriers...`)
    await batchInsert(calendars, batchSize, (chunk) =>
      prisma.calendar.createMany({
        data: chunk.map((c) => ({
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
      }),
    )
    stats.calendars = calendars.length
  }

  const calendarDates = gtfs['calendar_dates.txt'] ?? []
  if (calendarDates.length > 0) {
    log(`Import de ${calendarDates.length} exceptions calendrier...`)
    await batchInsert(calendarDates, batchSize, (chunk) =>
      prisma.calendarDate.createMany({
        data: chunk.map((cd) => ({
          serviceId: cd.service_id,
          date: cd.date,
          exceptionType: parseInt(cd.exception_type, 10),
        })),
      }),
    )
    stats.calendarDates = calendarDates.length
  }

  const trips = gtfs['trips.txt'] ?? []
  if (trips.length > 0) {
    log(`Import de ${trips.length} courses...`)
    await batchInsert(trips, batchSize, (chunk) =>
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
          wheelchairAccessible: t.wheelchair_accessible ? parseInt(t.wheelchair_accessible, 10) : null,
          bikesAllowed: t.bikes_allowed ? parseInt(t.bikes_allowed, 10) : null,
        })),
      }),
    )
    stats.trips = trips.length
  }

  const stopTimes = gtfs['stop_times.txt'] ?? []
  if (stopTimes.length > 0) {
    log(`Import de ${stopTimes.length} horaires (peut prendre quelques minutes)...`)
    let imported = 0
    await batchInsert(stopTimes, batchSize, async (chunk) => {
      await prisma.stopTime.createMany({
        data: chunk.map((st) => ({
          tripId: st.trip_id,
          arrivalTime: st.arrival_time,
          departureTime: st.departure_time,
          stopId: st.stop_id,
          stopSequence: parseInt(st.stop_sequence, 10),
          headsign: st.stop_headsign || null,
          pickupType: st.pickup_type ? parseInt(st.pickup_type, 10) : null,
          dropOffType: st.drop_off_type ? parseInt(st.drop_off_type, 10) : null,
          shapeDistTraveled: st.shape_dist_traveled ? parseFloat(st.shape_dist_traveled) : null,
          timepoint: st.timepoint ? parseInt(st.timepoint, 10) : null,
        })),
      })
      imported += chunk.length
      if (imported % 50_000 === 0) log(`  ${imported} / ${stopTimes.length} horaires...`)
    })
    stats.stopTimes = stopTimes.length
  }

  const shapes = gtfs['shapes.txt'] ?? []
  if (shapes.length > 0) {
    log(`Import de ${shapes.length} points de tracé...`)
    await batchInsert(shapes, batchSize, (chunk) =>
      prisma.shape.createMany({
        data: chunk.map((s) => ({
          shapeId: s.shape_id,
          ptLat: parseFloat(s.shape_pt_lat),
          ptLon: parseFloat(s.shape_pt_lon),
          ptSequence: parseInt(s.shape_pt_sequence, 10),
          distTraveled: s.shape_dist_traveled ? parseFloat(s.shape_dist_traveled) : null,
        })),
      }),
    )
    stats.shapes = shapes.length
  }

  return stats
}

async function batchInsert<T>(
  items: T[],
  batchSize: number,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await fn(items.slice(i, i + batchSize))
  }
}
