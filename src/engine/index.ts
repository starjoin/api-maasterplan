import type { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'
import { resolveEndpoint } from './resolver.js'
import type { ResponseSchema } from './types.js'

export interface ResolvedEndpoint {
  endpoint: {
    id: string
    path: string
    method: string
    responseSchema: string
  }
  params: Record<string, string>
}

export class EndpointRegistry {
  private routes: Array<{
    id: string
    path: string
    method: string
    responseSchema: string
    segments: string[]
  }> = []

  async reload() {
    const endpoints = await prisma.apiEndpoint.findMany({
      where: { isActive: true },
      select: { id: true, path: true, method: true, responseSchema: true },
    })

    this.routes = endpoints.map((ep) => ({
      ...ep,
      segments: ep.path.split('/').filter(Boolean),
    }))
  }

  resolve(method: string, urlPath: string): ResolvedEndpoint | null {
    const clean = urlPath.replace(/^\/api/, '').split('?')[0] || '/'
    const actualSegments = clean.split('/').filter(Boolean)

    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue
      if (route.segments.length !== actualSegments.length) continue

      const params: Record<string, string> = {}
      let match = true

      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i]
        const actual = actualSegments[i]

        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(actual)
        } else if (seg !== actual) {
          match = false
          break
        }
      }

      if (match) {
        return { endpoint: route, params }
      }
    }

    return null
  }

  count() {
    return this.routes.length
  }
}

export const endpointRegistry = new EndpointRegistry()

export async function registerDynamicApiHandler(app: FastifyInstance) {
  await endpointRegistry.reload()

  const handler = async (request: { method: string; url: string; query: unknown; log: { error: (err: unknown) => void } }, reply: { status: (code: number) => { send: (body: unknown) => unknown }; send: (body: unknown) => unknown }) => {
    const resolved = endpointRegistry.resolve(request.method, request.url)

    if (!resolved) {
      return reply.status(404).send({ error: 'Endpoint non trouvé' })
    }

    try {
      const schema = JSON.parse(resolved.endpoint.responseSchema) as ResponseSchema
      const result = await resolveEndpoint(
        schema,
        resolved.params,
        request.query as Record<string, unknown>,
      )

      if (result === null) {
        return reply.status(404).send({ error: 'Ressource non trouvée' })
      }

      return reply.send(result)
    } catch (err) {
      request.log.error(err)
      return reply.status(500).send({ error: 'Erreur interne' })
    }
  }

  app.get('/api/*', handler as never)
  app.post('/api/*', handler as never)

  app.log.info(`[Engine] ${endpointRegistry.count()} endpoint(s) dynamique(s) chargé(s)`)
}

export async function reloadEndpoints(app: FastifyInstance) {
  await endpointRegistry.reload()
  app.log.info(`[Engine] ${endpointRegistry.count()} endpoint(s) rechargé(s)`)
}
