import type { ResponseSchema } from './types.js'
import { project } from './resolver.js'
import * as sae from '../sae/handlers.js'
import * as siri from '../siri/handlers.js'

/**
 * Presets = handlers codés qui produisent un JSON au format Navitia (le format de l'API
 * SAE historique). Le Designer contrôle ce qui y entre (paramètres déclarés uniquement)
 * et ce qui en sort (clés racines + champs de chaque élément de la liste).
 */
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
  | 'vehicle_monitoring_list'
  | 'vehicle_monitoring_detail'
  | 'vehicle_monitoring_geojson'
  | 'vehicle_monitoring_status'
  | 'sae_catalog'

export interface PresetInput {
  name: string
  type: 'string' | 'number' | 'boolean'
  location: 'path' | 'query'
  required?: boolean
  description: string
}

export interface PresetMeta {
  id: PresetId
  label: string
  description: string
  /** Clés de premier niveau de la réponse */
  responseKeys: string[]
  /** Liste dont les éléments sont projetables champ par champ */
  listKey?: string
  /** Champs (chemins pointés) disponibles dans chaque élément de `listKey` */
  itemFields?: string[]
  /** Paramètres que le handler sait lire ; seuls ceux déclarés sur l'endpoint lui parviennent */
  inputs: PresetInput[]
  /** Données lues : base transport (GTFS/NeTEx), cache temps réel ou aucune */
  data: 'transport' | 'realtime' | 'none'
  /** Limites connues selon la base */
  caveats?: string
  entity: string
  multiple: boolean
  pathHint: string
}

const LIMIT: PresetInput = { name: 'limit', type: 'number', location: 'query', description: 'Taille de page (max 200)' }
const OFFSET: PresetInput = { name: 'offset', type: 'number', location: 'query', description: 'Décalage de pagination' }
const ID: PresetInput = { name: 'id', type: 'string', location: 'path', required: true, description: 'Identifiant de l’objet' }
const SEARCH: PresetInput = { name: 'q', type: 'string', location: 'query', description: 'Recherche plein texte' }

const LINE_FIELDS = [
  'id', 'name', 'code', 'direction', 'description', 'color', 'text_color', 'url', 'agency_id', 'sort_order',
  'physical_mode.id', 'physical_mode.name', 'commercial_mode.id', 'commercial_mode.name',
]
const STOP_FIELDS = [
  'id', 'name', 'label', 'code', 'description', 'coord.lat', 'coord.lon', 'location_type', 'embedded_type',
  'parent_station', 'wheelchair_boarding', 'zone_id', 'url',
]
const VEHICLE_FIELDS = [
  'id', 'vehicle_ref', 'vehicle_mode', 'line_code', 'line_ref', 'direction', 'journey_ref', 'destination_ref',
  'destination_stop_id', 'data_source', 'location.lat', 'location.lon', 'bearing', 'delay', 'delay_seconds', 'status',
  'recorded_at', 'valid_until', 'monitored_call',
]

