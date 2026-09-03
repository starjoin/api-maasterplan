import { PrismaClient } from '@prisma/client'

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

function schema(entity: string, opts: Partial<{
  multiple: boolean
  filters: unknown[]
  fields: { output: string; db: string }[]
  orderBy: { field: string; direction: 'asc' | 'desc' }
  paginate: boolean
}> = {}) {
  return {
    entity,
    multiple: opts.multiple ?? true,
    filters: opts.filters ?? [],
    fields: opts.fields ?? [],
    orderBy: opts.orderBy,
    paginate: opts.paginate ?? true,
  }
}

/** Catalogue API Designer — endpoints déclaratifs complémentaires au SAE natif */
const CATALOG: EndpointDef[] = [
  // ── Lignes (déclaratif — le SAE natif /api/v1/lines est prioritaire) ───────
  {
    path: '/v1/custom/lignes',
    method: 'GET',
    description: '[Designer] Liste lignes GTFS brute — personnalisable',
    isActive: true,
    responseSchema: schema('Route', {
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
    description: '[Designer] Détail ligne GTFS — personnalisable',
    isActive: true,
    responseSchema: schema('Route', {
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
    description: '[Designer] Lignes filtrées par type GTFS (0=tram, 1=métro, 3=bus…)',
    isActive: true,
    responseSchema: schema('Route', {
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

  // ── Arrêts ────────────────────────────────────────────────────────────────
  {
    path: '/v1/custom/arrets',
    method: 'GET',
    description: '[Designer] Liste des arrêts GTFS',
    isActive: true,
    responseSchema: schema('Stop', {
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
    description: '[Designer] Détail d\'un arrêt',
    isActive: true,
    responseSchema: schema('Stop', {
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

  // ── Courses / trips ───────────────────────────────────────────────────────
  {
    path: '/v1/custom/courses',
    method: 'GET',
    description: '[Designer] Liste des courses (trips)',
    isActive: true,
    responseSchema: schema('Trip', {
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
    path: '/v1/custom/courses/:tripId',
    method: 'GET',
    description: '[Designer] Détail d\'une course',
    isActive: true,
    responseSchema: schema('Trip', {
      multiple: false,
      paginate: false,
      filters: [{ field: 'tripId', source: 'path', key: 'tripId', operator: 'eq' }],
      fields: [
        { output: 'id', db: 'tripId' },
        { output: 'ligne_id', db: 'routeId' },
        { output: 'destination', db: 'headsign' },
        { output: 'direction', db: 'directionId' },
        { output: 'shape_id', db: 'shapeId' },
      ],
    }),
    params: [{ name: 'tripId', type: 'string', location: 'path', required: true }],
  },

  // ── Horaires stop_times ───────────────────────────────────────────────────
  {
    path: '/v1/custom/horaires',
    method: 'GET',
    description: '[Designer] Horaires bruts (stop_times) — filtrer par stop_id ou trip_id',
    isActive: true,
    responseSchema: schema('StopTime', {
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

  // ── Shapes / tracés bruts ─────────────────────────────────────────────────
  {
    path: '/v1/custom/traces/:shapeId',
    method: 'GET',
    description: '[Designer] Points de tracé GTFS pour un shape_id',
    isActive: true,
    responseSchema: schema('Shape', {
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

  // ── Agences ───────────────────────────────────────────────────────────────
  {
    path: '/v1/custom/reseaux',
    method: 'GET',
    description: '[Designer] Agences / réseaux GTFS',
    isActive: true,
    responseSchema: schema('Agency', {
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

  // ── Calendriers ───────────────────────────────────────────────────────────
  {
    path: '/v1/custom/calendriers',
    method: 'GET',
    description: '[Designer] Plannings de service (calendar)',
    isActive: true,
    responseSchema: schema('Calendar', {
      fields: [
        { output: 'service_id', db: 'serviceId' },
        { output: 'lundi', db: 'monday' },
        { output: 'mardi', db: 'tuesday' },
        { output: 'mercredi', db: 'wednesday' },
        { output: 'jeudi', db: 'thursday' },
        { output: 'vendredi', db: 'friday' },
        { output: 'samedi', db: 'saturday' },
        { output: 'dimanche', db: 'sunday' },
        { output: 'debut', db: 'startDate' },
        { output: 'fin', db: 'endDate' },
      ],
    }),
    params: [{ name: 'limit', type: 'number', location: 'query', required: false }],
  },
]

/** Endpoints SAE natifs documentés dans le Designer (inactifs = pas de double résolution) */
const SAE_DOCS: EndpointDef[] = [
  {
    path: '/v1/coverage',
    method: 'GET',
    description: '[SAE natif] Couverture / métadonnées dataset',
    isActive: false,
    responseSchema: { entity: 'Route', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [],
  },
  {
    path: '/v1/physical_modes',
    method: 'GET',
    description: '[SAE natif] Modes physiques (Bus, Tram, Métro…)',
    isActive: false,
    responseSchema: { entity: 'Route', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [],
  },
  {
    path: '/v1/lines',
    method: 'GET',
    description: '[SAE natif] Lignes (?physical_mode=&q=) — alias /v1/lignes',
    isActive: false,
    responseSchema: { entity: 'Route', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [
      { name: 'physical_mode', type: 'string', location: 'query', required: false, description: 'Bus|Tramway|Metro…' },
      { name: 'q', type: 'string', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/lines/:id/stop_points',
    method: 'GET',
    description: '[SAE natif] Thermomètre — séquence d\'arrêts — alias /lignes/:id/thermometre',
    isActive: false,
    responseSchema: { entity: 'Stop', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [
      { name: 'id', type: 'string', location: 'path', required: true },
      { name: 'direction_id', type: 'number', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/lines/:id/geojson',
    method: 'GET',
    description: '[SAE natif] Tracé GeoJSON — alias /lignes/:id/trace',
    isActive: false,
    responseSchema: { entity: 'Shape', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [{ name: 'id', type: 'string', location: 'path', required: true }],
  },
  {
    path: '/v1/lines/:id/route_schedules',
    method: 'GET',
    description: '[SAE natif] Horaires de ligne — alias /lignes/:id/horaires',
    isActive: false,
    responseSchema: { entity: 'StopTime', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [
      { name: 'id', type: 'string', location: 'path', required: true },
      { name: 'from_time', type: 'string', location: 'query', required: false, description: 'HH:MM:SS' },
      { name: 'stop_point_id', type: 'string', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/stop_points',
    method: 'GET',
    description: '[SAE natif] Arrêts — alias /v1/arrets',
    isActive: false,
    responseSchema: { entity: 'Stop', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [{ name: 'q', type: 'string', location: 'query', required: false }],
  },
  {
    path: '/v1/stop_points/:id/schedules',
    method: 'GET',
    description: '[SAE natif] Horaires / départs d\'un arrêt',
    isActive: false,
    responseSchema: { entity: 'StopTime', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [
      { name: 'id', type: 'string', location: 'path', required: true },
      { name: 'from_time', type: 'string', location: 'query', required: false },
      { name: 'line_id', type: 'string', location: 'query', required: false },
    ],
  },
  {
    path: '/v1/places',
    method: 'GET',
    description: '[SAE natif] Autocomplétion lieux (?q=) — alias /v1/lieux',
    isActive: false,
    responseSchema: { entity: 'Stop', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [{ name: 'q', type: 'string', location: 'query', required: true }],
  },
  {
    path: '/v1/places_nearby',
    method: 'GET',
    description: '[SAE natif] Lieux proches (?lat=&lon=&distance=) — alias /v1/lieux_proches',
    isActive: false,
    responseSchema: { entity: 'Stop', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [
      { name: 'lat', type: 'number', location: 'query', required: true },
      { name: 'lon', type: 'number', location: 'query', required: true },
      { name: 'distance', type: 'number', location: 'query', required: false, description: 'mètres (défaut 500)' },
    ],
  },
  {
    path: '/v1/poi',
    method: 'GET',
    description: '[SAE natif] Points d\'intérêt (stations)',
    isActive: false,
    responseSchema: { entity: 'Stop', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [{ name: 'q', type: 'string', location: 'query', required: false }],
  },
  {
    path: '/v1/vehicle_journeys',
    method: 'GET',
    description: '[SAE natif] Courses — alias /v1/courses',
    isActive: false,
    responseSchema: { entity: 'Trip', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [{ name: 'line_id', type: 'string', location: 'query', required: false }],
  },
  {
    path: '/v1/endpoints',
    method: 'GET',
    description: '[SAE natif] Catalogue complet des endpoints SAE',
    isActive: false,
    responseSchema: { entity: 'Route', multiple: true, filters: [], fields: [], native: 'sae' },
    params: [],
  },
]

export async function seedDefaultEndpoints(prisma: PrismaClient) {
  await prisma.datasetMeta.upsert({
    where: { id: 'default' },
    create: { id: 'default' },
    update: {},
  })

  // Désactiver les anciens endpoints /v1/lignes du premier seed (remplacés par SAE natif)
  await prisma.apiEndpoint.updateMany({
    where: {
      OR: [{ path: '/v1/lignes' }, { path: '/v1/lignes/:routeId' }],
      isActive: true,
    },
    data: { isActive: false },
  })

  const all = [...CATALOG, ...SAE_DOCS]
  let created = 0
  let updated = 0

  for (const ep of all) {
    const { params, responseSchema, ...data } = ep
    const existing = await prisma.apiEndpoint.findUnique({
      where: { path_method: { path: data.path, method: data.method } },
    })

    if (!existing) {
      await prisma.apiEndpoint.create({
        data: {
          ...data,
          responseSchema: JSON.stringify(responseSchema),
          params: { create: params },
        },
      })
      created++
    } else {
      await prisma.apiParam.deleteMany({ where: { endpointId: existing.id } })
      await prisma.apiEndpoint.update({
        where: { id: existing.id },
        data: {
          description: data.description,
          isActive: data.isActive,
          responseSchema: JSON.stringify(responseSchema),
          params: { create: params },
        },
      })
      updated++
    }
  }

  console.log(`[Seed] Catalogue SAE : ${created} créés, ${updated} mis à jour`)
}
