const BASE = ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body !== undefined
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export interface ImportJob {
  id: string
  status: 'PENDING' | 'DOWNLOADING' | 'PARSING' | 'IMPORTING' | 'COMPLETED' | 'FAILED' | 'SKIPPED'
  triggeredBy: string
  startedAt?: string
  completedAt?: string
  errorMessage?: string
  stats?: string
  logs?: string[] | string
  createdAt: string
}

export interface ApiEndpoint {
  id: string
  path: string
  method: string
  description?: string
  isActive: boolean
  responseSchema: ResponseSchema
  params: ApiParam[]
  createdAt: string
  updatedAt: string
}

export interface ApiParam {
  id?: string
  name: string
  type: 'string' | 'number' | 'boolean'
  location: 'path' | 'query'
  required: boolean
  description?: string
  defaultValue?: string
}

export interface ResponseSchema {
  entity: string
  multiple: boolean
  filters: FilterDef[]
  fields: FieldMapping[]
  relations?: RelationDef[]
  orderBy?: { field: string; direction: 'asc' | 'desc' }
  paginate?: boolean
  /** Preset SAE — si défini, pilote un handler nommé */
  preset?: string
  /** Projection des clés de réponse (presets) */
  responseKeys?: string[]
}

export interface PresetMeta {
  id: string
  label: string
  description: string
  responseKeys: string[]
  entity: string
  multiple: boolean
  pathHint: string
}

export interface FilterDef {
  field: string
  source: 'path' | 'query' | 'static'
  key: string
  operator?: 'eq' | 'contains' | 'startsWith'
}

export interface FieldMapping {
  output: string
  db: string
}

export interface RelationDef {
  output: string
  entity: string
  parentField: string
  foreignField: string
  fields: FieldMapping[]
}

export type DataSource = 'gtfs' | 'netex'

export interface SourceInfo {
  id: DataSource
  label: string
  active: boolean
  zipUrl: string
  lastImport: string | null
  rfuVersion: string | null
  counts: { routes: number; stops: number; trips: number }
}

export interface DownloadProgress {
  phase: 'idle' | 'downloading' | 'extracting' | 'parsing' | 'importing'
  percent: number | null
  bytesReceived: number
  bytesTotal: number | null
  speedBps: number | null
  etaSeconds: number | null
  bytesLabel: string | null
  speedLabel: string | null
  etaLabel: string | null
}

