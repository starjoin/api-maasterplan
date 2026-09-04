/** Modes commerciaux Sytral / RFU (sous-modes via route_desc + code ligne). */

export type CommercialModeKey =
  | 'metro'
  | 'tramway'
  | 'trambus'
  | 'chrono'
  | 'junior_direct'
  | 'bus'
  | 'navette'
  | 'bus_relais_tram'
  | 'bus_relais_metro'
  | 'bus_relais_funic'
  | 'tad'
  | 'navigone'
  | 'funiculaire'
  | 'train'
  | 'car_region'
  | 'cable_car'
  | 'other'

export type RouteLike = {
  shortName: string | null
  longName: string | null
  type: number
  desc?: string | null
}

export type CommercialModeInfo = {
  key: CommercialModeKey
  id: string
  name: string
  /** Types GTFS typiques (pour filtrer l’affichage des chips) */
  physicalTypes: number[]
}

export const COMMERCIAL_MODES: CommercialModeInfo[] = [
  { key: 'metro', id: 'commercial_mode:Métro', name: 'Métro', physicalTypes: [1] },
  { key: 'tramway', id: 'commercial_mode:Tramway', name: 'Tramway', physicalTypes: [0] },
  { key: 'trambus', id: 'commercial_mode:Trambus', name: 'Trambus', physicalTypes: [3] },
  { key: 'chrono', id: 'commercial_mode:Chrono', name: 'Chrono', physicalTypes: [11] },
  {
    key: 'junior_direct',
    id: 'commercial_mode:JuniorDirect',
    name: 'Junior Direct',
    physicalTypes: [3],
  },
  { key: 'bus', id: 'commercial_mode:Bus', name: 'Bus', physicalTypes: [3] },
  { key: 'navette', id: 'commercial_mode:Navette', name: 'Navette (EVE)', physicalTypes: [0, 3] },
  {
    key: 'bus_relais_tram',
    id: 'commercial_mode:BusRelaisTram',
    name: 'Bus relais tramway (PRT)',
    physicalTypes: [3],
  },
  {
    key: 'bus_relais_metro',
    id: 'commercial_mode:BusRelaisMétro',
    name: 'Bus relais métro (PRM)',
    physicalTypes: [3],
  },
  {
    key: 'bus_relais_funic',
    id: 'commercial_mode:BusRelaisFuniculaire',
    name: 'Bus relais funiculaire (PRF)',
    physicalTypes: [3],
  },
  { key: 'tad', id: 'commercial_mode:TAD', name: 'TAD', physicalTypes: [3] },
  { key: 'navigone', id: 'commercial_mode:Navigône', name: 'Navigône', physicalTypes: [4] },
  { key: 'funiculaire', id: 'commercial_mode:Funiculaire', name: 'Funiculaire', physicalTypes: [7] },
  { key: 'train', id: 'commercial_mode:Train', name: 'Train', physicalTypes: [2] },
  {
    key: 'car_region',
    id: 'commercial_mode:CarsRégion',
    name: 'Cars région',
    physicalTypes: [200],
  },
  {
    key: 'cable_car',
    id: 'commercial_mode:CableCar',
    name: 'Téléphérique',
    physicalTypes: [5, 6],
  },
  { key: 'other', id: 'commercial_mode:Other', name: 'Autre', physicalTypes: [] },
]

const BY_KEY = new Map(COMMERCIAL_MODES.map((m) => [m.key, m]))

function mode(key: CommercialModeKey): { id: string; name: string; key: CommercialModeKey } {
  const m = BY_KEY.get(key)!
  return { id: m.id, name: m.name, key: m.key }
}

export function commercialModeByKey(key: string): CommercialModeInfo | undefined {
  return BY_KEY.get(key as CommercialModeKey)
}