export const PRESET_CATALOG: PresetMeta[] = [
  {
    id: 'coverage',
    label: 'Couverture dataset',
    description: 'Métadonnées RFU, volumes importés et liens de découverte',
    responseKeys: ['coverage', 'datasets', 'links'],
    inputs: [],
    data: 'transport',
    entity: 'Route',
    multiple: false,
    pathHint: '/v1/coverage',
  },
  {
    id: 'physical_modes',
    label: 'Modes physiques',
    description: 'Bus, Tram, Métro… avec compteurs de lignes',
    responseKeys: ['physical_modes'],
    listKey: 'physical_modes',
    itemFields: ['id', 'name', 'gtfs_types', 'lines_count'],
    inputs: [],
    data: 'transport',
    entity: 'Route',
    multiple: false,
    pathHint: '/v1/physical_modes',
  },
  {
    id: 'lines_list',
    label: 'Lignes (liste)',
    description: 'Liste paginée de lignes Navitia (modes, réseau, routes ; tracé sur demande)',
    responseKeys: ['lines', 'pagination'],
    listKey: 'lines',
    itemFields: [
      'id', 'code', 'name', 'color', 'text_color', 'opening_time', 'closing_time', 'commercial_mode',
      'physical_modes', 'network', 'routes', 'codes', 'properties', 'geojson',
    ],
    inputs: [
      { name: 'physical_mode', type: 'string', location: 'query', description: 'Mode physique (Bus, Tramway, Metro…)' },
      { name: 'mode', type: 'string', location: 'query', description: 'Alias de physical_mode (utilisé par /modes/:mode/lignes)' },
      { name: 'type', type: 'number', location: 'query', description: 'route_type GTFS' },
      { name: 'agency_id', type: 'string', location: 'query', description: 'Réseau / opérateur' },
      SEARCH,
      { name: 'geojson', type: 'boolean', location: 'query', description: 'Inclure le tracé de chaque ligne' },
      LIMIT,
      OFFSET,
    ],
    data: 'transport',
    entity: 'Route',
    multiple: true,
    pathHint: '/v1/lines',
  },
  {
    id: 'line_detail',
    label: 'Ligne (détail)',
    description: 'Objet ligne Navitia à la racine (code, routes, horaires d’ouverture, tracé…)',
    responseKeys: [
      'id', 'code', 'name', 'color', 'text_color', 'opening_time', 'closing_time', 'links', 'codes', 'properties',
      'commercial_mode', 'physical_modes', 'network', 'routes', 'geojson',
    ],
    inputs: [ID, { name: 'geojson', type: 'boolean', location: 'query', description: 'false pour omettre le tracé' }],
    data: 'transport',
    entity: 'Route',
    multiple: false,
    pathHint: '/v1/lines/:id',
  },
  {
    id: 'line_thermometer',
    label: 'Thermomètre de ligne',
    description: 'Séquence d’arrêts par direction, d’après une course représentative',
    responseKeys: ['line', 'directions'],
    listKey: 'directions',
    itemFields: ['direction_id', 'headsign', 'shape_id', 'trip_id', 'stop_points'],
    inputs: [ID, { name: 'direction_id', type: 'number', location: 'query', description: '0 ou 1' }],
    data: 'transport',
    entity: 'Stop',
    multiple: false,
    pathHint: '/v1/lines/:id/stop_points',
  },
  {
    id: 'line_geojson',
    label: 'Tracé GeoJSON',
    description: 'FeatureCollection du tracé Navitia, avec les shapes GTFS en repli',
    responseKeys: ['type', 'features', 'line'],
    listKey: 'features',
    itemFields: ['type', 'geometry', 'properties'],
    inputs: [ID, { name: 'direction_id', type: 'number', location: 'query', description: '0 ou 1' }],
    data: 'transport',
    caveats: 'NeTEx n’a pas de shapes : sans tracé Navitia importé, la réponse est vide sur cette base.',
    entity: 'Shape',
    multiple: false,
    pathHint: '/v1/lines/:id/geojson',
  },
  {
    id: 'line_schedules',
    label: 'Horaires de ligne',
    description: 'Prochains passages de la ligne (route_schedules)',
    responseKeys: ['line', 'route_schedules'],
    listKey: 'route_schedules',
    inputs: [
      ID,
      { name: 'stop_id', type: 'string', location: 'query', description: 'Restreindre à un arrêt' },
      { name: 'from_time', type: 'string', location: 'query', description: 'HH:MM:SS' },
      { name: 'from_datetime', type: 'string', location: 'query', description: 'ISO 8601 (l’heure est utilisée)' },
      LIMIT,
    ],
    data: 'transport',
    entity: 'StopTime',
    multiple: false,
    pathHint: '/v1/lines/:id/route_schedules',
  },
  {
    id: 'stop_points_list',
    label: 'Arrêts (liste)',
    description: 'stop_points paginés avec recherche',
    responseKeys: ['stop_points', 'pagination'],
    listKey: 'stop_points',
    itemFields: STOP_FIELDS,
    inputs: [
      SEARCH,
      { name: 'location_type', type: 'number', location: 'query', description: '0 arrêt, 1 zone d’arrêts, 3 POI' },
      { name: 'stop_points_only', type: 'boolean', location: 'query', description: 'Uniquement les arrêts physiques' },
      { name: 'stop_areas_only', type: 'boolean', location: 'query', description: 'Uniquement les zones d’arrêts' },
      LIMIT,
      OFFSET,
    ],
    data: 'transport',
    entity: 'Stop',
    multiple: true,
    pathHint: '/v1/stop_points',
  },
  {
    id: 'stop_areas_list',
    label: 'Zones d’arrêts (liste)',
    description: 'Arrêts location_type = 1',
    responseKeys: ['stop_points', 'pagination'],
    listKey: 'stop_points',
    itemFields: STOP_FIELDS,
    inputs: [SEARCH, LIMIT, OFFSET],
    data: 'transport',
    entity: 'Stop',
    multiple: true,
    pathHint: '/v1/stop_areas',
  },
  {
    id: 'stop_point_detail',
    label: 'Arrêt (détail)',
    description: 'Arrêt et lignes qui le desservent',
    responseKeys: ['stop_point', 'lines'],
    listKey: 'lines',
    itemFields: LINE_FIELDS,
    inputs: [ID],
    data: 'transport',
    entity: 'Stop',
    multiple: false,
    pathHint: '/v1/stop_points/:id',
  },
  {
    id: 'stop_schedules',
    label: 'Horaires d’arrêt',
    description: 'Prochains départs à un arrêt',
    responseKeys: ['stop_point', 'stop_schedules'],
    listKey: 'stop_schedules',
    inputs: [
      ID,
      { name: 'line_id', type: 'string', location: 'query', description: 'Restreindre à une ligne' },
      { name: 'from_time', type: 'string', location: 'query', description: 'HH:MM:SS' },
      { name: 'from_datetime', type: 'string', location: 'query', description: 'ISO 8601 (l’heure est utilisée)' },
      LIMIT,
    ],
    data: 'transport',
    entity: 'StopTime',
    multiple: false,
    pathHint: '/v1/stop_points/:id/schedules',
  },
  {
    id: 'places',
    label: 'Autocomplétion',
    description: 'Recherche d’arrêts et de lignes',
    responseKeys: ['places', 'message'],
    listKey: 'places',
    itemFields: ['id', 'name', 'embedded_type', 'quality', 'stop_point', 'stop_area', 'line'],
    inputs: [
      { ...SEARCH, required: true },
      { name: 'type', type: 'string', location: 'query', description: 'Types séparés par des virgules (stop_point,line…)' },
      LIMIT,
    ],
    data: 'transport',
    entity: 'Stop',
    multiple: true,
    pathHint: '/v1/places',
  },
  {
    id: 'places_nearby',
    label: 'Lieux à proximité',
    description: 'Arrêts autour d’un point (distance à vol d’oiseau)',
    responseKeys: ['places_nearby', 'pagination', 'error'],
    listKey: 'places_nearby',
    itemFields: ['id', 'name', 'embedded_type', 'distance', 'stop_point'],
    inputs: [
      { name: 'lat', type: 'number', location: 'query', required: true, description: 'Latitude WGS84' },
      { name: 'lon', type: 'number', location: 'query', required: true, description: 'Longitude WGS84' },
      { name: 'distance', type: 'number', location: 'query', description: 'Rayon en mètres (500 par défaut, max 5000)' },
      LIMIT,
      OFFSET,
    ],
    data: 'transport',
    entity: 'Stop',
    multiple: true,
    pathHint: '/v1/places_nearby',
  },
  {
    id: 'poi_list',
    label: 'POI (liste)',
    description: 'Points d’intérêt et stations',
    responseKeys: ['poi', 'pagination'],
    listKey: 'poi',
    itemFields: ['id', 'name', 'classification', 'coord.lat', 'coord.lon', 'address', 'extras', 'stop_point'],
    inputs: [
      SEARCH,
      { name: 'classification', type: 'string', location: 'query', description: 'Catégorie de POI' },
      { name: 'poi_type', type: 'string', location: 'query', description: 'stop_point ou stop_area' },
      { name: 'all', type: 'boolean', location: 'query', description: 'Inclure aussi les arrêts' },
      LIMIT,
      OFFSET,
    ],
    data: 'transport',
    caveats: 'Les POI proviennent de NeTEx ; la base GTFS n’en contient pas.',
    entity: 'Stop',
    multiple: true,
    pathHint: '/v1/poi',
  },
  {
    id: 'poi_detail',
    label: 'POI (détail)',
    description: 'Un POI par identifiant',
    responseKeys: ['poi'],
    inputs: [ID],
    data: 'transport',
    caveats: 'Les POI proviennent de NeTEx ; la base GTFS n’en contient pas.',
    entity: 'Stop',
    multiple: false,
    pathHint: '/v1/poi/:id',
  },
  {
    id: 'networks',
    label: 'Réseaux / opérateurs',
    description: 'Agences de la base',
    responseKeys: ['networks'],
    listKey: 'networks',
    itemFields: ['id', 'name', 'url', 'timezone', 'lang', 'phone', 'email'],
    inputs: [],
    data: 'transport',
    entity: 'Agency',
    multiple: true,
    pathHint: '/v1/networks',
  },
  {
    id: 'vehicle_journeys_list',
    label: 'Courses (liste)',
    description: 'Courses (trips) avec leur ligne',
    responseKeys: ['vehicle_journeys', 'pagination'],
    listKey: 'vehicle_journeys',
    itemFields: ['id', 'name', 'headsign', 'direction_id', 'service_id', 'shape_id', ...LINE_FIELDS.map((f) => `line.${f}`)],
    inputs: [
      { name: 'line_id', type: 'string', location: 'query', description: 'Ligne (route_id)' },
      { name: 'direction_id', type: 'number', location: 'query', description: '0 ou 1' },
      LIMIT,
      OFFSET,
    ],
    data: 'transport',
    entity: 'Trip',
    multiple: true,
    pathHint: '/v1/vehicle_journeys',
  },
  {
    id: 'vehicle_journey_detail',
    label: 'Course (détail)',
    description: 'Course et ses passages',
    responseKeys: ['vehicle_journey'],
    inputs: [ID],
    data: 'transport',
    entity: 'Trip',
    multiple: false,
    pathHint: '/v1/vehicle_journeys/:id',
  },
  {
    id: 'vehicle_monitoring_list',
    label: 'Positions véhicules',
    description: 'Cache SIRI-Lite VehicleMonitoring, rafraîchi toutes les ~10 s',
    responseKeys: ['vehicle_monitoring', 'pagination', 'realtime'],
    listKey: 'vehicle_monitoring',
    itemFields: VEHICLE_FIELDS,
    inputs: [
      { name: 'line', type: 'string', location: 'query', description: 'Code ou référence de ligne' },
      { name: 'vehicle_id', type: 'string', location: 'query', description: 'Référence véhicule' },
      { name: 'direction', type: 'string', location: 'query', description: 'Direction SIRI' },
      { name: 'vehicle_mode', type: 'string', location: 'query', description: 'bus, tram, metro…' },
      { name: 'bbox', type: 'string', location: 'query', description: 'minLon,minLat,maxLon,maxLat' },
      SEARCH,
      LIMIT,
      OFFSET,
    ],
    data: 'realtime',
    entity: 'Vehicle',
    multiple: true,
    pathHint: '/v1/vehicle_monitoring',
  },
  {
    id: 'vehicle_monitoring_detail',
    label: 'Position véhicule (détail)',
    description: 'Un véhicule par identifiant',
    responseKeys: ['vehicle_monitoring', 'realtime'],
    inputs: [ID],
    data: 'realtime',
    entity: 'Vehicle',
    multiple: false,
    pathHint: '/v1/vehicle_monitoring/:id',
  },
  {
    id: 'vehicle_monitoring_geojson',
    label: 'Positions véhicules (GeoJSON)',
    description: 'FeatureCollection des positions temps réel',
    responseKeys: ['type', 'features', 'realtime'],
    listKey: 'features',
    itemFields: ['type', 'geometry', 'properties'],
    inputs: [
      { name: 'line', type: 'string', location: 'query', description: 'Code ou référence de ligne' },
      { name: 'vehicle_mode', type: 'string', location: 'query', description: 'bus, tram, metro…' },
      { name: 'bbox', type: 'string', location: 'query', description: 'minLon,minLat,maxLon,maxLat' },
    ],
    data: 'realtime',
    entity: 'Vehicle',
    multiple: false,
    pathHint: '/v1/vehicle_monitoring/geojson',
  },
  {
    id: 'vehicle_monitoring_status',
    label: 'Statut temps réel',
    description: 'Âge du cache SIRI, erreurs, compteurs',
    responseKeys: ['realtime'],
    inputs: [],
    data: 'realtime',
    entity: 'Vehicle',
    multiple: false,
    pathHint: '/v1/vehicle_monitoring/_status',
  },
  {
    id: 'sae_catalog',
    label: 'Catalogue des presets',
    description: 'Index JSON des presets disponibles',
    responseKeys: ['description', 'endpoints', 'note'],
    listKey: 'endpoints',
    itemFields: ['preset', 'path_hint', 'description'],
    inputs: [],
    data: 'none',
    entity: 'Route',
    multiple: false,
    pathHint: '/v1/endpoints',
  },
]

