// Live edit-mode climbing data.
//
// The published map renders a daily PMTiles snapshot. That snapshot can be up
// to a day old, so in edit mode we refresh the visible climbing features
// straight from the OSM APIs while the user is zoomed in far enough to edit.
//
// Requests are deliberately bounded: nothing is fetched while zoomed out, and
// a viewport that is too large for an editing session falls back to the daily
// snapshot. This keeps the public Overpass instance from being hammered by
// ordinary map panning, while the features the user actually edits come from
// the same OSM database that the version-pinned preflight checks.
import type { Map as LibreMap, GeoJSONSource } from 'maplibre-gl'
import { gradeColor } from '../grades'
import { pointInRing, type Position } from './model'

// Below this zoom the stale snapshot is good enough for navigation and a
// bbox query would cover too much ground to be polite to Overpass.
export const LIVE_MIN_ZOOM = 14
// Reject viewports larger than this (degrees). Dense bouldering areas stay tiny.
export const LIVE_MAX_SPAN = 0.25
export const LIVE_MAX_AREA = 0.12
// Public Overpass mirrors, tried in order. The main instance is occasionally
// unreachable or rate-limited, so a single hardcoded host is not reliable.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.ch/api/interpreter'
]
const REQUEST_DEBOUNCE_MS = 350
const REQUEST_TIMEOUT_MS = 8000
const FAILOVER_DEADLINE_MS = 30000
const ENDPOINT_COOLDOWN_MS = 120000

export type LiveKind = 'boulder' | 'boulder_point' | 'route' | 'area' | 'sector'

export interface OverpassPoint { lat: number; lon: number }
export interface OverpassMember {
  type: string
  ref: number
  role?: string
  lat?: number
  lon?: number
  geometry?: OverpassPoint[]
}
export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  nodes?: number[]
  geometry?: OverpassPoint[]
  members?: OverpassMember[]
}

/** Same classification as scripts/schema.yml, applied to live Overpass JSON. */
export function classifyLive(el: OverpassElement): LiveKind | undefined {
  const tags = el.tags ?? {}
  if (el.type === 'node') {
    if (tags.climbing === 'route_bottom') return 'route'
    if (tags.climbing === 'boulder' && tags.natural === 'stone' && tags.sport === 'climbing') return 'boulder_point'
    return undefined
  }
  if (tags.climbing === 'boulder' && (tags.natural === 'bare_rock' || tags.natural === 'stone') && tags.sport === 'climbing') return 'boulder'
  if (tags['climbing:boulder'] === 'yes') {
    if (tags.climbing === 'area') return 'area'
    if (tags.climbing === 'crag') return 'sector'
  }
  return undefined
}

function closeRing(points: Position[]): Position[] {
  if (!points.length) return points
  const [fx, fy] = points[0], [lx, ly] = points[points.length - 1]
  return fx === lx && fy === ly ? points : [...points, points[0]]
}
function wayRing(el: OverpassElement): Position[] | undefined {
  if (!el.geometry?.length) return undefined
  return closeRing(el.geometry.map(p => [p.lon, p.lat] as Position))
}
/** Recursive-ish centroid equivalent of scripts/extract-sectors.py for site relations. */
function relationCenter(el: OverpassElement): Position | undefined {
  const points: Position[] = []
  for (const member of el.members ?? []) {
    if (member.lat !== undefined && member.lon !== undefined) points.push([member.lon, member.lat])
    else if (member.geometry) for (const p of member.geometry) points.push([p.lon, p.lat])
  }
  if (!points.length) return undefined
  return [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length]
}
function relationPolygons(el: OverpassElement): Position[][][] {
  const rings = (el.members ?? []).flatMap(member => {
    if (member.type !== 'way' || !member.geometry?.length) return []
    return [{ role: member.role ?? '', points: closeRing(member.geometry.map(p => [p.lon, p.lat] as Position)) }]
  })
  const outers = rings.filter(r => r.role !== 'inner'), inners = rings.filter(r => r.role === 'inner')
  return outers.map(outer => [outer.points, ...inners.filter(inner => pointInRing(inner.points[0], outer.points)).map(inner => inner.points)])
}
function liveGeometry(el: OverpassElement, kind: LiveKind): GeoJSON.Geometry | undefined {
  if (kind === 'route' || kind === 'boulder_point') {
    return el.lat !== undefined && el.lon !== undefined ? { type: 'Point', coordinates: [el.lon, el.lat] } : undefined
  }
  if (kind === 'area' || kind === 'sector') {
    if (el.type === 'relation' && el.tags?.type === 'site') {
      const center = relationCenter(el)
      return center ? { type: 'Point', coordinates: center } : undefined
    }
    if (el.type === 'way') {
      const ring = wayRing(el)
      return ring ? { type: 'Polygon', coordinates: [ring] } : undefined
    }
    const polygons = relationPolygons(el)
    return polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : undefined
  }
  if (el.type === 'way') {
    const ring = wayRing(el)
    return ring ? { type: 'Polygon', coordinates: [ring] } : undefined
  }
  if (el.type === 'relation') {
    const polygons = relationPolygons(el)
    return polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : undefined
  }
  return undefined
}

