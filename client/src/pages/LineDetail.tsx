import { lazy, Suspense, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type LineDayDirection } from '../lib/api'
import type { MapStop } from '../components/LineMap'

// MapLibre pèse lourd : la carte est chargée à la demande.
const LineMap = lazy(() => import('../components/LineMap'))
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  Table2,
} from 'lucide-react'

/** HH:MM:SS (éventuellement > 24h) → HH:MM, avec J+1 si besoin */
function formatTime(t: string | null | undefined, withDay = true): string {
  if (!t) return '—'
  const [hh, mm = '00'] = t.split(':')
  const h = Number(hh)
  if (Number.isNaN(h)) return t
  const day = withDay && h >= 24 ? ` J+${Math.floor(h / 24)}` : ''
  return `${String(h % 24).padStart(2, '0')}:${mm.padStart(2, '0')}${day}`
}

function todayParis(): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T12:00:00Z`))
}

const isIsoDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

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

function Thermometer({ direction, color }: { direction: LineDayDirection; color: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const stops = direction.stop_points

  return (
    <div className="card overflow-hidden">
      <ol>
        {stops.map((sp, idx) => {
          const isFirst = idx === 0
          const isLast = idx === stops.length - 1
          const stopId = sp.stop_point.id
          const key = `${idx}-${stopId}`
          const expanded = open === key
          return (
            <li key={key} className="border-b border-gray-100 last:border-b-0">
              <div className="flex items-stretch gap-4 px-5 hover:bg-gray-50 transition-colors">
                <div className="flex flex-col items-center w-4 flex-shrink-0">
                  <span className={`w-0.5 h-3 ${isFirst ? 'bg-transparent' : ''}`} style={isFirst ? undefined : { backgroundColor: color }} />
                  <span
                    className="w-3.5 h-3.5 rounded-full border-2 flex-shrink-0"
                    style={{
                      borderColor: color,
                      backgroundColor: isFirst || isLast ? color : '#fff',
                    }}
                  />
                  <span className="w-0.5 flex-1" style={isLast ? undefined : { backgroundColor: color }} />
                </div>
                <button
                  type="button"
                  className="flex-1 min-w-0 py-3 text-left flex items-center gap-4"
                  onClick={() => setOpen(expanded ? null : key)}
                  aria-expanded={expanded}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm break-words ${isFirst || isLast ? 'font-semibold' : 'font-medium'}`}>
                      {sp.stop_point.name ?? sp.stop_point.label ?? stopId}
                    </p>
                    <p className="text-xs text-gray-400 font-mono truncate">{stopId}</p>
                  </div>
                  <div className="text-right text-xs text-gray-500 tabular-nums flex-shrink-0">
                    <p>
                      {formatTime(sp.first_departure)} → {formatTime(sp.last_departure)}
                    </p>
                    <p className="text-gray-400">{sp.passages} passage{sp.passages > 1 ? 's' : ''}</p>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  />
                </button>
                <Link
                  to={`/explorer/stops/${encodeURIComponent(stopId)}`}
                  className="self-center p-1.5 text-gray-400 hover:text-primary-600"
                  title="Voir l’arrêt"
                >
                  <ExternalLink className="w-4 h-4" />
                </Link>
              </div>
              {expanded && (
                <div className="pl-14 pr-5 pb-4 flex flex-wrap gap-1.5">
                  {sp.departures.map((t, i) => (
                    <span key={i} className="badge bg-gray-100 text-gray-700 tabular-nums">
                      {formatTime(t)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Timetable({ direction }: { direction: LineDayDirection }) {
  const { stop_points: stops, trips } = direction
  return (
    <div className="card overflow-auto max-h-[32rem]">
      <table className="text-xs tabular-nums border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 bg-white border-b border-r border-gray-200 px-3 py-2 text-left font-semibold text-gray-600 min-w-[14rem]">
              Arrêt
            </th>
            {trips.map((t, i) => (
              <th
                key={t.trip_id}
                className="sticky top-0 z-10 bg-white border-b border-gray-200 px-2 py-2 font-medium text-gray-400"
                title={`${t.trip_id}${t.headsign ? ` — ${t.headsign}` : ''}`}
              >
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stops.map((sp, row) => (
            <tr key={`${row}-${sp.stop_point.id}`} className="hover:bg-gray-50">
              <th className="sticky left-0 z-10 bg-white border-r border-b border-gray-100 px-3 py-1.5 text-left font-medium text-gray-700 max-w-[16rem] truncate">
                {sp.stop_point.name}
              </th>
              {trips.map((t) => (
                <td
                  key={t.trip_id}
                  className={`border-b border-gray-100 px-2 py-1.5 text-center ${t.times[row] ? 'text-gray-700' : 'text-gray-300'}`}
                >
                  {t.times[row] ? formatTime(t.times[row], false) : '|'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function LineDetail() {
  const { id = '' } = useParams()
  const routeId = decodeURIComponent(id)
  const [searchParams, setSearchParams] = useSearchParams()
  const dateParam = searchParams.get('date')
  const date = isIsoDate(dateParam) ? dateParam : todayParis()
  const [dirIndex, setDirIndex] = useState(0)
  const [view, setView] = useState<'thermometer' | 'timetable'>('thermometer')

  const setDate = (next: string) => {
    if (!isIsoDate(next)) return
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.set('date', next)
        return p
      },
      { replace: true },
    )
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['explore-route', routeId],
    queryFn: () => api.explore.route(routeId),
    enabled: Boolean(routeId),
  })

  const realRouteId = data ? String(data.route.routeId) : null
  const {
    data: day,
    isFetching: dayFetching,
    error: dayError,
  } = useQuery({
    queryKey: ['explore-route-day', realRouteId, date],
    queryFn: () => api.explore.routeDay(realRouteId!, date),
    enabled: Boolean(realRouteId),
    placeholderData: keepPreviousData,
  })

  const directions = day?.directions ?? []
  const activeIndex = Math.min(dirIndex, Math.max(directions.length - 1, 0))
  const activeDir = directions[activeIndex]

  const mapStops: MapStop[] = useMemo(() => {
    if (!activeDir) return []
    const last = activeDir.stop_points.length - 1
    return activeDir.stop_points
      .filter((sp) => sp.stop_point.coord)
      .map((sp) => ({
        id: sp.stop_point.id,
        name: sp.stop_point.name,
        lat: sp.stop_point.coord!.lat,
        lon: sp.stop_point.coord!.lon,
        terminus: sp.order === 0 || sp.order === last,
      }))
  }, [activeDir])

  const unservedMapStops: MapStop[] = useMemo(
    () =>
      (activeDir?.unserved_stops ?? [])
        .filter((s) => s.coord)
        .map((s) => ({ id: s.id, name: s.name, lat: s.coord!.lat, lon: s.coord!.lon })),
    [activeDir],
  )

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
    commercial_mode?: { name?: string }
    physical_modes?: Array<{ name?: string }>
    network?: { name?: string }
  }

  const code = String(line.code ?? data.route.shortName ?? '')
  const color = (line.color ?? data.route.color) as string | null
  const stroke = color ? `#${String(color).replace(/^#/, '')}` : '#2563eb'
  const range = day?.service_range
  const outOfRange = Boolean(range?.start && range?.end && (date < range.start || date > range.end))

  return (
    <div className="p-8 max-w-6xl">
      <Link to="/explorer" className="btn-ghost inline-flex items-center gap-2 mb-6">
        <ArrowLeft className="w-4 h-4" /> Explorateur
      </Link>

      <div className="flex flex-wrap items-start gap-5 mb-6">
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
          {line.network?.name && <p className="text-sm text-gray-500 mt-1">Réseau {line.network.name}</p>}
        </div>
      </div>

      {/* Sélecteur de date */}
      <div className="card p-4 mb-6 flex flex-wrap items-center gap-3">
        <CalendarDays className="w-5 h-5 text-primary-600" />
        <div className="flex items-center gap-1">
          <button type="button" className="btn-secondary py-1.5 px-2" onClick={() => setDate(shiftDate(date, -1))} title="Jour précédent">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="date"
            className="input py-1.5 w-auto"
            value={date}
            min={range?.start ?? undefined}
            max={range?.end ?? undefined}
            onChange={(e) => setDate(e.target.value)}
          />
          <button type="button" className="btn-secondary py-1.5 px-2" onClick={() => setDate(shiftDate(date, 1))} title="Jour suivant">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        {date !== todayParis() && (
          <button type="button" className="btn-ghost text-xs" onClick={() => setDate(todayParis())}>
            Aujourd’hui
          </button>
        )}
        <p className="text-sm text-gray-600 first-letter:uppercase">
          {formatLongDate(date)}
          {dayFetching && <Loader2 className="inline w-3.5 h-3.5 ml-2 animate-spin text-primary-500" />}
        </p>
        {range?.start && range?.end && (
          <p className="text-xs text-gray-400 ml-auto">
            Données du {new Date(`${range.start}T12:00:00Z`).toLocaleDateString('fr-FR')} au{' '}
            {new Date(`${range.end}T12:00:00Z`).toLocaleDateString('fr-FR')}
          </p>
        )}
      </div>

      {dayError ? (
        <div className="card p-8 text-center text-red-600">Impossible de charger la ligne à cette date</div>
      ) : !day ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
        </div>
      ) : (
        <>
          {day.unresolved_trips > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 text-amber-800 px-4 py-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                {day.unresolved_trips.toLocaleString('fr-FR')} course(s) de cette ligne ont un calendrier non
                résolu et ne sont pas prises en compte.
              </span>
            </div>
          )}

          {directions.length === 0 ? (
            <div className="card p-12 text-center text-gray-400 mb-8">
              Aucune course ne circule le {formatLongDate(date)}
              {outOfRange && <p className="text-xs mt-2">Cette date est hors de la période couverte par les données.</p>}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {directions.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDirIndex(i)}
                    className={`badge px-3 py-1.5 text-xs cursor-pointer ${
                      activeIndex === i ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    → {d.headsign || `Direction ${d.direction_id ?? i}`}
                  </button>
                ))}
              </div>

              <div className="grid sm:grid-cols-3 gap-4 mb-6">
                <div className="card p-5">
                  <p className="text-xs uppercase tracking-wide text-gray-400 font-medium">Courses ce jour</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1">{activeDir.trip_count}</p>
                  <p className="text-xs text-gray-400 mt-1">{activeDir.stop_points.length} arrêts desservis</p>
                </div>
                <div className="card p-5 flex items-start gap-3">
                  <Clock className="w-5 h-5 text-primary-600 mt-0.5" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-400 font-medium">1er départ</p>
                    <p className="text-2xl font-semibold tabular-nums mt-1">{formatTime(activeDir.first_departure)}</p>
                  </div>
                </div>
                <div className="card p-5 flex items-start gap-3">
                  <Clock className="w-5 h-5 text-primary-600 mt-0.5" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-400 font-medium">Dernier départ</p>
                    <p className="text-2xl font-semibold tabular-nums mt-1">{formatTime(activeDir.last_departure)}</p>
                  </div>
                </div>
              </div>

              <div className="mb-8">
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <MapPin className="w-4 h-4" /> Itinéraire
                  {activeDir.geometry_source === 'stops' && (
                    <span className="text-xs font-normal text-gray-400">(tracé approximatif entre arrêts)</span>
                  )}
                </h2>
                <Suspense fallback={<div className="card h-96 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>}>
                  <LineMap geojson={activeDir.geojson} color={color} stops={mapStops} unservedStops={unservedMapStops} />
                </Suspense>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    {view === 'thermometer' ? (
                      <>
                        <MapPin className="w-4 h-4" /> Thermomètre de ligne
                      </>
                    ) : (
                      <>
                        <Table2 className="w-4 h-4" /> Horaires
                      </>
                    )}
                  </h2>
                  <label className="flex items-center gap-2 text-xs text-gray-500">
                    <CalendarDays className="w-4 h-4 text-primary-600" />
                    <span className="hidden sm:inline">Arrêts desservis le</span>
                    <input
                      type="date"
                      className="input py-1 px-2 text-xs w-auto"
                      value={date}
                      min={range?.start ?? undefined}
                      max={range?.end ?? undefined}
                      onChange={(e) => setDate(e.target.value)}
                      aria-label="Date de desserte"
                    />
                    <span className="tabular-nums">
                      {activeDir.stop_points.length} arrêt{activeDir.stop_points.length > 1 ? 's' : ''}
                    </span>
                    {dayFetching && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-500" />}
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className={`badge px-3 py-1.5 text-xs cursor-pointer ${
                        view === 'thermometer' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      onClick={() => setView('thermometer')}
                    >
                      Thermomètre
                    </button>
                    <button
                      type="button"
                      className={`badge px-3 py-1.5 text-xs cursor-pointer ${
                        view === 'timetable' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      onClick={() => setView('timetable')}
                    >
                      Grille horaire
                    </button>
                  </div>
                </div>
                {view === 'thermometer' ? (
                  <Thermometer direction={activeDir} color={stroke} />
                ) : (
                  <Timetable direction={activeDir} />
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
