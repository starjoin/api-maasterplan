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
} from 'lucide-react'

const STATUS_LABELS: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  COMPLETED: { label: 'Terminé', color: 'text-green-600', icon: CheckCircle2 },
  FAILED: { label: 'Échoué', color: 'text-red-600', icon: XCircle },
  SKIPPED: { label: 'Ignoré', color: 'text-gray-500', icon: SkipForward },
  PENDING: { label: 'En attente', color: 'text-yellow-600', icon: Clock },
  DOWNLOADING: { label: 'Téléchargement', color: 'text-blue-600', icon: Loader2 },
  PARSING: { label: 'Parsing', color: 'text-blue-600', icon: Loader2 },
  IMPORTING: { label: 'Import', color: 'text-blue-600', icon: Loader2 },
}

function DownloadProgressBlock({ progress }: { progress: DownloadProgress }) {
  if (progress.phase === 'idle') return null

  const phaseLabel =
    progress.phase === 'downloading'
      ? 'Téléchargement'
      : progress.phase === 'extracting'
        ? 'Extraction'
        : progress.phase === 'parsing'
          ? 'Parsing'
          : 'Import en base'

  const showBar = progress.phase === 'downloading' && progress.percent != null

  return (
    <div className="mb-4 p-4 rounded-lg border border-blue-100 bg-blue-50/60 space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-blue-900 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {phaseLabel}
          {progress.percent != null && progress.phase === 'downloading' && (
            <span className="tabular-nums font-semibold">{progress.percent.toFixed(1)} %</span>
          )}
        </span>
        <span className="text-xs text-blue-700 tabular-nums">
          {progress.etaLabel ? `reste ~ ${progress.etaLabel}` : null}
          {progress.speedLabel ? (progress.etaLabel ? ' · ' : '') + progress.speedLabel : null}
        </span>
      </div>
      {showBar && (
        <div className="h-2 rounded-full bg-blue-100 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-[width] duration-300 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, progress.percent ?? 0))}%` }}
          />
        </div>
      )}
      {progress.bytesLabel && (
        <p className="text-xs text-blue-700 tabular-nums">{progress.bytesLabel}</p>
      )}
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
      const phase = q.state.data?.downloadProgress?.phase
      if (running && phase === 'downloading') return 1000
      if (running) return 2000
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

      {data.importRunning && progress && progress.phase !== 'idle' && (
        <DownloadProgressBlock progress={progress} />
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
                const isActiveDownload =
                  data.importRunning &&
                  latest?.id === job.id &&
                  job.status === 'DOWNLOADING' &&
                  progress?.phase === 'downloading'
                return (
                  <li key={job.id} className="flex flex-col gap-1.5 text-sm">
                    <div className="flex items-center gap-3">
                      <Icon
                        className={`w-4 h-4 flex-shrink-0 ${s.color} ${job.status.includes('ING') ? 'animate-spin' : ''}`}
                      />
                      <span className="flex-1 truncate text-gray-600">
                        {new Date(job.createdAt).toLocaleString('fr-FR')}
                      </span>
                      <span className={`badge bg-gray-100 ${s.color}`}>
                        {isActiveDownload && progress.percent != null
                          ? `Téléchargement ${progress.percent.toFixed(0)} %`
                          : s.label}
                      </span>
                    </div>
                    {isActiveDownload && (
                      <div className="ml-7 space-y-1">
                        <div className="h-1.5 rounded-full bg-blue-100 overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-[width] duration-300"
                            style={{
                              width: `${Math.min(100, Math.max(0, progress.percent ?? 0))}%`,
                            }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 tabular-nums">
                          {progress.bytesLabel}
                          {progress.etaLabel ? ` · reste ~ ${progress.etaLabel}` : ''}
                          {progress.speedLabel ? ` · ${progress.speedLabel}` : ''}
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
