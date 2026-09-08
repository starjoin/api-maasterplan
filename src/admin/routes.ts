import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import {
  ensureSourceDatabase,
  getActiveSource,
  getMetaId,
  prisma,
  setActiveSource,
  withSourcePrisma,
} from '../db.js'
import {
  config,
  DATA_SOURCES,
  getSourceConfig,
  isDataSource,
  type DataSource,
} from '../config.js'
import { runImportInWorker } from '../import-runner.js'
import { getDatasetStats, isImportRunning, syncDataset } from '../gtfs/sync.js'
import { formatBytes, formatEta, getDownloadProgress } from '../import-state.js'
import { fetchRfuInfo, fetchZipMetadata } from '../gtfs/downloader.js'
import { endpointRegistry, reloadEndpoints } from '../engine/index.js'
import { seedDefaultEndpoints } from '../seed.js'
import {
  COMMERCIAL_MODES,
  matchesCommercialKey,
  pictoUrl,
  resolveCommercialMode,
} from '../sae/commercial-modes.js'
import { buildNavitiaLine } from '../sae/line-navitia.js'
import { lineThermometer } from '../sae/handlers.js'
import {
  listVehicleMonitoring,
  vehicleMonitoringGeojson,
  vehicleMonitoringStatus,
} from '../siri/handlers.js'
import { refreshVehicleMonitoring } from '../siri/vehicle-monitoring.js'
import { getStorageStatus, logStorageStatus } from '../storage.js'
import { getExternalIntegrations } from './integrations.js'

function serializeProgress(p: ReturnType<typeof getDownloadProgress>) {
  const now = Date.now()
  return {
    phase: p.phase,
    percent: p.percent,
    phasePercent: p.phasePercent,
    phaseLabel: p.phaseLabel,
    detail: p.detail,
    currentItem: p.currentItem,
    processed: p.processed,
    total: p.total,
    unit: p.unit,
    counters: p.counters,
    recentEvents: p.recentEvents,
    startedAt: p.startedAt || null,
    lastActivityAt: p.lastActivityAt || null,
    heartbeatAt: p.heartbeatAt || null,
    elapsedSeconds: p.startedAt ? Math.max(0, Math.floor((now - p.startedAt) / 1000)) : null,
    secondsSinceActivity: p.lastActivityAt ? Math.max(0, Math.floor((now - p.lastActivityAt) / 1000)) : null,
    secondsSinceHeartbeat: p.heartbeatAt ? Math.max(0, Math.floor((now - p.heartbeatAt) / 1000)) : null,
    workerRssBytes: p.workerRssBytes,
    workerRssLabel: p.workerRssBytes != null ? formatBytes(p.workerRssBytes) : null,
    bytesReceived: p.bytesReceived,
    bytesTotal: p.bytesTotal,
    speedBps: p.speedBps,
    etaSeconds: p.etaSeconds,
    bytesLabel:
      p.bytesTotal != null
        ? `${formatBytes(p.bytesReceived)} / ${formatBytes(p.bytesTotal)}`
        : p.bytesReceived > 0
          ? formatBytes(p.bytesReceived)
          : null,
    speedLabel: p.speedBps != null && p.speedBps > 0 ? `${formatBytes(p.speedBps)}/s` : null,
    etaLabel: formatEta(p.etaSeconds),
  }
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/admin/dashboard', async (_req, reply) => {
    const source = getActiveSource()
    const src = getSourceConfig(source)
    const [stats, meta, recentJobs, endpointCount, integrations] = await Promise.all([
      getDatasetStats(),
      prisma.datasetMeta.findUnique({ where: { id: getMetaId() } }),
      prisma.importJob.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      Promise.resolve(endpointRegistry.count()),
      getExternalIntegrations(),
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
      source: {
        active: source,
        label: src.label,
      },
      rfu: {
        gtfsUrl: src.zipUrl,
        infoUrl: src.infoUrl,
        version: meta?.rfuVersion,
        updatedAt: meta?.rfuUpdatedAt,
      },
      data: stats,
      integrations,
      endpoints: { active: endpointCount },
      jobs: { recent: recentJobs, stats: jobStats },
      importRunning: isImportRunning(),
      downloadProgress: serializeProgress(getDownloadProgress()),
      storage: getStorageStatus(),
      realtime: {
        enabled: config.SIRI_VM_ENABLED,
        pollMs: config.SIRI_VM_POLL_MS,
        url: config.SIRI_VM_URL,
      },
    })
  })
}

