/** Mapping GTFS route_type → mode physique (style Navitia) */

export interface PhysicalMode {
  id: string
  name: string
  gtfsTypes: number[]
}

export const PHYSICAL_MODES: PhysicalMode[] = [
  { id: 'Tramway', name: 'Tramway', gtfsTypes: [0] },
  { id: 'Metro', name: 'Métro', gtfsTypes: [1] },
  { id: 'Train', name: 'Train', gtfsTypes: [2] },
  { id: 'Bus', name: 'Bus', gtfsTypes: [3] },
  /** Cars région (NeTEx coach) — type GTFS étendu 200, distinct du bus */
  { id: 'Coach', name: 'Cars région', gtfsTypes: [200] },
  /** Sur le RFU Sytral, route_type 4 = Navigône (pas Ferry) */
  { id: 'Navigone', name: 'Navigône', gtfsTypes: [4] },
  { id: 'CableCar', name: 'Téléphérique', gtfsTypes: [5, 6] },
  { id: 'Funicular', name: 'Funiculaire', gtfsTypes: [7] },
  /** Sur le RFU Sytral, route_type 11 = Chrono */
  { id: 'Chrono', name: 'Chrono', gtfsTypes: [11] },
  { id: 'Monorail', name: 'Monorail', gtfsTypes: [12] },
]

const TYPE_TO_MODE = new Map<number, PhysicalMode>()
for (const mode of PHYSICAL_MODES) {
  for (const t of mode.gtfsTypes) TYPE_TO_MODE.set(t, mode)
}

export function modeFromGtfsType(type: number): PhysicalMode {
  return TYPE_TO_MODE.get(type) ?? { id: `Other_${type}`, name: `Autre (${type})`, gtfsTypes: [type] }
}

export function gtfsTypesForModeId(modeId: string): number[] | null {
  const mode = PHYSICAL_MODES.find(
    (m) => m.id.toLowerCase() === modeId.toLowerCase() || m.name.toLowerCase() === modeId.toLowerCase(),
  )
  return mode?.gtfsTypes ?? null
}

export function hexColor(color: string | null | undefined): string | null {
  if (!color) return null
  return color.startsWith('#') ? color : `#${color}`
}
