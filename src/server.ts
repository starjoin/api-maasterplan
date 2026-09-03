import Fastify from 'fastify'
import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import path from 'node:path'
import { config } from './config.js'
import { endpointsRoutes } from './admin/endpoints.js'
import { dashboardRoutes, exploreRoutes, importRoutes } from './admin/routes.js'
import { saeRoutes } from './sae/routes.js'
import { docsRoutes } from './docs/routes.js'
import { registerDynamicApiHandler } from './engine/index.js'

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'development' ? 'info' : 'warn',
    },
  })

  await app.register(cors, {
    origin: config.NODE_ENV === 'development' ? true : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  const clientDist = path.join(process.cwd(), 'client', 'dist')
  try {
    await app.register(staticFiles, {
      root: clientDist,
      prefix: '/',
    })

    app.setNotFoundHandler(async (req, reply) => {
      if (
        !req.url.startsWith('/admin') &&
        !req.url.startsWith('/api') &&
        !req.url.startsWith('/health') &&
        !req.url.startsWith('/docs') &&
        !req.url.startsWith('/openapi')
      ) {
        return reply.sendFile('index.html')
      }
      return reply.status(404).send({ error: 'Not found' })
    })
  } catch {
    // Client dist pas encore buildé
  }

  await app.register(dashboardRoutes)
  await app.register(importRoutes)
  await app.register(exploreRoutes)
  await app.register(endpointsRoutes)
  await app.register(docsRoutes)

  // SAE natif (Navitia-like) AVANT le catch-all dynamique
  await app.register(saeRoutes)
  await registerDynamicApiHandler(app)

  app.get('/health', async () => ({
    status: 'ok',
    service: 'api-maasterplan',
    ts: new Date().toISOString(),
  }))

  return app
}
