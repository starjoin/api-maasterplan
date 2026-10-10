import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, withSourcePrisma, getActiveSource } from '../db.js'
import { DATA_SOURCES, isDataSource } from '../config.js'
import { resolveEndpoint } from '../engine/resolver.js'
import type { ResponseSchema } from '../engine/types.js'
import { reloadEndpoints } from '../engine/index.js'
import { ENTITY_DELEGATES, ENTITY_LABELS, ParamError, entityColumns, sampleJsonPaths } from '../engine/model.js'
import { PRESET_CATALOG } from '../engine/presets.js'
import { defaultEndpoint } from '../seed.js'

const paramSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  location: z.enum(['path', 'query']),
  required: z.boolean().default(false),
  // La base renvoie null pour une valeur absente : accepté et normalisé.
  description: z.string().nullish().transform((v) => v || undefined),
  defaultValue: z.string().nullish().transform((v) => v || undefined),
})

const fieldSchema = z.object({ output: z.string().min(1), db: z.string().min(1) })
const responseSchemaSchema = z
  .object({
    source: z.enum(['active', 'gtfs', 'netex']).default('active'),
    entity: z.string(),
    multiple: z.boolean(),
    filters: z.array(z.object({
      field: z.string().min(1),
      source: z.enum(['path', 'query', 'static']),
      key: z.string(),
      operator: z.enum(['eq', 'contains', 'startsWith', 'in', 'gte', 'lte']).optional(),
    })).default([]),
    fields: z.array(fieldSchema).default([]),
    relations: z.array(z.object({
      output: z.string().min(1),
      entity: z.string(),
      source: z.enum(['active', 'gtfs', 'netex']).optional(),
      parentField: z.string().min(1),
      foreignField: z.string().min(1),
      fields: z.array(fieldSchema).default([]),
      multiple: z.boolean().optional(),
      orderBy: z.object({ field: z.string(), direction: z.enum(['asc', 'desc']) }).optional(),
      limit: z.number().int().positive().optional(),
    })).optional(),
    orderBy: z.object({ field: z.string(), direction: z.enum(['asc', 'desc']) }).optional(),
    paginate: z.boolean().optional(),
    preset: z.string().optional(),
    responseKeys: z.array(z.string()).optional(),
    output: z.object({ list: z.string().optional(), fields: z.array(fieldSchema).default([]) }).optional(),
  })
  .superRefine((schema, ctx) => {
    if (schema.preset && !PRESET_CATALOG.some((p) => p.id === schema.preset)) {
      ctx.addIssue({ code: 'custom', message: `Preset inconnu : ${schema.preset}` })
    }
    if (!schema.preset && !(schema.entity in ENTITY_DELEGATES)) {
      ctx.addIssue({ code: 'custom', message: `Entité inconnue : ${schema.entity}` })
    }
  })

const createEndpointSchema = z.object({
  path: z.string().min(1).startsWith('/'),
  method: z.enum(['GET', 'POST']).default('GET'),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  responseSchema: responseSchemaSchema,
  params: z.array(paramSchema).default([]),
})

const updateEndpointSchema = createEndpointSchema.partial()

function serializeEndpoint(ep: {
  id: string
  path: string
  method: string
  description: string | null
  isActive: boolean
  responseSchema: string
  createdAt: Date
  updatedAt: Date
  params: unknown[]
}) {
  return {
    ...ep,
    responseSchema: JSON.parse(ep.responseSchema),
    isDefault: defaultEndpoint(ep.path, ep.method) !== null,
  }
}

