import type { FastifyBaseLogger } from 'fastify'
import { config } from '../config.js'

export type SiriVehicleActivity = {
  ValidUntilTime?: string
  RecordedAtTime?: string
  VehicleMonitoringRef?: { value?: string }
  MonitoredVehicleJourney?: {
    LineRef?: { value?: string }
    DirectionRef?: { value?: string }
    FramedVehicleJourneyRef?: {
      DataFrameRef?: { value?: string }
      DatedVehicleJourneyRef?: string
    }
    DestinationRef?: { value?: string }
    DataSource?: string
    VehicleLocation?: { Longitude?: number; Latitude?: number }
    Bearing?: number
    Delay?: string
    VehicleStatus?: string
    VehicleRef?: { value?: string }
    MonitoredCall?: Record<string, unknown>
    PreviousCalls?: unknown
    OnwardCalls?: unknown
  }
}

export type RealtimeVehicle = {
  id: string
  vehicle_ref: string
  vehicle_mode: string | null
  line_code: string | null
  line_ref: string | null
  direction: string | null
  journey_ref: string | null
  destination_ref: string | null
  destination_stop_id: string | null
  data_source: string | null
  location: { lat: number; lon: number } | null
  bearing: number | null
  delay: string | null
  delay_seconds: number | null
  status: string | null
  recorded_at: string | null
  valid_until: string | null
  monitored_call: {
    stop_ref: string | null
    stop_id: string | null
    order: number | null
    aimed_arrival_time: string | null
    aimed_departure_time: string | null
    arrival_status: string | null
    departure_status: string | null
  } | null
}

export type VehicleMonitoringCacheState = {
  vehicles: RealtimeVehicle[]
  rawCount: number
  fetchedAt: string | null
  responseTimestamp: string | null
  ageMs: number | null
  lastError: string | null
  lastFetchOk: boolean
  pollIntervalMs: number
  sourceUrl: string
  enabled: boolean
}

let cache: RealtimeVehicle[] = []
let fetchedAt: Date | null = null
let responseTimestamp: string | null = null
let rawCount = 0
let lastError: string | null = null
let lastFetchOk = false
let timer: ReturnType<typeof setInterval> | null = null
let inflight: Promise<void> | null = null

function siriValue(ref: { value?: string } | string | undefined | null): string | null {
  if (!ref) return null
  if (typeof ref === 'string') return ref || null
  return ref.value ?? null
}

/** ActIV:Line::C13:SYTRAL → C13 ; ActIV:Vehicle:Bus:2720:LOC → 2720 */
export function parseActIvToken(ref: string | null | undefined, kind: 'line' | 'vehicle' | 'stop'): string | null {
  if (!ref) return null
  const parts = ref.split(':')
  if (kind === 'line') {
    // ActIV : Line : : CODE : SYTRAL
    if (parts.length >= 4 && parts[1] === 'Line') return parts[3] || null
  }
  if (kind === 'vehicle') {
    // ActIV : Vehicle : Bus : 2720 : LOC
    if (parts.length >= 4 && parts[1] === 'Vehicle') return parts[3] || null
  }
  if (kind === 'stop') {
    // ActIV:StopArea:SP:306:SYTRAL
    if (parts.length >= 4) return parts[3] || null
  }
  return null
}

export function parseVehicleMode(ref: string | null | undefined): string | null {
  if (!ref) return null
  const parts = ref.split(':')
  if (parts.length >= 3 && parts[1] === 'Vehicle') return parts[2] || null
  return null
}

/** ISO-8601 duration PT1M57S → seconds */
export function parseIsoDurationSeconds(d: string | null | undefined): number | null {
  if (!d) return null
  const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(d.trim())
  if (!m) return null
  const h = Number(m[1] ?? 0)
  const min = Number(m[2] ?? 0)
  const s = Number(m[3] ?? 0)
  return Math.round(h * 3600 + min * 60 + s)
}

