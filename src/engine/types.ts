export type GtfsEntity =
  | 'Agency'
  | 'Stop'
  | 'Route'
  | 'Trip'
  | 'StopTime'
  | 'Calendar'
  | 'CalendarDate'
  | 'Shape'

export interface FieldMapping {
  output: string
  db: string
}

export interface FilterDef {
  field: string
  source: 'path' | 'query' | 'static'
  key: string
  operator?: 'eq' | 'contains' | 'startsWith'
}

export interface RelationDef {
  output: string
  entity: GtfsEntity
  parentField: string
  foreignField: string
  fields: FieldMapping[]
}

/**
 * Schéma stocké dans ApiEndpoint.responseSchema.
 * - Sans `preset` → moteur déclaratif GTFS (entité + fields + filters)
 * - Avec `preset` → handler SAE nommé, projection optionnelle via `responseKeys`
 */
export interface ResponseSchema {
  entity: GtfsEntity
  multiple: boolean
  filters: FilterDef[]
  fields: FieldMapping[]
  relations?: RelationDef[]
  orderBy?: { field: string; direction: 'asc' | 'desc' }
  paginate?: boolean
  /**
   * Preset SAE (ex: line_detail, places_nearby).
   * Si défini, le Designer pilote l’activation, les params, les filtres query
   * et la projection `responseKeys` — plus de route native parallèle.
   */
  preset?: string
  /**
   * Clés de premier niveau à conserver dans la réponse preset.
   * Vide = réponse complète. Préfixe `line.` pour projeter chaque item de `lines[]`.
   */
  responseKeys?: string[]
}
