import type { ResponseSchema } from './types.js'
import * as sae from '../sae/handlers.js'

export type PresetId =
  | 'coverage'
  | 'physical_modes'
  | 'lines_list'
  | 'line_detail'
  | 'line_thermometer'
  | 'line_geojson'
  | 'line_schedules'
  | 'stop_points_list'
  | 'stop_areas_list'
  | 'stop_point_detail'
  | 'stop_schedules'
  | 'places'
  | 'places_nearby'
  | 'poi_list'
  | 'poi_detail'
  | 'networks'
  | 'vehicle_journeys_list'
  | 'vehicle_journey_detail'
  | 'sae_catalog'

export interface PresetMeta {
  id: PresetId
  label: string
  description: string
  /** Clés de premier niveau (ou sous `lines` / enveloppe) projetables depuis le Designer */
  responseKeys: string[]
  /** Entité indicative pour l’UI */
  entity: string
  multiple: boolean
  pathHint: string
}

type Q = Record<string, string | undefined>

export const PRESET_CATALOG: PresetMeta[] = [
  {
    id: 'coverage',
    label: 'Couverture dataset',
    description: 'Métadonnées RFU + volumes importés + liens de découverte',
    responseKeys: ['coverage', 'datasets', 'links'],
    entity: 'Route',
    multiple: false,
    pathHint: '/v1/coverage',
  },
  {
    id: 'physical_modes',
    label: 'Modes physiques',
    description: 'Bus, Tram, Métro… avec compteurs de lignes',
    responseKeys: ['physical_modes'],
    entity: 'Route',
    multiple: false,
    pathHint: '/v1/physical_modes',
  },
  {
    id: 'lines_list',
    label: 'Lignes (liste Navitia)',
    description: 'Liste paginée au format Navitia (modes, network, routes, geojson…)',
    responseKeys: ['lines', 'pagination'],
    entity: 'Route',
    multiple: true,
    pathHint: '/v1/lines',
  },
  {
    id: 'line_detail',
    label: 'Ligne (détail Navitia)',
    description: 'Objet ligne Navitia à la racine (code, routes, opening_time, geojson…)',
    responseKeys: [
      'id',
      'code',
      'name',
      'color',
      'text_color',
      'opening_time',
      'closing_time',
      'links',
      'codes',
      'properties',
      'commercial_mode',
      'physical_modes',
      'network',
      'routes',
      'geojson',
    ],
    entity: 'Route',
    multiple: false,
    pathHint: '/v1/lines/:id',
  },
  {
    id: 'line_thermometer',
    label: 'Thermomètre de ligne',
    description: 'Séquence d’arrêts par direction',
    responseKeys: ['line', 'directions'],
    entity: 'Stop',
    multiple: false,
    pathHint: '/v1/lines/:id/stop_points',
  },
  {
    id: 'line_geojson',
    label: 'Tracé GeoJSON',
    description: 'FeatureCollection des shapes de la ligne',
    responseKeys: ['type', 'features', 'line'],
    entity: 'Shape',
    multiple: false,
    pathHint: '/v1/lines/:id/geojson',
  },
  {
    id: 'line_schedules',
    label: 'Horaires de ligne',
    description: 'Passages / route_schedules',
    responseKeys: ['line', 'route_schedules'],
    entity: 'StopTime',
    multiple: false,
    pathHint: '/v1/lines/:id/route_schedules',
  },
  {
    id: 'stop_points_list',
    label: 'Liste d’arrêts',
    description: 'stop_points paginés avec recherche',
    responseKeys: ['stop_points', 'pagination'],
    entity: 'Stop',
    multiple: true,
    pathHint: '/v1/stop_points',
  },
  {
    id: 'stop_areas_list',
    label: 'Stations (stop_areas)',
    description: 'Arrêts location_type=1',
    responseKeys: ['stop_points', 'pagination'],
    entity: 'Stop',
    multiple: true,
    pathHint: '/v1/stop_areas',
  },
  {
    id: 'stop_point_detail',
    label: 'Détail arrêt',
    description: 'Arrêt + lignes desservantes',
    responseKeys: ['stop_point', 'lines'],
    entity: 'Stop',
    multiple: false,
    pathHint: '/v1/stop_points/:id',
  },
  {
    id: 'stop_schedules',
    label: 'Horaires d’arrêt',
    description: 'Départs / timetable à un arrêt',
    responseKeys: ['stop_point', 'stop_schedules'],
    entity: 'StopTime',
    multiple: false,
    pathHint: '/v1/stop_points/:id/schedules',
  },
  {
    id: 'places',
    label: 'Autocomplétion lieux',
    description: 'Recherche arrêts + lignes (?q=)',
    responseKeys: ['places', 'message'],
    entity: 'Stop',
    multiple: true,
    pathHint: '/v1/places',
  },
  {
    id: 'places_nearby',
    label: 'Lieux à proximité',
    description: 'Haversine autour de lat/lon',
    responseKeys: ['places_nearby', 'pagination', 'error'],
    entity: 'Stop',
    multiple: true,
    pathHint: '/v1/places_nearby',
  },
  {
    id: 'poi_list',
    label: 'POI (liste)',
    description: 'Stations / points d’intérêt',
    responseKeys: ['poi', 'pagination'],
    entity: 'Stop',
    multiple: true,
    pathHint: '/v1/poi',
  },
  {
    id: 'poi_detail',
    label: 'POI (détail)',
    description: 'Un POI par id',
    responseKeys: ['poi'],
    entity: 'Stop',
    multiple: false,
    pathHint: '/v1/poi/:id',
  },
  {
    id: 'networks',
    label: 'Réseaux / agences',
    description: 'Agences GTFS',
    responseKeys: ['networks'],
    entity: 'Agency',
    multiple: true,
    pathHint: '/v1/networks',
  },
  {
    id: 'vehicle_journeys_list',
    label: 'Courses (liste)',
    description: 'Trips / vehicle_journeys',
    responseKeys: ['vehicle_journeys', 'pagination'],
    entity: 'Trip',
    multiple: true,
    pathHint: '/v1/vehicle_journeys',
  },
  {
    id: 'vehicle_journey_detail',
    label: 'Course (détail)',
    description: 'Trip + stop_times',
    responseKeys: ['vehicle_journey'],
    entity: 'Trip',
    multiple: false,
    pathHint: '/v1/vehicle_journeys/:id',
  },
  {
    id: 'sae_catalog',
    label: 'Catalogue endpoints',
    description: 'Index JSON des routes SAE documentées',
    responseKeys: ['description', 'endpoints', 'aliases_fr'],
    entity: 'Route',
    multiple: false,
    pathHint: '/v1/endpoints',
  },
]

