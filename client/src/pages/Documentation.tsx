import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  ExternalLink,
  Loader2,
  Search,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Play,
} from 'lucide-react'

interface DocEndpoint {
  group: string
  method: string
  path: string
  summary?: string
  description?: string
  active?: boolean
  source?: string
  entity?: string
  parameters?: Array<{
    name: string
    in?: string
    required?: boolean
    description?: string
    schema?: { type?: string; default?: unknown }
    example?: unknown
  }>
  example?: unknown
  curl?: string
  designerId?: string
}

interface Catalog {
  generated_at: string
  info: { title: string; version: string; description: string }
  groups: string[]
  endpoints: DocEndpoint[]
}

const METHOD_STYLE: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-800',
  POST: 'bg-blue-100 text-blue-800',
  PUT: 'bg-amber-100 text-amber-800',
  PATCH: 'bg-orange-100 text-orange-800',
  DELETE: 'bg-red-100 text-red-800',
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      className="btn-ghost text-xs py-1 px-2"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setOk(true)
        setTimeout(() => setOk(false), 1500)
      }}
    >
      {ok ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
      {ok ? 'Copié' : 'Copier'}
    </button>
  )
}

function EndpointCard({ ep }: { ep: DocEndpoint }) {
  const [open, setOpen] = useState(false)
  const [tryUrl, setTryUrl] = useState(() => {
    let p = ep.path
    for (const param of ep.parameters?.filter((x) => x.in === 'path') ?? []) {
      const sample = String(param.example ?? (param.name === 'id' ? '82' : 'exemple'))
      p = p.replace(`{${param.name}}`, encodeURIComponent(sample))
    }
    const qs = (ep.parameters ?? [])
      .filter((x) => x.in === 'query')
      .slice(0, 3)
      .map((x) => `${x.name}=${encodeURIComponent(String(x.example ?? x.schema?.default ?? ''))}`)
      .filter((x) => !x.endsWith('='))
    return qs.length ? `${p}?${qs.join('&')}` : p
  })
  const [tryResult, setTryResult] = useState<string | null>(null)
  const [tryLoading, setTryLoading] = useState(false)
  const [tryError, setTryError] = useState<string | null>(null)

  const runTry = async () => {
    setTryLoading(true)
    setTryError(null)
    try {
      const res = await fetch(tryUrl)
      const text = await res.text()
      try {
        setTryResult(JSON.stringify(JSON.parse(text), null, 2))
      } catch {
        setTryResult(text)
      }
      if (!res.ok) setTryError(`HTTP ${res.status}`)
    } catch (e) {
      setTryError(e instanceof Error ? e.message : String(e))
    } finally {
      setTryLoading(false)
    }
  }

  return (
    <article className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-4 flex items-start gap-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className={`badge font-mono text-xs mt-0.5 ${METHOD_STYLE[ep.method] ?? 'bg-gray-100'}`}>
          {ep.method}
        </span>
        <div className="flex-1 min-w-0">
          <code className="text-sm font-mono text-gray-900 break-all">{ep.path}</code>
          {ep.summary && <p className="text-sm text-gray-600 mt-1">{ep.summary}</p>}
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="badge bg-gray-100 text-gray-600">{ep.group}</span>
            {ep.entity && <span className="badge bg-sky-50 text-sky-700">entité {ep.entity}</span>}
            {ep.active === false && <span className="badge bg-amber-50 text-amber-700">inactif</span>}
          </div>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400 mt-1" /> : <ChevronRight className="w-4 h-4 text-gray-400 mt-1" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-5 space-y-5 bg-white">
          {ep.description && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Description</h3>
              <div className="prose-doc text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {ep.description.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')}
              </div>
            </section>
          )}

          {ep.parameters && ep.parameters.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Paramètres</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b">
                      <th className="py-2 pr-3">Nom</th>
                      <th className="py-2 pr-3">Dans</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Requis</th>
                      <th className="py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ep.parameters.map((p) => (
                      <tr key={`${p.in}-${p.name}`} className="border-b border-gray-50">
                        <td className="py-2 pr-3 font-mono text-xs">{p.name}</td>
                        <td className="py-2 pr-3 text-xs">{p.in}</td>
                        <td className="py-2 pr-3 text-xs">{p.schema?.type ?? 'string'}</td>
                        <td className="py-2 pr-3 text-xs">{p.required ? 'oui' : 'non'}</td>
                        <td className="py-2 text-xs text-gray-600">{p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {ep.curl && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Exemple cURL</h3>
                <CopyButton text={ep.curl} />
              </div>
              <pre className="bg-gray-950 text-green-400 text-xs rounded-lg p-4 overflow-x-auto font-mono whitespace-pre-wrap">
                {ep.curl}
              </pre>
            </section>
          )}

          {ep.example !== undefined && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Exemple de réponse</h3>
                <CopyButton text={JSON.stringify(ep.example, null, 2)} />
              </div>
              <pre className="bg-gray-950 text-sky-300 text-xs rounded-lg p-4 overflow-x-auto font-mono max-h-72">
                {JSON.stringify(ep.example, null, 2)}
              </pre>
            </section>
          )}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Essayer</h3>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs flex-1"
                value={tryUrl}
                onChange={(e) => setTryUrl(e.target.value)}
              />
              <button type="button" className="btn-primary text-xs" onClick={runTry} disabled={tryLoading}>
                {tryLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                GET
              </button>
            </div>
            {tryError && <p className="text-xs text-red-600 mt-2">{tryError}</p>}
            {tryResult && (
              <pre className="mt-3 bg-gray-950 text-green-400 text-xs rounded-lg p-4 overflow-auto font-mono max-h-80">
                {tryResult}
              </pre>
            )}
          </section>
        </div>
      )}
    </article>
  )
}

