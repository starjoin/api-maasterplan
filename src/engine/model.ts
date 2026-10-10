import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import type { GtfsEntity } from './types.js'

/** Modèle Prisma de chaque entité exposable dans le Designer. */
export const ENTITY_DELEGATES: Record<GtfsEntity, string> = {
  Agency: 'agency',
  Stop: 'stop',
  Route: 'route',
  Trip: 'trip',
  StopTime: 'stopTime',
  Calendar: 'calendar',
  CalendarDate: 'calendarDate',
  Shape: 'shape',
  FareZone: 'fareZone',
  FareAttribute: 'fareAttribute',
  FareRule: 'fareRule',
  Transfer: 'transfer',
}

export const ENTITY_LABELS: Record<GtfsEntity, string> = {
  Agency: 'Opérateur / réseau',
  Stop: 'Arrêt, zone d’arrêts ou POI',
  Route: 'Ligne',
  Trip: 'Course',
  StopTime: 'Passage d’une course à un arrêt',
  Calendar: 'Calendrier de service',
  CalendarDate: 'Exception de calendrier',
  Shape: 'Point de tracé (GTFS uniquement)',
  FareZone: 'Zone tarifaire (NeTEx)',
  FareAttribute: 'Tarif (GTFS fare_attributes)',
  FareRule: 'Règle tarifaire (GTFS fare_rules)',
  Transfer: 'Correspondance',
}

/** Colonnes texte qui contiennent du JSON : leurs sous-clés sont adressables par chemin pointé. */
export const JSON_COLUMNS = new Set(['extras'])

export type ColumnType = 'string' | 'number' | 'boolean' | 'json'

export interface ColumnMeta {
  name: string
  type: ColumnType
}

const columnCache = new Map<GtfsEntity, ColumnMeta[]>()

export function entityColumns(entity: GtfsEntity): ColumnMeta[] {
  const cached = columnCache.get(entity)
  if (cached) return cached
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === entity)
  if (!model) throw new Error(`Entité inconnue : ${entity}`)
  const columns = model.fields
    // `id` est une clé technique cuid, différente d'une base à l'autre : jamais exposée.
    .filter((f) => f.kind === 'scalar' && f.name !== 'id')
    .map((f) => ({
      name: f.name,
      type: JSON_COLUMNS.has(f.name)
        ? 'json'
        : f.type === 'Int' || f.type === 'Float' || f.type === 'BigInt'
          ? 'number'
          : f.type === 'Boolean'
            ? 'boolean'
            : 'string',
    })) as ColumnMeta[]
  columnCache.set(entity, columns)
  return columns
}

export function isEntity(value: unknown): value is GtfsEntity {
  return typeof value === 'string' && value in ENTITY_DELEGATES
}

export function columnType(entity: GtfsEntity, column: string): ColumnType | undefined {
  return entityColumns(entity).find((c) => c.name === column)?.type
}

/** Coercition d'une valeur de requête vers le type de la colonne. */
export function coerce(entity: GtfsEntity, column: string, value: unknown): unknown {
  const type = columnType(entity, column)
  if (type === 'number') {
    const n = Number(value)
    if (Number.isNaN(n)) throw new ParamError(`« ${String(value)} » n’est pas un nombre (${column})`)
    return n
  }
  if (type === 'boolean') return value === true || value === 'true' || value === '1'
  return String(value)
}

export class ParamError extends Error {}

/**
 * Inventaire des sous-clés JSON réellement présentes (échantillon), pour proposer
 * `extras.address.town`, `extras.keys.REF`… dans le Designer.
 */
export async function sampleJsonPaths(client: PrismaClient, entity: GtfsEntity, column: string, slices = 8, perSlice = 250) {
  const delegate = (client as unknown as Record<string, { findMany: Function; count: Function }>)[ENTITY_DELEGATES[entity]]
  const where = { [column]: { not: null } }
  const total = (await delegate.count({ where })) as number
  // Tranches réparties sur toute la table : les types NeTEx (Quay, StopPlace, POI…) sont importés par blocs.
  const step = Math.max(perSlice, Math.floor(total / slices))
  const rows: Record<string, string | null>[] = []
  for (let skip = 0; skip < total; skip += step) {
    rows.push(...((await delegate.findMany({ where, select: { [column]: true }, skip, take: perSlice })) as typeof rows))
  }
  const paths = new Set<string>()
  const walk = (value: unknown, prefix: string, depth: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return
    for (const [k, v] of Object.entries(value)) {
      const p = `${prefix}.${k}`
      paths.add(p)
      walk(v, p, depth + 1)
    }
  }
  for (const row of rows) {
    try {
      walk(JSON.parse(row[column] ?? 'null'), column, 0)
    } catch {
      /* JSON invalide : ignoré */
    }
  }
  return [...paths].sort()
}

/** Lit `a.b.c` dans un objet ; les colonnes JSON sérialisées sont décodées au passage. */
export function readPath(row: Record<string, unknown>, path: string): unknown {
  let current: unknown = row
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return null
    if (typeof current === 'string' && current.startsWith('{')) {
      try {
        current = JSON.parse(current)
      } catch {
        return null
      }
    }
    if (typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[part]
  }
  return current ?? null
}

/** Écrit une valeur sous une clé de sortie, en créant les objets intermédiaires pour `a.b`. */
export function writePath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let current = target
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') current[part] = {}
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}
