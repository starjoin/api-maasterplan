import { useState, useEffect, useId, useMemo, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  api,
  type ApiEndpoint,
  type FieldMapping,
  type FilterDef,
  type ApiParam,
  type ResponseSchema,
  type RelationDef,
  type EndpointSource,
  type ColumnMeta,
} from '../lib/api'
import {
  ChevronLeft,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  HelpCircle,
  AlertTriangle,
  RotateCcw,
  Check,
} from 'lucide-react'

const EMPTY_SCHEMA: ResponseSchema = {
  source: 'gtfs',
  entity: 'Route',
  multiple: true,
  filters: [],
  fields: [],
  paginate: true,
}

/** Paramètres lus par le moteur déclaratif en plus de ceux référencés par les filtres. */
const PAGINATION_PARAMS = ['limit', 'offset']

const SOURCE_OPTIONS: Array<{ id: EndpointSource; label: string; hint: string }> = [
  { id: 'gtfs', label: 'GTFS', hint: 'Toujours la base GTFS' },
  { id: 'netex', label: 'NeTEx', hint: 'Toujours la base NeTEx' },
  { id: 'active', label: 'Source active', hint: 'Suit la source choisie dans le dashboard' },
]

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
        <span className="absolute left-5 top-0 z-50 w-72 bg-gray-900 text-white text-xs font-normal rounded-lg px-3 py-2 shadow-xl">
          {text}
        </span>
      )}
    </span>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Chemins sélectionnables d'une entité : colonnes + sous-clés JSON observées. */
function columnPaths(columns: ColumnMeta[]) {
  return columns.flatMap((c) => [c.name, ...(c.paths ?? [])])
}

/** Clé de sortie proposée : dernier segment du chemin, ou chemin complet s'il est déjà pris. */
function defaultOutput(path: string, taken: Set<string>) {
  const short = path.split('.').pop() ?? path
  return taken.has(short) ? path : short
}

