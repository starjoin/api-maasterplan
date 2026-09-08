import { config, DATA_SOURCES, getSourceConfig } from '../config.js'
import { getActiveSource, withSourcePrisma } from '../db.js'
import { getVehicleMonitoringCache } from '../siri/vehicle-monitoring.js'

type Status = 'available' | 'partial' | 'waiting' | 'disabled' | 'error' | 'stale'
type Snapshot = {
  label: string
  status: Status
  lastSuccessAt: string | null
  metrics: Array<{ label: string; value: number }>
  note: string | null
}
export type ExternalIntegration = {
  id: string
  name: string
  description: string
  configured: boolean
  cadence: string
  scope: string
  urls: Array<{ label: string; url: string }>
  snapshots: Snapshot[]
}

function objectStats(raw: string | null | undefined): Record<string, unknown> {
  try {
    const value = JSON.parse(raw ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

/** Expose les adresses des services, jamais leurs identifiants de connexion. */
export function publicServiceUrl(raw: string) {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.username = ''
    url.password = ''
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (key !== 'count' && key !== 'depth') url.searchParams.delete(key)
    }
    return url.toString()
  } catch { return '' }
}

function publicError(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  let value = raw
  for (const secret of [config.NAVITIA_TOKEN, config.REACT_APP_NAVITIA_TOKEN, config.RFU_API_TOKEN,
    config.RFU_API_TOKEN_NETEX, config.SIRI_VM_USER, config.SIRI_VM_PASSWORD]) {
    if (secret) value = value.split(secret).join('[masqué]')
  }
  return value.replace(/https?:\/\/[^\s;]+/g, url => publicServiceUrl(url)).slice(0, 500)
}

/** Registre des services : ajouter un fournisseur ici suffit pour créer sa carte. */
export async function getExternalIntegrations(): Promise<ExternalIntegration[]> {
  const active = getActiveSource()
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(config.IMPORT_CRON)
  const schedule = daily
    ? `tous les jours à ${daily[2].padStart(2, '0')}:${daily[1].padStart(2, '0')}`
    : 'selon le calendrier configuré'
  const sources = await Promise.all(DATA_SOURCES.map(async source => {
    const meta = await withSourcePrisma(source, client => client.datasetMeta.findUnique({ where: { id: source } }))
    return { source, cfg: getSourceConfig(source), meta, stats: objectStats(meta?.stats) }
  }))
  const integrations: ExternalIntegration[] = sources.map(({ source, cfg, meta, stats }) => ({
    id: `rfu-${source}`,
    name: `RFU ${cfg.label}`,
    description: 'Lignes, arrêts, courses et horaires du réseau.',
    configured: Boolean(cfg.token),
    cadence: `Import manuel ou ${schedule} (heure du serveur, source active uniquement)`,
    scope: source === active ? 'Source active de l’API' : 'Base indépendante · source inactive',
    urls: [
      { label: 'Archive', url: publicServiceUrl(cfg.zipUrl) },
      { label: 'Métadonnées', url: publicServiceUrl(cfg.infoUrl) },
    ],
    snapshots: [{
      label: 'Version publiée',
      status: meta?.lastImport ? 'available' : 'waiting',
      lastSuccessAt: meta?.lastImport?.toISOString() ?? null,
      metrics: ['routes', 'stops', 'trips'].flatMap((key, i) => typeof stats[key] === 'number'
        ? [{ label: ['Lignes', 'Arrêts', 'Courses'][i], value: stats[key] as number }] : []),
      note: [meta?.rfuVersion ? `Version : ${meta.rfuVersion}` : null,
        meta?.rfuUpdatedAt ? `Publication RFU : ${meta.rfuUpdatedAt}` : null].filter(Boolean).join(' · ') || null,
    }],
  }))

  integrations.push({
    id: 'navitia', name: 'Navitia',
    description: 'Tracés GeoJSON des lignes, utilisés par la carte et l’API.',
    configured: Boolean(config.NAVITIA_TOKEN),
    cadence: 'À chaque import GTFS ou NeTEx effectué · aucun appel lors de la consultation des tracés',
    scope: 'Enrichissement des deux bases, indépendamment du sélecteur',
    urls: [{ label: 'Catalogue des lignes', url: publicServiceUrl(config.NAVITIA_LINES_URL) }],
    snapshots: sources.map(({ cfg, meta, stats }) => {
      const imported = typeof stats.navitiaGeometries === 'number' ? stats.navitiaGeometries : null
      const total = typeof stats.routes === 'number' ? stats.routes : null
      const error = publicError(stats.navitiaError)
      const status: Status = error ? 'error' : imported != null && imported > 0
        ? (total != null && imported < total ? 'partial' : 'available')
        : !config.NAVITIA_TOKEN ? 'disabled' : imported === 0 ? 'partial' : 'waiting'
      return {
        label: cfg.label, status,
        lastSuccessAt: typeof stats.navitiaUpdatedAt === 'string'
          ? stats.navitiaUpdatedAt
          : imported != null && imported > 0 ? meta?.lastImport?.toISOString() ?? null : null,
        metrics: [
          ...(imported != null ? [{ label: 'Tracés disponibles', value: imported }] : []),
          ...(total != null ? [{ label: 'Lignes de la base', value: total }] : []),
          ...(typeof stats.navitiaLinesUnmatched === 'number' ? [{ label: 'Sans correspondance', value: stats.navitiaLinesUnmatched }] : []),
          ...(typeof stats.navitiaLinesMatched === 'number' && imported != null
            ? [{ label: 'Correspondances sans tracé', value: Math.max(0, stats.navitiaLinesMatched - imported) }] : []),
        ],
        note: error ? `Dernier enrichissement : ${error}` : !config.NAVITIA_TOKEN
          ? 'Renseigner NAVITIA_TOKEN ou REACT_APP_NAVITIA_TOKEN côté serveur pour les prochains imports.'
          : imported == null ? 'Relancer un import pour disposer du bilan Navitia de cette base.'
          : imported === 0 ? 'Aucun tracé Navitia ajouté lors de cet import.' : null,
      }
    }),
  })

  const vm = getVehicleMonitoringCache()
  const stale = vm.ageMs != null && vm.ageMs > Math.max(vm.pollIntervalMs * 3, 60_000)
  integrations.push({
    id: 'siri-vm', name: 'SIRI VM',
    description: 'Positions des véhicules, directions et retards en temps réel.',
    configured: Boolean(config.SIRI_VM_USER && config.SIRI_VM_PASSWORD),
    cadence: vm.enabled ? `Interrogation toutes les ${vm.pollIntervalMs / 1000} secondes` : 'Interrogation automatique désactivée',
    scope: 'Temps réel commun à GTFS et NeTEx · cache en mémoire',
    urls: [{ label: 'Vehicle Monitoring', url: publicServiceUrl(vm.sourceUrl) }],
    snapshots: [{
      label: 'Cache temps réel',
      status: !vm.enabled ? 'disabled' : vm.lastError ? 'error' : stale ? 'stale' : vm.fetchedAt ? 'available' : 'waiting',
      lastSuccessAt: vm.fetchedAt,
      metrics: [
        { label: 'Véhicules en cache', value: vm.vehicles.length },
        { label: 'Activités reçues', value: vm.rawCount },
        ...(vm.ageMs != null ? [{ label: 'Âge du cache (s)', value: Math.floor(vm.ageMs / 1000) }] : []),
      ],
      note: publicError(vm.lastError) ?? (stale ? 'Le cache est ancien ; les dernières positions reçues restent conservées.' : null),
    }],
  })
  return integrations
}