export function presetMeta(id: string | undefined) {
  return PRESET_CATALOG.find((p) => p.id === id)
}

/**
 * Projection de la sortie d'un preset :
 * 1. `responseKeys` : clés racines gardées (vide = toutes) ;
 * 2. `output.list` + `output.fields` : champs gardés/renommés dans chaque élément de la liste.
 * Les anciennes clés `line.xxx` de `responseKeys` restent comprises (projection de `lines[]`).
 */
export function projectPresetResult(result: unknown, schema: ResponseSchema): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  const record = result as Record<string, unknown>
  const keys = schema.responseKeys ?? []
  const topKeys = keys.filter((k) => !k.startsWith('line.'))
  const legacyLineKeys = keys.filter((k) => k.startsWith('line.')).map((k) => k.slice(5))

  const out: Record<string, unknown> = {}
  for (const k of topKeys.length ? topKeys : Object.keys(record)) if (k in record) out[k] = record[k]

  const output = schema.output
  const list = output?.list ?? (legacyLineKeys.length ? 'lines' : undefined)
  const fields = output?.fields?.length
    ? output.fields
    : legacyLineKeys.map((k) => ({ output: k, db: k }))
  if (list && fields.length && Array.isArray(out[list])) {
    out[list] = (out[list] as Record<string, unknown>[]).map((item) => project(item, fields))
  }
  return out
}

export async function resolvePreset(schema: ResponseSchema, input: Record<string, string>): Promise<unknown> {
  const preset = schema.preset as PresetId | undefined
  if (!preset) throw new Error('Preset manquant')

  const q = input
  const id = String(q.id ?? q.routeId ?? q.stopId ?? '')

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
    case 'vehicle_monitoring_list':
      result = siri.listVehicleMonitoring(q)
      break
    case 'vehicle_monitoring_detail':
      result = siri.getVehicleMonitoring(id)
      break
    case 'vehicle_monitoring_geojson':
      result = siri.vehicleMonitoringGeojson(q)
      break
    case 'vehicle_monitoring_status':
      result = siri.vehicleMonitoringStatus()
      break
    case 'sae_catalog':
      result = {
        description: 'Presets disponibles dans l’API Designer',
        endpoints: PRESET_CATALOG.map((p) => ({
          preset: p.id,
          path_hint: `/api${p.pathHint}`,
          description: p.description,
        })),
        note: 'Activez, désactivez et projetez les champs depuis l’API Designer.',
      }
      break
    default:
      throw new Error(`Preset inconnu : ${preset}`)
  }

  if (result === null || result === undefined) return null
  return projectPresetResult(result, schema)
}
