import type { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'
import { config } from '../config.js'
import { getDatasetStats, isImportRunning, syncGtfs } from '../gtfs/sync.js'
import { fetchRfuInfo, fetchGtfsMetadata } from '../gtfs/downloader.js'
import { endpointRegistry } from '../engine/index.js'

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/admin/dashboard', async (_req, reply) => {
    const [stats, meta, recentJobs, endpointCount] = await Promise.all([
      getDatasetStats(),
      prisma.datasetMeta.findUnique({ where: { id: 'default' } }),
      prisma.importJob.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      Promise.resolve(endpointRegistry.count()),
    ])

    const jobs = await prisma.importJob.groupBy({
      by: ['status'],
      _count: true,
    })

    const jobStats = {
      completed: jobs.find((j) => j.status === 'COMPLETED')?._count ?? 0,
      failed: jobs.find((j) => j.status === 'FAILED')?._count ?? 0,
      skipped: jobs.find((j) => j.status === 'SKIPPED')?._count ?? 0,
      running: isImportRunning() ? 1 : 0,
    }

    return reply.send({
      rfu: {
        gtfsUrl: config.RFU_GTFS_URL,
        infoUrl: config.RFU_GTFS_INFO_URL,
        version: meta?.rfuVersion,
        updatedAt: meta?.rfuUpdatedAt,
      },
      data: stats,
      endpoints: { active: endpointCount },
      jobs: { recent: recentJobs, stats: jobStats },
      importRunning: isImportRunning(),
    })
  })
}

export async function importRoutes(app: FastifyInstance) {
  app.post<{ Querystring: { force?: string } }>('/admin/import/trigger', async (req, reply) => {
    if (isImportRunning()) {
      return reply.status(409).send({ error: 'Import déjà en cours' })
    }

    const force = req.query.force === 'true'

    syncGtfs('manual', force).catch((err) => {
      app.log.error(err, 'Import GTFS échoué')
    })

    return reply.status(202).send({ message: 'Import lancé en arrière-plan' })
  })

  app.get('/admin/import/status', async (_req, reply) => {
    const latest = await prisma.importJob.findFirst({ orderBy: { createdAt: 'desc' } })
    return reply.send({
      running: isImportRunning(),
      latest,
    })
  })

  app.get('/admin/import/jobs', async (req, reply) => {
    const limit = Math.min(parseInt(String((req.query as { limit?: string }).limit ?? '20'), 10), 100)
    const jobs = await prisma.importJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return reply.send(jobs)
  })

  app.get<{ Params: { id: string } }>('/admin/import/jobs/:id', async (req, reply) => {
    const job = await prisma.importJob.findUnique({ where: { id: req.params.id } })
    if (!job) return reply.status(404).send({ error: 'Job introuvable' })
    return reply.send({
      ...job,
      logs: JSON.parse(job.logs),
    })
  })

  app.get('/admin/rfu/info', async (_req, reply) => {
    try {
      const [info, meta] = await Promise.all([
        fetchRfuInfo(),
        fetchGtfsMetadata().catch(() => null),
      ])
      return reply.send({ info, gtfsHeaders: meta })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(502).send({ error: msg })
    }
  })
}

export async function exploreRoutes(app: FastifyInstance) {
  app.get('/admin/explore/routes', async (req, reply) => {
    const q = req.query as { q?: string; limit?: string; offset?: string; type?: string }
    const limit = Math.min(parseInt(q.limit ?? '50', 10), 200)
    const offset = parseInt(q.offset ?? '0', 10)

    const where: Record<string, unknown> = {}
    if (q.type) where.type = parseInt(q.type, 10)
    if (q.q) {
      where.OR = [
        { shortName: { contains: q.q } },
        { longName: { contains: q.q } },
        { routeId: { contains: q.q } },
      ]
    }

    const [items, total] = await Promise.all([
      prisma.route.findMany({ where, take: limit, skip: offset, orderBy: { sortOrder: 'asc' } }),
      prisma.route.count({ where }),
    ])

    return reply.send({ items, total, limit, offset })
  })

  app.get('/admin/explore/stops', async (req, reply) => {
    const q = req.query as { q?: string; limit?: string; offset?: string }
    const limit = Math.min(parseInt(q.limit ?? '50', 10), 200)
    const offset = parseInt(q.offset ?? '0', 10)

    const where = q.q
      ? { OR: [{ name: { contains: q.q } }, { stopId: { contains: q.q } }] }
      : {}

    const [items, total] = await Promise.all([
      prisma.stop.findMany({ where, take: limit, skip: offset, orderBy: { name: 'asc' } }),
      prisma.stop.count({ where }),
    ])

    return reply.send({ items, total, limit, offset })
  })
}
