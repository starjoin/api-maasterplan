import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { resolveEndpoint } from '../engine/resolver.js'
import type { ResponseSchema } from '../engine/types.js'
import { reloadEndpoints } from '../engine/index.js'

const paramSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  location: z.enum(['path', 'query']),
  required: z.boolean().default(false),
  description: z.string().optional(),
  defaultValue: z.string().optional(),
})

const createEndpointSchema = z.object({
  path: z.string().min(1).startsWith('/'),
  method: z.enum(['GET', 'POST']).default('GET'),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  responseSchema: z.record(z.unknown()),
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
  }
}

export async function endpointsRoutes(app: FastifyInstance) {
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

  app.get('/admin/endpoints/meta/fields', async (_req, reply) => {
    return reply.send({
      Agency: ['agencyId', 'name', 'url', 'timezone', 'lang', 'phone', 'email'],
      Stop: ['stopId', 'code', 'name', 'desc', 'lat', 'lon', 'zoneId', 'locationType', 'parentStation', 'wheelchairBoarding'],
      Route: ['routeId', 'agencyId', 'shortName', 'longName', 'desc', 'type', 'url', 'color', 'textColor', 'sortOrder'],
      Trip: ['tripId', 'routeId', 'serviceId', 'headsign', 'shortName', 'directionId', 'blockId', 'shapeId', 'wheelchairAccessible'],
      StopTime: ['tripId', 'arrivalTime', 'departureTime', 'stopId', 'stopSequence', 'headsign', 'pickupType', 'dropOffType'],
      Calendar: ['serviceId', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'startDate', 'endDate'],
      CalendarDate: ['serviceId', 'date', 'exceptionType'],
      Shape: ['shapeId', 'ptLat', 'ptLon', 'ptSequence', 'distTraveled'],
    })
  })

  app.get('/admin/endpoints/meta/presets', async (_req, reply) => {
    const { PRESET_CATALOG } = await import('../engine/presets.js')
    return reply.send({ presets: PRESET_CATALOG })
  })

  app.post<{
    Body: {
      schema: ResponseSchema
      pathParams?: Record<string, string>
      queryParams?: Record<string, string>
    }
  }>('/admin/endpoints/preview', async (req, reply) => {
    try {
      const { schema, pathParams = {}, queryParams = {} } = req.body
      const result = await resolveEndpoint(schema, pathParams, queryParams)
      return reply.send({ ok: true, result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(400).send({ ok: false, error: msg })
    }
  })
}
