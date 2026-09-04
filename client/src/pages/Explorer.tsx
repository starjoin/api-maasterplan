import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Search, Loader2, Route, MapPin, ChevronLeft, ChevronRight } from 'lucide-react'

const ROUTE_TYPES: Record<number, string> = {
  0: 'Tram',
  1: 'Métro',
  2: 'Train',
  3: 'Bus',
  4: 'Navigône',
  5: 'Téléphérique',
  6: 'Téléphérique',
  7: 'Funiculaire',
  11: 'Chrono',
  12: 'Monorail',
  200: 'Cars région',
}

const PAGE_SIZE = 50

const STOP_TYPE_LABELS: Record<number, string> = {
  0: 'Arrêt (stop_point)',
  1: 'Zone d’arrêts (stop_area)',
  2: 'Entrée / sortie',
  3: 'POI',
  4: 'Zone d’embarquement',
  [-1]: 'Non renseigné',
}

function stopTypeLabel(locationType: unknown): string {
  if (locationType == null) return STOP_TYPE_LABELS[-1]
  const n = Number(locationType)
  return STOP_TYPE_LABELS[n] ?? `Type ${n}`
}

function LinePicto({
  code,
  color,
  picto,
}: {
  code: string
  color?: string | null
  picto?: string | null
}) {
  const [failed, setFailed] = useState(false)
  const bg = color ? `#${String(color).replace(/^#/, '')}` : undefined

  if (picto && !failed) {
    return (
      <img
        src={picto}
        alt={`Ligne ${code}`}
        className="w-10 h-10 object-contain flex-shrink-0"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <span
      className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0 bg-gray-300"
      style={bg ? { backgroundColor: bg } : undefined}
    >
      {code || '?'}
    </span>
  )
}

function Pagination({
  page,
  pages,
  total,
  limit,
  onChange,
}: {
  page: number
  pages: number
  total: number
  limit: number
  onChange: (page: number) => void
}) {
  if (pages <= 1) return null

  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  const windowPages: number[] = []
  const start = Math.max(1, page - 2)
  const end = Math.min(pages, page + 2)
  for (let i = start; i <= end; i++) windowPages.push(i)

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
      <p className="text-xs text-gray-400">
        Affichage {from.toLocaleString('fr-FR')}–{to.toLocaleString('fr-FR')} sur{' '}
        {total.toLocaleString('fr-FR')}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn-secondary py-1.5 px-2"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {start > 1 && (
          <>
            <button type="button" className="btn-ghost py-1.5 px-2.5 text-xs" onClick={() => onChange(1)}>
              1
            </button>
            {start > 2 && <span className="px-1 text-gray-400 text-xs">…</span>}
          </>
        )}

        {windowPages.map((p) => (
          <button
            key={p}
            type="button"
            className={`py-1.5 px-2.5 text-xs rounded-lg font-medium ${
              p === page ? 'bg-primary-600 text-white' : 'btn-ghost'
            }`}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        ))}

        {end < pages && (
          <>
            {end < pages - 1 && <span className="px-1 text-gray-400 text-xs">…</span>}
            <button type="button" className="btn-ghost py-1.5 px-2.5 text-xs" onClick={() => onChange(pages)}>
              {pages}
            </button>
          </>
        )}

        <button
          type="button"
          className="btn-secondary py-1.5 px-2"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export default function Explorer() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'routes' | 'stops'>('routes')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [modeType, setModeType] = useState<number | null>(null)
  const [commercial, setCommercial] = useState<string | null>(null)
  const [stopType, setStopType] = useState<number | null>(null)
  const [poiClass, setPoiClass] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const showPoiCategories = tab === 'stops' && (stopType === 3 || stopType === null)

  const { data: modesData } = useQuery({
    queryKey: ['explore-route-modes'],
    queryFn: api.explore.routeModes,
    enabled: tab === 'routes',
  })

  const { data: commercialData } = useQuery({
    queryKey: ['explore-commercial-modes', modeType],
    queryFn: () => api.explore.commercialModes({ type: modeType ?? undefined }),
    enabled: tab === 'routes',
  })

  const { data: stopTypesData } = useQuery({
    queryKey: ['explore-stop-types'],
    queryFn: api.explore.stopTypes,
    enabled: tab === 'stops',
  })

  const { data: poiCategoriesData } = useQuery({
    queryKey: ['explore-poi-categories'],
    queryFn: api.explore.poiCategories,
    enabled: showPoiCategories,
  })

  const offset = (page - 1) * PAGE_SIZE
  const effectivePoiClass = stopType === 3 || (stopType === null && poiClass) ? poiClass : null

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['explore', tab, search, modeType, commercial, stopType, effectivePoiClass, page],
    queryFn: () =>
      tab === 'routes'
        ? api.explore.routes({
            q: search || undefined,
            type: modeType ?? undefined,
            commercial: commercial ?? undefined,
            limit: PAGE_SIZE,
            offset,
          })
        : api.explore.stops({
            q: search || undefined,
            locationType: effectivePoiClass ? 3 : (stopType ?? undefined),
            classification: effectivePoiClass ?? undefined,
            poiOnly: Boolean(effectivePoiClass),
            limit: PAGE_SIZE,
            offset,
          }),
    placeholderData: (prev, previousQuery) =>
      previousQuery?.queryKey?.[1] === tab ? prev : undefined,
  })

  useEffect(() => {
    setPage(1)
  }, [tab, search, modeType, commercial, stopType, poiClass])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(q.trim())
  }

  const handleTab = (next: 'routes' | 'stops') => {
    setTab(next)
    setModeType(null)
    setCommercial(null)
    setStopType(null)
    setPoiClass(null)
    setPage(1)
  }

  const total = data?.total ?? 0
  const pages = data?.pages ?? Math.max(Math.ceil(total / PAGE_SIZE), 1)
  const currentPage = data?.page ?? page
  const commercialLabel = commercialData?.modes.find((m) => m.key === commercial)?.name
  const stopTypeActiveLabel =
    stopType !== null ? stopTypesData?.types.find((t) => t.locationType === stopType)?.label : null
  const poiClassLabel = poiCategoriesData?.categories.find((c) => c.key === effectivePoiClass)?.name

  const hasFilters =
    search || modeType !== null || commercial || stopType !== null || effectivePoiClass !== null

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Explorateur GTFS</h1>
        <p className="text-sm text-gray-400 mt-1">Parcourez les données importées depuis le RFU</p>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          className={`btn ${tab === 'routes' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => handleTab('routes')}
        >
          <Route className="w-4 h-4" /> Lignes
        </button>
        <button
          className={`btn ${tab === 'stops' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => handleTab('stops')}
        >
          <MapPin className="w-4 h-4" /> Arrêts / POI
        </button>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9"
            placeholder={tab === 'routes' ? 'Rechercher une ligne…' : 'Rechercher un arrêt / POI…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-secondary">
          Rechercher
        </button>
        {hasFilters && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setQ('')
              setSearch('')
              setModeType(null)
              setCommercial(null)
              setStopType(null)
              setPoiClass(null)
            }}
          >
            Réinitialiser
          </button>
        )}
      </form>

      {tab === 'routes' && (
        <div className="mb-6 space-y-3">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Mode physique</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setModeType(null)
                  setCommercial(null)
                }}
                className={`badge px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                  modeType === null
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Tous
                {modesData && (
                  <span className="ml-1 opacity-80">
                    ({modesData.modes.reduce((s, m) => s + m.count, 0).toLocaleString('fr-FR')})
                  </span>
                )}
              </button>
              {(modesData?.modes ?? []).map((m) => (
                <button
                  key={m.type}
                  type="button"
                  onClick={() => {
                    setModeType(m.type)
                    setCommercial(null)
                  }}
                  className={`badge px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                    modeType === m.type
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {m.label}
                  <span className="ml-1 opacity-80">({m.count.toLocaleString('fr-FR')})</span>
                </button>
              ))}
            </div>
          </div>

          {(commercialData?.modes?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                Mode commercial (sous-mode)
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCommercial(null)}
                  className={`badge px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                    commercial === null
                      ? 'bg-emerald-700 text-white'
                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  }`}
                >
                  Tous les sous-modes
                  {commercialData && (
                    <span className="ml-1 opacity-80">
                      ({commercialData.total.toLocaleString('fr-FR')})
                    </span>
                  )}
                </button>
                {(commercialData?.modes ?? []).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setCommercial(m.key)}
                    className={`badge px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                      commercial === m.key
                        ? 'bg-emerald-700 text-white'
                        : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    }`}
                  >
                    {m.name}
                    <span className="ml-1 opacity-80">({m.count.toLocaleString('fr-FR')})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'stops' && (
        <div className="mb-6 space-y-3">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Type</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setStopType(null)
                  setPoiClass(null)
                }}
                className={`badge px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                  stopType === null
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Tous
                {stopTypesData && (
                  <span className="ml-1 opacity-80">
                    ({stopTypesData.types.reduce((s, t) => s + t.count, 0).toLocaleString('fr-FR')})
                  </span>
                )}
              </button>
              {(stopTypesData?.types ?? []).map((t) => (
                <button
                  key={t.locationType}
                  type="button"
                  onClick={() => {
                    setStopType(t.locationType)
                    if (t.locationType !== 3) setPoiClass(null)
                  }}
                  className={`badge px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                    stopType === t.locationType
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t.label}
                  <span className="ml-1 opacity-80">({t.count.toLocaleString('fr-FR')})</span>
                </button>
              ))}
            </div>
          </div>

          {(stopType === 3 || stopType === null) && (poiCategoriesData?.categories.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                Catégorie POI (Vélo’v, parking, bornes…)
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPoiClass(null)}
                  className={`badge px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                    poiClass === null
                      ? 'bg-violet-700 text-white'
                      : 'bg-violet-50 text-violet-800 hover:bg-violet-100'
                  }`}
                >
                  Toutes les catégories
                  {poiCategoriesData && (
                    <span className="ml-1 opacity-80">
                      ({poiCategoriesData.total.toLocaleString('fr-FR')})
                    </span>
                  )}
                </button>
                {(poiCategoriesData?.categories ?? []).map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      setStopType(3)
                      setPoiClass(c.key)
                    }}
                    className={`badge px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                      poiClass === c.key
                        ? 'bg-violet-700 text-white'
                        : 'bg-violet-50 text-violet-800 hover:bg-violet-100'
                    }`}
                  >
                    {c.name}
                    <span className="ml-1 opacity-80">({c.count.toLocaleString('fr-FR')})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isLoading && !data ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : !data?.items.length ? (
        <div className="card p-12 text-center text-gray-400">
          {hasFilters
            ? 'Aucun résultat pour ces filtres'
            : 'Aucune donnée — lancez un import depuis le Dashboard'}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-400">
              {total.toLocaleString('fr-FR')} résultat(s)
              {modeType !== null && (
                <span className="ml-1">
                  · mode <strong>{ROUTE_TYPES[modeType] ?? `Type ${modeType}`}</strong>
                </span>
              )}
              {commercialLabel && (
                <span className="ml-1">
                  · sous-mode <strong>{commercialLabel}</strong>
                </span>
              )}
              {stopTypeActiveLabel && (
                <span className="ml-1">
                  · type <strong>{stopTypeActiveLabel}</strong>
                </span>
              )}
              {poiClassLabel && (
                <span className="ml-1">
                  · catégorie <strong>{poiClassLabel}</strong>
                </span>
              )}
              {isFetching && <Loader2 className="inline w-3.5 h-3.5 ml-2 animate-spin text-primary-500" />}
            </p>
            <p className="text-xs text-gray-400">
              Page {currentPage} / {pages}
            </p>
          </div>

          <div className="card divide-y divide-gray-100">
            {tab === 'routes'
              ? data.items
                  .filter((r) => r.routeId != null)
                  .map((r) => {
                    const routeId = String(r.routeId)
                    const shortName = String(r.shortName ?? '')
                    const commercialName =
                      (r.commercialMode as { name?: string } | undefined)?.name ??
                      ROUTE_TYPES[Number(r.type)]
                    const netexSubmode =
                      typeof r.netexSubmode === 'string' ? r.netexSubmode : null
                    return (
                      <button
                        key={routeId}
                        type="button"
                        className="w-full text-left px-5 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors"
                        onClick={() => navigate(`/explorer/lines/${encodeURIComponent(routeId)}`)}
                      >
                        <LinePicto
                          code={shortName}
                          color={r.color as string | null}
                          picto={r.pictoUrl as string | null}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {String(r.longName ?? r.shortName ?? r.routeId)}
                          </p>
                          <p className="text-xs text-gray-400 font-mono">{routeId}</p>
                        </div>
                        {netexSubmode && (
                          <span className="badge bg-amber-50 text-amber-800" title="Sous-mode NeTEx">
                            {netexSubmode}
                          </span>
                        )}
                        <span className="badge bg-emerald-50 text-emerald-800">{commercialName}</span>
                        <span className="badge bg-gray-100 text-gray-600">
                          {ROUTE_TYPES[Number(r.type)] ?? `Type ${r.type}`}
                        </span>
                      </button>
                    )
                  })
              : data.items
                  .filter((s) => s.stopId != null)
                  .map((s) => {
                    const stopId = String(s.stopId)
                    const classification =
                      typeof s.classification === 'string' ? s.classification : null
                    const isPoi = Boolean(s.isPoi) || Number(s.locationType) === 3
                    return (
                      <button
                        key={stopId}
                        type="button"
                        className="w-full text-left px-5 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors"
                        onClick={() => navigate(`/explorer/stops/${encodeURIComponent(stopId)}`)}
                      >
                        <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{String(s.name ?? 'Sans nom')}</p>
                          <p className="text-xs text-gray-400 font-mono">{stopId}</p>
                        </div>
                        {isPoi && classification && (
                          <span className="badge bg-violet-50 text-violet-800">{classification}</span>
                        )}
                        <span className={`badge ${isPoi ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800'}`}>
                          {isPoi ? 'POI' : stopTypeLabel(s.locationType)}
                        </span>
                        {s.lat != null && s.lon != null && (
                          <span className="text-xs text-gray-400 font-mono">
                            {Number(s.lat).toFixed(5)}, {Number(s.lon).toFixed(5)}
                          </span>
                        )}
                      </button>
                    )
                  })}
          </div>

          <Pagination
            page={currentPage}
            pages={pages}
            total={total}
            limit={data.limit ?? PAGE_SIZE}
            onChange={setPage}
          />
        </>
      )}
    </div>
  )
}
