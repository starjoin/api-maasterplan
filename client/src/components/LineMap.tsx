import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type GeoJson = {
  type?: string
  features?: Array<{
    type?: string
    geometry?: {
      type?: string
      coordinates?: number[][] | number[][][]
    }
    properties?: Record<string, unknown>
  }>
}

function hasLineGeometry(geojson: GeoJson | null | undefined): boolean {
  return Boolean(geojson?.features?.some((f) => f.geometry?.coordinates?.length))
}

function FitGeoJson({ map, layer }: { map: L.Map; layer: L.GeoJSON }) {
  const bounds = layer.getBounds()
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 })
  }
}

export default function LineMap({
  geojson,
  color,
  className = '',
}: {
  geojson: GeoJson | null | undefined
  color?: string | null
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  const stroke = color ? `#${String(color).replace(/^#/, '')}` : '#2563eb'

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    }).setView([45.75, 4.85], 11)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const layers: L.Layer[] = []
    map.eachLayer((layer) => {
      if (layer instanceof L.GeoJSON) layers.push(layer)
    })
    for (const layer of layers) map.removeLayer(layer)

    if (!hasLineGeometry(geojson)) return

    const layer = L.geoJSON(geojson as GeoJSON.GeoJsonObject, {
      style: {
        color: stroke,
        weight: 4,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
      },
    }).addTo(map)

    FitGeoJson({ map, layer })

    // Recalcule la taille si le conteneur vient d’apparaître
    requestAnimationFrame(() => map.invalidateSize())
  }, [geojson, stroke])

  if (!hasLineGeometry(geojson)) {
    return (
      <div
        className={`card flex items-center justify-center h-64 text-sm text-gray-400 ${className}`}
      >
        Aucun tracé GeoJSON pour cette ligne
      </div>
    )
  }

  return (
    <div className={`card overflow-hidden ${className}`}>
      <div ref={containerRef} className="h-72 w-full z-0" />
    </div>
  )
}