export async function sourceRoutes(app: FastifyInstance) {
  app.get('/admin/source', async (_req, reply) => {
    const active = getActiveSource()
    const sources = []

    for (const source of DATA_SOURCES) {
      const cfg = getSourceConfig(source)
      const meta = await withSourcePrisma(source, (client) =>
        client.datasetMeta.findUnique({ where: { id: source } }),
      )
      const counts = await withSourcePrisma(source, async (client) => ({
        routes: await client.route.count(),
        stops: await client.stop.count(),
        trips: await client.trip.count(),
      }))
      sources.push({
        id: source,
        label: cfg.label,
        active: source === active,
        zipUrl: cfg.zipUrl,
        lastImport: meta?.lastImport ?? null,
        rfuVersion: meta?.rfuVersion ?? null,
        counts,
      })
    }

    return reply.send({ active, sources })
  })

  app.post<{ Body: { source?: string } }>('/admin/source', async (req, reply) => {
    const next = req.body?.source
    if (!next || !isDataSource(next)) {
      return reply.status(400).send({ error: 'source invalide (gtfs|netex)' })
    }
    if (isImportRunning()) {
      return reply.status(409).send({ error: 'Impossible de changer de source pendant un import' })
    }

    await ensureSourceDatabase(next)
    await setActiveSource(next)
    await seedDefaultEndpoints(prisma, next)
    await reloadEndpoints(app)

    return reply.send({
      active: getActiveSource(),
      label: getSourceConfig(next).label,
      message: `Source active : ${getSourceConfig(next).label}`,
    })
  })
}

