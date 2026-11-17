import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

/** Fond de carte vectoriel Maasterplan (schéma OpenMapTiles) */
export const BASEMAP_STYLE = 'https://cartes-fdl.maasterplan.app/style.json'

type Position = number[]

type GeoJson = {
  type?: string
  features?: Array<{
    type?: string
    geometry?: {
      type?: string
      coordinates?: Position[] | Position[][]
    }
    properties?: Record<string, unknown>
  }>
}

export type MapStop = {
  id: string
  name: string
  lat: number
  lon: number
  terminus?: boolean
}

/**
 * Le style cartes-fdl référence un relief servi par un protocole propre au client
 * newtile (newtile-relief://). On retire ces sources et leurs couches.
 */
function withoutCustomProtocols(style: StyleSpecification): StyleSpecification {
  const custom = (u: unknown) => typeof u === 'string' && !/^(https?:)?\/\//.test(u) && /^[a-z][a-z0-9+.-]*:\/\//i.test(u)
  const dropped = new Set(
    Object.entries(style.sources)
      .filter(([, s]) => {
        const src = s as { url?: string; tiles?: string[] }
        return custom(src.url) || (src.tiles ?? []).some(custom)
      })
      .map(([id]) => id),
  )
  if (!dropped.size) return style
  return {
    ...style,
    sources: Object.fromEntries(Object.entries(style.sources).filter(([id]) => !dropped.has(id))),
    layers: style.layers.filter((l) => !('source' in l) || !dropped.has(String(l.source))),
    ...(style.terrain && dropped.has(style.terrain.source) ? { terrain: undefined } : {}),
  }
}

const UNSERVED_COLOR = '#dc2626'

/** Icône « croix » dessinée au canvas (le jeu de glyphes du fond n'a pas ✕) */
function crossIcon(size = 18): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const m = 4
  ctx.lineCap = 'round'
  const draw = (color: string, width: number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(m, m)
    ctx.lineTo(size - m, size - m)
    ctx.moveTo(size - m, m)
    ctx.lineTo(m, size - m)
    ctx.stroke()
  }
  draw('#ffffff', 6)
  draw(UNSERVED_COLOR, 3)
  return ctx.getImageData(0, 0, size, size)
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function hasLineGeometry(geojson: GeoJson | null | undefined): boolean {
  return Boolean(geojson?.features?.some((f) => f.geometry?.coordinates?.length))
}

function stopsCollection(stops: MapStop[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stops.map((s) => ({
      type: 'Feature',
      properties: { id: s.id, name: s.name, terminus: Boolean(s.terminus) },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    })),
  }
}

function boundsOf(geojson: GeoJson | null | undefined, stops: MapStop[]): LngLatBoundsLike | null {
  const b = new maplibregl.LngLatBounds()
  let empty = true
  const add = (c: Position) => {
    if (typeof c?.[0] === 'number' && typeof c?.[1] === 'number') {
      b.extend([c[0], c[1]])
      empty = false
    }
  }
  for (const f of geojson?.features ?? []) {
    const coords = f.geometry?.coordinates ?? []
    if (f.geometry?.type === 'MultiLineString') (coords as Position[][]).forEach((l) => l.forEach(add))
    else (coords as Position[]).forEach(add)
  }
  for (const s of stops) add([s.lon, s.lat])
  return empty ? null : b
}

