import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type DownloadProgress } from '../lib/api'
import {
  RefreshCw,
  Loader2,
  Route,
  MapPin,
  Bus,
  Code2,
  Clock,
  CheckCircle2,
  XCircle,
  SkipForward,
  AlertTriangle,
  HardDrive,
  Activity,
} from 'lucide-react'

const STATUS_LABELS: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  VALIDATING: { label: 'Validation', color: 'text-blue-600', icon: Loader2 },
  COMPLETED: { label: 'Terminé', color: 'text-green-600', icon: CheckCircle2 },
  FAILED: { label: 'Échoué', color: 'text-red-600', icon: XCircle },
  SKIPPED: { label: 'Ignoré', color: 'text-gray-500', icon: SkipForward },
  PENDING: { label: 'En attente', color: 'text-yellow-600', icon: Clock },
  DOWNLOADING: { label: 'Téléchargement', color: 'text-blue-600', icon: Loader2 },
  PARSING: { label: 'Parsing', color: 'text-blue-600', icon: Loader2 },
  IMPORTING: { label: 'Import', color: 'text-blue-600', icon: Loader2 },
}

const COUNTER_LABELS: Array<[string, string]> = [
  ['filesRead', 'Fichiers lus'],
  ['filesTotal', 'Fichiers détectés'],
  ['archiveEntries', 'Entrées extraites'],
  ['rawRecords', 'Données sources'],
  ['agencies', 'Opérateurs'],
  ['routes', 'Lignes'],
  ['stops', 'Arrêts'],
  ['pois', 'POI'],
  ['trips', 'Courses'],
  ['stopTimes', 'Horaires'],
  ['shapes', 'Points de tracé'],
  ['navitiaGeometries', 'Tracés Navitia'],
  ['calendars', 'Calendriers'],
  ['fareZones', 'Zones tarifaires'],
  ['transfers', 'Correspondances'],
  ['summarizedRoutes', 'Lignes optimisées'],
]

function formatCount(value: number) {
  return value.toLocaleString('fr-FR')
}