/** Convert an Overpass `out geom` response into display features with tile-like properties. */
export function toLiveFeatures(elements: OverpassElement[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const el of elements) {
    const kind = classifyLive(el)
    if (!kind) continue
    const geometry = liveGeometry(el, kind)
    if (!geometry) continue
    const tags = el.tags ?? {}
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        kind,
        key: `${el.type}/${el.id}`,
        osm_type: el.type,
        osm_id: el.id,
        name: tags.name ?? '',
        'climbing:grade:font': tags['climbing:grade:font'] ?? '',
        color: gradeColor(tags['climbing:grade:font'])
      }
    })
  }
  return { type: 'FeatureCollection', features }
}

export type LiveStatus = 'loading' | 'live' | 'snapshot'
export interface LiveHooks {
  onStatus?: (status: LiveStatus, detail?: string) => void
  onError?: (error: unknown) => void
}

/**
 * Owns the `live` GeoJSON source and its display layers. When live data is
 * available it hides the daily-snapshot `climbing` layers; otherwise those
 * remain in charge. All mutations happen through the public methods so the
 * editor can leave a coherent state behind.
 */
export class LiveClimbing {
  private readonly sourceId = 'live'
  private readonly liveLayers: string[] = []
  private readonly snapshotLayers: string[] = []
  private ready = false
  private active = false
  private controller?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private request = 0
  private lastKey = ''
  private preferredEndpoint?: string
  private readonly cooldown = new Map<string, number>()
  constructor(private readonly map: LibreMap, private readonly hooks: LiveHooks = {}) {
    const attach = () => this.init()
    if (map.loaded()) attach()
    else map.on('load', attach)
    map.on('moveend', () => this.schedule())
  }

  /** Force a refresh, e.g. after the editor has published or discarded changes. */
  refresh(): void { this.lastKey = ''; this.schedule() }