export default function LineMap({
  geojson,
  color,
  stops = [],
  unservedStops = [],
  className = '',
}: {
  geojson: GeoJson | null | undefined
  color?: string | null
  /** Arrêts desservis à la date affichée */
  stops?: MapStop[]
  /** Arrêts de la ligne non desservis à cette date (affichés avec une croix) */
  unservedStops?: MapStop[]
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [loaded, setLoaded] = useState(false)

  const stroke = color ? `#${String(color).replace(/^#/, '')}` : '#2563eb'
  const visible = hasLineGeometry(geojson) || stops.length > 0
  const hasApprox = Boolean(geojson?.features?.some((f) => f.properties?.approx === true))

  useEffect(() => {
    if (!visible || !containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [4.85, 45.75],
      zoom: 11,
      cooperativeGestures: true,
      attributionControl: { compact: true },
    })
    map.setStyle(BASEMAP_STYLE, { transformStyle: (_prev, next) => withoutCustomProtocols(next) })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      map.addSource('line', { type: 'geojson', data: EMPTY })
      map.addSource('stops', { type: 'geojson', data: EMPTY })
      map.addSource('unserved', { type: 'geojson', data: EMPTY })
      map.addImage('unserved-cross', crossIcon(), { pixelRatio: 1 })

      map.addLayer({
        id: 'line-casing',
        type: 'line',
        source: 'line',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: 'line',
        type: 'line',
        source: 'line',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        filter: ['!=', ['get', 'approx'], true],
        paint: { 'line-color': stroke, 'line-width': 4 },
      })
      // Tronçons sans géométrie connue : reliés à vol d'oiseau, en pointillés
      map.addLayer({
        id: 'line-approx',
        type: 'line',
        source: 'line',
        layout: { 'line-join': 'round', 'line-cap': 'butt' },
        filter: ['==', ['get', 'approx'], true],
        paint: { 'line-color': stroke, 'line-width': 3, 'line-dasharray': [2, 1.5] },
      })
      map.addLayer({
        id: 'unserved',
        type: 'symbol',
        source: 'unserved',
        layout: {
          'icon-image': 'unserved-cross',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
      map.addLayer({
        id: 'unserved-labels',
        type: 'symbol',
        source: 'unserved',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Italic'],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': '#9ca3af', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      })
      map.addLayer({
        id: 'stops',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': ['case', ['get', 'terminus'], 6, 4],
          'circle-color': ['case', ['get', 'terminus'], stroke, '#ffffff'],
          'circle-stroke-color': stroke,
          'circle-stroke-width': 2,
        },
      })
      map.addLayer({
        id: 'stop-labels',
        type: 'symbol',
        source: 'stops',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      })

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 })
      map.on('mouseenter', 'stops', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const f = e.features?.[0]
        if (!f || f.geometry.type !== 'Point') return
        popup
          .setLngLat(f.geometry.coordinates as [number, number])
          .setText(String(f.properties?.name ?? ''))
          .addTo(map)
      })
      map.on('mouseleave', 'stops', () => {
        map.getCanvas().style.cursor = ''
        popup.remove()
      })
      map.on('mouseenter', 'unserved', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const f = e.features?.[0]
        if (!f || f.geometry.type !== 'Point') return
        popup
          .setLngLat(f.geometry.coordinates as [number, number])
          .setText(`${String(f.properties?.name ?? '')} — non desservi ce jour`)
          .addTo(map)
      })
      map.on('mouseleave', 'unserved', () => {
        map.getCanvas().style.cursor = ''
        popup.remove()
      })

      setLoaded(true)
    })

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      setLoaded(false)
    }
  }, [visible])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    ;(map.getSource('line') as GeoJSONSource | undefined)?.setData(
      (hasLineGeometry(geojson) ? geojson : EMPTY) as GeoJSON.FeatureCollection,
    )
    ;(map.getSource('stops') as GeoJSONSource | undefined)?.setData(stopsCollection(stops))
    ;(map.getSource('unserved') as GeoJSONSource | undefined)?.setData(stopsCollection(unservedStops))
    map.setPaintProperty('line', 'line-color', stroke)
    map.setPaintProperty('line-approx', 'line-color', stroke)
    map.setPaintProperty('stops', 'circle-stroke-color', stroke)
    map.setPaintProperty('stops', 'circle-color', ['case', ['get', 'terminus'], stroke, '#ffffff'])

    const bounds = boundsOf(geojson, [...stops, ...unservedStops])
    if (bounds) map.fitBounds(bounds, { padding: 32, maxZoom: 15, duration: 0 })
  }, [geojson, stops, unservedStops, stroke, loaded])

  if (!visible) {
    return (
      <div
        className={`card flex items-center justify-center h-64 text-sm text-gray-400 ${className}`}
      >
        Aucun tracé pour cette ligne à cette date
      </div>
    )
  }

  return (
    <div className={`card overflow-hidden relative ${className}`}>
      <div ref={containerRef} className="h-96 w-full z-0" />
      {(unservedStops.length > 0 || hasApprox) && (
        <div className="absolute left-2 top-2 z-10 rounded-md bg-white/95 shadow-sm px-2.5 py-1.5 text-[11px] text-gray-600 space-y-1">
          <p className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border-2 bg-white" style={{ borderColor: stroke }} />
            Arrêt desservi
          </p>
          {unservedStops.length > 0 && (
            <p className="flex items-center gap-1.5">
              <span className="w-2.5 text-center font-bold leading-none" style={{ color: UNSERVED_COLOR }}>✕</span>
              Non desservi ce jour ({unservedStops.length})
            </p>
          )}
          {hasApprox && (
            <p className="flex items-center gap-1.5">
              <span className="w-2.5 border-t-2 border-dashed" style={{ borderColor: stroke }} />
              Tracé approximatif
            </p>
          )}
        </div>
      )}
    </div>
  )
}
