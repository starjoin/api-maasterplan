import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import LineMap from '../components/LineMap'
import { ArrowLeft, Clock, Loader2, MapPin, Route } from 'lucide-react'

function formatNavitiaTime(t: string | null | undefined): string {
  if (!t) return '—'
  if (t.includes(':')) {
    const [hh, mm = '00', ss = '00'] = t.split(':')
    const h = Number(hh)
    if (Number.isNaN(h)) return t
    const day = h >= 24 ? ` J+${Math.floor(h / 24)}` : ''
    return `${String(h % 24).padStart(2, '0')}:${mm.padStart(2, '0')}:${ss.padStart(2, '0')}${day}`
  }
  const raw = t.replace(/\D/g, '').padStart(6, '0')
  const h = Number(raw.slice(0, 2))
  const m = raw.slice(2, 4)
  const s = raw.slice(4, 6)
  const day = h >= 24 ? ` J+${Math.floor(h / 24)}` : ''
  return `${String(h % 24).padStart(2, '0')}:${m}:${s}${day}`
}

function LinePicto({
  code,
  color,
  picto,
  size = 56,
}: {
  code: string
  color?: string | null
  picto?: string | null
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  const bg = color ? `#${String(color).replace(/^#/, '')}` : '#9ca3af'

  if (picto && !failed) {
    return (
      <img
        src={picto}
        alt={`Ligne ${code}`}
        style={{ width: size, height: size }}
        className="object-contain flex-shrink-0"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <span
      className="rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: bg }}
    >
      {code || '?'}
    </span>
  )
}

export default function LineDetail() {
  const { id = '' } = useParams()
  const routeId = decodeURIComponent(id)

  const { data, isLoading, error } = useQuery({
    queryKey: ['explore-route', routeId],
    queryFn: () => api.explore.route(routeId),
    enabled: Boolean(routeId),
  })

  const [dirIndex, setDirIndex] = useState(0)

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
        <div className="card p-12 text-center text-gray-400">Ligne introuvable</div>
      </div>
    )
  }

  const line = data.line as {
    code?: string
    name?: string
    color?: string | null
    text_color?: string | null
    opening_time?: string | null
    closing_time?: string | null
    commercial_mode?: { name?: string }
    physical_modes?: Array<{ name?: string }>
    network?: { name?: string }
    routes?: Array<{ name?: string; direction_type?: string; geojson?: unknown }>
    geojson?: {
      type?: string
      features?: Array<{
        type?: string
        geometry?: { type?: string; coordinates?: number[][] | number[][][] }
        properties?: Record<string, unknown>
      }>
    }
  }

  const directions = data.thermometer?.directions ?? []
  const activeDir = directions[Math.min(dirIndex, Math.max(directions.length - 1, 0))]
  const code = String(line.code ?? data.route.shortName ?? '')
  const color = (line.color ?? data.route.color) as string | null

  // Préférer le geojson de la direction active, sinon union ligne
  const activeRouteGeo =
    (line.routes?.[dirIndex] as { geojson?: typeof line.geojson } | undefined)?.geojson
  const mapGeojson =
    activeRouteGeo?.features?.length ? activeRouteGeo : line.geojson

  return (
    <div className="p-8 max-w-5xl">
      <Link to="/explorer" className="btn-ghost inline-flex items-center gap-2 mb-6">
        <ArrowLeft className="w-4 h-4" /> Explorateur
      </Link>

      <div className="flex flex-wrap items-start gap-5 mb-8">
        <LinePicto code={code} color={color} picto={data.pictoUrl} size={64} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold truncate">{String(line.name ?? code)}</h1>
            {line.commercial_mode?.name && (
              <span className="badge bg-emerald-50 text-emerald-800">{line.commercial_mode.name}</span>
            )}
            {line.physical_modes?.[0]?.name && (
              <span className="badge bg-gray-100 text-gray-600">{line.physical_modes[0].name}</span>
            )}
          </div>
          <p className="text-sm text-gray-400 font-mono">{String(data.route.routeId)}</p>
          {line.network?.name && (
            <p className="text-sm text-gray-500 mt-1">Réseau {line.network.name}</p>
          )}
        </div>
      </div>

      <div className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <MapPin className="w-4 h-4" /> Tracé
        </h2>
        <LineMap geojson={mapGeojson} color={color} />
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        <div className="card p-5 flex items-start gap-3">
          <Clock className="w-5 h-5 text-primary-600 mt-0.5" />
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400 font-medium">1er départ</p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {formatNavitiaTime(line.opening_time)}
            </p>
          </div>
        </div>
        <div className="card p-5 flex items-start gap-3">
          <Clock className="w-5 h-5 text-primary-600 mt-0.5" />
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400 font-medium">Dernier départ</p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {formatNavitiaTime(line.closing_time)}
            </p>
          </div>
        </div>
      </div>

      {(line.routes?.length ?? 0) > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Route className="w-4 h-4" /> Directions
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {line.routes!.map((r, i) => (
              <div key={i} className="card px-4 py-3">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">
                  {r.direction_type === 'inbound'
                    ? 'Retour'
                    : r.direction_type === 'outbound'
                      ? 'Aller'
                      : r.direction_type ?? 'Direction'}
                </p>
                <p className="font-medium text-sm">{r.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Thermomètre de ligne
          </h2>
          {directions.length > 1 && (
            <div className="flex gap-2">
              {directions.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setDirIndex(i)}
                  className={`badge px-3 py-1.5 text-xs cursor-pointer ${
                    dirIndex === i
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {d.headsign || `Direction ${d.direction_id ?? i}`}
                </button>
              ))}
            </div>
          )}
        </div>

        {!activeDir || activeDir.stop_points.length === 0 ? (
          <div className="card p-8 text-center text-gray-400">Aucun arrêt sur cette ligne</div>
        ) : (
          <div className="card overflow-hidden">
            <ol className="divide-y divide-gray-100">
              {activeDir.stop_points.map((sp, idx) => {
                const isFirst = idx === 0
                const isLast = idx === activeDir.stop_points.length - 1
                return (
                  <li key={`${sp.order}-${sp.stop_point.id}`} className="flex gap-4 px-5 py-3">
                    <div className="flex flex-col items-center w-6 flex-shrink-0">
                      <span
                        className={`w-3 h-3 rounded-full border-2 ${
                          isFirst || isLast
                            ? 'bg-primary-600 border-primary-600'
                            : 'bg-white border-primary-400'
                        }`}
                      />
                      {!isLast && <span className="flex-1 w-0.5 bg-primary-200 mt-1" />}
                    </div>
                    <div className="flex-1 min-w-0 pb-1">
                      <p className="font-medium text-sm truncate">
                        {sp.stop_point.name ?? sp.stop_point.label ?? sp.stop_point.id}
                      </p>
                      <p className="text-xs text-gray-400 font-mono">{sp.stop_point.id}</p>
                    </div>
                    <div className="text-right text-xs text-gray-500 tabular-nums flex-shrink-0">
                      <p>Arr. {formatNavitiaTime(sp.arrival_time)}</p>
                      <p>Dep. {formatNavitiaTime(sp.departure_time)}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}