export function normalizeVehicleActivity(va: SiriVehicleActivity): RealtimeVehicle | null {
  const mvj = va.MonitoredVehicleJourney
  if (!mvj) return null

  const vehicleRef = siriValue(va.VehicleMonitoringRef) ?? siriValue(mvj.VehicleRef)
  if (!vehicleRef) return null

  const lineRef = siriValue(mvj.LineRef)
  const destinationRef = siriValue(mvj.DestinationRef)
  const call = mvj.MonitoredCall as
    | {
        StopPointRef?: { value?: string }
        Order?: number
        AimedArrivalTime?: string
        AimedDepartureTime?: string
        ArrivalStatus?: string
        DepartureStatus?: string
      }
    | undefined

  const stopRef = siriValue(call?.StopPointRef)
  const lat = mvj.VehicleLocation?.Latitude
  const lon = mvj.VehicleLocation?.Longitude
  const id = parseActIvToken(vehicleRef, 'vehicle') ?? vehicleRef

  return {
    id,
    vehicle_ref: vehicleRef,
    vehicle_mode: parseVehicleMode(vehicleRef),
    line_code: parseActIvToken(lineRef, 'line'),
    line_ref: lineRef,
    direction: siriValue(mvj.DirectionRef),
    journey_ref: mvj.FramedVehicleJourneyRef?.DatedVehicleJourneyRef ?? null,
    destination_ref: destinationRef,
    destination_stop_id: parseActIvToken(destinationRef, 'stop'),
    data_source: mvj.DataSource ?? null,
    location:
      lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)
        ? { lat, lon }
        : null,
    bearing: mvj.Bearing ?? null,
    delay: mvj.Delay ?? null,
    delay_seconds: parseIsoDurationSeconds(mvj.Delay),
    status: mvj.VehicleStatus ?? null,
    recorded_at: va.RecordedAtTime ?? null,
    valid_until: va.ValidUntilTime ?? null,
    monitored_call: call
      ? {
          stop_ref: stopRef,
          stop_id: parseActIvToken(stopRef, 'stop'),
          order: call.Order ?? null,
          aimed_arrival_time: call.AimedArrivalTime ?? null,
          aimed_departure_time: call.AimedDepartureTime ?? null,
          arrival_status: call.ArrivalStatus ?? null,
          departure_status: call.DepartureStatus ?? null,
        }
      : null,
  }
}

function extractActivities(payload: unknown): SiriVehicleActivity[] {
  const root = payload as {
    Siri?: {
      ServiceDelivery?: {
        ResponseTimestamp?: string
        VehicleMonitoringDelivery?: Array<{ VehicleActivity?: SiriVehicleActivity[] }>
      }
    }
  }
  responseTimestamp = root.Siri?.ServiceDelivery?.ResponseTimestamp ?? null
  const deliveries = root.Siri?.ServiceDelivery?.VehicleMonitoringDelivery ?? []
  return deliveries.flatMap((d) => d.VehicleActivity ?? [])
}

export async function refreshVehicleMonitoring(log?: FastifyBaseLogger): Promise<void> {
  if (inflight) return inflight

  inflight = (async () => {
    const auth = Buffer.from(`${config.SIRI_VM_USER}:${config.SIRI_VM_PASSWORD}`).toString('base64')
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 20_000)

    try {
      const res = await fetch(config.SIRI_VM_URL, {
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${auth}`,
          'User-Agent': 'api-maasterplan/0.1',
        },
        signal: ctrl.signal,
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`)
      }

      const json = await res.json()
      const activities = extractActivities(json)
      const vehicles = activities
        .map(normalizeVehicleActivity)
        .filter((v): v is RealtimeVehicle => Boolean(v))

      cache = vehicles
      rawCount = activities.length
      fetchedAt = new Date()
      lastError = null
      lastFetchOk = true
      log?.info(`[SIRI] VehicleMonitoring : ${vehicles.length} véhicule(s)`)
    } catch (err) {
      lastFetchOk = false
      lastError = err instanceof Error ? err.message : String(err)
      log?.warn(`[SIRI] Refresh échoué : ${lastError}`)
    } finally {
      clearTimeout(timeout)
      inflight = null
    }
  })()

  return inflight
}

export function getVehicleMonitoringCache(): VehicleMonitoringCacheState {
  const ageMs = fetchedAt ? Date.now() - fetchedAt.getTime() : null
  return {
    vehicles: cache,
    rawCount,
    fetchedAt: fetchedAt?.toISOString() ?? null,
    responseTimestamp,
    ageMs,
    lastError,
    lastFetchOk,
    pollIntervalMs: config.SIRI_VM_POLL_MS,
    sourceUrl: config.SIRI_VM_URL,
    enabled: config.SIRI_VM_ENABLED,
  }
}

export function getRealtimeVehicles(): RealtimeVehicle[] {
  return cache
}

export function startVehicleMonitoringPoller(log?: FastifyBaseLogger): void {
  if (!config.SIRI_VM_ENABLED) {
    log?.info('[SIRI] VehicleMonitoring désactivé (SIRI_VM_ENABLED=false)')
    return
  }

  if (timer) return

  const tick = () => {
    refreshVehicleMonitoring(log).catch(() => {
      /* already logged */
    })
  }

  tick()
  timer = setInterval(tick, config.SIRI_VM_POLL_MS)
  // Ne pas bloquer l’arrêt du process Node
  if (typeof timer === 'object' && 'unref' in timer) timer.unref()

  log?.info(`[SIRI] Poll VehicleMonitoring toutes les ${config.SIRI_VM_POLL_MS}ms`)
}

export function stopVehicleMonitoringPoller(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
