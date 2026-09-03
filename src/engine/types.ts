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

export interface ResponseSchema {
  entity: GtfsEntity
  multiple: boolean
  filters: FilterDef[]
  fields: FieldMapping[]
  relations?: RelationDef[]
  orderBy?: { field: string; direction: 'asc' | 'desc' }
  paginate?: boolean
  /** Marqueur pour les endpoints documentés mais servis par la couche SAE native */
  native?: string
}
