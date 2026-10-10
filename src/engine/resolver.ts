import { prisma, getActiveSource, withSourcePrisma } from '../db.js'
import type { DataSource } from '../config.js'
import type { ResponseSchema, FieldMapping, FilterDef, RelationDef, EndpointSource } from './types.js'
import { resolvePreset } from './presets.js'
import {
  ENTITY_DELEGATES,
  JSON_COLUMNS,
  ParamError,
  coerce,
  columnType,
  entityColumns,
  readPath,
  writePath,
} from './model.js'

type AnyRecord = Record<string, unknown>

/** Paramètre déclaré dans le Designer (ApiParam). */
export interface DeclaredParam {
  name: string
  type: string
  location: string
  required: boolean
  defaultValue?: string | null
}

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

/**
 * Point d'entrée du moteur.
 * `declared` = paramètres de l'endpoint : seuls ceux-là sont lus, avec leurs valeurs
 * par défaut et leur caractère obligatoire. Un paramètre non déclaré est ignoré.
 */
export async function resolveEndpoint(
  schema: ResponseSchema,
  pathParams: AnyRecord,
  queryParams: AnyRecord,
  declared: DeclaredParam[],
): Promise<unknown> {
  const input = collectInput(declared, pathParams, queryParams)
  return inSource(schema.source, () =>
    schema.preset ? resolvePreset(schema, input) : resolveDeclarative(schema, input),
  )
}

export function collectInput(declared: DeclaredParam[], pathParams: AnyRecord, queryParams: AnyRecord) {
  const input: Record<string, string> = {}
  for (const p of declared) {
    const raw = p.location === 'path' ? pathParams[p.name] : queryParams[p.name]
    let value = raw === undefined || raw === null || raw === '' ? undefined : String(raw)
    if (value === undefined && p.defaultValue != null && p.defaultValue !== '') value = p.defaultValue
    if (value === undefined) {
      if (p.required) throw new ParamError(`Paramètre obligatoire manquant : ${p.name}`)
      continue
    }
    if (p.type === 'number' && Number.isNaN(Number(value))) {
      throw new ParamError(`Le paramètre ${p.name} doit être un nombre`)
    }
    if (p.type === 'boolean' && !['true', 'false', '1', '0'].includes(value)) {
      throw new ParamError(`Le paramètre ${p.name} doit valoir true ou false`)
    }
    input[p.name] = value
  }
  return input
}

/** Exécute `fn` sur la base demandée ; `active`/absent = base de la requête en cours. */
function inSource<T>(source: EndpointSource | undefined, fn: () => Promise<T>): Promise<T> {
  if (!source || source === 'active' || source === getActiveSource()) return fn()
  return withSourcePrisma(source as DataSource, () => fn())
}

function delegate(entity: string) {
  const name = ENTITY_DELEGATES[entity as keyof typeof ENTITY_DELEGATES]
  if (!name) throw new ParamError(`Entité inconnue : ${entity}`)
  return (prisma as unknown as Record<string, Record<string, Function>>)[name]
}

function pagination(input: Record<string, string>) {
  const limit = Math.max(1, Math.min(parseInt(input.limit ?? '', 10) || DEFAULT_LIMIT, MAX_LIMIT))
  const offset = Math.max(0, parseInt(input.offset ?? '', 10) || 0)
  return { limit, offset }
}

async function resolveDeclarative(schema: ResponseSchema, input: Record<string, string>): Promise<unknown> {
  const where = buildWhere(schema.entity, schema.filters, input)
  const relations = schema.relations ?? []
  const select = buildSelect(schema.entity, schema.fields, relations.map((r) => r.parentField))
  const orderBy = schema.orderBy ? { [schema.orderBy.field]: schema.orderBy.direction } : undefined
  const model = delegate(schema.entity)
  const { limit, offset } = pagination(input)

  const rows = (schema.multiple
    ? await model.findMany({ where, orderBy, select, take: limit, skip: offset })
    : [await model.findFirst({ where, orderBy, select })].filter(Boolean)) as AnyRecord[]
  if (!schema.multiple && rows.length === 0) return null

  const mapped = rows.map((row) => project(row, schema.fields))
  for (const rel of relations) await attachRelation(rel, schema.source, rows, mapped)

  if (!schema.multiple) return mapped[0]
  if (!schema.paginate) return mapped
  const total = (await model.count({ where })) as number
  return { data: mapped, pagination: { total, limit, offset, hasMore: offset + limit < total } }
}