export async function importRoutes(app: FastifyInstance) {
  app.post<{ Querystring: { source?: string } }>('/admin/navitia/trigger', async (req, reply) => {
    if (isImportRunning()) return reply.status(409).send({ error: 'Import déjà en cours' })
    if (!config.NAVITIA_TOKEN) {
      return reply.status(400).send({ error: 'NAVITIA_TOKEN / REACT_APP_NAVITIA_TOKEN absent' })
    }
    if (!req.query.source || !isDataSource(req.query.source)) {
      return reply.status(400).send({ error: 'source invalide (gtfs|netex)' })
    }
    const source = req.query.source
    runImportInWorker(source, 'manual', true, undefined, 'navitia').catch(err => {
      app.log.error(err, `Actualisation Navitia ${source.toUpperCase()} échouée`)
    })
    return reply.status(202).send({
      message: `Actualisation des tracés Navitia lancée pour ${getSourceConfig(source).label}`,
      source,
    })
  })

  app.post<{ Querystring: { force?: string; source?: string } }>(
    '/admin/import/trigger',
    async (req, reply) => {
      if (isImportRunning()) {
        return reply.status(409).send({ error: 'Import déjà en cours' })
      }

      const force = req.query.force === 'true'
      let source: DataSource = getActiveSource()
      if (req.query.source) {
        if (!isDataSource(req.query.source)) return reply.status(400).send({ error: 'source invalide' })
        source = req.query.source
      }

      const label = getSourceConfig(source).label
      // Toujours via syncDataset (worker en prod) pour ne pas figer/tuer le HTTP
      syncDataset('manual', force, source).catch((err) => {
        app.log.error(err, `Import ${label} échoué`)
      })

      return reply.status(202).send({ message: `Import ${label} lancé en arrière-plan`, source })
    },
  )

  app.post<{ Body: { path?: string } }>('/admin/import/netex-local', async (req, reply) => {
    if (isImportRunning()) {
      return reply.status(409).send({ error: 'Import déjà en cours' })
    }
    const dir = req.body?.path
    if (!dir) return reply.status(400).send({ error: 'path requis' })

    const realDir = await fs.realpath(dir).catch(() => null)
    const root = await fs.realpath(config.LOCAL_IMPORT_ROOT).catch(() => path.resolve(config.LOCAL_IMPORT_ROOT))
    if (!realDir || (realDir !== root && !realDir.startsWith(root + path.sep))) return reply.status(400).send({ error: 'Le dossier doit être dans LOCAL_IMPORT_ROOT' })
    runImportInWorker('netex', 'manual', true, realDir).catch((err) => {
      app.log.error(err, 'Import NeTEx local échoué')
    })

    return reply.status(202).send({ message: 'Import NeTEx local lancé', path: dir })
  })

  app.get('/admin/import/status', async (_req, reply) => {
    const jobs = await Promise.all(DATA_SOURCES.map(source => withSourcePrisma(source, client => client.importJob.findFirst({ orderBy: { createdAt: 'desc' } }))))
    const latest = jobs.filter(j => j != null).sort((a, b) => +b!.createdAt - +a!.createdAt)[0] ?? null
    return reply.send({
      running: isImportRunning(),
      latest,
      source: latest?.source ?? getActiveSource(),
      downloadProgress: serializeProgress(getDownloadProgress()),
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
      const source = getActiveSource()
      const [info, meta] = await Promise.all([
        fetchRfuInfo(source),
        fetchZipMetadata(source).catch(() => null),
      ])
      return reply.send({ source, info, gtfsHeaders: meta })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(502).send({ error: msg })
    }
  })
}

function parseStopExtras(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function stopClassification(s: {
  desc: string | null
  extras: string | null
  locationType: number | null
}): string | null {
  const extras = parseStopExtras(s.extras)
  if (Array.isArray(extras?.classifications) && extras!.classifications.length > 0) {
    return String((extras!.classifications as unknown[])[0])
  }
  if (typeof extras?.classification === 'string') return extras.classification
  if (s.desc) return s.desc
  if (extras?.netex_type === 'PointOfInterest') return 'POI'
  return null
}

function enrichStop(s: {
  id: string
  stopId: string
  code: string | null
  name: string
  desc: string | null
  lat: number | null
  lon: number | null
  zoneId: string | null
  url: string | null
  locationType: number | null
  parentStation: string | null
  wheelchairBoarding: number | null
  extras: string | null
}) {
  const extras = parseStopExtras(s.extras)
  const classification = stopClassification(s)
  const classifications = Array.isArray(extras?.classifications)
    ? (extras!.classifications as string[])
    : classification
      ? [classification]
      : []
  return {
    ...s,
    extras,
    classification,
    classifications,
    isPoi: extras?.netex_type === 'PointOfInterest',
    netexType: typeof extras?.netex_type === 'string' ? extras.netex_type : null,
    address: extras?.address ?? null,
    keys: extras?.keys ?? null,
  }
}

function enrichRoute(r: {
  routeId: string
  shortName: string | null
  longName: string | null
  desc: string | null
  type: number
  color: string | null
  textColor: string | null
  url: string | null
  agencyId: string | null
  sortOrder: number | null
  extras?: string | null
}) {
  const commercial = resolveCommercialMode(r)
  let extras: Record<string, unknown> | null = null
  if (r.extras) {
    try {
      extras = JSON.parse(r.extras) as Record<string, unknown>
    } catch {
      extras = null
    }
  }
  const submode =
    typeof extras?.transport_submode === 'string'
      ? extras.transport_submode
      : typeof extras?.transport_mode === 'string'
        ? extras.transport_mode
        : null
  return {
    ...r,
    extras,
    netexSubmode: submode,
    commercialMode: { key: commercial.key, id: commercial.id, name: commercial.name },
    pictoUrl: pictoUrl(r.shortName),
  }
}

export async function exploreRoutes(app: FastifyInstance) {
  app.get('/admin/explore/route-modes', async (_req, reply) => {
    const counts = await prisma.route.groupBy({ by: ['type'], _count: true, orderBy: { type: 'asc' } })
    const labels: Record<number, string> = {
      0: 'Tram',
      1: 'Métro',
      2: 'Train',
      3: 'Bus',
      4: 'Navigône',
      5: 'Téléphérique',
      6: 'Téléphérique',
      7: 'Funiculaire',
      11: 'Chrono',
      12: 'Monorail',
      200: 'Cars région',
    }
    return reply.send({
      modes: counts.map((c) => ({
        type: c.type,
        label: labels[c.type] ?? `Type ${c.type}`,
        count: c._count,
      })),
    })
  })

  app.get('/admin/explore/commercial-modes', async (req, reply) => {
    const q = req.query as { type?: string }
    const physicalType =
      q.type !== undefined && q.type !== '' ? parseInt(q.type, 10) : null

    const where =
      physicalType !== null && !Number.isNaN(physicalType) ? { type: physicalType } : {}

    const routes = await prisma.route.findMany({
      where,
      select: { shortName: true, longName: true, type: true },
    })

    const counts = new Map<string, number>()
    for (const r of routes) {
      const m = resolveCommercialMode(r)
      counts.set(m.key, (counts.get(m.key) ?? 0) + 1)
    }

    const modes = COMMERCIAL_MODES.filter((m) => (counts.get(m.key) ?? 0) > 0)
      .filter((m) => {
        if (physicalType === null) return true
        // Afficher aussi si le type physique matche le mode, ou s’il y a des lignes
        return m.physicalTypes.includes(physicalType) || (counts.get(m.key) ?? 0) > 0
      })
      .map((m) => ({
        key: m.key,
        id: m.id,
        name: m.name,
        count: counts.get(m.key) ?? 0,
        physicalTypes: m.physicalTypes,
      }))
      .sort((a, b) => b.count - a.count)

    return reply.send({ modes, total: routes.length })
  })

  app.get('/admin/explore/routes', async (req, reply) => {
    const q = req.query as {
      q?: string
      limit?: string
      offset?: string
      type?: string
      commercial?: string
    }
    const limit = Math.min(parseInt(q.limit ?? '50', 10), 200)
    const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0)
    const commercial = q.commercial?.trim() || null

    const where: Record<string, unknown> = {}
    if (q.type !== undefined && q.type !== '') where.type = parseInt(q.type, 10)
    if (q.q) {
      where.OR = [
        { shortName: { contains: q.q } },
        { longName: { contains: q.q } },
        { routeId: { contains: q.q } },
      ]
    }

    // Filtre commercial = classification en mémoire (~800 lignes)
    if (commercial) {
      const all = await prisma.route.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { shortName: 'asc' }],
      })
      const filtered = all.filter((r) => matchesCommercialKey(r, commercial))
      const pageItems = filtered.slice(offset, offset + limit).map(enrichRoute)
      const total = filtered.length
      return reply.send({
        items: pageItems,
        total,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        pages: Math.max(Math.ceil(total / limit), 1),
      })
    }

    const [items, total] = await Promise.all([
      prisma.route.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ sortOrder: 'asc' }, { shortName: 'asc' }],
      }),
      prisma.route.count({ where }),
    ])

    return reply.send({
      items: items.map(enrichRoute),
      total,
      limit,
      offset,
      page: Math.floor(offset / limit) + 1,
      pages: Math.max(Math.ceil(total / limit), 1),
    })
  })

  app.get<{ Params: { id: string } }>('/admin/explore/routes/:id', async (req, reply) => {
    const id = decodeURIComponent(req.params.id)
    const route =
      (await prisma.route.findUnique({ where: { routeId: id } })) ??
      (await prisma.route.findFirst({
        where: {
          OR: [{ routeId: id }, { shortName: id }, { routeId: id.replace(/^line:/, '') }],
        },
      }))

    if (!route) return reply.status(404).send({ error: 'Ligne introuvable' })

    const [line, thermometer] = await Promise.all([
      buildNavitiaLine(route, { includeGeojson: true }),
      lineThermometer(route.routeId, {}),
    ])

    return reply.send({
      route: enrichRoute(route),
      line,
      thermometer,
      pictoUrl: pictoUrl(route.shortName),
    })
  })

  app.get('/admin/explore/stop-types', async (_req, reply) => {
    const counts = await prisma.stop.groupBy({
      by: ['locationType'],
      _count: true,
      orderBy: { locationType: 'asc' },
    })
    const labels: Record<number, string> = {
      0: 'Arrêt (stop_point)',
      1: 'Zone d’arrêts (stop_area)',
      2: 'Entrée / sortie',
      3: getActiveSource() === 'netex' ? 'POI' : 'Nœud de circulation',
      4: 'Zone d’embarquement',
    }
    return reply.send({
      types: counts.map((c) => ({
        locationType: c.locationType ?? -1,
        label: c.locationType == null ? 'Non renseigné' : (labels[c.locationType] ?? `Type ${c.locationType}`),
        count: c._count,
      })),
    })
  })

  app.get('/admin/explore/poi-categories', async (_req, reply) => {
    const counts = await prisma.stop.groupBy({ by: ['classification'], where: { isPoi: true }, _count: true })
    const categories = counts.map(c => ({ key: c.classification ?? 'Autre POI', name: c.classification ?? 'Autre POI', count: c._count })).sort((a, b) => b.count - a.count)
    return reply.send({ categories, total: categories.reduce((n, c) => n + c.count, 0) })
  })

  app.get('/admin/explore/stops', async (req, reply) => {
    const q = req.query as {
      q?: string
      limit?: string
      offset?: string
      location_type?: string
      classification?: string
      poi_only?: string
    }
    const limit = Math.min(parseInt(q.limit ?? '50', 10), 200)
    const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0)
    const classification = q.classification?.trim() || null
    const poiOnly = q.poi_only === 'true'

    const where: Record<string, unknown> = {}
    if (poiOnly) where.isPoi = true
    if (q.location_type !== undefined && q.location_type !== '') {
      const lt = parseInt(q.location_type, 10)
      if (lt === -1) where.locationType = null
      else if (!Number.isNaN(lt)) where.locationType = lt
    }
    if (q.q) {
      where.OR = [
        { name: { contains: q.q } },
        { stopId: { contains: q.q } },
        { code: { contains: q.q } },
        { desc: { contains: q.q } },
      ]
    }

    if (classification) { where.isPoi = true; where.classification = classification === 'Autre POI' ? null : classification }

    const [items, total] = await Promise.all([
      prisma.stop.findMany({ where, take: limit, skip: offset, orderBy: { name: 'asc' } }),
      prisma.stop.count({ where }),
    ])

    return reply.send({
      items: items.map(enrichStop),
      total,
      limit,
      offset,
      page: Math.floor(offset / limit) + 1,
      pages: Math.max(Math.ceil(total / limit), 1),
    })
  })

  app.get<{ Params: { id: string } }>('/admin/explore/stops/:id', async (req, reply) => {
    const id = decodeURIComponent(req.params.id)
    const stop =
      (await prisma.stop.findUnique({ where: { stopId: id } })) ??
      (await prisma.stop.findFirst({
        where: { OR: [{ stopId: id }, { code: id }] },
      }))
    if (!stop) return reply.status(404).send({ error: 'Arrêt / POI introuvable' })

    const enriched = enrichStop(stop)
    let fareZone = null
    if (stop.zoneId) {
      fareZone = await prisma.fareZone.findUnique({ where: { zoneId: stop.zoneId } })
    }

    // Lignes desservant cet arrêt (si stop_point/quay)
    let lines: ReturnType<typeof enrichRoute>[] = []
    if (!stop.isPoi) {
      const routeIds = await prisma.$queryRaw<{ routeId: string }[]>`SELECT DISTINCT t.routeId FROM Trip t JOIN StopTime st ON st.tripId=t.tripId WHERE st.stopId=${stop.stopId}`
      const routes = await prisma.route.findMany({ where: { routeId: { in: routeIds.map(r => r.routeId) } }, orderBy: { shortName: 'asc' } })
      lines = routes.map(enrichRoute)
    }

    return reply.send({
      stop: enriched,
      fareZone: fareZone
        ? {
            id: fareZone.zoneId,
            name: fareZone.name,
            extras: fareZone.extras ? JSON.parse(fareZone.extras) : null,
          }
        : null,
      lines,
    })
  })
}

export async function realtimeRoutes(app: FastifyInstance) {
  app.get('/admin/realtime/status', async (_req, reply) => {
    return reply.send(vehicleMonitoringStatus())
  })

  app.post('/admin/realtime/refresh', async (_req, reply) => {
    await refreshVehicleMonitoring(app.log)
    return reply.send(vehicleMonitoringStatus())
  })

  app.get('/admin/explore/vehicles', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>
    const result = listVehicleMonitoring(q)
    return reply.send({
      items: result.vehicle_monitoring,
      total: result.pagination.total,
      limit: result.pagination.limit,
      offset: result.pagination.offset,
      page: Math.floor(result.pagination.offset / result.pagination.limit) + 1,
      pages: Math.max(Math.ceil(result.pagination.total / result.pagination.limit), 1),
      realtime: result.realtime,
    })
  })

  app.get('/admin/explore/vehicles/geojson', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>
    return reply.send(vehicleMonitoringGeojson(q))
  })
}
