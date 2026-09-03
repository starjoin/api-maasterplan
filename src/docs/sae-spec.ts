/** Opérations OpenAPI enrichies pour la couche SAE native */

export const SAE_OPENAPI_PATHS: Record<string, Record<string, unknown>> = {
  '/api/v1/coverage': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Métadonnées de couverture',
      description:
        'Point d’entrée de découverte. Retourne l’identité du jeu de données RFU, les volumes importés et les liens vers les ressources principales — équivalent Navitia `/coverage`.',
      operationId: 'getCoverage',
      responses: {
        '200': {
          description: 'Informations de couverture',
          content: {
            'application/json': {
              example: {
                coverage: {
                  id: 'sytral-rfu',
                  name: 'Sytral Mobilités — RFU',
                  dataset_created_at: '2026-09-03T00:00:00.000Z',
                },
                datasets: { lines: 795, stop_points: 13922, vehicle_journeys: 97070 },
                links: [{ rel: 'lines', href: '/api/v1/lines' }],
              },
            },
          },
        },
      },
      'x-codeSamples': [
        { lang: 'cURL', source: 'curl -sS "https://api.example.com/api/v1/coverage"' },
      ],
    },
  },
  '/api/v1/physical_modes': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Modes de transport',
      description:
        'Liste les modes physiques présents dans le GTFS (Bus, Tramway, Métro…) avec le nombre de lignes associés. Alias FR : `/api/v1/modes`.',
      operationId: 'getPhysicalModes',
      responses: {
        '200': {
          description: 'Modes disponibles',
          content: {
            'application/json': {
              example: {
                physical_modes: [
                  { id: 'Bus', name: 'Bus', gtfs_types: [3], lines_count: 600 },
                  { id: 'Tramway', name: 'Tramway', gtfs_types: [0], lines_count: 8 },
                ],
              },
            },
          },
        },
      },
    },
  },
  '/api/v1/physical_modes/{mode}/lines': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Lignes filtrées par mode',
      description: 'Retourne les lignes d’un mode donné (`Bus`, `Tramway`, `Metro`…). Alias FR : `/api/v1/modes/{mode}/lignes`.',
      operationId: 'getLinesByMode',
      parameters: [
        {
          name: 'mode',
          in: 'path',
          required: true,
          schema: { type: 'string', example: 'Bus' },
          description: 'Identifiant ou libellé du mode physique',
        },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 }, example: 20 },
      ],
      responses: {
        '200': {
          description: 'Liste de lignes',
          content: {
            'application/json': {
              example: {
                lines: [
                  {
                    id: '82',
                    code: 'C1',
                    name: 'Gorge de Loup ↔ Cuire',
                    physical_mode: { id: 'Bus', name: 'Bus' },
                    color: '#E4002B',
                  },
                ],
                pagination: { total: 600, limit: 20, offset: 0, hasMore: true },
              },
            },
          },
        },
      },
    },
  },
  '/api/v1/lines': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Liste des lignes',
      description:
        'Liste paginée des lignes commerciales. Filtres : `physical_mode`, `type` (GTFS), `q` (recherche), `agency_id`. Alias FR : `/api/v1/lignes`.',
      operationId: 'listLines',
      parameters: [
        { name: 'physical_mode', in: 'query', schema: { type: 'string' }, example: 'Bus', description: 'Filtrer par mode' },
        { name: 'q', in: 'query', schema: { type: 'string' }, example: 'C1', description: 'Recherche libre' },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 }, example: 20 },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      ],
      responses: {
        '200': {
          description: 'Lignes',
          content: {
            'application/json': {
              example: {
                lines: [{ id: '82', code: 'C1', name: 'Gorge de Loup ↔ Cuire', color: '#E4002B' }],
                pagination: { total: 795, limit: 20, offset: 0, hasMore: true },
              },
            },
          },
        },
      },
      'x-codeSamples': [
        { lang: 'cURL', source: 'curl -sS "https://api.example.com/api/v1/lines?physical_mode=Bus&limit=10"' },
      ],
    },
  },
  '/api/v1/lines/{id}': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Détail d’une ligne',
      description: 'Retourne le détail d’une ligne par son `route_id` GTFS. Alias FR : `/api/v1/lignes/{id}`.',
      operationId: 'getLine',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: '82' },
      ],
      responses: {
        '200': {
          description: 'Ligne',
          content: {
            'application/json': {
              example: {
                line: {
                  id: '82',
                  code: 'C1',
                  name: 'Gorge de Loup ↔ Cuire',
                  physical_mode: { id: 'Bus', name: 'Bus' },
                  color: '#E4002B',
                },
              },
            },
          },
        },
        '404': { description: 'Ligne introuvable' },
      },
    },
  },
  '/api/v1/lines/{id}/stop_points': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Thermomètre de ligne',
      description:
        'Séquence ordonnée des arrêts par direction (thermometre). Choisit automatiquement la course la plus complète. Alias FR : `/api/v1/lignes/{id}/thermometre`.',
      operationId: 'getLineThermometer',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: '82' },
        { name: 'direction_id', in: 'query', schema: { type: 'integer' }, example: 0, description: '0 ou 1' },
      ],
      responses: {
        '200': {
          description: 'Directions + arrêts ordonnés',
          content: {
            'application/json': {
              example: {
                line: { id: '82', code: 'C1' },
                directions: [
                  {
                    direction_id: 0,
                    headsign: 'Cuire',
                    stop_points: [
                      { order: 1, stop_point: { id: 'S1', name: 'Gorge de Loup' }, departure_time: '06:00:00' },
                      { order: 2, stop_point: { id: 'S2', name: 'Valmy' }, departure_time: '06:04:00' },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      'x-codeSamples': [
        { lang: 'cURL', source: 'curl -sS "https://api.example.com/api/v1/lignes/82/thermometre"' },
      ],
    },
  },
  '/api/v1/lines/{id}/geojson': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Tracé GeoJSON',
      description:
        'FeatureCollection GeoJSON des tracés (`shapes.txt`) associés à la ligne. Prêt pour Leaflet / MapLibre. Alias FR : `/api/v1/lignes/{id}/trace`.',
      operationId: 'getLineGeojson',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: '82' },
        { name: 'direction_id', in: 'query', schema: { type: 'integer' } },
      ],
      responses: {
        '200': {
          description: 'GeoJSON FeatureCollection',
          content: {
            'application/json': {
              example: {
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    properties: { line_id: '82', color: '#E4002B' },
                    geometry: { type: 'LineString', coordinates: [[4.80, 45.75], [4.83, 45.76]] },
                  },
                ],
              },
            },
          },
        },
      },
    },
  },
  '/api/v1/lines/{id}/route_schedules': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Horaires de ligne',
      description:
        'Horaires / passages d’une ligne. Filtres optionnels `from_time` (HH:MM:SS) et `stop_point_id`. Alias FR : `/api/v1/lignes/{id}/horaires`.',
      operationId: 'getLineSchedules',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: '82' },
        { name: 'from_time', in: 'query', schema: { type: 'string', example: '08:00:00' } },
        { name: 'stop_point_id', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
      ],
      responses: { '200': { description: 'Horaires' } },
    },
  },
  '/api/v1/stop_points': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Liste des arrêts',
      description: 'Arrêts GTFS avec recherche `q`. Alias FR : `/api/v1/arrets`. Voir aussi `/api/v1/stop_areas` pour les stations.',
      operationId: 'listStopPoints',
      parameters: [
        { name: 'q', in: 'query', schema: { type: 'string' }, example: 'bellecour' },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
      ],
      responses: { '200': { description: 'Arrêts' } },
    },
  },
  '/api/v1/stop_points/{id}': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Détail d’un arrêt',
      description: 'Arrêt + lignes qui le desservent. Alias FR : `/api/v1/arrets/{id}`.',
      operationId: 'getStopPoint',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'S1234' },
      ],
      responses: { '200': { description: 'Arrêt + lignes' }, '404': { description: 'Introuvable' } },
    },
  },
  '/api/v1/stop_points/{id}/schedules': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Horaires / départs d’un arrêt',
      description:
        'Timetable au sens SAE : prochains passages à un arrêt. `from_time`, `line_id` optionnels. Alias FR : `/api/v1/arrets/{id}/horaires`.',
      operationId: 'getStopSchedules',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'S1234' },
        { name: 'from_time', in: 'query', schema: { type: 'string' }, example: '08:00:00' },
        { name: 'line_id', in: 'query', schema: { type: 'string' }, example: '82' },
        { name: 'limit', in: 'query', schema: { type: 'integer' }, example: 30 },
      ],
      responses: {
        '200': {
          description: 'Départs',
          content: {
            'application/json': {
              example: {
                stop_point: { id: 'S1234', name: 'Bellecour Le Viste' },
                stop_schedules: [
                  {
                    departure_time: '08:12:00',
                    headsign: 'Cuire',
                    line: { id: '82', code: 'C1', color: '#E4002B' },
                  },
                ],
              },
            },
          },
        },
      },
      'x-codeSamples': [
        {
          lang: 'cURL',
          source: 'curl -sS "https://api.example.com/api/v1/arrets/S1234/horaires?from_time=08:00:00&limit=20"',
        },
      ],
    },
  },
  '/api/v1/places': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Autocomplétion de lieux',
      description:
        'Recherche multi-types (arrêts + lignes), style Navitia `places`. Paramètre `q` obligatoire (≥ 2 caractères). Alias FR : `/api/v1/lieux`.',
      operationId: 'searchPlaces',
      parameters: [
        { name: 'q', in: 'query', required: true, schema: { type: 'string' }, example: 'part' },
        {
          name: 'type',
          in: 'query',
          schema: { type: 'string', default: 'stop_point,line' },
          description: 'Types séparés par des virgules : stop_point, stop_area, line, poi',
        },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
      ],
      responses: {
        '200': {
          description: 'Suggestions',
          content: {
            'application/json': {
              example: {
                places: [
                  { id: 'S1', name: 'Part-Dieu', embedded_type: 'stop_area', quality: 100 },
                  { id: 'C3', name: 'C3 — …', embedded_type: 'line', quality: 90 },
                ],
              },
            },
          },
        },
      },
    },
  },
  '/api/v1/places_nearby': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Lieux à proximité',
      description:
        'Recherche géospatiale autour d’un point (Haversine). `lat`, `lon` requis ; `distance` en mètres (défaut 500, max 5000). Alias FR : `/api/v1/lieux_proches`.',
      operationId: 'placesNearby',
      parameters: [
        { name: 'lat', in: 'query', required: true, schema: { type: 'number' }, example: 45.76 },
        { name: 'lon', in: 'query', required: true, schema: { type: 'number' }, example: 4.83 },
        { name: 'distance', in: 'query', schema: { type: 'integer', default: 500 }, example: 400 },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 30 } },
      ],
      responses: {
        '200': {
          description: 'Lieux proches triés par distance',
          content: {
            'application/json': {
              example: {
                places_nearby: [
                  {
                    distance: 85,
                    embedded_type: 'stop_point',
                    stop_point: { id: 'S9', name: 'Hôtel de Ville', coord: { lat: 45.7601, lon: 4.8302 } },
                  },
                ],
              },
            },
          },
        },
        '400': { description: 'lat/lon manquants' },
      },
      'x-codeSamples': [
        {
          lang: 'cURL',
          source: 'curl -sS "https://api.example.com/api/v1/places_nearby?lat=45.76&lon=4.83&distance=400"',
        },
      ],
    },
  },
  '/api/v1/poi': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Points d’intérêt',
      description:
        'Stations / arrêts exposés comme POI. Par défaut `location_type=1` (stations). `all=true` pour tout inclure.',
      operationId: 'listPoi',
      parameters: [
        { name: 'q', in: 'query', schema: { type: 'string' } },
        { name: 'all', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
      ],
      responses: { '200': { description: 'POI' } },
    },
  },
  '/api/v1/poi/{id}': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Détail d’un POI',
      operationId: 'getPoi',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'POI' }, '404': { description: 'Introuvable' } },
    },
  },
  '/api/v1/networks': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Réseaux / agences',
      description: 'Agences GTFS. Alias : `/api/v1/agencies`.',
      operationId: 'listNetworks',
      responses: { '200': { description: 'Réseaux' } },
    },
  },
  '/api/v1/vehicle_journeys': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Courses (vehicle journeys)',
      description: 'Liste des trips GTFS. Filtre `line_id`. Alias FR : `/api/v1/courses`.',
      operationId: 'listVehicleJourneys',
      parameters: [
        { name: 'line_id', in: 'query', schema: { type: 'string' }, example: '82' },
        { name: 'direction_id', in: 'query', schema: { type: 'integer' } },
      ],
      responses: { '200': { description: 'Courses' } },
    },
  },
  '/api/v1/vehicle_journeys/{id}': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Détail d’une course',
      description: 'Course + séquence complète de stop_times. Alias FR : `/api/v1/courses/{id}`.',
      operationId: 'getVehicleJourney',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Course' }, '404': { description: 'Introuvable' } },
    },
  },
  '/api/v1/endpoints': {
    get: {
      tags: ['SAE (natif)'],
      summary: 'Catalogue JSON des endpoints SAE',
      description: 'Index machine-readable des routes SAE. Pour la documentation humaine, préférez `/docs`.',
      operationId: 'listSaeEndpoints',
      responses: { '200': { description: 'Catalogue' } },
    },
  },
}
