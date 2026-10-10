export type GtfsEntity =
  | 'Agency'
  | 'Stop'
  | 'Route'
  | 'Trip'
  | 'StopTime'
  | 'Calendar'
  | 'CalendarDate'
  | 'Shape'
  | 'FareZone'
  | 'FareAttribute'
  | 'FareRule'
  | 'Transfer'

/**
 * Base servie par un endpoint.
 * - `active` : suit la source choisie dans le dashboard (comportement historique)
 * - `gtfs` / `netex` : toujours cette base, quelle que soit la source active
 */
export type EndpointSource = 'active' | 'gtfs' | 'netex'

export interface FieldMapping {
  output: string
  /**
   * Colonne ou chemin pointé.
   * Déclaratif : `stopId`, `extras.address.town` (les colonnes JSON sont décodées).
   * Preset : chemin dans chaque élément de la liste, ex. `line.code`.
   */
  db: string
}

export interface FilterDef {
  field: string
  source: 'path' | 'query' | 'static'
  key: string
  operator?: 'eq' | 'contains' | 'startsWith' | 'in' | 'gte' | 'lte'
}

export interface RelationDef {
  output: string
  entity: GtfsEntity
  /** Base de l'entité liée ; absente = même base que l'endpoint. */
  source?: EndpointSource
  parentField: string
  foreignField: string
  fields: FieldMapping[]
  /** true = tableau de toutes les lignes liées ; false = première ligne. */
  multiple?: boolean
  orderBy?: { field: string; direction: 'asc' | 'desc' }
  /** Plafond d'éléments par parent quand `multiple` (défaut 100). */
  limit?: number
}

/** Projection de la réponse d'un preset. */
export interface PresetOutput {
  /** Clé de la liste à projeter (ex. `vehicle_journeys`) ; vide = objet racine. */
  list?: string
  /** Champs gardés dans chaque élément ; vide = élément complet. */
  fields: FieldMapping[]
}

/**
 * Schéma stocké dans ApiEndpoint.responseSchema.
 * - Sans `preset` → moteur déclaratif (entité + fields + filters + relations)
 * - Avec `preset` → handler nommé au format Navitia, projection via `responseKeys` et `output`
 */
export interface ResponseSchema {
  entity: GtfsEntity
  multiple: boolean
  filters: FilterDef[]
  fields: FieldMapping[]
  relations?: RelationDef[]
  orderBy?: { field: string; direction: 'asc' | 'desc' }
  paginate?: boolean
  source?: EndpointSource
  preset?: string
  /** Clés de premier niveau conservées (preset). Vide = toutes. */
  responseKeys?: string[]
  output?: PresetOutput
}
