import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PRESET_CATALOG } from './engine/presets.js'

type Param = {
  name: string
  type: string
  location: string
  required: boolean
  description?: string
}

type EndpointDef = {
  path: string
  method: string
  description: string
  isActive: boolean
  responseSchema: Record<string, unknown>
  params: Param[]
}

function declarative(
  entity: string,
  opts: Partial<{
    multiple: boolean
    filters: unknown[]
    fields: { output: string; db: string }[]
    orderBy: { field: string; direction: 'asc' | 'desc' }
    paginate: boolean
  }> = {},
) {
  return {
    source: 'active',
    entity,
    multiple: opts.multiple ?? true,
    filters: opts.filters ?? [],
    fields: opts.fields ?? [],
    orderBy: opts.orderBy,
    paginate: opts.paginate ?? true,
  }
}

function preset(
  id: string,
  entity: string,
  opts: Partial<{
    multiple: boolean
    filters: unknown[]
    responseKeys: string[]
    paginate: boolean
  }> = {},
) {
  return {
    source: 'active',
    preset: id,
    entity,
    multiple: opts.multiple ?? true,
    filters: opts.filters ?? [],
    fields: [] as { output: string; db: string }[],
    responseKeys: opts.responseKeys ?? [],
    paginate: opts.paginate ?? false,
  }
}

