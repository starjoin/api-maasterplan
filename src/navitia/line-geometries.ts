import { getActiveSource, prisma } from '../db.js'
import { config } from '../config.js'
import { reportImportActivity, setDownloadProgress } from '../import-state.js'

export type NavitiaGeometry = {
  type: 'LineString' | 'MultiLineString'
  coordinates: number[][] | number[][][]
}

type NavitiaLine = {
  id: string
  code: string
  name: string
  network?: { id?: string; name?: string }
  geojson?: unknown
}

type LocalRoute = {
  routeId: string
  shortName: string | null
  longName: string | null
  extras: string | null
}

type NavitiaResponse = {
  lines?: NavitiaLine[]
  error?: { message?: string }
}

function normalize(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function validPosition(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === 'number'
    && typeof value[1] === 'number'
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90
}

export function parseNavitiaGeometry(value: unknown): NavitiaGeometry | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { type?: unknown; coordinates?: unknown }
  if (candidate.type === 'LineString') {
    if (!Array.isArray(candidate.coordinates) || candidate.coordinates.length < 2) return null
    if (!candidate.coordinates.every(validPosition)) return null
    return { type: 'LineString', coordinates: candidate.coordinates }
  }
  if (candidate.type === 'MultiLineString') {
    if (!Array.isArray(candidate.coordinates) || candidate.coordinates.length === 0) return null
    if (!candidate.coordinates.every(line => Array.isArray(line) && line.length >= 2 && line.every(validPosition))) return null
    return { type: 'MultiLineString', coordinates: candidate.coordinates as number[][][] }
  }
  return null
}

export function geometryFromRouteExtras(raw: string | null | undefined): NavitiaGeometry | null {
  if (!raw) return null
  try {
    const extras = JSON.parse(raw) as { navitia?: { geojson?: unknown } }
    return parseNavitiaGeometry(extras.navitia?.geojson)
  } catch {
    return null
  }
}

export function geometryFeatureCollection(
  geometry: NavitiaGeometry,
  properties: Record<string, unknown>,
) {
  return {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      properties: { ...properties, geometry_source: 'navitia' },
      geometry,
    }],
  }
}

export function matchNavitiaLine(
  route: Pick<LocalRoute, 'shortName' | 'longName'>,
  candidates: NavitiaLine[],
) {
  const routeCode = normalize(route.shortName)
  if (!routeCode) return null
  const sameCode = candidates.filter(line => normalize(line.code) === routeCode)
  if (sameCode.length === 1) return sameCode[0]
  if (sameCode.length > 1) {
    const sameName = sameCode.filter(line => normalize(line.name) === normalize(route.longName))
    if (sameName.length === 1) return sameName[0]
  }
  return null
}

async function fetchNavitiaLines(): Promise<NavitiaLine[]> {
  const response = await fetch(config.NAVITIA_LINES_URL, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.NAVITIA_TOKEN}:`).toString('base64')}`,
      Accept: 'application/json',
      'User-Agent': 'api-maasterplan/1.0',
    },
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error(`Navitia HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > 100 * 1024 * 1024) throw new Error('Réponse Navitia supérieure à 100 Mo')
  const body = await response.json() as NavitiaResponse
  if (!Array.isArray(body.lines)) {
    throw new Error(body.error?.message || 'Réponse Navitia sans lignes')
  }
  return body.lines
}

function mergeExtras(raw: string | null, navitia: Record<string, unknown>) {
  let extras: Record<string, unknown> = {}
  try {
    if (raw) extras = JSON.parse(raw) as Record<string, unknown>
  } catch {
    extras = {}
  }
  return JSON.stringify({ ...extras, navitia })
}

/**
 * Enrichit la projection transport active avec les géométries de ligne Navitia.
 * Les données de la source et les fichiers originaux restent conservés comme repli/audit.
 */
export async function importNavitiaLineGeometries(log: (message: string) => void | Promise<void>) {
  const sourceLabel = getActiveSource() === 'netex' ? 'NeTEx' : 'GTFS'
  if (!config.NAVITIA_TOKEN) {
    await log('Tracés Navitia ignorés : NAVITIA_TOKEN / REACT_APP_NAVITIA_TOKEN absent')
    reportImportActivity(`Tracés Navitia non configurés, données ${sourceLabel} conservées`, {
      phase: 'importing',
      detail: `Ajoutez NAVITIA_TOKEN dans les variables runtime pour enrichir les lignes ${sourceLabel}`,
    })
    return { fetched: 0, matched: 0, imported: 0, unmatched: 0 }
  }

  reportImportActivity('Téléchargement des tracés de lignes Navitia', {
    phase: 'importing',
    detail: 'Récupération du catalogue fr-se-sytral et de ses GeoJSON',
    currentItem: config.NAVITIA_LINES_URL,
  })
  const navitiaLines = await fetchNavitiaLines()
  const routes = await prisma.route.findMany({
    select: { routeId: true, shortName: true, longName: true, extras: true },
    orderBy: { routeId: 'asc' },
  })
  const fetchedAt = new Date().toISOString()
  let matched = 0
  let imported = 0
  let unmatched = 0

  for (let offset = 0; offset < routes.length; offset += 25) {
    const updates = []
    for (const route of routes.slice(offset, offset + 25)) {
      const line = matchNavitiaLine(route, navitiaLines)
      if (!line) {
        unmatched++
        continue
      }
      matched++
      const geometry = parseNavitiaGeometry(line.geojson)
      if (!geometry) continue
      imported++
      updates.push(prisma.route.update({
        where: { routeId: route.routeId },
        data: {
          extras: mergeExtras(route.extras, {
            line_id: line.id,
            code: line.code,
            name: line.name,
            network_id: line.network?.id ?? null,
            fetched_at: fetchedAt,
            geojson: geometry,
          }),
        },
      }))
    }
    if (updates.length) await prisma.$transaction(updates)
    setDownloadProgress({
      phase: 'importing',
      detail: `${imported.toLocaleString('fr-FR')} tracé(s) Navitia ajouté(s)`,
      currentItem: routes[Math.min(offset + 24, routes.length - 1)]?.shortName ?? null,
      processed: Math.min(offset + 25, routes.length),
      total: routes.length,
      unit: 'lignes',
      counters: { navitiaGeometries: imported },
    })
  }

  const message = `Tracés Navitia pour ${sourceLabel} : ${imported}/${routes.length} lignes enrichies, ${unmatched} sans correspondance`
  await log(message)
  reportImportActivity(message, {
    phase: 'importing',
    detail: `${navitiaLines.length.toLocaleString('fr-FR')} lignes reçues de fr-se-sytral`,
    currentItem: null,
    counters: { navitiaGeometries: imported },
  })
  return { fetched: navitiaLines.length, matched, imported, unmatched }
}
