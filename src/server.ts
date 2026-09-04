import Fastify from 'fastify'
import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import path from 'node:path'
import { config } from './config.js'
import { endpointsRoutes } from './admin/endpoints.js'
import {
  dashboardRoutes,
  exploreRoutes,
  importRoutes,
  realtimeRoutes,
  sourceRoutes,
} from './admin/routes.js'
import { docsRoutes } from './docs/routes.js'
import { registerDynamicApiHandler } from './engine/index.js'
import { getStorageStatus } from './storage.js'

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
  await app.register(sourceRoutes)
  await app.register(importRoutes)
  await app.register(exploreRoutes)
  await app.register(realtimeRoutes)
  await app.register(endpointsRoutes)
  await app.register(docsRoutes)

  // Un seul moteur : tout ce qui est actif dans l’API Designer
  await registerDynamicApiHandler(app)

  app.get('/health', async () => {
    const storage = getStorageStatus()
    return {
      status: 'ok',
      service: 'api-maasterplan',
      ts: new Date().toISOString(),
      storage: {
        volumeMounted: storage.volumeMounted,
        warning: storage.warning,
      },
    }
  })

  return app
}