function formatBytes(value: number) {
  if (value < 1024) return `${formatCount(value)} o`
  if (value < 1024 ** 2) return `${(value / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
  return `${(value / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Go`
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes} min ${rest.toString().padStart(2, '0')} s`
  return `${Math.floor(minutes / 60)} h ${(minutes % 60).toString().padStart(2, '0')} min`
}

function formatWork(progress: DownloadProgress) {
  if (progress.processed == null) return null
  const format = progress.unit === 'octets' ? formatBytes : formatCount
  const value = format(progress.processed)
  const total = progress.total != null ? ` / ${format(progress.total)}` : ''
  return `${value}${total}${progress.unit && progress.unit !== 'octets' ? ` ${progress.unit}` : ''}`
}

function DownloadProgressBlock({ progress }: { progress: DownloadProgress }) {
  if (progress.phase === 'idle') return null
  const percent = progress.percent ?? 0
  const phasePercent = progress.phasePercent ?? 0
  const workerAlive = progress.secondsSinceHeartbeat != null && progress.secondsSinceHeartbeat <= 5
  const counters = COUNTER_LABELS
    .map(([key, label]) => ({ key, label, value: progress.counters?.[key] }))
    .filter((counter) => counter.value != null)
  const work = formatWork(progress)

  return (
    <div className="mb-6 rounded-xl border border-blue-200 bg-white shadow-sm overflow-hidden">
      <div className="p-5 bg-blue-50/70">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-blue-950">
              <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
              <h2 className="font-semibold">Import en cours · {progress.phaseLabel ?? progress.phase}</h2>
            </div>
            <p className="mt-1 text-sm text-blue-900">{progress.detail ?? 'Traitement en cours…'}</p>
            {progress.currentItem && (
              <p className="mt-1 text-xs text-blue-700 truncate" title={progress.currentItem}>
                Élément courant : <span className="font-mono">{progress.currentItem}</span>
              </p>
            )}
          </div>
          <div className="flex items-baseline gap-1 text-blue-950 tabular-nums flex-shrink-0">
            <span className="text-3xl font-bold">{percent.toFixed(1)}</span>
            <span className="font-semibold">%</span>
          </div>
        </div>

        <div className="mt-4 h-3 rounded-full bg-blue-100 overflow-hidden" aria-label={`Progression globale ${percent.toFixed(1)} %`}>
          <div
            className="h-full bg-blue-600 transition-[width] duration-500 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-blue-700 tabular-nums">
          <span>Phase actuelle : {phasePercent.toFixed(1)} %</span>
          {work && <span>{work}</span>}
          {(progress.etaLabel || progress.speedLabel) && (
            <span>
              {progress.etaLabel ? `reste ~ ${progress.etaLabel}` : ''}
              {progress.speedLabel ? `${progress.etaLabel ? ' · ' : ''}${progress.speedLabel}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-gray-400">Durée</p>
            <p className="font-semibold text-gray-700 mt-1 tabular-nums">{formatDuration(progress.elapsedSeconds)}</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-gray-400">Dernière activité</p>
            <p className="font-semibold text-gray-700 mt-1 tabular-nums">
              {progress.secondsSinceActivity == null ? '—' : `il y a ${formatDuration(progress.secondsSinceActivity)}`}
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-gray-400">Worker d’import</p>
            <p className={`font-semibold mt-1 flex items-center gap-1.5 ${workerAlive ? 'text-green-700' : 'text-amber-700'}`}>
              <span className={`w-2 h-2 rounded-full ${workerAlive ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
              {workerAlive ? 'Actif' : 'Signal en attente'}
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-gray-400">Mémoire worker</p>
            <p className="font-semibold text-gray-700 mt-1 tabular-nums">{progress.workerRssLabel ?? 'Mesure en attente'}</p>
          </div>
        </div>

        {counters.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Compteurs en direct</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {counters.map(({ key, label, value }) => (
                <div key={key} className="rounded-lg border border-gray-100 px-3 py-2">
                  <p className="text-lg font-semibold text-gray-800 tabular-nums">{formatCount(value)}</p>
                  <p className="text-xs text-gray-400">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {progress.recentEvents?.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> Activité récente
            </h3>
            <div className="rounded-lg bg-gray-950 text-gray-200 p-3 max-h-52 overflow-y-auto font-mono text-xs leading-5">
              {progress.recentEvents.slice().reverse().map((event, index) => (
                <div key={`${event.at}-${index}`} className="flex gap-3">
                  <time className="text-gray-500 tabular-nums flex-shrink-0">
                    {new Date(event.at).toLocaleTimeString('fr-FR')}
                  </time>
                  <span className="break-words">{event.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard.get,
    refetchInterval: (q) => {
      const running = q.state.data?.importRunning
      if (running) return 1000
      return 30_000
    },
  })

  const importMut = useMutation({
    mutationFn: (force: boolean) => api.import.trigger(force),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['import-status'] })
    },
  })

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  const stats = [
    { label: 'Lignes', value: data.data.routes, icon: Route, color: 'bg-blue-50 text-blue-600' },
    { label: 'Arrêts', value: data.data.stops, icon: MapPin, color: 'bg-green-50 text-green-600' },
    { label: 'Courses', value: data.data.trips, icon: Bus, color: 'bg-purple-50 text-purple-600' },
    { label: 'Endpoints actifs', value: data.endpoints.active, icon: Code2, color: 'bg-orange-50 text-orange-600' },
  ]

  const progress = data.downloadProgress
  const latest = data.jobs.recent[0]

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">
            Source active :{' '}
            <span className="font-medium text-gray-600">{data.source?.label ?? 'GTFS'}</span>
            {' · '}
            Sytral Mobilités via le RFU Enroute
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            disabled={data.importRunning || importMut.isPending}
            onClick={() => importMut.mutate(false)}
          >
            {data.importRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Importer {data.source?.label ?? 'GTFS'}
          </button>
          <button
            className="btn-ghost border border-gray-200"
            disabled={data.importRunning || importMut.isPending}
            onClick={() => importMut.mutate(true)}
            title="Forcer le re-téléchargement même si les données n'ont pas changé"
          >
            Forcer
          </button>
        </div>
      </div>

      {data.importRunning && <p className="mb-4 p-3 bg-green-50 text-green-800 rounded-lg text-sm">La version publiée reste accessible pendant le nouvel import. La bascule aura lieu après validation.</p>}
      {data.importRunning && progress && progress.phase !== 'idle' && (
        <DownloadProgressBlock progress={progress} />
      )}

      {data.storage?.warning && (
        <div className="mb-6 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-950">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm min-w-0">
              <p className="font-semibold">Données non persistantes</p>
              <p>{data.storage.warning}</p>
              <ol className="list-decimal list-inside space-y-1 text-amber-900/90">
                <li>Coolify → cette application → Storages (ou Persistent Storage)</li>
                <li>
                  Add → Name <code className="font-mono text-xs bg-amber-100 px-1 rounded">maasterplan-data</code>
                </li>
                <li>
                  Destination Path{' '}
                  <code className="font-mono text-xs bg-amber-100 px-1 rounded">/app/data</code>
                </li>
                <li>Sauvegarder, redéployer, puis relancer un import GTFS/NeTEx</li>
              </ol>
              {data.storage.files.length > 0 && (
                <p className="text-xs text-amber-800/80 flex items-center gap-1.5 pt-1">
                  <HardDrive className="w-3.5 h-3.5" />
                  Fichiers actuels :{' '}
                  {data.storage.files.map((f) => `${f.name} (${f.sizeLabel})`).join(', ')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {!data.storage?.warning && data.storage && (
        <p className="mb-4 text-xs text-gray-400 flex items-center gap-1.5">
          <HardDrive className="w-3.5 h-3.5" />
          Stockage {data.storage.volumeMounted ? 'persistant' : 'local'} · {data.storage.dataDir}
          {data.storage.files.length > 0
            ? ` · ${data.storage.files.map((f) => f.name).join(', ')}`
            : ' · (vide)'}
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-5">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold">{value.toLocaleString('fr-FR')}</p>
            <p className="text-sm text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h2 className="font-semibold mb-4">Source RFU ({data.source?.label ?? 'GTFS'})</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-gray-400">Archive</dt>
              <dd className="font-mono text-xs break-all">{data.rfu.gtfsUrl}</dd>
            </div>
            <div>
              <dt className="text-gray-400">Dernière synchro</dt>
              <dd className="font-medium">
                {data.data.lastImport
                  ? new Date(data.data.lastImport).toLocaleString('fr-FR')
                  : 'Jamais importé'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-400">Version RFU</dt>
              <dd className="font-mono text-xs">{data.rfu.version ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-400">Mis à jour RFU</dt>
              <dd className="font-mono text-xs">{data.rfu.updatedAt ?? '—'}</dd>
            </div>
          </dl>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold mb-4">Imports récents</h2>
          {data.jobs.recent.length === 0 ? (
            <p className="text-sm text-gray-400">Aucun import pour l'instant</p>
          ) : (
            <ul className="space-y-3">
              {data.jobs.recent.map((job) => {
                const s = STATUS_LABELS[job.status] ?? STATUS_LABELS.PENDING
                const Icon = s.icon
                const isActiveImport =
                  data.importRunning &&
                  latest?.id === job.id &&
                  progress?.phase !== 'idle'
                const activeProgress = isActiveImport ? progress : undefined
                return (
                  <li key={job.id} className="flex flex-col gap-1.5 text-sm">
                    <div className="flex items-center gap-3">
                      <Icon
                        className={`w-4 h-4 flex-shrink-0 ${s.color} ${['DOWNLOADING', 'PARSING', 'IMPORTING', 'VALIDATING'].includes(job.status) ? 'animate-spin' : ''}`}
                      />
                      <span className="flex-1 truncate text-gray-600">
                        {new Date(job.createdAt).toLocaleString('fr-FR')}
                      </span>
                      <span className={`badge bg-gray-100 ${s.color}`}>
                        {activeProgress?.percent != null
                          ? `${activeProgress.phaseLabel ?? s.label} ${activeProgress.percent.toFixed(0)} %`
                          : s.label}
                      </span>
                    </div>
                    {activeProgress && (
                      <div className="ml-7 space-y-1">
                        <div className="h-1.5 rounded-full bg-blue-100 overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-[width] duration-300"
                            style={{
                              width: `${Math.min(100, Math.max(0, activeProgress.percent ?? 0))}%`,
                            }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 tabular-nums">
                          {activeProgress.detail}
                          {activeProgress.bytesLabel ? ` · ${activeProgress.bytesLabel}` : ''}
                          {activeProgress.etaLabel ? ` · reste ~ ${activeProgress.etaLabel}` : ''}
                          {activeProgress.speedLabel ? ` · ${activeProgress.speedLabel}` : ''}
                        </p>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {data.data.routes > 0 && (
        <div className="mt-6 p-4 bg-primary-50 border border-primary-200 rounded-lg text-sm text-primary-800 space-y-2">
          <p>
            API SAE prête —{' '}
            <code className="font-mono bg-white px-2 py-0.5 rounded border">GET /api/v1/endpoints</code>
          </p>
          <p className="text-xs text-primary-700">
            Exemples :{' '}
            <code className="font-mono">/api/v1/lines</code>
            {' · '}
            <code className="font-mono">/api/v1/places?q=part</code>
            {' · '}
            <code className="font-mono">/api/v1/places_nearby?lat=45.76&lon=4.83</code>
            {' · '}
            <code className="font-mono">/api/v1/lignes/:id/thermometre</code>
          </p>
        </div>
      )}
    </div>
  )
}
