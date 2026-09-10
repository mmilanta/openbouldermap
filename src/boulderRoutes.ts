// Map-side lookup of problems lying on/very close to a physical boulder.

import type * as maplibregl from 'maplibre-gl'

export interface NearbyBoulderRoute {
  properties: Record<string, any>
  lon: number
  lat: number
}

let map: maplibregl.Map | undefined

export function setBoulderRoutesMap(instance: maplibregl.Map): void {
  map = instance
}

/**
 * Return route points near the clicked boulder geometry. Route bottoms are
 * commonly mapped just outside a polygon, hence the small screen-space buffer.
 * Using rendered tile data avoids another API request and works for ways and
 * relations alike.
 */
export function routesOnBoulder(feature: maplibregl.MapGeoJSONFeature): NearbyBoulderRoute[] {
  if (!map) return []

  const coordinates = feature.geometry.type === 'Point'
    ? [feature.geometry.coordinates as [number, number]]
    : feature.geometry.type === 'Polygon'
      ? feature.geometry.coordinates.flat() as [number, number][]
      : feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates.flat(2) as [number, number][]
        : []
  if (!coordinates.length) return []

  const projected = coordinates.map(coordinate => map!.project(coordinate))
  const padding = feature.geometry.type === 'Point' ? 28 : 16
  const minX = Math.min(...projected.map(point => point.x)) - padding
  const minY = Math.min(...projected.map(point => point.y)) - padding
  const maxX = Math.max(...projected.map(point => point.x)) + padding
  const maxY = Math.max(...projected.map(point => point.y)) + padding

  const found = map.queryRenderedFeatures([[minX, minY], [maxX, maxY]], { layers: ['route'] })
  const rings = feature.geometry.type === 'Polygon'
    ? feature.geometry.coordinates
    : feature.geometry.type === 'MultiPolygon'
      ? feature.geometry.coordinates.flat()
      : []
  const screenRings = rings.map(ring => ring.map(coordinate => map!.project(coordinate as [number, number])))
  const distanceToSegment = (point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
  }
  const nearEdge = (coordinate: [number, number]) => {
    const point = map!.project(coordinate)
    if (feature.geometry.type === 'Point') {
      return Math.hypot(point.x - projected[0].x, point.y - projected[0].y) <= padding
    }
    return screenRings.some(ring => ring.some((vertex, index) =>
      index > 0 && distanceToSegment(point, ring[index - 1], vertex) <= padding
    ))
  }

  const unique = new Map<number | string, NearbyBoulderRoute>()
  for (const route of found) {
    if (route.geometry.type !== 'Point' || !nearEdge(route.geometry.coordinates as [number, number])) continue
    const id = Number(route.properties?.osm_id)
    const key = Number.isFinite(id) ? id : JSON.stringify(route.geometry.coordinates)
    unique.set(key, {
      properties: route.properties ?? {},
      lon: route.geometry.coordinates[0],
      lat: route.geometry.coordinates[1]
    })
  }
  return [...unique.values()]
}
