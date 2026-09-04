import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { ArrowLeft, Loader2, MapPin, Route } from 'lucide-react'

export default function PoiDetail() {
  const { id = '' } = useParams()
  const stopId = decodeURIComponent(id)

  const { data, isLoading, error } = useQuery({
    queryKey: ['explore-stop', stopId],
    queryFn: () => api.explore.stop(stopId),
    enabled: Boolean(stopId),
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <Link to="/explorer" className="btn-ghost inline-flex items-center gap-2 mb-6">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Link>
        <div className="card p-12 text-center text-gray-400">POI / arrêt introuvable</div>
      </div>
    )
  }

  const stop = data.stop
  const isPoi = Boolean(stop.isPoi) || Number(stop.locationType) === 3
  const classifications = Array.isArray(stop.classifications)
    ? (stop.classifications as string[])
    : []
  const classification =
    (typeof stop.classification === 'string' && stop.classification) || classifications[0] || null
  const address = stop.address as
    | { line?: string; town?: string; postcode?: string; region?: string }
    | null
    | undefined
  const keys = stop.keys as Record<string, string> | null | undefined
  const extras = stop.extras as Record<string, unknown> | null | undefined

  return (
    <div className="p-8 max-w-4xl">
      <Link to="/explorer" className="btn-ghost inline-flex items-center gap-2 mb-6">
        <ArrowLeft className="w-4 h-4" /> Explorateur
      </Link>

      <div className="flex items-start gap-4 mb-8">
        <div className="w-14 h-14 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center flex-shrink-0">
          <MapPin className="w-7 h-7" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{String(stop.name ?? stopId)}</h1>
          <p className="text-sm text-gray-400 font-mono mt-1 break-all">{String(stop.stopId)}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            {isPoi ? (
              <span className="badge bg-amber-50 text-amber-800">POI</span>
            ) : (
              <span className="badge bg-sky-50 text-sky-800">
                {Number(stop.locationType) === 1 ? 'Zone d’arrêts' : 'Arrêt'}
              </span>
            )}
            {classification && (
              <span className="badge bg-violet-50 text-violet-800">{classification}</span>
            )}
            {stop.code != null && String(stop.code) !== '' && (
              <span className="badge bg-gray-100 text-gray-600 font-mono">{String(stop.code)}</span>
            )}
            {stop.netexType != null && (
              <span className="badge bg-gray-100 text-gray-500 font-mono text-[10px]">
                {String(stop.netexType)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="card p-5 space-y-3 text-sm">
          <h2 className="font-semibold">Localisation</h2>
          {stop.lat != null && stop.lon != null ? (
            <>
              <p className="font-mono text-xs">
                {Number(stop.lat).toFixed(6)}, {Number(stop.lon).toFixed(6)}
              </p>
              <a
                className="text-primary-600 text-xs underline"
                href={`https://www.openstreetmap.org/?mlat=${stop.lat}&mlon=${stop.lon}#map=18/${stop.lat}/${stop.lon}`}
                target="_blank"
                rel="noreferrer"
              >
                Ouvrir dans OpenStreetMap
              </a>
            </>
          ) : (
            <p className="text-gray-400">Coordonnées absentes</p>
          )}
          {address && (
            <div className="pt-2 border-t border-gray-100 space-y-1">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Adresse</p>
              {address.line && <p>{address.line}</p>}
              <p>
                {[address.postcode, address.town].filter(Boolean).join(' ')}
              </p>
              {address.region && <p className="text-gray-500 text-xs">{address.region}</p>}
            </div>
          )}
        </div>

        <div className="card p-5 space-y-3 text-sm">
          <h2 className="font-semibold">Détails importés</h2>
          <dl className="space-y-2">
            <div>
              <dt className="text-xs text-gray-400">Catégories</dt>
              <dd>
                {classifications.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {classifications.map((c) => (
                      <span key={c} className="badge bg-violet-50 text-violet-800">
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">Zone tarifaire</dt>
              <dd className="font-mono text-xs">
                {data.fareZone
                  ? `${data.fareZone.name ?? data.fareZone.id} (${data.fareZone.id})`
                  : stop.zoneId
                    ? String(stop.zoneId)
                    : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">Parent</dt>
              <dd className="font-mono text-xs">{String(stop.parentStation ?? '—')}</dd>
            </div>
          </dl>
        </div>
      </div>

      {keys && Object.keys(keys).length > 0 && (
        <div className="card p-5 mb-8">
          <h2 className="font-semibold mb-3">Identifiants (keyList)</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {Object.entries(keys).map(([k, v]) => (
              <div key={k} className="flex gap-2 min-w-0">
                <dt className="text-gray-400 w-24 flex-shrink-0 font-mono text-xs">{k}</dt>
                <dd className="font-mono text-xs truncate" title={String(v)}>
                  {String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {extras && (
        <div className="card p-5 mb-8">
          <h2 className="font-semibold mb-3">Extras JSON (brut)</h2>
          <pre className="text-xs font-mono bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-auto max-h-80">
            {JSON.stringify(extras, null, 2)}
          </pre>
        </div>
      )}

      {data.lines.length > 0 && (
        <div className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Route className="w-4 h-4" /> Lignes desservant cet arrêt
          </h2>
          <ul className="divide-y divide-gray-100">
            {data.lines.map((r) => {
              const rid = String(r.routeId)
              return (
                <li key={rid}>
                  <Link
                    to={`/explorer/lines/${encodeURIComponent(rid)}`}
                    className="flex items-center gap-3 py-2.5 hover:bg-gray-50 px-1 rounded"
                  >
                    <span className="font-medium">{String(r.shortName ?? rid)}</span>
                    <span className="text-sm text-gray-500 truncate flex-1">
                      {String(r.longName ?? '')}
                    </span>
                    {(r.commercialMode as { name?: string } | undefined)?.name && (
                      <span className="badge bg-emerald-50 text-emerald-800">
                        {(r.commercialMode as { name: string }).name}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
