import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  api,
  type ApiEndpoint,
  type FieldMapping,
  type FilterDef,
  type ApiParam,
  type ResponseSchema,
} from '../lib/api'
import { ChevronLeft, Plus, Trash2, Loader2, Play, HelpCircle } from 'lucide-react'

const ENTITIES = ['Agency', 'Stop', 'Route', 'Trip', 'StopTime', 'Calendar', 'CalendarDate', 'Shape']

const ENTITY_DESCRIPTIONS: Record<string, string> = {
  Agency: 'Opérateur de transport',
  Stop: 'Arrêt ou station avec coordonnées GPS',
  Route: 'Ligne de transport (bus, métro, tram…)',
  Trip: 'Course — un trajet sur une ligne',
  StopTime: 'Passage d\'un trip à un arrêt (horaires)',
  Calendar: 'Planning de service (jours actifs)',
  CalendarDate: 'Exception au planning',
  Shape: 'Tracé géographique d\'une ligne',
}

const EMPTY_SCHEMA: ResponseSchema = {
  entity: 'Route',
  multiple: true,
  filters: [],
  fields: [],
  paginate: true,
}

function Help({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-flex items-center ml-1.5">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="text-gray-400 hover:text-gray-600"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {show && (
        <span className="absolute left-5 top-0 z-50 w-64 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl">
          {text}
        </span>
      )}
    </span>
  )
}

