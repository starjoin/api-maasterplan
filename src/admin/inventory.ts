import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { DATA_SOURCES, getSourceConfig, isDataSource, type DataSource } from '../config.js'
import { getDatasetPath, withSourcePrisma } from '../db.js'

const features = [
  ['Opérateurs', 'agency.txt', 'Operator'], ['Arrêts / quais', 'stops.txt', 'Quay'],
  ['Zones d’arrêts', 'stops.txt', 'StopPlace'], ['Points d’intérêt', '', 'PointOfInterest'],
  ['Lignes', 'routes.txt', 'Line'], ['Courses', 'trips.txt', 'ServiceJourney'],
  ['Horaires', 'stop_times.txt', 'TimetabledPassingTime'], ['Calendriers', 'calendar.txt', 'DayType'],
  ['Exceptions / affectations de jours', 'calendar_dates.txt', 'DayTypeAssignment'],
  ['Tracés', 'shapes.txt', 'ServiceLink'], ['Tarifs historiques', 'fare_attributes.txt', 'FareTable'],
  ['Produits tarifaires', 'fare_products.txt', 'PreassignedFareProduct'], ['Correspondances', 'transfers.txt', 'SiteConnection'],
  ['Cheminements', 'pathways.txt', 'PathLink'], ['Accessibilité', 'stops.txt', 'AccessibilityAssessment'],
] as const
function parseSource(value: unknown): DataSource {
  if (typeof value !== 'string' || !isDataSource(value)) throw Object.assign(new Error('source requise : gtfs ou netex'), { statusCode: 400 })
  return value
}
export async function inventoryRoutes(app: FastifyInstance) {
  app.get('/admin/compare', async () => {
    const sources = await Promise.all(DATA_SOURCES.map(source => withSourcePrisma(source, async client => {
      const meta = await client.datasetMeta.findUnique({ where: { id: source } })
      const kinds = await client.sourceKind.findMany({ orderBy: { kind: 'asc' } })
      const files = await client.sourceFile.findMany({ orderBy: { name: 'asc' } })
      return { source, url: getSourceConfig(source).zipUrl, lastImport: meta?.lastImport, version: meta?.rfuVersion,
        stats: JSON.parse(meta?.stats ?? '{}'), kinds: kinds.map(k => ({ ...k, fields: JSON.parse(k.fields) })),
        files: files.map(f => ({ ...f, bytes: Number(f.bytes), fields: undefined })) }
    })))
    return { sources, features: features.map(([label, gtfs, netex]) => ({ label, gtfs, netex })),
      note: 'La comparaison porte sur les publications chargées, dont les périmètres et dates peuvent différer. Une absence dans ce jeu ne signifie pas que le format ne sait pas représenter cette information. Les familles rapprochées ne sont pas des équivalences de comptage.' }
  })
  app.get<{ Querystring: { source: string; kind?: string; after?: string; entityId?: string } }>('/admin/inventory/records', async req => {
    const source = parseSource(req.query.source)
    if (!req.query.kind) throw Object.assign(new Error('kind requis'), { statusCode: 400 })
    const after = Number(req.query.after ?? 0)
    if (!Number.isSafeInteger(after) || after < 0) throw Object.assign(new Error('Curseur invalide'), { statusCode: 400 })
    return withSourcePrisma(source, async client => {
      // SQL truncation: listing never deserializes whole large XML entities in the HTTP process.
      const rows = req.query.entityId
        ? await client.$queryRaw<{ id: number; file: string; entityId: string | null; preview: string }[]>`SELECT id,file,entityId,substr(data,1,500) AS preview FROM SourceRecord WHERE kind=${req.query.kind!} AND entityId=${req.query.entityId} AND id>${after} ORDER BY id LIMIT 26`
        : await client.$queryRaw<{ id: number; file: string; entityId: string | null; preview: string }[]>`SELECT id,file,entityId,substr(data,1,500) AS preview FROM SourceRecord WHERE kind=${req.query.kind!} AND id>${after} ORDER BY id LIMIT 26`
      return { items: rows.slice(0, 25), next: rows.length > 25 ? rows[24].id : null }
    })
  })
  app.get<{ Params: { id: string }; Querystring: { source: string } }>('/admin/inventory/records/:id', async (req, reply) => {
    return withSourcePrisma(parseSource(req.query.source), async client => {
      const id = Number(req.params.id)
      if (!Number.isSafeInteger(id) || id < 1) return reply.status(400).send({ error: 'Identifiant invalide' })
      const record = await client.sourceRecord.findUnique({ where: { id } })
      if (!record) return reply.status(404).send({ error: 'Entité introuvable' })
      return { ...record, data: JSON.parse(record.data) }
    })
  })
  app.get<{ Querystring: { source: string; name: string } }>('/admin/inventory/file', async (req, reply) => {
    return withSourcePrisma(parseSource(req.query.source), async client => {
      const file = await client.sourceFile.findUnique({ where: { name: req.query.name ?? '' } })
      if (!file) return reply.status(404).send({ error: 'Fichier introuvable' })
      const root = path.join(path.dirname(getDatasetPath()), 'sources')
      const target = path.resolve(root, file.name)
      if (!target.startsWith(root + path.sep)) return reply.status(400).send({ error: 'Chemin invalide' })
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file.name))}`)
      reply.type('application/octet-stream')
      return reply.send(fs.createReadStream(target))
    })
  })
}