/**
 * Classification RFU Sytral :
 * - route_desc : REG (bus), SCO (scolaire), EVE (navette), PRT/PRM/PRF (relais), TAD
 * - JD* → Junior Direct (toujours)
 * - type 11 → Chrono
 * - type 4 → Navigône
 */
export function resolveCommercialMode(route: RouteLike): { id: string; name: string; key: CommercialModeKey } {
  const code = (route.shortName ?? '').toUpperCase().trim()
  const desc = (route.desc ?? '').toUpperCase().trim()
  const name = (route.longName ?? '').toLowerCase()

  // Junior Direct : code JD* (souvent SCO, parfois desc vide)
  if (/^JD/i.test(code)) {
    return mode('junior_direct')
  }

  // Codes route_desc GTFS / NeTEx
  if (desc === 'EVE') return mode('navette')
  if (desc === 'PRT') return mode('bus_relais_tram')
  if (desc === 'PRM') return mode('bus_relais_metro')
  if (desc === 'PRF') return mode('bus_relais_funic')
  if (desc === 'TAD') return mode('tad')
  if (desc === 'TRAIN') return mode('train')
  if (desc === 'CAR') return mode('car_region')
  // SCO = scolaire ; sur ce réseau ce sont des JD (tag parfois absent)
  if (desc === 'SCO') return mode('junior_direct')

  if (route.type === 200) return mode('car_region')

  if (route.type === 2 || name.includes('ter ') || /\bter\b/.test(name)) {
    return mode('train')
  }

  if (route.type === 1 || /^[ABCD]$/.test(code)) {
    return mode('metro')
  }

  if (/^TB\d+/i.test(code) || name.includes('trambus')) {
    return mode('trambus')
  }

  // Chrono = route_type 11 (ne pas matcher les codes train C9 etc. déjà type 2)
  if (route.type === 11 || (/^C\d+/i.test(code) && route.type !== 2 && route.type !== 200)) {
    return mode('chrono')
  }

  if (route.type === 0) {
    return mode('tramway')
  }

  if (route.type === 7) {
    return mode('funiculaire')
  }

  if (route.type === 4) {
    return mode('navigone')
  }

  if (route.type === 5 || route.type === 6) {
    return mode('cable_car')
  }

  // Bus TCL classique uniquement (pas les cars région type 200)
  if (route.type === 3 || desc === 'REG') {
    return mode('bus')
  }

  return mode('other')
}

/** Alias Navitia (compat clients) */
export function resolveCommercialModeNavitia(route: RouteLike): { id: string; name: string } {
  const m = resolveCommercialMode(route)
  if (m.key === 'junior_direct') {
    return { id: 'commercial_mode:BusJD', name: m.name }
  }
  return { id: m.id, name: m.name }
}

export function matchesCommercialKey(route: RouteLike, key: string): boolean {
  let normalized = key.replace(/^commercial_mode:/i, '')
  if (normalized === 'BusJD' || normalized === 'junior' || normalized === 'jd' || normalized === 'JuniorDirect') {
    normalized = 'junior_direct'
  }
  if (normalized === 'Proximo' || normalized === 'proximo') {
    normalized = 'bus'
  }
  if (normalized === 'Ferry' || normalized === 'ferry') {
    normalized = 'navigone'
  }
  if (normalized === 'Trolleybus' || normalized === 'trolleybus') {
    normalized = 'chrono'
  }

  const resolved = resolveCommercialMode(route)
  if (normalized === resolved.key) return true
  if (normalized.toLowerCase() === resolved.name.toLowerCase()) return true

  // Filtre SCO : lignes marquées SCO dans route_desc
  if (normalized === 'scolaire' || normalized === 'SCO') {
    return (route.desc ?? '').toUpperCase() === 'SCO'
  }

  return false
}

export function pictoUrl(commercialCode: string | null | undefined): string | null {
  if (!commercialCode) return null
  return `https://www.maasterplan.app/api/picto?line=${encodeURIComponent(commercialCode)}`
}