export default function EndpointEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isNew = !id

  const [path, setPath] = useState('/v1/')
  const [method, setMethod] = useState('GET')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [params, setParams] = useState<ApiParam[]>([])
  const [schema, setSchema] = useState<ResponseSchema>(EMPTY_SCHEMA)

  const [previewPathParams, setPreviewPathParams] = useState<Record<string, string>>({})
  const [previewQueryParams, setPreviewQueryParams] = useState<Record<string, string>>({})
  const [previewResult, setPreviewResult] = useState<unknown>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const { data: existing, isLoading } = useQuery({
    queryKey: ['endpoint', id],
    queryFn: () => api.endpoints.get(id!),
    enabled: !isNew,
  })

  const { data: fieldsMeta = {} } = useQuery({
    queryKey: ['endpoint-fields'],
    queryFn: api.endpoints.fields,
  })

  const { data: presetsData } = useQuery({
    queryKey: ['endpoint-presets'],
    queryFn: api.endpoints.presets,
  })
  const presets = presetsData?.presets ?? []
  const selectedPreset = presets.find((p) => p.id === schema.preset)
  const engineMode: 'declarative' | 'preset' = schema.preset ? 'preset' : 'declarative'

  const setEngineMode = (mode: 'declarative' | 'preset') => {
    if (mode === 'declarative') {
      setSchema((s) => ({
        entity: s.entity,
        multiple: s.multiple,
        filters: s.filters ?? [],
        fields: s.fields ?? [],
        orderBy: s.orderBy,
        paginate: s.paginate,
      }))
    } else {
      const first = presets[0]
      setSchema((s) => ({
        ...s,
        preset: first?.id ?? 'lines_list',
        entity: first?.entity ?? 'Route',
        multiple: first?.multiple ?? true,
        fields: [],
        responseKeys: [],
      }))
    }
  }

  useEffect(() => {
    if (existing) {
      setPath(existing.path)
      setMethod(existing.method)
      setDescription(existing.description ?? '')
      setIsActive(existing.isActive)
      setParams(existing.params)
      setSchema(existing.responseSchema)
    }
  }, [existing])

  const saveMut = useMutation({
    mutationFn: (data: Partial<ApiEndpoint>) =>
      isNew ? api.endpoints.create(data) : api.endpoints.update(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['endpoints'] })
      navigate('/api-designer')
    },
  })

  const handleSave = () => {
    saveMut.mutate({
      path,
      method,
      description,
      isActive,
      responseSchema: schema,
      params: params.map(({ id: _id, ...p }) => p) as ApiParam[],
    })
  }

  const runPreview = useCallback(async () => {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const res = await api.endpoints.preview(schema, previewPathParams, previewQueryParams)
      if (!res.ok) setPreviewError(res.error ?? 'Erreur inconnue')
      else setPreviewResult(res.result)
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreviewLoading(false)
    }
  }, [schema, previewPathParams, previewQueryParams])

  const availableFields = fieldsMeta[schema.entity] ?? []

  const addField = () =>
    setSchema((s) => ({
      ...s,
      fields: [...s.fields, { output: availableFields[0] ?? '', db: availableFields[0] ?? '' }],
    }))
  const updateField = (i: number, k: keyof FieldMapping, v: string) =>
    setSchema((s) => {
      const fields = [...s.fields]
      fields[i] = { ...fields[i], [k]: v }
      return { ...s, fields }
    })
  const removeField = (i: number) =>
    setSchema((s) => ({ ...s, fields: s.fields.filter((_, fi) => fi !== i) }))

  const addFilter = () =>
    setSchema((s) => ({
      ...s,
      filters: [...s.filters, { field: 'routeId', source: 'query', key: 'routeId', operator: 'eq' }],
    }))
  const updateFilter = (i: number, k: keyof FilterDef, v: string) =>
    setSchema((s) => {
      const filters = [...s.filters]
      filters[i] = { ...filters[i], [k]: v } as FilterDef
      return { ...s, filters }
    })
  const removeFilter = (i: number) =>
    setSchema((s) => ({ ...s, filters: s.filters.filter((_, fi) => fi !== i) }))

  const addParam = () =>
    setParams((p) => [...p, { name: '', type: 'string', location: 'query', required: false }])
  const updateParam = (i: number, k: keyof ApiParam, v: unknown) =>
    setParams((p) => {
      const a = [...p]
      a[i] = { ...a[i], [k]: v } as ApiParam
      return a
    })
  const removeParam = (i: number) => setParams((p) => p.filter((_, pi) => pi !== i))

  const pathParamNames = [...path.matchAll(/:([a-zA-Z_]+)/g)].map((m) => m[1])

  if (!isNew && isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="p-8 flex gap-6">
      <div className="flex-1 min-w-0">
        <Link to="/api-designer" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft className="w-4 h-4" /> Retour au designer
        </Link>

        <h1 className="text-2xl font-bold mb-6">{isNew ? 'Nouvel endpoint' : "Modifier l'endpoint"}</h1>

        <div className="card p-5 mb-5">
          <h2 className="font-semibold mb-1">Configuration générale</h2>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div>
              <label className="label">Méthode</label>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option>GET</option>
                <option>POST</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="label flex items-center">
                Chemin
                <Help text="URL relative depuis /api. Utilise :param pour les paramètres de chemin. Ex: /v1/lignes/:routeId" />
              </label>
              <input
                className="input font-mono"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/v1/lignes"
              />
            </div>
            <div className="col-span-3">
              <label className="label">Description</label>
              <input
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Liste les lignes de transport"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="active" className="text-sm cursor-pointer">
                Actif
              </label>
            </div>
          </div>
        </div>

        <div className="card p-5 mb-5">
          <h2 className="font-semibold mb-1">
            Moteur de réponse
            <Help text="Déclaratif = projection GTFS libre. Preset = handler SAE (Navitia) dont vous pilotez l’activation, les params et les clés de réponse." />
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Ce qui est configuré ici est exactement ce que sert <code className="font-mono">/api{path}</code> une
            fois l’endpoint actif.
          </p>
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              className={`btn text-sm ${engineMode === 'declarative' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setEngineMode('declarative')}
            >
              Déclaratif GTFS
            </button>
            <button
              type="button"
              className={`btn text-sm ${engineMode === 'preset' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setEngineMode('preset')}
            >
              Preset SAE / Navitia
            </button>
          </div>

          {engineMode === 'preset' && (
            <div className="space-y-4">
              <div>
                <label className="label">Preset</label>
                <select
                  className="input"
                  value={schema.preset ?? ''}
                  onChange={(e) => {
                    const p = presets.find((x) => x.id === e.target.value)
                    setSchema((s) => ({
                      ...s,
                      preset: e.target.value,
                      entity: p?.entity ?? s.entity,
                      multiple: p?.multiple ?? s.multiple,
                      responseKeys: [],
                    }))
                    if (p?.pathHint && (isNew || path === '/v1/')) setPath(p.pathHint)
                  }}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.id})
                    </option>
                  ))}
                </select>
                {selectedPreset && (
                  <p className="text-xs text-gray-500 mt-2">{selectedPreset.description}</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">
                    Clés de réponse
                    <Help text="Cochez les clés JSON à conserver. Aucune case = réponse complète du preset. Pour la liste de lignes, utilisez aussi line.code, line.routes…" />
                  </label>
                  <button
                    type="button"
                    className="text-xs text-primary-700"
                    onClick={() =>
                      setSchema((s) => ({
                        ...s,
                        responseKeys: [],
                      }))
                    }
                  >
                    Tout inclure
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-56 overflow-auto p-3 bg-gray-50 rounded-lg border border-gray-100">
                  {(selectedPreset?.responseKeys ?? []).map((key) => {
                    const checked = (schema.responseKeys ?? []).includes(key)
                    const hasProjection = (schema.responseKeys ?? []).length > 0
                    return (
                      <label key={key} className="flex items-center gap-2 text-xs font-mono cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5"
                          checked={!hasProjection || checked}
                          onChange={() => {
                            setSchema((s) => {
                              const current = s.responseKeys ?? []
                              if (current.length === 0) {
                                // passer en mode projection : tout sauf cette clé décochée
                                const all = selectedPreset?.responseKeys ?? []
                                return { ...s, responseKeys: all.filter((k) => k !== key) }
                              }
                              if (checked) {
                                const next = current.filter((k) => k !== key)
                                return { ...s, responseKeys: next }
                              }
                              return { ...s, responseKeys: [...current, key] }
                            })
                          }}
                        />
                        {key}
                      </label>
                    )
                  })}
                  {schema.preset === 'lines_list' && (
                    <>
                      <p className="col-span-2 text-[10px] uppercase tracking-wide text-gray-400 mt-2">
                        Projection items lines[]
                      </p>
                      {['id', 'code', 'name', 'color', 'text_color', 'commercial_mode', 'physical_modes', 'network', 'routes', 'geojson', 'opening_time', 'closing_time'].map(
                        (k) => {
                          const key = `line.${k}`
                          const checked = (schema.responseKeys ?? []).includes(key)
                          return (
                            <label key={key} className="flex items-center gap-2 text-xs font-mono cursor-pointer">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5"
                                checked={checked}
                                onChange={() => {
                                  setSchema((s) => {
                                    const current = s.responseKeys ?? []
                                    if (checked) return { ...s, responseKeys: current.filter((x) => x !== key) }
                                    return { ...s, responseKeys: [...current, key] }
                                  })
                                }}
                              />
                              {key}
                            </label>
                          )
                        },
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {engineMode === 'declarative' && (
        <div className="card p-5 mb-5">
          <h2 className="font-semibold mb-1">
            Entité principale
            <Help text="Le type de données GTFS que l'endpoint retourne." />
          </h2>
          <p className="text-xs text-gray-400 mb-4">{ENTITY_DESCRIPTIONS[schema.entity]}</p>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="label">Entité</label>
              <select
                className="input"
                value={schema.entity}
                onChange={(e) => setSchema((s) => ({ ...s, entity: e.target.value, fields: [] }))}
              >
                {ENTITIES.map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Mode de retour</label>
              <select
                className="input"
                value={schema.multiple ? 'multiple' : 'single'}
                onChange={(e) => setSchema((s) => ({ ...s, multiple: e.target.value === 'multiple' }))}
              >
                <option value="multiple">Liste (tableau)</option>
                <option value="single">Objet unique</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="label">Pagination</label>
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={!!schema.paginate}
                  onChange={(e) => setSchema((s) => ({ ...s, paginate: e.target.checked }))}
                  className="w-4 h-4"
                />
                <span className="text-sm">Activer (?limit & ?offset)</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Trier par</label>
              <select
                className="input"
                value={schema.orderBy?.field ?? ''}
                onChange={(e) =>
                  setSchema((s) => ({
                    ...s,
                    orderBy: e.target.value
                      ? { field: e.target.value, direction: s.orderBy?.direction ?? 'asc' }
                      : undefined,
                  }))
                }
              >
                <option value="">— Aucun tri —</option>
                {availableFields.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>
            {schema.orderBy && (
              <div>
                <label className="label">Direction</label>
                <select
                  className="input"
                  value={schema.orderBy.direction}
                  onChange={(e) =>
                    setSchema((s) => ({
                      ...s,
                      orderBy: { ...s.orderBy!, direction: e.target.value as 'asc' | 'desc' },
                    }))
                  }
                >
                  <option value="asc">Croissant</option>
                  <option value="desc">Décroissant</option>
                </select>
              </div>
            )}
          </div>
        </div>
        )}

        {engineMode === 'declarative' && (
        <div className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Champs de réponse</h2>
            <button className="btn-secondary text-xs py-1" onClick={addField}>
              <Plus className="w-3 h-3" /> Ajouter
            </button>
          </div>

          {schema.fields.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-3 bg-gray-50 rounded-lg">
              Aucun champ — tous les champs seront retournés.
            </p>
          )}

          <div className="space-y-2">
            {schema.fields.map((f, i) => (
              <div key={i} className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="label text-xs">Champ DB</label>
                  <select className="input" value={f.db} onChange={(e) => updateField(i, 'db', e.target.value)}>
                    {availableFields.map((af) => (
                      <option key={af}>{af}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-shrink-0 text-gray-400 mb-2">→</div>
                <div className="flex-1">
                  <label className="label text-xs">Clé JSON</label>
                  <input
                    className="input font-mono"
                    value={f.output}
                    onChange={(e) => updateField(i, 'output', e.target.value)}
                  />
                </div>
                <button className="btn-ghost p-2 mb-0.5 text-red-500" onClick={() => removeField(i)}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
        )}

        {engineMode === 'declarative' && (
        <div className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Filtres</h2>
            <button className="btn-secondary text-xs py-1" onClick={addFilter}>
              <Plus className="w-3 h-3" /> Ajouter
            </button>
          </div>

          {schema.filters.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-3 bg-gray-50 rounded-lg">Aucun filtre.</p>
          )}

          <div className="space-y-2">
            {schema.filters.map((f, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="w-36">
                  <label className="label text-xs">Champ DB</label>
                  <select className="input" value={f.field} onChange={(e) => updateFilter(i, 'field', e.target.value)}>
                    {availableFields.map((af) => (
                      <option key={af}>{af}</option>
                    ))}
                  </select>
                </div>
                <div className="w-40">
                  <label className="label text-xs">Source</label>
                  <select className="input" value={f.source} onChange={(e) => updateFilter(i, 'source', e.target.value)}>
                    <option value="path">Param URL (:x)</option>
                    <option value="query">Query string (?x=)</option>
                    <option value="static">Valeur fixe</option>
                  </select>
                </div>
                <div className="w-32">
                  <label className="label text-xs">{f.source === 'static' ? 'Valeur' : 'Nom du param'}</label>
                  <input
                    className="input font-mono text-sm"
                    value={f.key}
                    onChange={(e) => updateFilter(i, 'key', e.target.value)}
                  />
                </div>
                <div className="w-36">
                  <label className="label text-xs">Opérateur</label>
                  <select
                    className="input"
                    value={f.operator ?? 'eq'}
                    onChange={(e) => updateFilter(i, 'operator', e.target.value)}
                  >
                    <option value="eq">= égal</option>
                    <option value="contains">contient</option>
                    <option value="startsWith">commence par</option>
                  </select>
                </div>
                <button className="btn-ghost p-2 mb-0.5 text-red-500" onClick={() => removeFilter(i)}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
        )}

        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">
              Paramètres
              <Help text="Documentés et utilisés dans le formulaire de preview. Pour les presets, ce sont les query/path réellement lus par le handler." />
            </h2>
            <button className="btn-secondary text-xs py-1" onClick={addParam}>
              <Plus className="w-3 h-3" /> Ajouter
            </button>
          </div>

          <div className="space-y-2">
            {params.map((p, i) => (
              <div key={i} className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="label text-xs">Nom</label>
                  <input
                    className="input font-mono"
                    value={p.name}
                    onChange={(e) => updateParam(i, 'name', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label text-xs">Emplacement</label>
                  <select
                    className="input"
                    value={p.location}
                    onChange={(e) => updateParam(i, 'location', e.target.value)}
                  >
                    <option value="path">URL :path</option>
                    <option value="query">?query</option>
                  </select>
                </div>
                <div>
                  <label className="label text-xs">Type</label>
                  <select className="input" value={p.type} onChange={(e) => updateParam(i, 'type', e.target.value)}>
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                  </select>
                </div>
                <button className="btn-ghost p-2 mb-0.5 text-red-500" onClick={() => removeParam(i)}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button className="btn-primary" onClick={handleSave} disabled={saveMut.isPending}>
            {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Enregistrer
          </button>
          <Link to="/api-designer" className="btn-secondary">
            Annuler
          </Link>
        </div>
        {saveMut.isError && <p className="text-red-600 text-sm mt-3">{saveMut.error.message}</p>}
      </div>

      <div className="w-96 flex-shrink-0">
        <div className="sticky top-8">
          <div className="card overflow-hidden">
            <div className="px-4 py-3 bg-gray-900 text-white flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">Preview live</p>
                <code className="text-xs text-gray-400">
                  {method} /api{path || '…'}
                </code>
              </div>
              <button onClick={runPreview} disabled={previewLoading} className="btn-primary text-xs py-1.5 px-3">
                {previewLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Tester
              </button>
            </div>

            {(pathParamNames.length > 0 || params.some((p) => p.location === 'query')) && (
              <div className="border-b border-gray-100 px-4 py-3 space-y-2 bg-gray-50">
                <p className="text-xs font-medium text-gray-500 uppercase">Paramètres de test</p>
                {pathParamNames.map((name) => (
                  <div key={name} className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 w-24 font-mono">:{name}</label>
                    <input
                      className="input text-xs py-1"
                      value={previewPathParams[name] ?? ''}
                      onChange={(e) => setPreviewPathParams((p) => ({ ...p, [name]: e.target.value }))}
                    />
                  </div>
                ))}
                {params
                  .filter((p) => p.location === 'query')
                  .map((p) => (
                    <div key={p.name} className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 w-24 font-mono">?{p.name}</label>
                      <input
                        className="input text-xs py-1"
                        value={previewQueryParams[p.name] ?? ''}
                        onChange={(e) => setPreviewQueryParams((q) => ({ ...q, [p.name]: e.target.value }))}
                      />
                    </div>
                  ))}
              </div>
            )}

            <div className="bg-gray-950 min-h-48 max-h-[60vh] overflow-auto">
              {previewError && (
                <div className="p-4 text-red-400 text-xs font-mono">
                  <p className="text-red-300 font-semibold mb-1">Erreur :</p>
                  {previewError}
                </div>
              )}
              {!previewError && previewResult !== null && (
                <pre className="p-4 text-xs text-green-400 font-mono whitespace-pre-wrap">
                  {JSON.stringify(previewResult, null, 2)}
                </pre>
              )}
              {!previewError && previewResult === null && (
                <div className="p-4 text-gray-600 text-xs text-center mt-8">
                  Cliquez sur « Tester » pour voir une réponse réelle.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