/** Endpoints déclaratifs GTFS — 100 % pilotés par fields/filters du Designer */
const DECLARATIVE: EndpointDef[] = [
  {
    path: '/v1/custom/lignes',
    method: 'GET',
    description: 'Liste lignes GTFS brute (déclaratif)',
    isActive: true,
    responseSchema: declarative('Route', {
      fields: [
        { output: 'id', db: 'routeId' },
        { output: 'numero', db: 'shortName' },
        { output: 'nom', db: 'longName' },
        { output: 'type', db: 'type' },
        { output: 'couleur', db: 'color' },
        { output: 'couleurTexte', db: 'textColor' },
      ],
      orderBy: { field: 'sortOrder', direction: 'asc' },
    }),
    params: [
      { name: 'limit', type: 'number', location: 'query', required: false },
      { name: 'offset', type: 'number', location: 'query', required: false },
      { name: 'type', type: 'number', location: 'query', required: false, description: 'Type GTFS' },
    ],
  },
  {
    path: '/v1/custom/lignes/:routeId',
    method: 'GET',
    description: 'Détail ligne GTFS brute (déclaratif)',
    isActive: true,
    responseSchema: declarative('Route', {
      multiple: false,
      paginate: false,
      filters: [{ field: 'routeId', source: 'path', key: 'routeId', operator: 'eq' }],
      fields: [
        { output: 'id', db: 'routeId' },
        { output: 'numero', db: 'shortName' },
        { output: 'nom', db: 'longName' },
        { output: 'type', db: 'type' },
        { output: 'couleur', db: 'color' },
        { output: 'couleurTexte', db: 'textColor' },
        { output: 'description', db: 'desc' },
        { output: 'url', db: 'url' },
      ],
    }),
    params: [{ name: 'routeId', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/custom/lignes/mode/:type',
    method: 'GET',
    description: 'Lignes filtrées par type GTFS (déclaratif)',
    isActive: true,
    responseSchema: declarative('Route', {
      filters: [{ field: 'type', source: 'path', key: 'type', operator: 'eq' }],
      fields: [
        { output: 'id', db: 'routeId' },
        { output: 'numero', db: 'shortName' },
        { output: 'nom', db: 'longName' },
        { output: 'type', db: 'type' },
        { output: 'couleur', db: 'color' },
      ],
      orderBy: { field: 'sortOrder', direction: 'asc' },
    }),
    params: [{ name: 'type', type: 'number', location: 'path', required: true }],
  },
  {
    path: '/v1/custom/arrets',
    method: 'GET',
    description: 'Liste des arrêts GTFS (déclaratif)',
    isActive: true,
    responseSchema: declarative('Stop', {
      fields: [
        { output: 'id', db: 'stopId' },
        { output: 'code', db: 'code' },
        { output: 'nom', db: 'name' },
        { output: 'lat', db: 'lat' },
        { output: 'lon', db: 'lon' },
        { output: 'type', db: 'locationType' },
      ],
      orderBy: { field: 'name', direction: 'asc' },
    }),
    params: [
      { name: 'limit', type: 'number', location: 'query', required: false },
      { name: 'offset', type: 'number', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/custom/arrets/:stopId',
    method: 'GET',
    description: "Détail d'un arrêt (déclaratif)",
    isActive: true,
    responseSchema: declarative('Stop', {
      multiple: false,
      paginate: false,
      filters: [{ field: 'stopId', source: 'path', key: 'stopId', operator: 'eq' }],
      fields: [
        { output: 'id', db: 'stopId' },
        { output: 'code', db: 'code' },
        { output: 'nom', db: 'name' },
        { output: 'description', db: 'desc' },
        { output: 'lat', db: 'lat' },
        { output: 'lon', db: 'lon' },
        { output: 'type', db: 'locationType' },
        { output: 'parent', db: 'parentStation' },
      ],
    }),
    params: [{ name: 'stopId', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/custom/courses',
    method: 'GET',
    description: 'Liste des courses (déclaratif)',
    isActive: true,
    responseSchema: declarative('Trip', {
      filters: [{ field: 'routeId', source: 'query', key: 'line_id', operator: 'eq' }],
      fields: [
        { output: 'id', db: 'tripId' },
        { output: 'ligne_id', db: 'routeId' },
        { output: 'destination', db: 'headsign' },
        { output: 'direction', db: 'directionId' },
        { output: 'shape_id', db: 'shapeId' },
        { output: 'service_id', db: 'serviceId' },
      ],
    }),
    params: [
      { name: 'line_id', type: 'string', location: 'query', required: false },
      { name: 'limit', type: 'number', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/custom/horaires',
    method: 'GET',
    description: 'Horaires bruts stop_times (déclaratif)',
    isActive: true,
    responseSchema: declarative('StopTime', {
      filters: [
        { field: 'stopId', source: 'query', key: 'stop_id', operator: 'eq' },
        { field: 'tripId', source: 'query', key: 'trip_id', operator: 'eq' },
      ],
      fields: [
        { output: 'course_id', db: 'tripId' },
        { output: 'arret_id', db: 'stopId' },
        { output: 'arrivee', db: 'arrivalTime' },
        { output: 'depart', db: 'departureTime' },
        { output: 'sequence', db: 'stopSequence' },
        { output: 'destination', db: 'headsign' },
      ],
      orderBy: { field: 'departureTime', direction: 'asc' },
    }),
    params: [
      { name: 'stop_id', type: 'string', location: 'query', required: false },
      { name: 'trip_id', type: 'string', location: 'query', required: false },
      { name: 'limit', type: 'number', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/custom/traces/:shapeId',
    method: 'GET',
    description: 'Points de tracé GTFS (déclaratif)',
    isActive: true,
    responseSchema: declarative('Shape', {
      filters: [{ field: 'shapeId', source: 'path', key: 'shapeId', operator: 'eq' }],
      fields: [
        { output: 'shape_id', db: 'shapeId' },
        { output: 'lat', db: 'ptLat' },
        { output: 'lon', db: 'ptLon' },
        { output: 'sequence', db: 'ptSequence' },
        { output: 'distance', db: 'distTraveled' },
      ],
      orderBy: { field: 'ptSequence', direction: 'asc' },
      paginate: false,
    }),
    params: [{ name: 'shapeId', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/custom/reseaux',
    method: 'GET',
    description: 'Agences GTFS (déclaratif)',
    isActive: true,
    responseSchema: declarative('Agency', {
      fields: [
        { output: 'id', db: 'agencyId' },
        { output: 'nom', db: 'name' },
        { output: 'url', db: 'url' },
        { output: 'timezone', db: 'timezone' },
      ],
      paginate: false,
    }),
    params: [],
  },
]

/**
 * Endpoints SAE / Navitia — actifs dans le Designer.
 * Désactiver / projeter responseKeys / ajouter des params = effet réel sur l’API.
 */
const SAE_PRESETS: EndpointDef[] = [
  {
    path: '/v1/coverage',
    method: 'GET',
    description: 'Couverture / métadonnées dataset',
    isActive: true,
    responseSchema: preset('coverage', 'Route', { multiple: false }),
    params: [],
  },
  {
    path: '/v1/physical_modes',
    method: 'GET',
    description: 'Modes physiques (Bus, Tram, Métro…)',
    isActive: true,
    responseSchema: preset('physical_modes', 'Route', { multiple: false }),
    params: [],
  },
  {
    path: '/v1/modes',
    method: 'GET',
    description: 'Alias FR — modes physiques',
    isActive: true,
    responseSchema: preset('physical_modes', 'Route', { multiple: false }),
    params: [],
  },
  {
    path: '/v1/lines',
    method: 'GET',
    description: 'Liste des lignes (format Navitia)',
    isActive: true,
    responseSchema: preset('lines_list', 'Route', { multiple: true, paginate: true }),
    params: [
      { name: 'physical_mode', type: 'string', location: 'query', required: false, description: 'Bus|Tramway|Metro…' },
      { name: 'q', type: 'string', location: 'query', required: false },
      { name: 'geojson', type: 'string', location: 'query', required: false, description: 'true|false' },
      { name: 'limit', type: 'number', location: 'query', required: false },
      { name: 'offset', type: 'number', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/lignes',
    method: 'GET',
    description: 'Alias FR — liste des lignes',
    isActive: true,
    responseSchema: preset('lines_list', 'Route', { multiple: true, paginate: true }),
    params: [
      { name: 'physical_mode', type: 'string', location: 'query', required: false },
      { name: 'q', type: 'string', location: 'query', required: false },
      { name: 'limit', type: 'number', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/lines/:id',
    method: 'GET',
    description: 'Détail ligne format Navitia',
    isActive: true,
    responseSchema: preset('line_detail', 'Route', {
      multiple: false,
      filters: [{ field: 'routeId', source: 'path', key: 'id', operator: 'eq' }],
    }),
    params: [
      { name: 'id', type: 'string', location: 'path', required: true },
      { name: 'geojson', type: 'string', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/lignes/:id',
    method: 'GET',
    description: 'Alias FR — détail ligne',
    isActive: true,
    responseSchema: preset('line_detail', 'Route', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/physical_modes/:mode/lines',
    method: 'GET',
    description: 'Lignes filtrées par mode',
    isActive: true,
    responseSchema: preset('lines_list', 'Route', { multiple: true, paginate: true }),
    params: [
      { name: 'mode', type: 'string', location: 'path', required: true },
      { name: 'limit', type: 'number', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/modes/:mode/lignes',
    method: 'GET',
    description: 'Alias FR — lignes par mode',
    isActive: true,
    responseSchema: preset('lines_list', 'Route', { multiple: true, paginate: true }),
    params: [{ name: 'mode', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/lines/:id/stop_points',
    method: 'GET',
    description: 'Thermomètre — séquence d’arrêts',
    isActive: true,
    responseSchema: preset('line_thermometer', 'Stop', { multiple: false }),
    params: [
      { name: 'id', type: 'string', location: 'path', required: true },
      { name: 'direction_id', type: 'number', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/lignes/:id/thermometre',
    method: 'GET',
    description: 'Alias FR — thermomètre',
    isActive: true,
    responseSchema: preset('line_thermometer', 'Stop', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/lines/:id/geojson',
    method: 'GET',
    description: 'Tracé GeoJSON',
    isActive: true,
    responseSchema: preset('line_geojson', 'Shape', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/lignes/:id/trace',
    method: 'GET',
    description: 'Alias FR — tracé',
    isActive: true,
    responseSchema: preset('line_geojson', 'Shape', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/lines/:id/route_schedules',
    method: 'GET',
    description: 'Horaires de ligne',
    isActive: true,
    responseSchema: preset('line_schedules', 'StopTime', { multiple: false }),
    params: [
      { name: 'id', type: 'string', location: 'path', required: true },
      { name: 'from_time', type: 'string', location: 'query', required: false },
      { name: 'stop_point_id', type: 'string', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/lignes/:id/horaires',
    method: 'GET',
    description: 'Alias FR — horaires de ligne',
    isActive: true,
    responseSchema: preset('line_schedules', 'StopTime', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/stop_points',
    method: 'GET',
    description: 'Liste des arrêts',
    isActive: true,
    responseSchema: preset('stop_points_list', 'Stop', { multiple: true, paginate: true }),
    params: [
      { name: 'q', type: 'string', location: 'query', required: false },
      { name: 'limit', type: 'number', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/arrets',
    method: 'GET',
    description: 'Alias FR — arrêts',
    isActive: true,
    responseSchema: preset('stop_points_list', 'Stop', { multiple: true, paginate: true }),
    params: [{ name: 'q', type: 'string', location: 'query', required: false }],
  },
  {
    path: '/v1/stop_areas',
    method: 'GET',
    description: 'Stations (location_type=1)',
    isActive: true,
    responseSchema: preset('stop_areas_list', 'Stop', { multiple: true, paginate: true }),
    params: [{ name: 'q', type: 'string', location: 'query', required: false }],
  },
  {
    path: '/v1/stop_points/:id',
    method: 'GET',
    description: 'Détail arrêt + lignes',
    isActive: true,
    responseSchema: preset('stop_point_detail', 'Stop', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/arrets/:id',
    method: 'GET',
    description: 'Alias FR — détail arrêt',
    isActive: true,
    responseSchema: preset('stop_point_detail', 'Stop', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/stop_points/:id/schedules',
    method: 'GET',
    description: 'Horaires / départs d’un arrêt',
    isActive: true,
    responseSchema: preset('stop_schedules', 'StopTime', { multiple: false }),
    params: [
      { name: 'id', type: 'string', location: 'path', required: true },
      { name: 'from_time', type: 'string', location: 'query', required: false },
      { name: 'line_id', type: 'string', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/arrets/:id/horaires',
    method: 'GET',
    description: 'Alias FR — horaires d’arrêt',
    isActive: true,
    responseSchema: preset('stop_schedules', 'StopTime', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/places',
    method: 'GET',
    description: 'Autocomplétion lieux',
    isActive: true,
    responseSchema: preset('places', 'Stop', { multiple: true }),
    params: [
      { name: 'q', type: 'string', location: 'query', required: true },
      { name: 'type', type: 'string', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/lieux',
    method: 'GET',
    description: 'Alias FR — lieux',
    isActive: true,
    responseSchema: preset('places', 'Stop', { multiple: true }),
    params: [{ name: 'q', type: 'string', location: 'query', required: true }],
  },
  {
    path: '/v1/places_nearby',
    method: 'GET',
    description: 'Lieux à proximité',
    isActive: true,
    responseSchema: preset('places_nearby', 'Stop', { multiple: true }),
    params: [
      { name: 'lat', type: 'number', location: 'query', required: true },
      { name: 'lon', type: 'number', location: 'query', required: true },
      { name: 'distance', type: 'number', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/lieux_proches',
    method: 'GET',
    description: 'Alias FR — lieux proches',
    isActive: true,
    responseSchema: preset('places_nearby', 'Stop', { multiple: true }),
    params: [
      { name: 'lat', type: 'number', location: 'query', required: true },
      { name: 'lon', type: 'number', location: 'query', required: true },
    ],
  },
  {
    path: '/v1/poi',
    method: 'GET',
    description: 'Points d’intérêt',
    isActive: true,
    responseSchema: preset('poi_list', 'Stop', { multiple: true, paginate: true }),
    params: [{ name: 'q', type: 'string', location: 'query', required: false }],
  },
  {
    path: '/v1/poi/:id',
    method: 'GET',
    description: 'Détail POI',
    isActive: true,
    responseSchema: preset('poi_detail', 'Stop', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/networks',
    method: 'GET',
    description: 'Réseaux / agences',
    isActive: true,
    responseSchema: preset('networks', 'Agency', { multiple: true }),
    params: [],
  },
  {
    path: '/v1/agencies',
    method: 'GET',
    description: 'Alias — agences',
    isActive: true,
    responseSchema: preset('networks', 'Agency', { multiple: true }),
    params: [],
  },
  {
    path: '/v1/vehicle_journeys',
    method: 'GET',
    description: 'Courses GTFS',
    isActive: true,
    responseSchema: preset('vehicle_journeys_list', 'Trip', { multiple: true, paginate: true }),
    params: [{ name: 'line_id', type: 'string', location: 'query', required: false }],
  },
  {
    path: '/v1/courses',
    method: 'GET',
    description: 'Alias FR — courses',
    isActive: true,
    responseSchema: preset('vehicle_journeys_list', 'Trip', { multiple: true, paginate: true }),
    params: [{ name: 'line_id', type: 'string', location: 'query', required: false }],
  },
  {
    path: '/v1/vehicle_journeys/:id',
    method: 'GET',
    description: 'Détail course',
    isActive: true,
    responseSchema: preset('vehicle_journey_detail', 'Trip', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/courses/:id',
    method: 'GET',
    description: 'Alias FR — détail course',
    isActive: true,
    responseSchema: preset('vehicle_journey_detail', 'Trip', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/vehicle_monitoring',
    method: 'GET',
    description: 'Positions véhicules temps réel (SIRI-Lite Grand Lyon)',
    isActive: true,
    responseSchema: preset('vehicle_monitoring_list', 'Vehicle', { multiple: true, paginate: true }),
    params: [
      { name: 'line', type: 'string', location: 'query', required: false },
      { name: 'vehicle_id', type: 'string', location: 'query', required: false },
      { name: 'direction', type: 'string', location: 'query', required: false },
      { name: 'vehicle_mode', type: 'string', location: 'query', required: false },
      { name: 'bbox', type: 'string', location: 'query', required: false },
      { name: 'q', type: 'string', location: 'query', required: false },
      { name: 'limit', type: 'number', location: 'query', required: false },
      { name: 'offset', type: 'number', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/positions_vehicules',
    method: 'GET',
    description: 'Alias FR — positions véhicules temps réel',
    isActive: true,
    responseSchema: preset('vehicle_monitoring_list', 'Vehicle', { multiple: true, paginate: true }),
    params: [
      { name: 'line', type: 'string', location: 'query', required: false },
      { name: 'vehicle_id', type: 'string', location: 'query', required: false },
      { name: 'direction', type: 'string', location: 'query', required: false },
      { name: 'limit', type: 'number', location: 'query', required: false },
      { name: 'offset', type: 'number', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/vehicle_monitoring/geojson',
    method: 'GET',
    description: 'Positions véhicules temps réel en GeoJSON',
    isActive: true,
    responseSchema: preset('vehicle_monitoring_geojson', 'Vehicle', { multiple: false }),
    params: [
      { name: 'line', type: 'string', location: 'query', required: false },
      { name: 'bbox', type: 'string', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/positions_vehicules/geojson',
    method: 'GET',
    description: 'Alias FR — GeoJSON positions',
    isActive: true,
    responseSchema: preset('vehicle_monitoring_geojson', 'Vehicle', { multiple: false }),
    params: [{ name: 'line', type: 'string', location: 'query', required: false }],
  },
  {
    path: '/v1/vehicle_monitoring/_status',
    method: 'GET',
    description: 'Statut du cache temps réel SIRI',
    isActive: true,
    responseSchema: preset('vehicle_monitoring_status', 'Vehicle', { multiple: false }),
    params: [],
  },
  {
    path: '/v1/vehicle_monitoring/:id',
    method: 'GET',
    description: 'Détail position d’un véhicule',
    isActive: true,
    responseSchema: preset('vehicle_monitoring_detail', 'Vehicle', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/positions_vehicules/:id',
    method: 'GET',
    description: 'Alias FR — détail véhicule',
    isActive: true,
    responseSchema: preset('vehicle_monitoring_detail', 'Vehicle', { multiple: false }),
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/endpoints',
    method: 'GET',
    description: 'Catalogue des presets SAE',
    isActive: true,
    responseSchema: preset('sae_catalog', 'Route', { multiple: false }),
    params: [],
  },
]

const DEFAULTS = [...DECLARATIVE, ...SAE_PRESETS]
const keyOf = (path: string, method: string) => `${method} ${path}`

/**
 * Paramètres d'un endpoint preset : ceux que le handler lit (catalogue), adaptés au chemin.
 * Un `:x` du chemin devient un paramètre de chemin obligatoire.
 */
export function presetParams(presetId: string, path: string): Param[] {
  const meta = PRESET_CATALOG.find((p) => p.id === presetId)
  const pathNames = [...path.matchAll(/:([a-zA-Z_]+)/g)].map((m) => m[1])
  const params: Param[] = []
  for (const input of meta?.inputs ?? []) {
    if (pathNames.includes(input.name)) continue
    if (input.location === 'path') continue
    params.push({ name: input.name, type: input.type, location: 'query', required: !!input.required, description: input.description })
  }
  for (const name of pathNames) {
    const input = meta?.inputs.find((i) => i.name === name)
    params.unshift({ name, type: input?.type ?? 'string', location: 'path', required: true, description: input?.description })
  }
  return params
}

function defaultParams(ep: EndpointDef): Param[] {
  const presetId = (ep.responseSchema as { preset?: string }).preset
  return presetId ? presetParams(presetId, ep.path) : ep.params
}

export function defaultEndpoint(path: string, method: string) {
  const ep = DEFAULTS.find((d) => d.path === path && d.method === method)
  return ep ? { ...ep, params: defaultParams(ep) } : null
}

/**
 * Fusionne les endpoints autrefois stockés dans la base de contrôle NeTEx dans la
 * configuration unique, puis les retire de l'ancienne base pour qu'une suppression
 * dans le Designer ne soit pas annulée au démarrage suivant.
 */
async function mergeLegacyEndpoints(prisma: PrismaClient) {
  const { controlClient, CONFIG_SOURCE } = await import('./db.js')
  for (const source of ['gtfs', 'netex'] as const) {
    if (source === CONFIG_SOURCE) continue
    const legacy = controlClient(source)
    if (!legacy) continue
    const endpoints = await legacy.apiEndpoint.findMany({ include: { params: true } })
    let merged = 0
    for (const { id, params, createdAt: _c, updatedAt: _u, ...ep } of endpoints) {
      const exists = await prisma.apiEndpoint.findUnique({ where: { path_method: { path: ep.path, method: ep.method } } })
      if (!exists) {
        await prisma.apiEndpoint.create({
          data: { ...ep, params: { create: params.map(({ id: _id, endpointId: _e, ...p }) => p) } },
        })
        merged++
      }
      await legacy.apiEndpoint.delete({ where: { id } })
    }
    if (endpoints.length) console.log(`[Seed] Configuration ${source} fusionnée : ${merged} endpoint(s) repris`)
  }
}

/**
 * Crée les endpoints par défaut qui n'ont jamais été proposés. Le Designer reste la seule
 * source de vérité : un endpoint existant n'est jamais modifié, et un endpoint supprimé
 * n'est pas recréé (les clés déjà proposées sont mémorisées dans designer-seed.json).
 */
export async function seedDefaultEndpoints(prisma: PrismaClient) {
  const { settingsFile, atomicJson } = await import('./db.js')
  await mergeLegacyEndpoints(prisma)

  const file = settingsFile('designer-seed.json')
  let offered = new Set<string>()
  let firstRun = true
  try {
    offered = new Set(JSON.parse(fs.readFileSync(file, 'utf8')).offered)
    firstRun = false
  } catch { /* premier démarrage avec ce mécanisme */ }

  let created = 0
  for (const ep of DEFAULTS) {
    const key = keyOf(ep.path, ep.method)
    if (offered.has(key)) continue
    offered.add(key)
    const exists = await prisma.apiEndpoint.findUnique({ where: { path_method: { path: ep.path, method: ep.method } } })
    if (exists) {
      // Installation existante : l'ancien seed écrasait les params ; on aligne une seule fois
      // les presets sur les paramètres réellement lus par leur handler.
      if (firstRun) await alignPresetParams(prisma, exists.id, exists.responseSchema, ep.path)
      continue
    }
    const { params: _p, responseSchema, ...data } = ep
    await prisma.apiEndpoint.create({
      data: { ...data, responseSchema: JSON.stringify(responseSchema), params: { create: defaultParams(ep) } },
    })
    created++
  }
  atomicJson(file, { offered: [...offered].sort() })
  console.log(`[Seed] ${created} endpoint(s) par défaut créé(s) ; configuration existante conservée`)
}

async function alignPresetParams(prisma: PrismaClient, id: string, rawSchema: string, path: string) {
  let schema: { preset?: string; source?: string }
  try { schema = JSON.parse(rawSchema) } catch { return }
  const update: { responseSchema?: string } = {}
  if (!schema.source) update.responseSchema = JSON.stringify({ source: 'active', ...schema })
  if (schema.preset) {
    await prisma.apiParam.deleteMany({ where: { endpointId: id } })
    await prisma.apiParam.createMany({ data: presetParams(schema.preset, path).map((p) => ({ ...p, endpointId: id })) })
  }
  if (update.responseSchema) await prisma.apiEndpoint.update({ where: { id }, data: update })
}
