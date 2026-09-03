import type { ResponseSchema, FieldMapping, FilterDef } from '../engine/types.js'

export interface DesignerEndpoint {
  id: string
  path: string
  method: string
  description: string | null
  isActive: boolean
  responseSchema: ResponseSchema & { native?: string }
  params: Array<{
    name: string
    type: string
    location: string
    required: boolean
    description?: string | null
    defaultValue?: string | null
  }>
  updatedAt: Date
}

type JsonSchema = Record<string, unknown>

const ENTITY_BLURBS: Record<string, string> = {
  Agency: 'Opérateur / réseau de transport (agency.txt).',
  Stop: 'Arrêt ou station avec coordonnées GPS (stops.txt).',
  Route: 'Ligne commerciale (routes.txt) — bus, tram, métro…',
  Trip: 'Course / véhicule journey sur une ligne (trips.txt).',
  StopTime: 'Passage horaire d’une course à un arrêt (stop_times.txt).',
  Calendar: 'Planning hebdomadaire de service (calendar.txt).',
  CalendarDate: 'Exception de service (calendar_dates.txt).',
  Shape: 'Point de tracé géographique (shapes.txt).',
}

const SAMPLE_BY_DB: Record<string, unknown> = {
  routeId: '82',
  shortName: 'C1',
  longName: 'Gorge de Loup ↔ Cuire',
  type: 3,
  color: 'E4002B',
  textColor: 'FFFFFF',
  desc: 'Ligne structurante',
  url: 'https://www.tcl.fr',
  agencyId: 'TCL',
  sortOrder: 10,
  stopId: 'S1234',
  code: '1234',
  name: 'Bellecour Le Viste',
  lat: 45.7578,
  lon: 4.8320,
  locationType: 0,
  parentStation: null,
  wheelchairBoarding: 1,
  zoneId: 'A',
  tripId: 'trip:C1:1',
  serviceId: 'SEM_1',
  headsign: 'Cuire',
  directionId: 0,
  shapeId: 'shape:C1:0',
  arrivalTime: '08:12:00',
  departureTime: '08:12:30',
  stopSequence: 5,
  pickupType: 0,
  dropOffType: 0,
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false,
  startDate: '20260101',
  endDate: '20261231',
  date: '20260714',
  exceptionType: 2,
  ptLat: 45.76,
  ptLon: 4.83,
  ptSequence: 1,
  distTraveled: 120.5,
  agency_name: 'TCL',
}

function openApiType(t: string): { type: string } {
  if (t === 'number') return { type: 'number' }
  if (t === 'boolean') return { type: 'boolean' }
  return { type: 'string' }
}

function fieldExample(f: FieldMapping): unknown {
  if (f.db in SAMPLE_BY_DB) return SAMPLE_BY_DB[f.db]
  if (f.db.toLowerCase().includes('id')) return `ex_${f.output}`
  if (f.db.toLowerCase().includes('time')) return '08:00:00'
  if (f.db.toLowerCase().includes('lat')) return 45.76
  if (f.db.toLowerCase().includes('lon')) return 4.83
  return `exemple_${f.output}`
}

export function buildItemExample(schema: ResponseSchema): Record<string, unknown> {
  const fields = schema.fields?.length
    ? schema.fields
    : [{ output: 'id', db: 'routeId' }, { output: 'name', db: 'name' }]
  const out: Record<string, unknown> = {}
  for (const f of fields) out[f.output] = fieldExample(f)
  return out
}

export function buildResponseExample(schema: ResponseSchema & { native?: string }): unknown {
  if (schema.native === 'sae' || schema.preset) {
    return { note: 'Réponse générée par le preset SAE configuré dans l’API Designer.' }
  }
  const item = buildItemExample(schema)
  if (!schema.multiple) return item
  if (schema.paginate) {
    return {
      data: [item, { ...item, id: 'ex_2' }],
      pagination: { total: 42, limit: 100, offset: 0, hasMore: true },
    }
  }
  return [item]
}

