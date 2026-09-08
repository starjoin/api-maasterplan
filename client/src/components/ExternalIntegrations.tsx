import { Cable, Clock, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import type { DataSource, ExternalIntegration } from '../lib/api'

const states = {
  available: { label: 'Données disponibles', color: 'bg-green-50 text-green-700' },
  partial: { label: 'Couverture partielle', color: 'bg-amber-50 text-amber-800' },
  waiting: { label: 'En attente de données', color: 'bg-gray-100 text-gray-600' },
  disabled: { label: 'Désactivé', color: 'bg-gray-100 text-gray-600' },
  error: { label: 'Erreur de récupération', color: 'bg-red-50 text-red-700' },
  stale: { label: 'Données anciennes', color: 'bg-amber-50 text-amber-800' },
}

type Props = {
  integrations: ExternalIntegration[]
  importRunning: boolean
  pendingSource: DataSource | null
  onForceNavitia: (source: DataSource) => void
}

export default function ExternalIntegrations({
  integrations,
  importRunning,
  pendingSource,
  onForceNavitia,
}: Props) {
  return (
    <section className="mb-8" aria-labelledby="external-apis-title">
      <div className="flex items-center gap-2 mb-2">
        <Cable className="w-5 h-5 text-primary-600" />
        <h2 id="external-apis-title" className="font-semibold text-lg">API externes et sources de données</h2>
        <span className="badge bg-gray-100 text-gray-600">{integrations.length}</span>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Toutes les sources utilisées par l’application. Les états reflètent les données publiées et le cache temps réel.
      </p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {integrations.map(integration => (
          <article className="card p-5 min-w-0" key={integration.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{integration.name}</h3>
              <span className={`badge ${integration.configured ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800'}`}>
                {integration.configured ? 'Accès configuré' : 'Identifiants manquants'}
              </span>
            </div>
            <p className="text-sm text-gray-600 mt-2">{integration.description}</p>
            <p className="text-xs text-primary-700 mt-2">{integration.scope}</p>
            <p className="flex items-start gap-1.5 text-xs text-gray-500 mt-2">
              <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {integration.cadence}
            </p>

            {integration.id === 'navitia' && (
              <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                <p className="text-xs text-blue-900 mb-3">
                  Actualise uniquement les tracés Navitia dans une copie de la base, puis la publie après validation.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(['gtfs', 'netex'] as const).map(source => {
                    const pending = pendingSource === source
                    return (
                      <button
                        key={source}
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={!integration.configured || importRunning || pendingSource !== null}
                        onClick={() => onForceNavitia(source)}
                        title={`Forcer l’actualisation Navitia de la base ${source === 'gtfs' ? 'GTFS' : 'NeTEx'}`}
                      >
                        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        Forcer tracés {source === 'gtfs' ? 'GTFS' : 'NeTEx'}
                      </button>
                    )
                  })}
                </div>
                {!integration.configured && (
                  <p className="text-xs text-amber-800 mt-2">Configurez NAVITIA_TOKEN pour activer ces actions.</p>
                )}
              </div>
            )}

            <div className="mt-4 space-y-3">
              {integration.snapshots.map(snapshot => {
                const state = states[snapshot.status]
                return (
                  <div key={snapshot.label} className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-gray-700">{snapshot.label}</span>
                      <span className={`badge ${state.color}`}>{state.label}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Dernières données : {snapshot.lastSuccessAt
                        ? new Date(snapshot.lastSuccessAt).toLocaleString('fr-FR') : 'Aucune date disponible'}
                    </p>
                    {snapshot.metrics.length > 0 && (
                      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                        {snapshot.metrics.map(metric => (
                          <div key={metric.label}>
                            <dd className="font-semibold tabular-nums text-gray-800">{metric.value.toLocaleString('fr-FR')}</dd>
                            <dt className="text-xs text-gray-500">{metric.label}</dt>
                          </div>
                        ))}
                      </dl>
                    )}
                    {snapshot.note && <p className="text-xs text-gray-600 mt-3 break-words">{snapshot.note}</p>}
                  </div>
                )
              })}
            </div>

            <dl className="mt-4 space-y-2">
              {integration.urls.map(endpoint => (
                <div key={endpoint.label}>
                  <dt className="text-xs text-gray-400">{endpoint.label}</dt>
                  <dd className="text-xs mt-0.5">
                    <a href={endpoint.url || undefined} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline break-all">
                      {endpoint.url || 'Adresse indisponible'} <ExternalLink className="w-3 h-3 inline" />
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}