export const api = {
  source: {
    get: () =>
      request<{ active: DataSource; sources: SourceInfo[] }>('/admin/source'),
    set: (source: DataSource) =>
      request<{ active: DataSource; label: string; message: string }>('/admin/source', {
        method: 'POST',
        body: JSON.stringify({ source }),
      }),
  },

  dashboard: {
    get: () =>
      request<{
        source?: { active: DataSource; label: string }
        rfu: { gtfsUrl: string; infoUrl: string; version?: string; updatedAt?: string }
        data: { routes: number; stops: number; trips: number; agencies: number; lastImport?: string }
        endpoints: { active: number }
        jobs: { recent: ImportJob[]; stats: Record<string, number> }
        importRunning: boolean
        downloadProgress?: DownloadProgress
        storage?: {
          dataDir: string
          volumeMounted: boolean
          exists: boolean
          writable: boolean
          files: Array<{ name: string; sizeBytes: number; sizeLabel: string }>
          hasGtfsDb: boolean
          hasNetexDb: boolean
          warning: string | null
        }
      }>('/admin/dashboard'),
  },

  import: {
    trigger: (force = false) =>
      request<{ message: string; source?: string }>(`/admin/import/trigger?force=${force}`, {
        method: 'POST',
      }),
    netexLocal: (path: string) =>
      request<{ message: string }>('/admin/import/netex-local', {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),
    status: () =>
      request<{
        running: boolean
        latest?: ImportJob
        source?: string
        downloadProgress?: DownloadProgress
      }>('/admin/import/status'),
    jobs: (limit = 20) => request<ImportJob[]>(`/admin/import/jobs?limit=${limit}`),
    getJob: (id: string) => request<ImportJob & { logs: string[] }>(`/admin/import/jobs/${id}`),
    rfuInfo: () => request<Record<string, unknown>>('/admin/rfu/info'),
  },

  endpoints: {
    list: () => request<ApiEndpoint[]>('/admin/endpoints'),
    get: (id: string) => request<ApiEndpoint>(`/admin/endpoints/${id}`),
    create: (data: Partial<ApiEndpoint>) =>
      request<ApiEndpoint>('/admin/endpoints', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<ApiEndpoint>) =>
      request<ApiEndpoint>(`/admin/endpoints/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/admin/endpoints/${id}`, { method: 'DELETE' }),
    toggle: (id: string) => request<ApiEndpoint>(`/admin/endpoints/${id}/toggle`, { method: 'PATCH' }),
    fields: () => request<Record<string, string[]>>('/admin/endpoints/meta/fields'),
    presets: () => request<{ presets: PresetMeta[] }>('/admin/endpoints/meta/presets'),
    preview: (schema: ResponseSchema, pathParams: Record<string, string>, queryParams: Record<string, string>) =>
      request<{ ok: boolean; result: unknown; error?: string }>('/admin/endpoints/preview', {
        method: 'POST',
        body: JSON.stringify({ schema, pathParams, queryParams }),
      }),
  },

  explore: {
    routeModes: () =>
      request<{ modes: Array<{ type: number; label: string; count: number }> }>('/admin/explore/route-modes'),
    commercialModes: (p?: { type?: number }) => {
      const q = new URLSearchParams()
      if (p?.type !== undefined) q.set('type', String(p.type))
      const qs = q.toString()
      return request<{
        modes: Array<{
          key: string
          id: string
          name: string
          count: number
          physicalTypes: number[]
        }>
        total: number
      }>(`/admin/explore/commercial-modes${qs ? `?${qs}` : ''}`)
    },
    routes: (p: {
      q?: string
      limit?: number
      offset?: number
      type?: number
      commercial?: string
    }) => {
      const q = new URLSearchParams()
      if (p.q) q.set('q', p.q)
      if (p.limit) q.set('limit', String(p.limit))
      if (p.offset) q.set('offset', String(p.offset))
      if (p.type !== undefined) q.set('type', String(p.type))
      if (p.commercial) q.set('commercial', p.commercial)
      return request<{
        items: Record<string, unknown>[]
        total: number
        limit: number
        offset: number
        page: number
        pages: number
      }>(`/admin/explore/routes?${q}`)
    },
    route: (id: string) =>
      request<{
        route: Record<string, unknown>
        line: Record<string, unknown>
        thermometer: {
          line: Record<string, unknown>
          directions: Array<{
            direction_id: number | null
            headsign: string | null
            shape_id: string | null
            trip_id: string
            stop_points: Array<{
              order: number
              stop_point: { id?: string; name?: string; label?: string }
              arrival_time: string | null
              departure_time: string | null
            }>
          }>
        } | null
        pictoUrl: string | null
      }>(`/admin/explore/routes/${encodeURIComponent(id)}`),
    stopTypes: () =>
      request<{
        types: Array<{ locationType: number; label: string; count: number }>
      }>('/admin/explore/stop-types'),
    poiCategories: () =>
      request<{
        categories: Array<{ key: string; name: string; count: number }>
        total: number
      }>('/admin/explore/poi-categories'),
    stops: (p: {
      q?: string
      limit?: number
      offset?: number
      locationType?: number
      classification?: string
      poiOnly?: boolean
    }) => {
      const q = new URLSearchParams()
      if (p.q) q.set('q', p.q)
      if (p.limit) q.set('limit', String(p.limit))
      if (p.offset) q.set('offset', String(p.offset))
      if (p.locationType !== undefined) q.set('location_type', String(p.locationType))
      if (p.classification) q.set('classification', p.classification)
      if (p.poiOnly) q.set('poi_only', 'true')
      return request<{
        items: Record<string, unknown>[]
        total: number
        limit: number
        offset: number
        page: number
        pages: number
      }>(`/admin/explore/stops?${q}`)
    },
    stop: (id: string) =>
      request<{
        stop: Record<string, unknown>
        fareZone: { id: string; name: string | null; extras: unknown } | null
        lines: Record<string, unknown>[]
      }>(`/admin/explore/stops/${encodeURIComponent(id)}`),
  },
}