export default function Documentation() {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string>('all')

  const { data, isLoading, error } = useQuery({
    queryKey: ['docs-catalog'],
    queryFn: async () => {
      const res = await fetch('/docs/catalog')
      if (!res.ok) throw new Error('Impossible de charger le catalogue')
      return res.json() as Promise<Catalog>
    },
    refetchInterval: 60_000,
  })

  const filtered = useMemo(() => {
    if (!data) return []
    return data.endpoints.filter((ep) => {
      if (group !== 'all' && ep.group !== group) return false
      if (!q.trim()) return true
      const hay = `${ep.path} ${ep.summary ?? ''} ${ep.description ?? ''} ${ep.method}`.toLowerCase()
      return hay.includes(q.trim().toLowerCase())
    })
  }, [data, q, group])

  const byGroup = useMemo(() => {
    const map = new Map<string, DocEndpoint[]>()
    for (const ep of filtered) {
      if (!map.has(ep.group)) map.set(ep.group, [])
      map.get(ep.group)!.push(ep)
    }
    return [...map.entries()]
  }, [filtered])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <p className="text-red-600">Erreur de chargement de la documentation.</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="w-6 h-6 text-primary-600" />
            <h1 className="text-2xl font-bold">Documentation API</h1>
          </div>
          <p className="text-sm text-gray-500 max-w-2xl">
            Générée automatiquement depuis l’API Designer et la couche SAE. Toute modification d’endpoint
            met à jour cette doc.
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Dernière génération : {new Date(data.generated_at).toLocaleString('fr-FR')} · {data.endpoints.length}{' '}
            opérations
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <a href="/docs" target="_blank" rel="noreferrer" className="btn-primary text-sm">
            <ExternalLink className="w-4 h-4" /> OpenAPI interactive
          </a>
          <a href="/openapi.json" target="_blank" rel="noreferrer" className="btn-secondary text-sm">
            openapi.json
          </a>
        </div>
      </div>

      <div className="card p-5 mb-8 bg-gradient-to-br from-gray-50 to-white">
        <h2 className="font-semibold mb-2">Comment lire cette doc</h2>
        <ul className="text-sm text-gray-600 space-y-1.5 list-disc pl-5">
          <li>
            <strong>SAE (natif)</strong> — endpoints métier prêts à l’emploi (lignes, horaires, nearby…).
          </li>
          <li>
            <strong>Designer (custom)</strong> — endpoints que vous créez / personnalisez dans l’API Designer.
          </li>
          <li>
            Utilisez <strong>Essayer</strong> pour interroger l’instance live, ou ouvrez la vue{' '}
            <a className="text-primary-700 underline" href="/docs" target="_blank" rel="noreferrer">
              Scalar
            </a>{' '}
            pour une expérience OpenAPI complète.
          </li>
        </ul>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Rechercher un endpoint, un paramètre…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className="input w-auto" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="all">Tous les groupes</option>
          {data.groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      {byGroup.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">Aucun endpoint ne correspond.</div>
      ) : (
        <div className="space-y-8">
          {byGroup.map(([g, items]) => (
            <section key={g}>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                {g}
                <span className="text-xs font-normal text-gray-400">{items.length}</span>
              </h2>
              <div className="space-y-3">
                {items.map((ep) => (
                  <EndpointCard key={`${ep.method}-${ep.path}-${ep.designerId ?? ''}`} ep={ep} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
