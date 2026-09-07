import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

type Source = 'gtfs' | 'netex'
type Kind = { kind: string; count: number; fields: Record<string, number> }
type Dataset = { source: Source; url: string; lastImport: string | null; version: string | null; stats: Record<string, unknown>; kinds: Kind[]; files: { name: string; bytes: number; records: number; sha256: string }[] }
type Comparison = { sources: Dataset[]; features: { label: string; gtfs: string; netex: string }[]; note: string }
async function get<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error((await response.json()).error ?? 'Requête échouée')
  return response.json()
}
const number = (n: number) => n.toLocaleString('fr-FR')
export default function ComparisonPage() {
  const [source, setSource] = useState<Source>('netex')
  const [kind, setKind] = useState('')
  const [after, setAfter] = useState(0)
  const [history, setHistory] = useState<number[]>([])
  const [entityId, setEntityId] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [fieldSearch, setFieldSearch] = useState('')
  const comparison = useQuery({ queryKey: ['comparison'], queryFn: () => get<Comparison>('/admin/compare'), refetchInterval: 30_000 })
  const dataset = comparison.data?.sources.find(s => s.source === source)
  const generation = dataset?.lastImport
  useEffect(() => { setAfter(0); setHistory([]); setSelected(null) }, [source, kind, search, generation])
  useEffect(() => { if (!dataset?.kinds.some(k => k.kind === kind)) setKind(dataset?.kinds[0]?.kind ?? '') }, [dataset, kind])
  const query = new URLSearchParams({ source, kind, after: String(after), ...(search ? { entityId: search } : {}) })
  const records = useQuery({ queryKey: ['inventory', source, kind, after, search, generation], queryFn: () => get<{ items: { id: number; file: string; entityId: string | null; preview: string }[]; next: number | null }>(`/admin/inventory/records?${query}`), enabled: !!kind })
  const detail = useQuery({ queryKey: ['inventory-detail', source, selected, generation], queryFn: () => get<{ data: unknown }>(`/admin/inventory/records/${selected}?source=${source}`), enabled: selected !== null })
  const fields = Object.entries(dataset?.kinds.find(k => k.kind === kind)?.fields ?? {}).filter(([name]) => name.toLowerCase().includes(fieldSearch.toLowerCase()))
  return <div className="p-8 space-y-6 max-w-screen-2xl mx-auto">
    <div><h1 className="text-2xl font-bold">GTFS ↔ NeTEx</h1><p className="text-gray-600 mt-2">Comparez les publications et consultez toutes les données d’origine, y compris les extensions.</p></div>
    {comparison.isPending && <p role="status">Chargement de l’inventaire…</p>}
    {comparison.error && <p role="alert" className="text-red-700">{comparison.error.message}</p>}
    <div className="grid md:grid-cols-2 gap-4">{comparison.data?.sources.map(s => <section key={s.source} className="bg-white border rounded-xl p-5 space-y-2">
      <h2 className="font-bold text-lg">{s.source === 'gtfs' ? 'GTFS' : 'NeTEx'}</h2>
      <p className="text-sm break-all text-gray-500">{s.url}</p>
      <p>{s.lastImport ? `Publié le ${new Date(s.lastImport).toLocaleString('fr-FR')}` : 'Aucune version importée'}</p>
      <p className="text-sm">{s.version ?? 'Version non renseignée'}</p>
      <p>{number(s.files.length)} fichiers · {number(s.kinds.length)} familles · {number(Number(s.stats.rawRecords ?? 0))} enregistrements bruts</p>
      {!s.files.length && s.lastImport && <p className="text-amber-700 text-sm">Ancien import : relancez un chargement pour disposer de l’inventaire complet.</p>}
      {Number(s.stats.tripsWithoutCalendarProjection ?? 0) > 0 && <p className="text-amber-800 text-sm">{number(Number(s.stats.tripsWithoutCalendarProjection))} courses sans calendrier converti. Consultez les calendriers NeTEx originaux ; aucune période de circulation n’est inventée.</p>}
      {Array.isArray(s.stats.projectionNotes) && s.stats.projectionNotes.map((note, i) => <p className="text-sm text-gray-600" key={i}>{String(note)}</p>)}
    </section>)}</div>
    <p className="bg-blue-50 text-blue-900 rounded-lg p-4 text-sm">{comparison.data?.note}</p>
    <section className="bg-white border rounded-xl overflow-hidden"><h2 className="p-4 font-semibold">Informations disponibles dans les fichiers</h2>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-gray-50"><tr><th className="p-3">Famille rapprochée</th><th className="p-3">GTFS</th><th className="p-3">NeTEx</th></tr></thead><tbody>
        {comparison.data?.features.map(feature => <tr key={feature.label} className="border-t"><th className="p-3 font-medium">{feature.label}</th>{(['gtfs','netex'] as const).map(s => {
          const data = comparison.data!.sources.find(d => d.source === s)!
          const k = data.kinds.find(k => k.kind === feature[s])
          let count = k?.count ?? 0
          if (s === 'gtfs' && feature.label === 'Accessibilité') count = k?.fields.wheelchair_boarding ?? 0
          if (s === 'gtfs' && feature.label === 'Zones d’arrêts') count = Number((data.stats.stopTypes as Record<string, number> | undefined)?.['1'] ?? 0)
          if (s === 'gtfs' && feature.label === 'Arrêts / quais') count = Number((data.stats.stopTypes as Record<string, number> | undefined)?.['0'] ?? k?.count ?? 0)
          return <td key={s} className="p-3">{k && count > 0 ? <button className="text-primary-700 underline text-left" onClick={() => { setSource(s); setKind(k.kind) }}>{number(count)} · {k.kind}</button> : <span className="text-gray-500">{!feature[s] ? 'Pas de table standard dédiée' : data.files.length ? 'Non renseigné dans cette publication' : 'Non inventorié'}</span>}</td>
        })}</tr>)}
      </tbody></table></div>
      <p className="p-4 text-sm text-gray-600">Un nœud GTFS de type 3 est un point de circulation dans une station. Il n’est pas compté comme PointOfInterest NeTEx. Les comptes d’entités incluent leurs occurrences dans les fichiers.</p>
    </section>
    <section className="bg-white border rounded-xl p-5 space-y-4"><h2 className="font-semibold text-lg">Inventaire intégral</h2>
      <div className="flex flex-wrap gap-3"><label>Source <select className="border rounded p-2 ml-2" value={source} onChange={e => setSource(e.target.value as Source)}><option value="gtfs">GTFS</option><option value="netex">NeTEx</option></select></label>
        <label>Famille <select className="border rounded p-2 ml-2 max-w-xs" value={kind} onChange={e => setKind(e.target.value)}><option value="">Sélectionnez une famille</option>{dataset?.kinds.map(k => <option key={k.kind} value={k.kind}>{k.kind} ({number(k.count)})</option>)}</select></label>
      </div>
      {!dataset?.kinds.length && <p>Aucune donnée inventoriée pour cette source. Lancez un nouvel import depuis le dashboard.</p>}
      {!!kind && <><details className="border rounded p-3"><summary className="cursor-pointer font-medium">Champs renseignés ({Object.keys(dataset?.kinds.find(k => k.kind === kind)?.fields ?? {}).length})</summary>
        <input aria-label="Filtrer les champs" className="border rounded p-2 my-3 w-full" placeholder="Rechercher un champ : Latitude, wheelchair, address…" value={fieldSearch} onChange={e => setFieldSearch(e.target.value)} />
        <div className="max-h-80 overflow-auto"><table className="text-sm w-full text-left"><thead><tr><th>Champ original</th><th>Occurrences renseignées</th></tr></thead><tbody>{fields.map(([name,count]) => <tr key={name} className="border-t"><td className="py-2 break-all font-mono">{name}</td><td>{number(count)}</td></tr>)}</tbody></table></div>
      </details>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); setSearch(entityId) }}><input className="border rounded p-2 flex-1" aria-label="Identifiant exact" placeholder="Filtrer par identifiant exact (laisser vide pour tout voir)" value={entityId} onChange={e => setEntityId(e.target.value)} /><button className="bg-gray-900 text-white rounded px-4">Rechercher</button></form>
      {records.isFetching && <p role="status">Chargement…</p>}{records.error && <p role="alert">{records.error.message}</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Identifiant / ligne</th><th className="p-2">Fichier</th><th className="p-2">Aperçu</th></tr></thead><tbody>{records.data?.items.map(row => <tr key={row.id} className="border-t align-top"><td className="p-2"><button className="text-primary-700 underline break-all" onClick={() => setSelected(row.id)}>{row.entityId || `Enregistrement ${row.id}`}</button></td><td className="p-2 break-all">{row.file}</td><td className="p-2 max-w-lg"><pre className="whitespace-pre-wrap break-all text-xs max-h-20 overflow-hidden">{row.preview}</pre></td></tr>)}</tbody></table></div>
      {records.data?.items.length === 0 && <p>Aucun résultat.</p>}
      <div className="flex gap-3"><button className="border rounded px-3 py-2 disabled:opacity-40" disabled={!history.length || records.isFetching} onClick={() => { setAfter(history.at(-1)!); setHistory(history.slice(0,-1)) }}>Précédent</button><button className="border rounded px-3 py-2 disabled:opacity-40" disabled={records.data?.next == null || records.isFetching} onClick={() => { setHistory([...history, after]); setAfter(records.data!.next!) }}>Suivant</button><span className="self-center text-sm text-gray-500">25 enregistrements par page</span></div>
      {selected !== null && <section className="bg-gray-950 text-gray-100 rounded p-4"><div className="flex justify-between"><h3>Entité complète · {selected}</h3><button onClick={() => setSelected(null)}>Fermer</button></div>{detail.isPending ? <p>Chargement…</p> : detail.error ? <p role="alert">{detail.error.message}</p> : <pre className="overflow-auto max-h-96 text-xs mt-3">{JSON.stringify(detail.data?.data, null, 2)}</pre>}</section>}</>}
    </section>
    <section className="bg-white border rounded-xl p-5"><h2 className="font-semibold mb-3">Fichiers originaux · {source === 'gtfs' ? 'GTFS' : 'NeTEx'}</h2><p className="text-sm text-gray-500 mb-3">Téléchargement intégral : XML, CSV, extensions et fichiers annexes. Les empreintes SHA-256 permettent de vérifier leur contenu.</p>
      <div className="max-h-96 overflow-auto space-y-2">{dataset?.files.map(file => <details key={file.name} className="border rounded p-3 text-sm"><summary className="cursor-pointer">{file.name} · {number(file.records)} enregistrements · {(file.bytes / 1024 / 1024).toFixed(2)} Mo</summary><p className="font-mono text-xs break-all mt-2">SHA-256 : {file.sha256}</p><a className="text-primary-700 underline inline-block mt-2" href={`/admin/inventory/file?${new URLSearchParams({ source, name: file.name })}`}>Télécharger le fichier complet</a></details>)}</div>
    </section>
  </div>
}