function asQuery(pathParams: Record<string, unknown>, queryParams: Record<string, unknown>): Q {
  const q: Q = {}
  for (const [k, v] of Object.entries(queryParams)) {
    if (v !== undefined && v !== null) q[k] = String(v)
  }
  // Les filtres Designer "path" sont déjà dans pathParams ; on expose aussi en query pour les presets
  for (const [k, v] of Object.entries(pathParams)) {
    if (v !== undefined && v !== null && q[k] === undefined) q[k] = String(v)
  }
  return q
}

function pickKeys(obj: unknown, keys: string[]): unknown {
  if (!keys.length || obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj
  if (typeof obj !== 'object') return obj

  const record = obj as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    if (k in record) out[k] = record[k]
  }

  // Projection fine des items dans `lines` si responseKeys contient des clés "line.*"
  const lineKeys = keys.filter((k) => k.startsWith('line.')).map((k) => k.slice(5))
  if (lineKeys.length && Array.isArray(out.lines)) {
    out.lines = (out.lines as Record<string, unknown>[]).map((item) => {
      const slim: Record<string, unknown> = {}
      for (const lk of lineKeys) {
        if (lk in item) slim[lk] = item[lk]
      }
      // Si aucune clé line.* n’a matché mais qu’on a demandé des clés racines de ligne via itemKeys
      return Object.keys(slim).length ? slim : item
    })
  }

  // Pour line_detail : si responseKeys sont des champs de l’objet ligne
  const knownLineKeys = new Set(PRESET_CATALOG.find((p) => p.id === 'line_detail')?.responseKeys ?? [])
  const onlyLineFields = keys.every((k) => knownLineKeys.has(k) || k.startsWith('line.'))
  if (onlyLineFields && !('lines' in record) && !('pagination' in record)) {
    return out
  }

  return out
}

