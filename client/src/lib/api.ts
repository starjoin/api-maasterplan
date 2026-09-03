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

export const api = {
  dashboard: {
    get: () =>
      request<{
        rfu: { gtfsUrl: string; infoUrl: string; version?: string; updatedAt?: string }
        data: { routes: number; stops: number; trips: number; agencies: number; lastImport?: string }
        endpoints: { active: number }
        jobs: { recent: ImportJob[]; stats: Record<string, number> }
        importRunning: boolean
      }>('/admin/dashboard'),
  },

  import: {
    trigger: (force = false) =>
      request<{ message: string }>(`/admin/import/trigger?force=${force}`, { method: 'POST' }),
    status: () => request<{ running: boolean; latest?: ImportJob }>('/admin/import/status'),
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
    preview: (schema: ResponseSchema, pathParams: Record<string, string>, queryParams: Record<string, string>) =>
      request<{ ok: boolean; result: unknown; error?: string }>('/admin/endpoints/preview', {
        method: 'POST',
        body: JSON.stringify({ schema, pathParams, queryParams }),
      }),
  },

  explore: {
    routeModes: () =>
      request<{ modes: Array<{ type: number; label: string; count: number }> }>('/admin/explore/route-modes'),
    routes: (p: { q?: string; limit?: number; offset?: number; type?: number }) => {
      const q = new URLSearchParams()
      if (p.q) q.set('q', p.q)
      if (p.limit) q.set('limit', String(p.limit))
      if (p.offset) q.set('offset', String(p.offset))
      if (p.type !== undefined) q.set('type', String(p.type))
      return request<{
        items: Record<string, unknown>[]
        total: number
        limit: number
        offset: number
        page: number
        pages: number
      }>(`/admin/explore/routes?${q}`)
    },
    stops: (p: { q?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams()
      if (p.q) q.set('q', p.q)
      if (p.limit) q.set('limit', String(p.limit))
      if (p.offset) q.set('offset', String(p.offset))
      return request<{
        items: Record<string, unknown>[]
        total: number
        limit: number
        offset: number
        page: number
        pages: number
      }>(`/admin/explore/stops?${q}`)
    },
  },
}