  private init(): void {
    if (this.ready) return
    const map = this.map
    for (const layer of map.getStyle().layers ?? []) {
      if ('source' in layer && (layer as { source?: string }).source === 'climbing') this.snapshotLayers.push(layer.id)
    }
    map.addSource(this.sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    const add = (layer: Record<string, unknown>) => {
      this.liveLayers.push(layer.id as string)
      map.addLayer(layer as never)
    }
    const hidden = { visibility: 'none' }
    add({ id: 'live-sector', type: 'fill', source: this.sourceId, filter: ['==', ['get', 'kind'], 'sector'], minzoom: 13, maxzoom: 16, layout: hidden,
      paint: { 'fill-color': '#a0c8e0', 'fill-opacity': 0.15, 'fill-outline-color': '#4a90b8' } })
    add({ id: 'live-boulder', type: 'fill', source: this.sourceId, filter: ['==', ['get', 'kind'], 'boulder'], minzoom: 13, layout: hidden,
      paint: { 'fill-color': '#4a4a4a', 'fill-opacity': 0.85, 'fill-outline-color': '#2b2b2b' } })
    add({ id: 'live-boulder-point', type: 'circle', source: this.sourceId, filter: ['==', ['get', 'kind'], 'boulder_point'], minzoom: 13, layout: hidden,
      paint: { 'circle-color': '#555555', 'circle-radius': 4, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } })
    add({ id: 'live-route', type: 'circle', source: this.sourceId, filter: ['==', ['get', 'kind'], 'route'], minzoom: 13, layout: hidden,
      paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5.5, 17, 7], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2 } })
    add({ id: 'live-route-hit', type: 'circle', source: this.sourceId, filter: ['==', ['get', 'kind'], 'route'], minzoom: 13, layout: hidden,
      paint: { 'circle-color': '#000', 'circle-opacity': 0, 'circle-radius': 12 } })
    add({ id: 'live-boulder-label', type: 'symbol', source: this.sourceId, filter: ['==', ['get', 'kind'], 'boulder'], minzoom: 16, maxzoom: 19, layout: { ...hidden, 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-anchor': 'center' },
      paint: { 'text-color': '#1a1a1a', 'text-halo-color': 'rgba(255,255,255,0.8)', 'text-halo-width': 1.5 } })
    add({ id: 'live-boulder-point-label', type: 'symbol', source: this.sourceId, filter: ['==', ['get', 'kind'], 'boulder_point'], minzoom: 16, maxzoom: 19, layout: { ...hidden, 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 9, 'text-anchor': 'left', 'text-offset': [0.6, 0] },
      paint: { 'text-color': '#333333', 'text-halo-color': 'rgba(255,255,255,0.8)', 'text-halo-width': 1.5 } })
    add({ id: 'live-sector-label', type: 'symbol', source: this.sourceId, filter: ['==', ['get', 'kind'], 'sector'], minzoom: 13, maxzoom: 16, layout: { ...hidden, 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-anchor': 'center' },
      paint: { 'text-color': '#2a6090', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.5 } })
    add({ id: 'live-route-label', type: 'symbol', source: this.sourceId, filter: ['==', ['get', 'kind'], 'route'], minzoom: 19, layout: { ...hidden, 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.8, 'text-justify': 'auto' },
      paint: { 'text-color': '#202020', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.5 } })
    for (const id of this.liveLayers) {
      map.on('mouseenter', id, () => { if (this.active) map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', id, () => { if (this.active) map.getCanvas().style.cursor = '' })
    }
    this.ready = true
    this.hooks.onStatus?.('snapshot')
    this.schedule()
  }

  private schedule(): void {
    if (!this.ready) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.update(), REQUEST_DEBOUNCE_MS)
  }

  private async update(): Promise<void> {
    if (!this.ready) return
    if (this.map.getZoom() < LIVE_MIN_ZOOM) { this.useSnapshot(); return }
    const bounds = this.map.getBounds()
    const south = bounds.getSouth(), west = bounds.getWest(), north = bounds.getNorth(), east = bounds.getEast()
    const spanLat = north - south, spanLon = east - west
    if (!(spanLat > 0 && spanLon > 0) || spanLat > LIVE_MAX_SPAN || spanLon > LIVE_MAX_SPAN || spanLat * spanLon > LIVE_MAX_AREA) {
      this.useSnapshot('Zoom in to load live OSM data')
      return
    }
    const key = `${south.toFixed(3)},${west.toFixed(3)},${north.toFixed(3)},${east.toFixed(3)}`
    if (key === this.lastKey && this.active) return
    const request = ++this.request
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.hooks.onStatus?.('loading')
    try {
      const elements = await this.fetch(south, west, north, east, controller.signal)
      if (request !== this.request) return
      ;(this.map.getSource(this.sourceId) as GeoJSONSource).setData(toLiveFeatures(elements))
      this.lastKey = key
      this.useLive()
    } catch (error) {
      if (controller.signal.aborted || request !== this.request) return
      this.useSnapshot('Live OSM data unavailable')
      this.hooks.onError?.(error)
    }
  }

  /** Mirrors to try, preferring the host that worked last and skipping cooled-down ones. */
  private endpointOrder(): string[] {
    const now = Date.now()
    const usable = OVERPASS_ENDPOINTS.filter(endpoint => (this.cooldown.get(endpoint) ?? 0) <= now)
    const pool = usable.length ? usable : OVERPASS_ENDPOINTS
    if (!this.preferredEndpoint || !pool.includes(this.preferredEndpoint)) return pool
    return [this.preferredEndpoint, ...pool.filter(endpoint => endpoint !== this.preferredEndpoint)]
  }

  private async fetch(south: number, west: number, north: number, east: number, signal: AbortSignal): Promise<OverpassElement[]> {
    const query = `[out:json][timeout:25][maxsize:33554432];nwr["climbing"](${south},${west},${north},${east});out geom;`
    const deadline = Date.now() + FAILOVER_DEADLINE_MS
    let lastError: unknown
    for (const endpoint of this.endpointOrder()) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      if (Date.now() >= deadline) break
      try {
        const data = await this.requestJson(endpoint, { method: 'POST', body: new URLSearchParams({ data: query }) }, signal)
        if (!Array.isArray(data?.elements)) throw new Error(`${new URL(endpoint).host} returned an unexpected response`)
        this.preferredEndpoint = endpoint
        this.cooldown.delete(endpoint)
        return data.elements as OverpassElement[]
      } catch (error) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        lastError = error
        this.cooldown.set(endpoint, Date.now() + ENDPOINT_COOLDOWN_MS)
        if (this.preferredEndpoint === endpoint) this.preferredEndpoint = undefined
      }
    }
    throw lastError instanceof Error ? lastError : new Error('All Overpass endpoints failed')
  }

  private async requestJson(url: string, init: RequestInit, signal: AbortSignal): Promise<any> {
    // Bound each attempt so one unresponsive mirror cannot stall the others.
    const timeout = new AbortController()
    const abort = () => timeout.abort()
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, { ...init, signal: timeout.signal })
      if (!response.ok) throw new Error(`${new URL(url).host} returned HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
  }

  private useLive(): void {
    if (this.active) { this.hooks.onStatus?.('live'); return }
    this.active = true
    for (const id of this.snapshotLayers) this.map.setLayoutProperty(id, 'visibility', 'none')
    for (const id of this.liveLayers) this.map.setLayoutProperty(id, 'visibility', 'visible')
    this.hooks.onStatus?.('live')
  }

  private useSnapshot(detail?: string): void {
    if (this.active) {
      this.active = false
      this.controller?.abort()
      for (const id of this.liveLayers) this.map.setLayoutProperty(id, 'visibility', 'none')
      for (const id of this.snapshotLayers) this.map.setLayoutProperty(id, 'visibility', 'visible')
    }
    this.hooks.onStatus?.('snapshot', detail)
  }
}