export function buildJsonSchemaFromFields(schema: ResponseSchema & { native?: string }): JsonSchema {
  if (schema.native === 'sae' || schema.preset) {
    return { type: 'object', description: 'Réponse SAE / preset (structure riche, voir exemples).' }
  }

  const properties: Record<string, JsonSchema> = {}
  const fields = schema.fields ?? []
  for (const f of fields) {
    const sample = fieldExample(f)
    properties[f.output] = {
      type: typeof sample === 'number' ? 'number' : typeof sample === 'boolean' ? 'boolean' : 'string',
      description: `Champ GTFS \`${f.db}\` exposé sous \`${f.output}\``,
      example: sample,
    }
  }

  const itemSchema: JsonSchema =
    fields.length > 0
      ? { type: 'object', properties, additionalProperties: true }
      : { type: 'object', additionalProperties: true, description: 'Tous les champs de l’entité' }

  if (!schema.multiple) return itemSchema

  if (schema.paginate) {
    return {
      type: 'object',
      required: ['data', 'pagination'],
      properties: {
        data: { type: 'array', items: itemSchema },
        pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer', example: 42 },
            limit: { type: 'integer', example: 100 },
            offset: { type: 'integer', example: 0 },
            hasMore: { type: 'boolean', example: true },
          },
        },
      },
    }
  }

  return { type: 'array', items: itemSchema }
}

function toOpenApiPath(path: string): string {
  return `/api${path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')}`
}

function detectPathParams(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])
}

function explainEndpoint(ep: DesignerEndpoint): string {
  const schema = ep.responseSchema
  const parts: string[] = []

  if (ep.description) parts.push(ep.description)

  if (schema.native === 'sae' || schema.preset) {
    parts.push(
      schema.preset
        ? `Cet endpoint est piloté par le **preset SAE** \`${schema.preset}\` depuis l’API Designer (activation, params, projection \`responseKeys\`).`
        : 'Cet endpoint est servi par un preset SAE.',
    )
    if (schema.responseKeys?.length) {
      parts.push(`**Projection :** ${schema.responseKeys.map((k) => `\`${k}\``).join(', ')}.`)
    }
    return parts.join('\n\n')
  }

  const entity = schema.entity ?? 'Route'
  parts.push(`**Entité GTFS :** \`${entity}\` — ${ENTITY_BLURBS[entity] ?? 'Données GTFS.'}`)

  if (schema.multiple) {
    parts.push(
      schema.paginate
        ? 'Retourne une **liste paginée** (`data` + `pagination`). Utilisez `?limit=` et `?offset=`.'
        : 'Retourne un **tableau** de résultats.',
    )
  } else {
    parts.push('Retourne un **objet unique**. Réponse `404` si aucune ressource ne correspond.')
  }

  if (schema.fields?.length) {
    const mapping = schema.fields.map((f) => `\`${f.db}\` → \`${f.output}\``).join(', ')
    parts.push(`**Projection des champs :** ${mapping}.`)
  } else {
    parts.push('**Projection :** tous les champs de l’entité sont renvoyés.')
  }

  if (schema.filters?.length) {
    const filters = (schema.filters as FilterDef[])
      .map((f) => {
        const src =
          f.source === 'path'
            ? `paramètre d’URL \`:${f.key}\``
            : f.source === 'query'
              ? `query \`?${f.key}=\``
              : `valeur fixe \`${f.key}\``
        return `- \`${f.field}\` ${f.operator ?? 'eq'} depuis ${src}`
      })
      .join('\n')
    parts.push(`**Filtres appliqués :**\n${filters}`)
  }

  if (schema.orderBy) {
    parts.push(`**Tri :** \`${schema.orderBy.field}\` ${schema.orderBy.direction}.`)
  }

  if (!ep.isActive) {
    parts.push('> ⚠️ Endpoint **inactif** — non exposé par le moteur dynamique (peut rester documenté).')
  }

  return parts.join('\n\n')
}

function buildCurlExample(method: string, path: string, params: DesignerEndpoint['params']): string {
  const openPath = toOpenApiPath(path)
  let url = openPath
  for (const p of params.filter((x) => x.location === 'path')) {
    const sample =
      p.name.toLowerCase().includes('route') || p.name === 'id'
        ? '82'
        : p.name.toLowerCase().includes('stop')
          ? 'S1234'
          : p.type === 'number'
            ? '0'
            : 'exemple'
    url = url.replace(`{${p.name}}`, encodeURIComponent(sample))
  }

  const qs = params
    .filter((p) => p.location === 'query')
    .slice(0, 3)
    .map((p) => {
      const v =
        p.defaultValue ??
        (p.name === 'limit' ? '10' : p.name === 'q' ? 'part' : p.type === 'number' ? '3' : 'exemple')
      return `${p.name}=${encodeURIComponent(v)}`
    })

  if (qs.length) url += `?${qs.join('&')}`

  return `curl -sS "https://api.example.com${url}" \\\n  -H "Accept: application/json"`
}