/** Lignes « champ source → clé JSON », avec suggestions et saisie libre de chemins pointés. */
function FieldRows({
  fields,
  suggestions,
  onChange,
  emptyText,
  sourceLabel = 'Champ source',
}: {
  fields: FieldMapping[]
  suggestions: string[]
  onChange: (fields: FieldMapping[]) => void
  emptyText: string
  sourceLabel?: string
}) {
  const listId = useId()
  const update = (i: number, k: keyof FieldMapping, v: string) => {
    const next = [...fields]
    const previous = next[i]
    next[i] = { ...previous, [k]: v }
    // Tant que la clé de sortie suit le champ source, on la garde alignée.
    if (k === 'db' && (previous.output === '' || previous.output === defaultOutput(previous.db, new Set()))) {
      next[i].output = defaultOutput(v, new Set(fields.filter((_, fi) => fi !== i).map((f) => f.output)))
    }
    onChange(next)
  }
  const unused = suggestions.filter((s) => !fields.some((f) => f.db === s))

  return (
    <div className="space-y-2">
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {fields.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-3 bg-gray-50 rounded-lg">{emptyText}</p>
      )}
      {fields.map((f, i) => (
        <div key={i} className="flex items-end gap-3">
          <div className="flex-1">
            {i === 0 && <label className="label text-xs">{sourceLabel}</label>}
            <input
              className="input font-mono text-sm"
              list={listId}
              value={f.db}
              onChange={(e) => update(i, 'db', e.target.value)}
            />
          </div>
          <div className="flex-shrink-0 text-gray-400 mb-2">→</div>
          <div className="flex-1">
            {i === 0 && <label className="label text-xs">Clé JSON (a.b pour imbriquer)</label>}
            <input
              className="input font-mono text-sm"
              value={f.output}
              onChange={(e) => update(i, 'output', e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-ghost p-2 mb-0.5 text-red-500"
            onClick={() => onChange(fields.filter((_, fi) => fi !== i))}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className="btn-secondary text-xs py-1"
          onClick={() =>
            onChange([
              ...fields,
              { db: unused[0] ?? '', output: unused[0] ? defaultOutput(unused[0], new Set(fields.map((f) => f.output))) : '' },
            ])
          }
        >
          <Plus className="w-3 h-3" /> Ajouter un champ
        </button>
        {unused.length > 0 && (
          <button
            type="button"
            className="btn-ghost text-xs py-1"
            onClick={() => {
              const taken = new Set(fields.map((f) => f.output))
              const added = unused
                // Un parent (extras.address) est omis quand ses sous-clés sont proposées.
                .filter((s) => !suggestions.some((o) => o !== s && o.startsWith(`${s}.`)))
                .map((s) => {
                  const output = defaultOutput(s, taken)
                  taken.add(output)
                  return { db: s, output }
                })
              onChange([...fields, ...added])
            }}
          >
            Ajouter tous les champs proposés
          </button>
        )}
      </div>
    </div>
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
  const [preview, setPreview] = useState<{ result?: unknown; error?: string; ms?: number }>({})
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewTick, setPreviewTick] = useState(0)
  const previewSeq = useRef(0)

  const { data: existing, isLoading } = useQuery({
    queryKey: ['endpoint', id],
    queryFn: () => api.endpoints.get(id!),
    enabled: !isNew,
  })

  const { data: sourcesData } = useQuery({ queryKey: ['endpoint-sources'], queryFn: api.endpoints.sources })
  const activeSource = sourcesData?.sources.find((s) => s.active)?.id
  const source = schema.source ?? 'active'
  const resolvedSource = source === 'active' ? activeSource : source

  const { data: fieldsMeta } = useQuery({
    queryKey: ['endpoint-fields', resolvedSource],
    queryFn: () => api.endpoints.fields(resolvedSource),
    enabled: Boolean(resolvedSource),
  })
  const entities = fieldsMeta?.entities ?? {}

  const { data: presetsData } = useQuery({ queryKey: ['endpoint-presets'], queryFn: api.endpoints.presets })
  const presets = presetsData?.presets ?? []
  const selectedPreset = presets.find((p) => p.id === schema.preset)
  const engineMode: 'declarative' | 'preset' = schema.preset ? 'preset' : 'declarative'

  useEffect(() => {
    if (existing) {
      setPath(existing.path)
      setMethod(existing.method)
      setDescription(existing.description ?? '')
      setIsActive(existing.isActive)
      setParams(existing.params)
      setSchema({ source: 'active', ...existing.responseSchema })
    }
  }, [existing])

  const setEngineMode = (mode: 'declarative' | 'preset') => {
    if (mode === 'declarative') {
      setSchema((s) => ({
        source: s.source,
        entity: entities[s.entity] ? s.entity : 'Route',
        multiple: s.multiple,
        filters: [],
        fields: [],
        paginate: s.paginate,
      }))
    } else {
      choosePreset(presets[0]?.id ?? 'lines_list')
    }
  }

  const choosePreset = (presetId: string) => {
    const p = presets.find((x) => x.id === presetId)
    setSchema((s) => ({
      source: s.source,
      preset: presetId,
      entity: p?.entity ?? s.entity,
      multiple: p?.multiple ?? s.multiple,
      filters: [],
      fields: [],
      responseKeys: [],
      output: p?.listKey ? { list: p.listKey, fields: [] } : undefined,
    }))
    if (p?.pathHint && (isNew || path === '/v1/')) setPath(p.pathHint)
  }

  const saveMut = useMutation({
    mutationFn: (data: Partial<ApiEndpoint>) =>
      isNew ? api.endpoints.create(data) : api.endpoints.update(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['endpoints'] })
      qc.invalidateQueries({ queryKey: ['endpoint', id] })
      navigate('/api-designer')
    },
  })

  const resetMut = useMutation({
    mutationFn: () => api.endpoints.reset(id!),
    onSuccess: (ep) => {
      qc.setQueryData(['endpoint', id], ep)
      qc.invalidateQueries({ queryKey: ['endpoints'] })
    },
  })

  const cleanParams = () => params.map(({ id: _id, ...p }) => p) as ApiParam[]

  const handleSave = () => {
    saveMut.mutate({ path, method, description, isActive, responseSchema: schema, params: cleanParams() })
  }

  // Preview live : chaque modification relance la requête après une courte pause de saisie.
  // Seule la réponse de la dernière requête est affichée, même si une plus ancienne arrive après.
  const previewReady = isNew || Boolean(existing)
  useEffect(() => {
    if (!previewReady) return
    const seq = ++previewSeq.current
    const timer = setTimeout(async () => {
      setPreviewLoading(true)
      const started = performance.now()
      let next: { result?: unknown; error?: string }
      try {
        const res = await api.endpoints.preview(schema, cleanParams(), previewPathParams, previewQueryParams)
        next = res.ok ? { result: res.result } : { error: res.error ?? 'Erreur inconnue' }
      } catch (e) {
        next = { error: e instanceof Error ? e.message : String(e) }
      }
      if (seq !== previewSeq.current) return
      // Une erreur garde la dernière réponse valide visible (atténuée) pour comparer.
      const ms = Math.round(performance.now() - started)
      setPreview((prev) => {
        const kept = 'result' in next ? next : 'result' in prev ? { result: prev.result } : {}
        return { ...kept, error: next.error, ms }
      })
      setPreviewLoading(false)
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewReady, schema, params, previewPathParams, previewQueryParams, previewTick])

  const columns = entities[schema.entity]?.columns ?? []
  const filterableColumns = columns.filter((c) => c.type !== 'json').map((c) => c.name)

  const updateFilter = (i: number, k: keyof FilterDef, v: string) =>
    setSchema((s) => {
      const filters = [...s.filters]
      filters[i] = { ...filters[i], [k]: v } as FilterDef
      return { ...s, filters }
    })

  const updateRelation = (i: number, patch: Partial<RelationDef>) =>
    setSchema((s) => {
      const relations = [...(s.relations ?? [])]
      relations[i] = { ...relations[i], ...patch }
      return { ...s, relations }
    })

  const updateParam = (i: number, k: keyof ApiParam, v: unknown) =>
    setParams((p) => {
      const a = [...p]
      a[i] = { ...a[i], [k]: v } as ApiParam
      return a
    })

  const pathParamNames = [...path.matchAll(/:([a-zA-Z_]+)/g)].map((m) => m[1])

  /** Cohérence paramètres ↔ moteur : ce qui est déclaré doit être lu, et inversement. */
  const diagnostics = useMemo(() => {
    const declared = new Set(params.map((p) => p.name))
    const read = new Set<string>(
      engineMode === 'preset'
        ? (selectedPreset?.inputs ?? []).map((i) => i.name)
        : [
            ...schema.filters.filter((f) => f.source !== 'static').map((f) => f.key),
            ...(schema.multiple ? PAGINATION_PARAMS : []),
          ],
    )
    return {
      unread: params.filter((p) => p.name && !read.has(p.name)).map((p) => p.name),
      undeclaredFilters: schema.filters
        .filter((f) => f.source !== 'static' && f.key && !declared.has(f.key))
        .map((f) => f.key),
      missingPathParams: pathParamNames.filter((n) => !params.some((p) => p.name === n && p.location === 'path')),
    }
  }, [params, schema, engineMode, selectedPreset, pathParamNames])

  const declarePresetInput = (name: string) => {
    const input = selectedPreset?.inputs.find((i) => i.name === name)
    if (!input) return
    const inPath = pathParamNames.includes(name)
    setParams((p) => [
      ...p,
      {
        name,
        type: input.type,
        location: inPath ? 'path' : 'query',
        required: inPath || !!input.required,
        description: input.description,
      },
    ])
  }

  if (!isNew && isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  const countFor = (sourceId: 'gtfs' | 'netex', entity: string) =>
    sourcesData?.sources.find((s) => s.id === sourceId)?.counts[entity]
  const entityCount = resolvedSource ? countFor(resolvedSource, schema.entity) : undefined
  const sourceMatters = engineMode === 'declarative' || selectedPreset?.data === 'transport'

  return (
    <div className="p-8 flex flex-col xl:flex-row gap-6">
      <div className="flex-1 min-w-0">
        <Link to="/api-designer" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft className="w-4 h-4" /> Retour au designer
        </Link>

        <div className="flex items-start justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold">{isNew ? 'Nouvel endpoint' : "Modifier l'endpoint"}</h1>
          {existing?.isDefault && (
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={resetMut.isPending}
              onClick={() => {
                if (confirm('Restaurer la configuration livrée ? Vos modifications seront perdues.')) resetMut.mutate()
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Configuration d’origine
            </button>
          )}
        </div>

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
            Données interrogées
            <Help text="GTFS et NeTEx sont importés dans deux bases au même modèle. Les identifiants de lignes, arrêts, zones d’arrêts et opérateurs sont communs aux deux : une relation peut aller chercher un complément dans l’autre base." />
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            GTFS apporte les tracés (shapes) ; NeTEx apporte adresses, zones tarifaires, POI et identifiants
            complémentaires (<code className="font-mono">extras</code>).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {SOURCE_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={!sourceMatters}
                onClick={() => setSchema((s) => ({ ...s, source: o.id }))}
                className={`text-left rounded-lg border px-3 py-2 transition-colors disabled:opacity-50 ${
                  source === o.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <p className="text-sm font-medium">
                  {o.label}
                  {o.id === 'active' && activeSource && (
                    <span className="text-xs text-gray-400 font-normal"> (actuellement {activeSource.toUpperCase()})</span>
                  )}
                </p>
                <p className="text-xs text-gray-500">{o.hint}</p>
              </button>
            ))}
          </div>
          {!sourceMatters && (
            <p className="text-xs text-gray-500 mt-3">
              Ce preset ne lit pas les bases transport (temps réel ou catalogue) : la source n’a pas d’effet.
            </p>
          )}
          {sourceMatters && entityCount === 0 && (
            <div className="mt-3">
              <Warning>
                La base {resolvedSource?.toUpperCase()} ne contient aucun {schema.entity} : cet endpoint renverra une
                réponse vide.
              </Warning>
            </div>
          )}
        </div>

        <div className="card p-5 mb-5">
          <h2 className="font-semibold mb-1">
            Moteur de réponse
            <Help text="Requête sur tables : vous choisissez l’entité, chaque champ, les filtres et les relations. Format Navitia : un handler codé construit une réponse au format de l’API Navitia (lignes avec modes et réseau, horaires, thermomètre…) ; vous contrôlez les paramètres qu’il reçoit et les champs qu’il renvoie." />
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Ce qui est configuré ici est exactement ce que sert <code className="font-mono">/api{path}</code>. Seuls les
            paramètres déclarés plus bas sont transmis.
          </p>
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              className={`btn text-sm ${engineMode === 'declarative' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setEngineMode('declarative')}
            >
              Requête sur tables
            </button>
            <button
              type="button"
              className={`btn text-sm ${engineMode === 'preset' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setEngineMode('preset')}
            >
              Format Navitia (preset)
            </button>
          </div>

          {engineMode === 'preset' && (
            <div className="space-y-5">
              <div>
                <label className="label">Preset</label>
                <select className="input" value={schema.preset ?? ''} onChange={(e) => choosePreset(e.target.value)}>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.id})
                    </option>
                  ))}
                </select>
                {selectedPreset && <p className="text-xs text-gray-500 mt-2">{selectedPreset.description}</p>}
                {selectedPreset?.caveats && (
                  <div className="mt-2">
                    <Warning>{selectedPreset.caveats}</Warning>
                  </div>
                )}
              </div>

              {selectedPreset && (
                <div>
                  <label className="label">
                    Paramètres lus par ce preset
                    <Help text="Un paramètre n’atteint le handler que s’il est déclaré dans la section Paramètres. Non déclaré = ignoré, même si l’appelant l’envoie." />
                  </label>
                  {selectedPreset.inputs.length === 0 ? (
                    <p className="text-xs text-gray-400">Aucun : la réponse ne dépend d’aucun paramètre.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                      {selectedPreset.inputs.map((input) => {
                        const declared = params.some((p) => p.name === input.name)
                        return (
                          <li key={input.name} className="flex items-center gap-3 px-3 py-2 text-xs">
                            <code className="font-mono w-28 flex-shrink-0">{input.name}</code>
                            <span className="text-gray-500 flex-1">
                              {input.description}
                              {input.required && <span className="text-red-500"> · obligatoire</span>}
                            </span>
                            {declared ? (
                              <span className="inline-flex items-center gap-1 text-green-700">
                                <Check className="w-3.5 h-3.5" /> déclaré
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="btn-secondary text-xs py-0.5 px-2"
                                onClick={() => declarePresetInput(input.name)}
                              >
                                Déclarer
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">
                    Clés racines
                    <Help text="Clés de premier niveau conservées. Toutes cochées = réponse complète." />
                  </label>
                  <button
                    type="button"
                    className="text-xs text-primary-700"
                    onClick={() => setSchema((s) => ({ ...s, responseKeys: [] }))}
                  >
                    Tout inclure
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
                  {(selectedPreset?.responseKeys ?? []).map((key) => {
                    const current = schema.responseKeys ?? []
                    const checked = current.length === 0 || current.includes(key)
                    return (
                      <label key={key} className="flex items-center gap-2 text-xs font-mono cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5"
                          checked={checked}
                          onChange={() =>
                            setSchema((s) => {
                              const all = selectedPreset?.responseKeys ?? []
                              const base = (s.responseKeys ?? []).length ? s.responseKeys! : all
                              const next = checked ? base.filter((k) => k !== key) : [...base, key]
                              return { ...s, responseKeys: next.length === all.length ? [] : next }
                            })
                          }
                        />
                        {key}
                      </label>
                    )
                  })}
                </div>
              </div>

              {selectedPreset?.listKey && (
                <div>
                  <label className="label">
                    Champs de chaque élément de <code className="font-mono">{selectedPreset.listKey}</code>
                    <Help text="Chemins pointés dans chaque élément (ex. line.code). Aucun champ = élément complet tel que produit par le preset." />
                  </label>
                  <FieldRows
                    fields={schema.output?.fields ?? []}
                    suggestions={selectedPreset.itemFields ?? []}
                    sourceLabel="Chemin dans l’élément"
                    emptyText="Aucun champ choisi : chaque élément est renvoyé en entier."
                    onChange={(fields) =>
                      setSchema((s) => ({ ...s, output: { list: selectedPreset.listKey, fields } }))
                    }
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {engineMode === 'declarative' && (
          <>
            <div className="card p-5 mb-5">
              <h2 className="font-semibold mb-1">Entité principale</h2>
              <p className="text-xs text-gray-400 mb-4">
                {entities[schema.entity]?.label}
                {entityCount !== undefined && ` · ${entityCount.toLocaleString('fr-FR')} enregistrements`}
              </p>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="label">Entité</label>
                  <select
                    className="input"
                    value={schema.entity}
                    onChange={(e) =>
                      setSchema((s) => ({ ...s, entity: e.target.value, fields: [], filters: [], relations: [], orderBy: undefined }))
                    }
                  >
                    {Object.entries(entities).map(([name, meta]) => (
                      <option key={name} value={name}>
                        {name} — {meta.label}
                      </option>
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
                      disabled={!schema.multiple}
                      onChange={(e) => setSchema((s) => ({ ...s, paginate: e.target.checked }))}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Enveloppe data + pagination</span>
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
                    {filterableColumns.map((f) => (
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
              {schema.multiple && (
                <p className="text-xs text-gray-400 mt-3">
                  Les listes sont toujours bornées (100 par défaut, 500 max). Déclarez <code>limit</code> /{' '}
                  <code>offset</code> pour laisser l’appelant paginer.
                </p>
              )}
            </div>

            <div className="card p-5 mb-5">
              <h2 className="font-semibold mb-1">
                Champs de réponse
                <Help text="Colonnes de l’entité. Les colonnes JSON (extras) sont adressables par chemin : extras.address.town, extras.keys.REF…" />
              </h2>
              <p className="text-xs text-gray-400 mb-4">Aucun champ = toutes les colonnes de l’entité.</p>
              <FieldRows
                fields={schema.fields}
                suggestions={columnPaths(columns)}
                emptyText="Aucun champ choisi : toutes les colonnes sont renvoyées."
                onChange={(fields) => setSchema((s) => ({ ...s, fields }))}
              />
            </div>

            <div className="card p-5 mb-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">Filtres</h2>
                <button
                  type="button"
                  className="btn-secondary text-xs py-1"
                  onClick={() =>
                    setSchema((s) => ({
                      ...s,
                      filters: [
                        ...s.filters,
                        { field: filterableColumns[0] ?? '', source: 'query', key: '', operator: 'eq' },
                      ],
                    }))
                  }
                >
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
                      <label className="label text-xs">Colonne</label>
                      <select className="input" value={f.field} onChange={(e) => updateFilter(i, 'field', e.target.value)}>
                        {filterableColumns.map((af) => (
                          <option key={af}>{af}</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-36">
                      <label className="label text-xs">Opérateur</label>
                      <select
                        className="input"
                        value={f.operator ?? 'eq'}
                        onChange={(e) => updateFilter(i, 'operator', e.target.value)}
                      >
                        <option value="eq">= égal</option>
                        <option value="in">dans la liste (a,b)</option>
                        <option value="contains">contient</option>
                        <option value="startsWith">commence par</option>
                        <option value="gte">≥</option>
                        <option value="lte">≤</option>
                      </select>
                    </div>
                    <div className="w-40">
                      <label className="label text-xs">Valeur depuis</label>
                      <select className="input" value={f.source} onChange={(e) => updateFilter(i, 'source', e.target.value)}>
                        <option value="path">Param URL (:x)</option>
                        <option value="query">Query string (?x=)</option>
                        <option value="static">Valeur fixe</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="label text-xs">{f.source === 'static' ? 'Valeur' : 'Nom du paramètre'}</label>
                      <input
                        className="input font-mono text-sm"
                        value={f.key}
                        onChange={(e) => updateFilter(i, 'key', e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-ghost p-2 mb-0.5 text-red-500"
                      onClick={() => setSchema((s) => ({ ...s, filters: s.filters.filter((_, fi) => fi !== i) }))}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-5 mb-5">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-semibold">
                  Relations
                  <Help text="Ajoute à chaque élément des données liées, éventuellement depuis l’autre base. Ex. arrêt GTFS → même stopId dans NeTEx pour récupérer extras.address et extras.fare_zone." />
                </h2>
                <button
                  type="button"
                  className="btn-secondary text-xs py-1"
                  onClick={() =>
                    setSchema((s) => ({
                      ...s,
                      relations: [
                        ...(s.relations ?? []),
                        {
                          output: 'lie',
                          entity: s.entity,
                          source: 'active',
                          parentField: filterableColumns[0] ?? '',
                          foreignField: filterableColumns[0] ?? '',
                          fields: [],
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="w-3 h-3" /> Ajouter
                </button>
              </div>
              <p className="text-xs text-gray-400 mb-4">
                Jointure par valeur de colonne, chargée en une requête pour toute la page.
              </p>
              {(schema.relations ?? []).length === 0 && (
                <p className="text-sm text-gray-400 text-center py-3 bg-gray-50 rounded-lg">Aucune relation.</p>
              )}
              <div className="space-y-4">
                {(schema.relations ?? []).map((rel, i) => (
                  <RelationEditor
                    key={i}
                    relation={rel}
                    parentColumns={filterableColumns}
                    endpointSource={source}
                    activeSource={activeSource}
                    onChange={(patch) => updateRelation(i, patch)}
                    onRemove={() =>
                      setSchema((s) => ({ ...s, relations: (s.relations ?? []).filter((_, ri) => ri !== i) }))
                    }
                  />
                ))}
              </div>
            </div>
          </>
        )}

        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">
              Paramètres
              <Help text="Contrat d’entrée de l’endpoint. Seuls ces paramètres sont lus ; les autres sont ignorés. Obligatoire absent → 400. Valeur par défaut appliquée si l’appelant n’envoie rien." />
            </h2>
            <button
              type="button"
              className="btn-secondary text-xs py-1"
              onClick={() => setParams((p) => [...p, { name: '', type: 'string', location: 'query', required: false }])}
            >
              <Plus className="w-3 h-3" /> Ajouter
            </button>
          </div>

          {params.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-3 bg-gray-50 rounded-lg mb-2">
              Aucun paramètre : la réponse ne dépend d’aucune entrée.
            </p>
          )}

          <div className="space-y-3">
            {params.map((p, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3">
                  {i === 0 && <label className="label text-xs">Nom</label>}
                  <input
                    className="input font-mono text-sm"
                    value={p.name}
                    onChange={(e) => updateParam(i, 'name', e.target.value)}
                  />
                </div>
                <div className="col-span-2">
                  {i === 0 && <label className="label text-xs">Emplacement</label>}
                  <select className="input text-sm" value={p.location} onChange={(e) => updateParam(i, 'location', e.target.value)}>
                    <option value="path">:path</option>
                    <option value="query">?query</option>
                  </select>
                </div>
                <div className="col-span-2">
                  {i === 0 && <label className="label text-xs">Type</label>}
                  <select className="input text-sm" value={p.type} onChange={(e) => updateParam(i, 'type', e.target.value)}>
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                  </select>
                </div>
                <div className="col-span-2">
                  {i === 0 && <label className="label text-xs">Défaut</label>}
                  <input
                    className="input font-mono text-sm"
                    value={p.defaultValue ?? ''}
                    disabled={p.location === 'path'}
                    onChange={(e) => updateParam(i, 'defaultValue', e.target.value || undefined)}
                  />
                </div>
                <label className="col-span-2 flex items-center gap-1.5 text-xs pb-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5"
                    checked={p.required || p.location === 'path'}
                    disabled={p.location === 'path'}
                    onChange={(e) => updateParam(i, 'required', e.target.checked)}
                  />
                  Obligatoire
                </label>
                <button
                  type="button"
                  className="col-span-1 btn-ghost p-2 mb-0.5 text-red-500"
                  onClick={() => setParams((ps) => ps.filter((_, pi) => pi !== i))}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <input
                  className="col-span-11 input text-xs py-1"
                  placeholder="Description (documentation OpenAPI)"
                  value={p.description ?? ''}
                  onChange={(e) => updateParam(i, 'description', e.target.value || undefined)}
                />
              </div>
            ))}
          </div>

          <div className="space-y-2 mt-4">
            {diagnostics.missingPathParams.length > 0 && (
              <Warning>
                Paramètre(s) de chemin non déclaré(s) : {diagnostics.missingPathParams.map((n) => `:${n}`).join(', ')}.
              </Warning>
            )}
            {diagnostics.undeclaredFilters.length > 0 && (
              <Warning>
                Filtre(s) branché(s) sur un paramètre non déclaré, donc jamais appliqué(s) :{' '}
                {diagnostics.undeclaredFilters.join(', ')}.
              </Warning>
            )}
            {diagnostics.unread.length > 0 && (
              <Warning>
                Déclaré(s) mais lu(s) par aucun {engineMode === 'preset' ? 'paramètre du preset' : 'filtre'} :{' '}
                {diagnostics.unread.join(', ')}.
              </Warning>
            )}
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
        {resetMut.isError && <p className="text-red-600 text-sm mt-3">{resetMut.error.message}</p>}
      </div>

      <div className="xl:w-96 flex-shrink-0">
        <div className="xl:sticky xl:top-8">
          <div className="card overflow-hidden">
            <div className="px-4 py-3 bg-gray-900 text-white flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">Preview live</p>
                <code className="text-xs text-gray-400">
                  {method} /api{path || '…'}
                </code>
                {sourceMatters && resolvedSource && (
                  <p className="text-[10px] text-gray-400 mt-0.5">base {resolvedSource.toUpperCase()}</p>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-gray-400">
                {previewLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> mise à jour…
                  </span>
                ) : (
                  preview.ms !== undefined && <span>{preview.ms} ms</span>
                )}
                <button
                  type="button"
                  title="Relancer la requête"
                  onClick={() => setPreviewTick((t) => t + 1)}
                  className="btn-ghost p-1.5 text-gray-300 hover:text-white hover:bg-gray-800"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {params.some((p) => p.name) && (
              <div className="border-b border-gray-100 px-4 py-3 space-y-2 bg-gray-50">
                <p className="text-xs font-medium text-gray-500 uppercase">Paramètres de test</p>
                {params
                  .filter((p) => p.name)
                  .map((p) => {
                    const isPath = p.location === 'path'
                    const values = isPath ? previewPathParams : previewQueryParams
                    const setValues = isPath ? setPreviewPathParams : setPreviewQueryParams
                    return (
                      <div key={`${p.location}-${p.name}`} className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 w-28 font-mono truncate">
                          {isPath ? ':' : '?'}
                          {p.name}
                          {(p.required || isPath) && <span className="text-red-500">*</span>}
                        </label>
                        <input
                          className="input text-xs py-1"
                          placeholder={p.defaultValue ?? ''}
                          value={values[p.name] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                        />
                      </div>
                    )
                  })}
              </div>
            )}

            <div className="bg-gray-950 min-h-48 max-h-[60vh] overflow-auto">
              {preview.error && (
                <div
                  className={`p-4 text-xs font-mono border-b border-gray-800 ${
                    preview.error.startsWith('Paramètre obligatoire') ? 'text-amber-300' : 'text-red-400'
                  }`}
                >
                  {preview.error.startsWith('Paramètre obligatoire')
                    ? `${preview.error} — renseignez-le dans les paramètres de test.`
                    : `Erreur : ${preview.error}`}
                </div>
              )}
              {'result' in preview && (
                <pre
                  className={`p-4 text-xs text-green-400 font-mono whitespace-pre-wrap transition-opacity ${
                    preview.error || previewLoading ? 'opacity-40' : ''
                  }`}
                >
                  {preview.result === null
                    ? 'null — aucune ressource (404 en production)'
                    : JSON.stringify(preview.result, null, 2)}
                </pre>
              )}
              {!('result' in preview) && !preview.error && (
                <div className="p-4 text-gray-600 text-xs text-center mt-8">Chargement de la réponse…</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function RelationEditor({
  relation,
  parentColumns,
  endpointSource,
  activeSource,
  onChange,
  onRemove,
}: {
  relation: RelationDef
  parentColumns: string[]
  endpointSource: EndpointSource
  activeSource?: 'gtfs' | 'netex'
  onChange: (patch: Partial<RelationDef>) => void
  onRemove: () => void
}) {
  const relSource = relation.source && relation.source !== 'active' ? relation.source : endpointSource
  const resolved = relSource === 'active' ? activeSource : relSource
  const { data } = useQuery({
    queryKey: ['endpoint-fields', resolved],
    queryFn: () => api.endpoints.fields(resolved),
    enabled: Boolean(resolved),
  })
  const entities = data?.entities ?? {}
  const columns = entities[relation.entity]?.columns ?? []
  const foreignColumns = columns.filter((c) => c.type !== 'json').map((c) => c.name)

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-3">
          <label className="label text-xs">Clé de sortie</label>
          <input
            className="input font-mono text-sm"
            value={relation.output}
            onChange={(e) => onChange({ output: e.target.value })}
          />
        </div>
        <div className="col-span-3">
          <label className="label text-xs">Base</label>
          <select
            className="input text-sm"
            value={relation.source ?? 'active'}
            onChange={(e) => onChange({ source: e.target.value as EndpointSource })}
          >
            <option value="active">Même base</option>
            <option value="gtfs">GTFS</option>
            <option value="netex">NeTEx</option>
          </select>
        </div>
        <div className="col-span-3">
          <label className="label text-xs">Entité liée</label>
          <select
            className="input text-sm"
            value={relation.entity}
            onChange={(e) => onChange({ entity: e.target.value, fields: [], foreignField: '' })}
          >
            {Object.keys(entities).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label text-xs">Retour</label>
          <select
            className="input text-sm"
            value={relation.multiple ? 'many' : 'one'}
            onChange={(e) => onChange({ multiple: e.target.value === 'many' })}
          >
            <option value="one">Objet</option>
            <option value="many">Liste</option>
          </select>
        </div>
        <button type="button" className="col-span-1 btn-ghost p-2 mb-0.5 text-red-500" onClick={onRemove}>
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-end gap-2 text-sm">
        <div className="flex-1">
          <label className="label text-xs">Colonne de l’élément</label>
          <select className="input text-sm" value={relation.parentField} onChange={(e) => onChange({ parentField: e.target.value })}>
            {parentColumns.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <span className="text-gray-400 mb-2">=</span>
        <div className="flex-1">
          <label className="label text-xs">Colonne de {relation.entity}</label>
          <select className="input text-sm" value={relation.foreignField} onChange={(e) => onChange({ foreignField: e.target.value })}>
            <option value="">—</option>
            {foreignColumns.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        {relation.multiple && (
          <div className="flex-1">
            <label className="label text-xs">Trier par</label>
            <select
              className="input text-sm"
              value={relation.orderBy?.field ?? ''}
              onChange={(e) => onChange({ orderBy: e.target.value ? { field: e.target.value, direction: 'asc' } : undefined })}
            >
              <option value="">—</option>
              {foreignColumns.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <FieldRows
        fields={relation.fields}
        suggestions={columnPaths(columns)}
        emptyText="Aucun champ choisi : toutes les colonnes de l’entité liée."
        onChange={(fields) => onChange({ fields })}
      />
    </div>
  )
}
