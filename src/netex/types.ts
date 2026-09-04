import type { GtfsFiles, ImportStats } from '../gtfs/types.js'

export type NetexExtras = Record<string, unknown>

export type NetexMapped = GtfsFiles & {
  routeExtras?: Record<string, NetexExtras>
  stopExtras?: Record<string, NetexExtras>
  fareZoneExtras?: Record<string, NetexExtras>
}

export const EMPTY_STATS: ImportStats = {
  agencies: 0,
  stops: 0,
  routes: 0,
  trips: 0,
  stopTimes: 0,
  calendars: 0,
  calendarDates: 0,
  shapes: 0,
  fareZones: 0,
  fareAttributes: 0,
  fareRules: 0,
  transfers: 0,
  pois: 0,
}

export function transportModeToGtfsType(mode: string | undefined, submode?: string): number {
  const m = (mode ?? '').toLowerCase()
  const s = (submode ?? '').toLowerCase()
  if (m === 'metro' || m === 'underground') return 1
  if (m === 'tram' || m === 'tramway') return 0
  if (m === 'rail' || m === 'train') return 2
  if (m === 'water' || m === 'ferry') return 4
  if (m === 'funicular') return 7
  if (m === 'trolleybus' || m === 'trolleybus' || m === 'trolleyBus' || s.includes('trolley')) return 11
  // Cars région / cars longue distance — type GTFS étendu 200 (Coach)
  if (m === 'coach') return 200
  if (m === 'bus') return 3
  return 3
}

/** route_desc commercial pour faciliter les filtres Explorer */
export function transportModeToRouteDesc(mode: string | undefined, submode?: string): string | undefined {
  const m = (mode ?? '').toLowerCase()
  const s = (submode ?? '').toLowerCase()
  if (m === 'rail' || m === 'train') return 'TRAIN'
  if (m === 'coach') return 'CAR'
  if (s.includes('school') || s.includes('dedicatedLane')) return 'SCO'
  if (m === 'bus' || m === 'trolleybus' || m === 'trolleyBus') return 'REG'
  if (m === 'tram' || m === 'tramway') return 'TRAM'
  if (m === 'metro' || m === 'underground') return 'METRO'
  return undefined
}

export function directionToGtfs(directionType: string | undefined): string {
  const d = (directionType ?? '').toLowerCase()
  if (d === 'inbound' || d === 'return') return '1'
  if (d === 'outbound' || d === 'outward') return '0'
  return '0'
}
