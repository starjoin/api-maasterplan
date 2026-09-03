import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type ApiEndpoint } from '../lib/api'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Loader2, Zap } from 'lucide-react'

const METHOD_STYLES: Record<string, string> = {
  GET: 'bg-green-100 text-green-700',
  POST: 'bg-blue-100 text-blue-700',
}

export default function ApiDesigner() {
  const qc = useQueryClient()

  const { data: endpoints = [], isLoading } = useQuery({
    queryKey: ['endpoints'],
    queryFn: api.endpoints.list,
  })

  const deleteMut = useMutation({
    mutationFn: api.endpoints.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['endpoints'] }),
  })

  const toggleMut = useMutation({
    mutationFn: api.endpoints.toggle,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['endpoints'] }),
  })

  const handleDelete = (ep: ApiEndpoint) => {
    if (confirm(`Supprimer l'endpoint "${ep.method} ${ep.path}" ?`)) {
      deleteMut.mutate(ep.id)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">API Designer</h1>
          <p className="text-sm text-gray-400 mt-1">
            Source de vérité de l’API publique — chaque endpoint actif ici est réellement exposé sous{' '}
            <code className="font-mono">/api</code>
          </p>
        </div>
        <Link to="/api-designer/new" className="btn-primary">
          <Plus className="w-4 h-4" /> Nouvel endpoint
        </Link>
      </div>

      {endpoints.length === 0 ? (
        <div className="card p-16 text-center">
          <p className="text-gray-400 mb-4">Aucun endpoint configuré</p>
          <Link to="/api-designer/new" className="btn-primary">
            <Plus className="w-4 h-4" /> Créer votre premier endpoint
          </Link>
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {endpoints.map((ep) => (
            <div key={ep.id} className="px-5 py-4 flex items-center gap-4">
              <span className={`badge font-mono text-xs ${METHOD_STYLES[ep.method] ?? 'bg-gray-100 text-gray-700'}`}>
                {ep.method}
              </span>

              <div className="flex-1 min-w-0">
                <code className="text-sm font-mono text-gray-900">/api{ep.path}</code>
                {ep.description && <p className="text-xs text-gray-400 mt-0.5">{ep.description}</p>}
                <div className="flex flex-wrap gap-2 mt-1">
                  {ep.responseSchema?.preset ? (
                    <span className="badge bg-violet-100 text-violet-700">
                      preset:{ep.responseSchema.preset}
                    </span>
                  ) : (
                    <span className="badge bg-sky-50 text-sky-700">
                      déclaratif · {ep.responseSchema?.entity}
                    </span>
                  )}
                  {ep.params.length > 0 && (
                    <span className="text-xs text-gray-400">{ep.params.length} param(s)</span>
                  )}
                  {!ep.isActive && <span className="badge bg-amber-50 text-amber-700">inactif</span>}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost p-2"
                  title={ep.isActive ? 'Désactiver' : 'Activer'}
                  onClick={() => toggleMut.mutate(ep.id)}
                >
                  {ep.isActive ? (
                    <ToggleRight className="w-5 h-5 text-green-500" />
                  ) : (
                    <ToggleLeft className="w-5 h-5 text-gray-400" />
                  )}
                </button>

                <Link to={`/api-designer/${ep.id}`} className="btn-ghost p-2">
                  <Pencil className="w-4 h-4" />
                </Link>

                <button
                  className="btn-ghost p-2 text-red-500 hover:bg-red-50"
                  onClick={() => handleDelete(ep)}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {endpoints.length > 0 && (
        <div className="mt-4 p-4 bg-primary-50 border border-primary-200 rounded-lg text-sm text-primary-800 flex items-start gap-2">
          <Zap className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            Les endpoints <strong>actifs</strong> sont exposés immédiatement sous{' '}
            <code className="font-mono">/api{endpoints.find((e) => e.isActive)?.path ?? endpoints[0].path}</code>
            <br />
            <span className="text-xs text-primary-600">
              Désactiver un endpoint ici le retire de l’API. Modifier champs / responseKeys / filtres change la
              réponse réelle. Doc : <code className="font-mono">/docs</code>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