/** Charge une relation en une requête par endpoint (pas une par ligne). */
async function attachRelation(
  rel: RelationDef,
  parentSource: EndpointSource | undefined,
  rows: AnyRecord[],
  mapped: AnyRecord[],
) {
  const values = [...new Set(rows.map((r) => r[rel.parentField]).filter((v) => v !== null && v !== undefined))]
  const source = rel.source && rel.source !== 'active' ? rel.source : parentSource
  const related = values.length
    ? await inSource(source, async () =>
        (await delegate(rel.entity).findMany({
          where: { [rel.foreignField]: { in: values } },
          select: buildSelect(rel.entity, rel.fields, [rel.foreignField]),
          orderBy: rel.orderBy ? { [rel.orderBy.field]: rel.orderBy.direction } : undefined,
        })) as AnyRecord[],
      )
    : []

  const groups = new Map<unknown, AnyRecord[]>()
  for (const row of related) {
    const key = row[rel.foreignField]
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  const cap = Math.max(1, Math.min(rel.limit ?? 100, 1000))
  rows.forEach((row, i) => {
    const group = groups.get(row[rel.parentField]) ?? []
    const items = group.map((r) => project(r, rel.fields))
    writePath(mapped[i], rel.output, rel.multiple ? items.slice(0, cap) : (items[0] ?? null))
  })
}

function buildWhere(entity: ResponseSchema['entity'], filters: FilterDef[], input: Record<string, string>): AnyRecord {
  const where: AnyRecord = {}
  for (const filter of filters) {
    if (!columnType(entity, filter.field) || JSON_COLUMNS.has(filter.field)) {
      throw new ParamError(`Filtre impossible sur ${entity}.${filter.field}`)
    }
    const value = filter.source === 'static' ? filter.key : input[filter.key]
    if (value === undefined || value === '') continue

    const op = filter.operator ?? 'eq'
    if (op === 'eq') where[filter.field] = coerce(entity, filter.field, value)
    else if (op === 'in') {
      where[filter.field] = { in: String(value).split(',').map((v) => coerce(entity, filter.field, v.trim())) }
    } else if (op === 'gte' || op === 'lte') {
      where[filter.field] = { ...(where[filter.field] as AnyRecord), [op]: coerce(entity, filter.field, value) }
    } else where[filter.field] = { [op]: String(value) }
  }
  return where
}

/** Ne lit que les colonnes utiles ; sans champ déclaré, toutes les colonnes publiques. */
function buildSelect(entity: ResponseSchema['entity'], fields: FieldMapping[], extra: string[]): AnyRecord {
  const select: AnyRecord = {}
  const roots = fields.length ? fields.map((f) => f.db.split('.')[0]) : publicColumns(entity)
  for (const column of [...roots, ...extra]) {
    if (!columnType(entity, column)) throw new ParamError(`Champ inconnu : ${entity}.${column}`)
    select[column] = true
  }
  return select
}

function publicColumns(entity: ResponseSchema['entity']) {
  return entityColumns(entity).map((c) => c.name)
}

/** Projette une ligne : sans mapping, toutes les colonnes (JSON décodé). */
export function project(row: AnyRecord, fields: FieldMapping[]): AnyRecord {
  const out: AnyRecord = {}
  if (!fields.length) {
    for (const [k, v] of Object.entries(row)) {
      out[k] = JSON_COLUMNS.has(k) && typeof v === 'string' ? safeJson(v) : v
    }
    return out
  }
  for (const f of fields) {
    const value = readPath(row, f.db)
    writePath(out, f.output, JSON_COLUMNS.has(f.db) && typeof value === 'string' ? safeJson(value) : value)
  }
  return out
}

function safeJson(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
