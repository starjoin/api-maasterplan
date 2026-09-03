import { prisma } from '../db.js'
import type { ResponseSchema, FieldMapping, GtfsEntity } from './types.js'
import { resolvePreset } from './presets.js'

type AnyRecord = Record<string, unknown>

const ENTITY_MAP: Record<GtfsEntity, keyof typeof prisma> = {
  Agency: 'agency',
  Stop: 'stop',
  Route: 'route',
  Trip: 'trip',
  StopTime: 'stopTime',
  Calendar: 'calendar',
  CalendarDate: 'calendarDate',
  Shape: 'shape',
}

export async function resolveEndpoint(
  schema: ResponseSchema,
  pathParams: AnyRecord,
  queryParams: AnyRecord,
): Promise<unknown> {
  // ── Preset SAE piloté par le Designer ─────────────────────────────────────
  if (schema.preset) {
    return resolvePreset(schema, pathParams, queryParams)
  }

  const where = buildWhere(schema, pathParams, queryParams)
  const select = schema.fields.length > 0 ? buildSelect(schema.fields) : undefined
  const orderBy = schema.orderBy ? { [schema.orderBy.field]: schema.orderBy.direction } : undefined
  const delegate = prisma[ENTITY_MAP[schema.entity]] as AnyRecord

  let rows: AnyRecord[]

  if (schema.multiple) {
    const limit = queryParams.limit ? Math.min(parseInt(String(queryParams.limit), 10), 500) : 100
    const offset = queryParams.offset ? parseInt(String(queryParams.offset), 10) : 0

    const findManyArgs: AnyRecord = { where, orderBy }
    if (select) findManyArgs.select = select
    if (schema.paginate) {
      findManyArgs.take = limit
      findManyArgs.skip = offset
    }

    rows = (await (delegate.findMany as Function)(findManyArgs)) as AnyRecord[]
  } else {
    const findArgs: AnyRecord = { where, orderBy }
    if (select) findArgs.select = select
    const row = (await (delegate.findFirst as Function)(findArgs)) as AnyRecord | null
    if (!row) return null
    rows = [row]
  }

  const mapped =
    schema.fields.length > 0 ? rows.map((row) => applyFieldMappings(row, schema.fields)) : rows

  if (schema.relations?.length) {
    for (const rel of schema.relations) {
      const relDelegate = prisma[ENTITY_MAP[rel.entity]] as AnyRecord
      const relSelect = rel.fields.length > 0 ? buildSelect(rel.fields) : undefined

      for (let i = 0; i < mapped.length; i++) {
        const parentValue = rows[i]?.[rel.parentField]
        if (!parentValue) {
          ;(mapped[i] as AnyRecord)[rel.output] = null
          continue
        }

        const findArgs: AnyRecord = { where: { [rel.foreignField]: parentValue } }
        if (relSelect) findArgs.select = relSelect

        const relRow = (await (relDelegate.findFirst as Function)(findArgs)) as AnyRecord | null
        ;(mapped[i] as AnyRecord)[rel.output] = relRow
          ? rel.fields.length > 0
            ? applyFieldMappings(relRow, rel.fields)
            : relRow
          : null
      }
    }
  }

  if (!schema.multiple) return mapped[0] ?? null

  if (schema.paginate) {
    const total = (await (delegate.count as Function)({ where })) as number
    const limit = queryParams.limit ? Math.min(parseInt(String(queryParams.limit), 10), 500) : 100
    const offset = queryParams.offset ? parseInt(String(queryParams.offset), 10) : 0
    return {
      data: mapped,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    }
  }

  return mapped
}

function buildWhere(schema: ResponseSchema, pathParams: AnyRecord, queryParams: AnyRecord): AnyRecord {
  const where: AnyRecord = {}

  for (const filter of schema.filters) {
    let value: unknown

    if (filter.source === 'path') {
      value = pathParams[filter.key]
    } else if (filter.source === 'query') {
      value = queryParams[filter.key]
    } else {
      value = filter.key
    }

    if (value === undefined || value === null || value === '') continue

    const op = filter.operator ?? 'eq'
    if (op === 'eq') {
      where[filter.field] = isNumericField(filter.field) ? Number(value) : value
    } else {
      where[filter.field] = { [op]: String(value) }
    }
  }

  return where
}

function isNumericField(field: string): boolean {
  return ['type', 'locationType', 'directionId', 'stopSequence', 'exceptionType', 'sortOrder'].includes(field)
}

function buildSelect(fields: FieldMapping[]): AnyRecord {
  const select: AnyRecord = {}
  for (const f of fields) select[f.db] = true
  return select
}

function applyFieldMappings(row: AnyRecord, fields: FieldMapping[]): AnyRecord {
  const out: AnyRecord = {}
  for (const f of fields) out[f.output] = row[f.db] ?? null
  return out
}