/**
 * Applique la projection `responseKeys` du schéma Designer sur le résultat preset.
 * - Vide / absent → réponse complète
 * - Présent → ne garde que ces clés de premier niveau
 * - Préfixe `line.` → projette aussi chaque élément de `lines[]`
 */
export function projectPresetResult(result: unknown, schema: ResponseSchema): unknown {
  const keys = schema.responseKeys ?? []
  if (!keys.length) return result

  const topKeys = keys.filter((k) => !k.startsWith('line.'))
  const lineItemKeys = keys.filter((k) => k.startsWith('line.')).map((k) => k.slice(5))

  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const record = result as Record<string, unknown>
    const projected = pickKeys(record, topKeys.length ? topKeys : Object.keys(record)) as Record<
      string,
      unknown
    >

    if (lineItemKeys.length && Array.isArray(projected.lines)) {
      projected.lines = (projected.lines as Record<string, unknown>[]).map((item) => {
        const slim: Record<string, unknown> = {}
        for (const k of lineItemKeys) {
          if (k in item) slim[k] = item[k]
        }
        return slim
      })
    }

    // line_detail : objet à la racine
    if (topKeys.length && !('lines' in record) && topKeys.some((k) => k in record)) {
      return projected
    }

    return projected
  }

  return result
}

export async function resolvePreset(
  schema: ResponseSchema,
  pathParams: Record<string, unknown>,
  queryParams: Record<string, unknown>,
): Promise<unknown> {
  const preset = schema.preset as PresetId | undefined
  if (!preset) throw new Error('Preset manquant')

  const q = asQuery(pathParams, queryParams)
  const id = String(pathParams.id ?? pathParams.routeId ?? pathParams.stopId ?? q.id ?? '')

  let result: unknown

  switch (preset) {
    case 'coverage':
      result = await sae.coverage()
      break
    case 'physical_modes':
      result = await sae.physicalModes()
      break
    case 'lines_list':
      result = await sae.listLines(q)
      break
    case 'line_detail':
      result = await sae.getLine(id, q)
      break
    case 'line_thermometer':
      result = await sae.lineThermometer(id, q)
      break
    case 'line_geojson':
      result = await sae.lineGeojson(id, q)
      break
    case 'line_schedules':
      result = await sae.lineSchedules(id, q)
      break
    case 'stop_points_list':
      result = await sae.listStopPoints(q)
      break
    case 'stop_areas_list':
      result = await sae.listStopPoints({ ...q, stop_areas_only: 'true' })
      break
    case 'stop_point_detail':
      result = await sae.getStopPoint(id)
      break
    case 'stop_schedules':
      result = await sae.stopSchedules(id, q)
      break
    case 'places':
      result = await sae.places(q)
      break
    case 'places_nearby':
      result = await sae.placesNearby(q)
      break
    case 'poi_list':
      result = await sae.listPoi(q)
      break
    case 'poi_detail':
      result = await sae.getPoi(id)
      break
    case 'networks':
      result = await sae.listNetworks()
      break
    case 'vehicle_journeys_list':
      result = await sae.listVehicleJourneys(q)
      break
    case 'vehicle_journey_detail':
      result = await sae.getVehicleJourney(id)
      break
    case 'sae_catalog':
      result = {
        description: 'API SAE — endpoints pilotés par l’API Designer (presets)',
        endpoints: PRESET_CATALOG.map((p) => ({
          preset: p.id,
          path_hint: `/api${p.pathHint}`,
          description: p.description,
        })),
        note: 'Activez / désactivez / projetez les champs depuis l’API Designer.',
      }
      break
    default:
      throw new Error(`Preset inconnu : ${preset}`)
  }

  return projectPresetResult(result, schema)
}