export function designerEndpointToOperation(ep: DesignerEndpoint) {
  const schema = ep.responseSchema
  const tag = schema.preset
    ? 'SAE (preset Designer)'
    : ep.path.startsWith('/v1/custom')
      ? 'Designer (déclaratif)'
      : 'Designer'
  const pathParams = detectPathParams(ep.path)

  const parameters: Array<Record<string, unknown>> = []

  for (const name of pathParams) {
    const declared = ep.params.find((p) => p.name === name && p.location === 'path')
    parameters.push({
      name,
      in: 'path',
      required: true,
      description: declared?.description ?? `Identifiant \`${name}\``,
      schema: openApiType(declared?.type ?? 'string'),
      example: name.toLowerCase().includes('route') || name === 'id' ? '82' : 'S1234',
    })
  }

  for (const p of ep.params.filter((x) => x.location === 'query')) {
    parameters.push({
      name: p.name,
      in: 'query',
      required: p.required,
      description: p.description ?? `Paramètre query \`${p.name}\``,
      schema: {
        ...openApiType(p.type),
        ...(p.defaultValue ? { default: p.defaultValue } : {}),
      },
      example: p.defaultValue ?? (p.name === 'limit' ? 10 : p.name === 'q' ? 'part' : undefined),
    })
  }

  // Pagination auto si activée
  if (schema.paginate && !parameters.some((p) => p.name === 'limit')) {
    parameters.push({
      name: 'limit',
      in: 'query',
      required: false,
      description: 'Nombre max de résultats (plafond 500, défaut 100).',
      schema: { type: 'integer', default: 100, maximum: 500 },
      example: 20,
    })
    parameters.push({
      name: 'offset',
      in: 'query',
      required: false,
      description: 'Décalage pour la pagination.',
      schema: { type: 'integer', default: 0 },
      example: 0,
    })
  }

  // Filtres query non déclarés dans params
  for (const f of (schema.filters ?? []) as FilterDef[]) {
    if (f.source !== 'query') continue
    if (parameters.some((p) => p.name === f.key)) continue
    parameters.push({
      name: f.key,
      in: 'query',
      required: false,
      description: `Filtre sur le champ \`${f.field}\` (opérateur ${f.operator ?? 'eq'}).`,
      schema: { type: 'string' },
    })
  }

  const example = buildResponseExample(schema)
  const responseSchema = buildJsonSchemaFromFields(schema)

  return {
    openApiPath: toOpenApiPath(ep.path),
    method: ep.method.toLowerCase(),
    operation: {
      tags: [tag],
      summary: ep.description?.replace(/^\[.*?\]\s*/, '').slice(0, 120) || `${ep.method} ${ep.path}`,
      description: explainEndpoint(ep),
      operationId: `${ep.method.toLowerCase()}_${ep.path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      parameters,
      responses: {
        '200': {
          description: 'Succès',
          content: {
            'application/json': {
              schema: responseSchema,
              example,
            },
          },
        },
        ...(schema.multiple
          ? {}
          : {
              '404': {
                description: 'Ressource introuvable',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { error: { type: 'string', example: 'Ressource non trouvée' } },
                    },
                  },
                },
              },
            }),
      },
      'x-codeSamples': [
        {
          lang: 'cURL',
          source: buildCurlExample(ep.method, ep.path, ep.params),
        },
        {
          lang: 'JavaScript',
          source: `const res = await fetch("${toOpenApiPath(ep.path).replace(/\{[^}]+\}/g, '82')}");\nconst data = await res.json();\nconsole.log(data);`,
        },
      ],
    },
    meta: {
      id: ep.id,
      isActive: ep.isActive,
      entity: schema.entity,
      native: schema.native === 'sae',
      curl: buildCurlExample(ep.method, ep.path, ep.params),
      example,
      explanation: explainEndpoint(ep),
    },
  }
}
