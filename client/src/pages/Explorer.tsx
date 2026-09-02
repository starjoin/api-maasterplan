import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Search, Loader2, Route, MapPin } from 'lucide-react'

const ROUTE_TYPES: Record<number, string> = {
  0: 'Tram',
  1: 'Métro',
  2: 'Train',
  3: 'Bus',
  4: 'Ferry',
  7: 'Funiculaire',
  11: 'Trolleybus',
}

export default function Explorer() {
  const [tab, setTab] = useState<'routes' | 'stops'>('routes')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['explore', tab, search],
    queryFn: () =>
      tab === 'routes'
        ? api.explore.routes({ q: search || undefined, limit: 50 })
        : api.explore.stops({ q: search || undefined, limit: 50 }),
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(q)
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Explorateur GTFS</h1>
        <p className="text-sm text-gray-400 mt-1">Parcourez les données importées depuis le RFU</p>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          className={`btn ${tab === 'routes' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('routes')}
        >
          <Route className="w-4 h-4" /> Lignes
        </button>
        <button
          className={`btn ${tab === 'stops' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('stops')}
        >
          <MapPin className="w-4 h-4" /> Arrêts
        </button>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
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
      </form>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : !data?.items.length ? (
        <div className="card p-12 text-center text-gray-400">
          {search ? 'Aucun résultat' : 'Aucune donnée — lancez un import depuis le Dashboard'}
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-400 mb-4">{data.total.toLocaleString('fr-FR')} résultat(s)</p>
          <div className="card divide-y divide-gray-100">
            {tab === 'routes'
              ? data.items.map((r) => (
                  <div key={String(r.routeId)} className="px-5 py-3 flex items-center gap-4">
                    {r.color ? (
                      <span
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                        style={{ backgroundColor: `#${r.color}` }}
                      >
                        {String(r.shortName ?? '')}
                      </span>
                    ) : (
                      <span className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {String(r.shortName ?? '?')}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{String(r.longName ?? r.shortName ?? r.routeId)}</p>
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
        </>
      )}
    </div>
  )
}
