import type { FastifyInstance, FastifyRequest } from 'fastify'
import { buildOpenApiDocument, renderDocsHtml } from './build-openapi.js'

function resolveBaseUrl(req: FastifyRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000'
  return `${proto}://${host}`
}

export async function docsRoutes(app: FastifyInstance) {
  app.get('/openapi.json', async (req, reply) => {
    const { document } = await buildOpenApiDocument(resolveBaseUrl(req))
    return reply
      .header('Cache-Control', 'no-store')
      .header('Access-Control-Allow-Origin', '*')
      .send(document)
  })

  app.get('/docs/catalog', async (req, reply) => {
    const { catalog, document } = await buildOpenApiDocument(resolveBaseUrl(req))
    return reply.header('Cache-Control', 'no-store').send({
      generated_at: document['x-generated-at'],
      info: {
        title: document.info.title,
        version: document.info.version,
        description: 'Catalogue enrichi pour l’UI admin — synchronisé avec le Designer.',
      },
      groups: [...new Set(catalog.map((c) => c.group))],
      endpoints: catalog,
    })
  })

  app.get('/docs', async (req, reply) => {
    const html = renderDocsHtml(resolveBaseUrl(req))
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html)
  })

  app.log.info('[Docs] OpenAPI dynamique : /openapi.json · UI : /docs')
}