export async function endpointsRoutes(app: FastifyInstance) {
  // Une configuration invalide est une erreur de saisie (400) avec un message lisible, pas une 500.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({
        error: err.issues.map((i) => `${i.path.join('.') || 'configuration'} : ${i.message}`).join(' ; '),
      })
    }
    req.log.error(err)
    return reply.status(err.statusCode ?? 500).send({ error: err.message })
  })

  app.get('/admin/endpoints', async (_req, reply) => {
    const endpoints = await prisma.apiEndpoint.findMany({
      include: { params: true },
      orderBy: { path: 'asc' },
    })
    return reply.send(endpoints.map(serializeEndpoint))
  })

  app.get<{ Params: { id: string } }>('/admin/endpoints/:id', async (req, reply) => {
    const endpoint = await prisma.apiEndpoint.findUnique({
      where: { id: req.params.id },
      include: { params: true },
    })
    if (!endpoint) return reply.status(404).send({ error: 'Endpoint introuvable' })
    return reply.send(serializeEndpoint(endpoint))
  })

  app.post('/admin/endpoints', async (req, reply) => {
    const { params, responseSchema, ...data } = createEndpointSchema.parse(req.body)

    const endpoint = await prisma.apiEndpoint.create({
      data: {
        ...data,
        responseSchema: JSON.stringify(responseSchema),
        params: { create: params },
      },
      include: { params: true },
    })

    await reloadEndpoints(app)
    return reply.status(201).send(serializeEndpoint(endpoint))
  })

  app.put<{ Params: { id: string } }>('/admin/endpoints/:id', async (req, reply) => {
    const { params, responseSchema, ...rest } = updateEndpointSchema.parse(req.body)

    await prisma.apiParam.deleteMany({ where: { endpointId: req.params.id } })

    const endpoint = await prisma.apiEndpoint.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(responseSchema ? { responseSchema: JSON.stringify(responseSchema) } : {}),
        ...(params ? { params: { create: params } } : {}),
      },
      include: { params: true },
    })

    await reloadEndpoints(app)
    return reply.send(serializeEndpoint(endpoint))
  })

  app.delete<{ Params: { id: string } }>('/admin/endpoints/:id', async (req, reply) => {
    await prisma.apiEndpoint.delete({ where: { id: req.params.id } })
    await reloadEndpoints(app)
    return reply.status(204).send()
  })

  app.patch<{ Params: { id: string } }>('/admin/endpoints/:id/toggle', async (req, reply) => {
    const endpoint = await prisma.apiEndpoint.findUnique({ where: { id: req.params.id } })
    if (!endpoint) return reply.status(404).send({ error: 'Endpoint introuvable' })

    const updated = await prisma.apiEndpoint.update({
      where: { id: req.params.id },
      data: { isActive: !endpoint.isActive },
      include: { params: true },
    })

    await reloadEndpoints(app)
    return reply.send(serializeEndpoint(updated))
  })

  /** Colonnes de chaque entité, avec les sous-clés JSON observées dans la base demandée. */
  app.get<{ Querystring: { source?: string } }>('/admin/endpoints/meta/fields', async (req, reply) => {
    const requested = req.query.source
    const source = requested && isDataSource(requested) ? requested : getActiveSource()
    const out: Record<string, { label: string; columns: Array<{ name: string; type: string; paths?: string[] }> }> = {}
    await withSourcePrisma(source, async (client) => {
      for (const entity of Object.keys(ENTITY_DELEGATES) as Array<keyof typeof ENTITY_DELEGATES>) {
        const columns = []
        for (const column of entityColumns(entity)) {
          columns.push(column.type === 'json'
            ? { ...column, paths: await sampleJsonPaths(client, entity, column.name) }
            : column)
        }
        out[entity] = { label: ENTITY_LABELS[entity], columns }
      }
    })
    return reply.send({ source, entities: out })
  })

  /** Volumes par entité dans chaque base : aide à choisir la source d'un endpoint. */
  app.get('/admin/endpoints/meta/sources', async (_req, reply) => {
    const sources = []
    for (const source of DATA_SOURCES) {
      const counts = await withSourcePrisma(source, async (client) => {
        const entries: Record<string, number> = {}
        for (const [entity, delegate] of Object.entries(ENTITY_DELEGATES)) {
          entries[entity] = await (client as unknown as Record<string, { count: () => Promise<number> }>)[delegate].count()
        }
        return entries
      })
      sources.push({ id: source, active: source === getActiveSource(), counts })
    }
    return reply.send({ sources })
  })

  app.get('/admin/endpoints/meta/presets', async (_req, reply) => {
    return reply.send({ presets: PRESET_CATALOG })
  })

  /** Restaure la configuration livrée d'un endpoint par défaut. */
  app.post<{ Params: { id: string } }>('/admin/endpoints/:id/reset', async (req, reply) => {
    const endpoint = await prisma.apiEndpoint.findUnique({ where: { id: req.params.id } })
    if (!endpoint) return reply.status(404).send({ error: 'Endpoint introuvable' })
    const def = defaultEndpoint(endpoint.path, endpoint.method)
    if (!def) return reply.status(400).send({ error: 'Pas de configuration par défaut pour cet endpoint' })
    await prisma.apiParam.deleteMany({ where: { endpointId: endpoint.id } })
    const updated = await prisma.apiEndpoint.update({
      where: { id: endpoint.id },
      data: {
        description: def.description,
        responseSchema: JSON.stringify(def.responseSchema),
        params: { create: def.params },
      },
      include: { params: true },
    })
    await reloadEndpoints(app)
    return reply.send(serializeEndpoint(updated))
  })

  app.post<{
    Body: {
      schema: ResponseSchema
      params?: Array<{ name: string; type: string; location: string; required: boolean; defaultValue?: string }>
      pathParams?: Record<string, string>
      queryParams?: Record<string, string>
    }
  }>('/admin/endpoints/preview', async (req, reply) => {
    try {
      const { pathParams = {}, queryParams = {}, params = [] } = req.body
      const schema = responseSchemaSchema.parse(req.body.schema) as ResponseSchema
      const result = await resolveEndpoint(schema, pathParams, queryParams, params)
      return reply.send({ ok: true, result })
    } catch (err) {
      const msg = err instanceof z.ZodError
        ? err.issues.map((i) => i.message).join(' ; ')
        : err instanceof Error ? err.message : String(err)
      if (!(err instanceof ParamError) && !(err instanceof z.ZodError)) req.log.error(err)
      return reply.status(400).send({ ok: false, error: msg })
    }
  })
}
