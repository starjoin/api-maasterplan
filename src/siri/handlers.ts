import {
  getRealtimeVehicles,
  getVehicleMonitoringCache,
  type RealtimeVehicle,
} from './vehicle-monitoring.js'

type Query = Record<string, string | undefined>

function parseLimit(q: Query, def = 200, max = 2000) {
  return Math.min(parseInt(q.limit ?? String(def), 10) || def, max)
}

function parseOffset(q: Query) {
  return Math.max(parseInt(q.offset ?? '0', 10) || 0, 0)
}

function filterVehicles(q: Query): RealtimeVehicle[] {
  let items = getRealtimeVehicles()

  const line = (q.line ?? q.line_code ?? q.line_id ?? q.ligne ?? '').trim()
  if (line) {
    const needle = line.replace(/^line:/i, '').toUpperCase()
    items = items.filter(
      (v) =>
        (v.line_code ?? '').toUpperCase() === needle ||
        (v.line_ref ?? '').toUpperCase().includes(`:${needle}:`),
    )
  }

  const vehicle = (q.vehicle_id ?? q.vehicle ?? q.id ?? '').trim()
  if (vehicle) {
    const needle = vehicle.toUpperCase()
    items = items.filter(
      (v) =>
        v.id.toUpperCase() === needle ||
        v.vehicle_ref.toUpperCase() === needle ||
        v.vehicle_ref.toUpperCase().includes(`:${needle}:`),
    )
  }

  const direction = (q.direction ?? q.direction_id ?? '').trim().toLowerCase()
  if (direction) {
    items = items.filter((v) => (v.direction ?? '').toLowerCase() === direction)
  }

  const mode = (q.vehicle_mode ?? q.mode ?? '').trim().toLowerCase()
  if (mode) {
    items = items.filter((v) => (v.vehicle_mode ?? '').toLowerCase() === mode)
  }

  const bbox = (q.bbox ?? '').trim()
  if (bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number)
    if ([minLon, minLat, maxLon, maxLat].every((n) => Number.isFinite(n))) {
      items = items.filter((v) => {
        if (!v.location) return false
        return (
          v.location.lon >= minLon &&
          v.location.lon <= maxLon &&
          v.location.lat >= minLat &&
          v.location.lat <= maxLat
        )
      })
    }
  }

  const term = (q.q ?? '').trim().toLowerCase()
  if (term) {
    items = items.filter(
      (v) =>
        v.id.toLowerCase().includes(term) ||
        (v.line_code ?? '').toLowerCase().includes(term) ||
        (v.vehicle_ref ?? '').toLowerCase().includes(term) ||
        (v.journey_ref ?? '').toLowerCase().includes(term),
    )
  }

  return items
}

function metaEnvelope() {
  const c = getVehicleMonitoringCache()
  return {
    realtime: {
      fetched_at: c.fetchedAt,
      response_timestamp: c.responseTimestamp,
      age_ms: c.ageMs,
      poll_interval_ms: c.pollIntervalMs,
      source: c.sourceUrl,
      enabled: c.enabled,
      last_error: c.lastError,
      ok: c.lastFetchOk,
      vehicle_count: c.vehicles.length,
    },
  }
}

/** Liste des positions véhicules (cache SIRI-Lite VM). */
export function listVehicleMonitoring(q: Query) {
  const limit = parseLimit(q)
  const offset = parseOffset(q)
  const all = filterVehicles(q)
  const page = all.slice(offset, offset + limit)

  return {
    ...metaEnvelope(),
    vehicle_monitoring: page,
    pagination: {
      total: all.length,
      limit,
      offset,
      hasMore: offset + limit < all.length,
    },
  }
}

export function getVehicleMonitoring(id: string) {
  const needle = decodeURIComponent(id).trim().toUpperCase()
  const vehicle = getRealtimeVehicles().find(
    (v) =>
      v.id.toUpperCase() === needle ||
      v.vehicle_ref.toUpperCase() === needle ||
      v.vehicle_ref.toUpperCase().endsWith(`:${needle}:LOC`),
  )

  if (!vehicle) return null

  return {
    ...metaEnvelope(),
    vehicle_monitoring: vehicle,
  }
}

/** FeatureCollection GeoJSON des positions. */
export function vehicleMonitoringGeojson(q: Query) {
  const items = filterVehicles(q).filter((v) => v.location)

  return {
    ...metaEnvelope(),
    type: 'FeatureCollection' as const,
    features: items.map((v) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [v.location!.lon, v.location!.lat],
      },
      properties: {
        id: v.id,
        vehicle_ref: v.vehicle_ref,
        vehicle_mode: v.vehicle_mode,
        line_code: v.line_code,
        direction: v.direction,
        bearing: v.bearing,
        delay_seconds: v.delay_seconds,
        status: v.status,
        recorded_at: v.recorded_at,
      },
    })),
  }
}

export function vehicleMonitoringStatus() {
  return metaEnvelope()
}
