import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Search, Loader2, Route, MapPin, ChevronLeft, ChevronRight } from 'lucide-react'

const ROUTE_TYPES: Record<number, string> = {
  0: 'Tram',
  1: 'Métro',
  2: 'Train',
  3: 'Bus',
  4: 'Ferry',
  5: 'Téléphérique',
  6: 'Téléphérique',
  7: 'Funiculaire',
  11: 'Trolleybus',
  12: 'Monorail',
}

const PAGE_SIZE = 50

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
  const [tab, setTab] = useState<'routes' | 'stops'>('routes')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [modeType, setModeType] = useState<number | null>(null)
  const [page, setPage] = useState(1)

  const { data: modesData } = useQuery({
    queryKey: ['explore-route-modes'],
    queryFn: api.explore.routeModes,
    enabled: tab === 'routes',
  })

  const offset = (page - 1) * PAGE_SIZE

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['explore', tab, search, modeType, page],
    queryFn: () =>
      tab === 'routes'
        ? api.explore.routes({
            q: search || undefined,
            type: modeType ?? undefined,
            limit: PAGE_SIZE,
            offset,
          })
        : api.explore.stops({
            q: search || undefined,
            limit: PAGE_SIZE,
            offset,
          }),
    placeholderData: (prev) => prev,
  })

  useEffect(() => {
    setPage(1)
  }, [tab, search, modeType])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(q.trim())
  }

  const handleTab = (next: 'routes' | 'stops') => {
    setTab(next)
    setModeType(null)
  }

  const total = data?.total ?? 0
  const pages = data?.pages ?? Math.max(Math.ceil(total / PAGE_SIZE), 1)
  const currentPage = data?.page ?? page

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
          <MapPin className="w-4 h-4" /> Arrêts
        </button>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9"
            placeholder={tab === 'routes' ? 'Rechercher une ligne…' : 'Rechercher un arrêt…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-secondary">
          Rechercher
        </button>
        {(search || modeType !== null) && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setQ('')
              setSearch('')
              setModeType(null)
            }}
          >
            Réinitialiser
          </button>
        )}
      </form>

      {tab === 'routes' && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            type="button"
            onClick={() => setModeType(null)}
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
              onClick={() => setModeType(m.type)}
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
      )}

      {isLoading && !data ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : !data?.items.length ? (
        <div className="card p-12 text-center text-gray-400">
          {search || modeType !== null
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
              {isFetching && <Loader2 className="inline w-3.5 h-3.5 ml-2 animate-spin text-primary-500" />}
            </p>
            <p className="text-xs text-gray-400">
              Page {currentPage} / {pages}
            </p>
          </div>

          <div className="card divide-y divide-gray-100">
            {tab === 'routes'
              ? data.items.map((r) => (
                  <div key={String(r.routeId)} className="px-5 py-3 flex items-center gap-4">
                    {r.color ? (
                      <span
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                        style={{ backgroundColor: `#${String(r.color).replace(/^#/, '')}` }}
                      >
                        {String(r.shortName ?? '')}
                      </span>
                    ) : (
                      <span className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {String(r.shortName ?? '?')}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {String(r.longName ?? r.shortName ?? r.routeId)}
                      </p>
                      <p className="text-xs text-gray-400 font-mono">{String(r.routeId)}</p>
                    </div>
                    <span className="badge bg-gray-100 text-gray-600">
                      {ROUTE_TYPES[Number(r.type)] ?? `Type ${r.type}`}
                    </span>
                  </div>
                ))
              : data.items.map((s) => (
                  <div key={String(s.stopId)} className="px-5 py-3 flex items-center gap-4">
                    <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{String(s.name)}</p>
                      <p className="text-xs text-gray-400 font-mono">{String(s.stopId)}</p>
                    </div>
                    {s.lat != null && s.lon != null && (
                      <span className="text-xs text-gray-400 font-mono">
                        {Number(s.lat).toFixed(5)}, {Number(s.lon).toFixed(5)}
                      </span>
                    )}
                  </div>
                ))}
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
