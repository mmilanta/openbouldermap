import type { Map as LibreMap, MapMouseEvent, GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl'
import { EditGraph, groupKind, isBoulder, isRoute, keyOf, pointInRing, type Key, type Position, type Element } from './model'
import { routeGradeColor as gradeColorForTags } from '../grades'
import { AREA_LABEL_LAYERS } from '../style'

export interface Snap { way: Key; segment: number; position: Position; vertex?: number }
export interface ContextTarget { key: Key; way?: Key; position: Position; x: number; y: number }
interface Hooks {
  select(key: Key): void
  context(target: ContextTarget): void
  dismissContext(): void
  vertex(way: Key, node: Key): void
  createRoute(p: Position, snap?: Snap): void
  createBoulder(points: Position[]): void
  moveNode(key: Key, p: Position, snap?: Snap): Promise<unknown>
  moveBoulder(key: Key, dx: number, dy: number): Promise<unknown>
  insert(way: Key, segment: number, p: Position): void
  message(text: string): void
  loadVisible(): void
  canInteract(): boolean
}
const empty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] })
// Small, clickable point features that get an index-finger cursor. Polygons
// (boulders, areas) keep the drag hand: panning is the primary gesture there.
const POINT_CURSOR_LAYERS = [
  'edit-vertices', 'edit-routes',
  'route', 'route-hit',
  'boulder-point', 'boulder-point-label', 'boulder-label',
  'sector-label', ...AREA_LABEL_LAYERS,
  // Live edit-mode layers, present once the live-data feature is merged.
  'live-route', 'live-route-hit',
  'live-boulder-point', 'live-boulder-point-label', 'live-boulder-label', 'live-sector-label'
]
export class EditingMap {
  selected?: Key
  vertexSelection?: { way: Key; node: Key }
  tool: 'select' | 'route' | 'boulder' | 'move-boulder' = 'select'
  drawing: Position[] = []
  private ready = false
  private committingDrag = false
  private drag?: { key: Key; whole: boolean; start: Position; current: Position; moved: boolean; detachedOrigin?: Position }
  private preview = new Map<number, Position>()
  private snap?: Snap
  private suppressClick = false
  private baseFilters = new Map<string, any>()
  private filterSignature = ''
  private panning = false
  // Latest editor features, kept so hit-testing does not depend on MapLibre's
  // asynchronous GeoJSON re-parse (queryRenderedFeatures can lag a change).
  private lastFeatures: GeoJSON.Feature[] = []
  private lastHandles: GeoJSON.Feature[] = []
  constructor(readonly map: LibreMap, readonly graph: EditGraph, readonly hooks: Hooks) {
    // The editor chunk loads lazily, so the map may already be loaded by the
    // time this runs; initialize immediately in that case instead of waiting
    // for a 'load' event that has already fired.
    if (map.isStyleLoaded()) this.init()
    else map.on('load', () => this.init())
    map.on('click', e => this.click(e))
    map.on('contextmenu', e => this.context(e))
    map.on('movestart', () => hooks.dismissContext())
    map.dragRotate?.disable() // Right-click belongs to editing actions, not map rotation.
    map.on('mousedown', e => this.down(e))
    map.on('mousemove', e => this.move(e))
    map.on('mouseup', e => this.up(e))
    // Panning shows the closed hand; the open hand is the select default.
    map.on('dragstart', () => { this.panning = true; this.applyCursor() })
    map.on('dragend', () => { this.panning = false; this.applyCursor() })
    map.on('idle', () => { if (this.ready) hooks.loadVisible() })
    window.addEventListener('mouseup', () => { if (this.drag) this.cancelDrag() })
    window.addEventListener('blur', () => this.cancelDrag())
  }
  private init(): void {
    const m = this.map
    m.doubleClickZoom.disable()
    m.addSource('edit-features', { type: 'geojson', data: empty() })
    m.addSource('edit-handles', { type: 'geojson', data: empty() })
    m.addSource('edit-sketch', { type: 'geojson', data: empty() })
    m.addLayer({ id: 'edit-boulders', type: 'fill', source: 'edit-features', filter: ['==', ['get', 'kind'], 'boulder'], paint: { 'fill-color': ['case', ['get', 'selected'], '#447cac', '#555555'], 'fill-opacity': 0.6 } })
    m.addLayer({ id: 'edit-outlines', type: 'line', source: 'edit-features', filter: ['==', ['get', 'kind'], 'boulder'], paint: { 'line-color': '#194f7a', 'line-width': 2 } })
    m.addLayer({ id: 'edit-routes', type: 'circle', source: 'edit-features', filter: ['==', ['get', 'kind'], 'route'], paint: { 'circle-color': ['get', 'color'], 'circle-radius': 7, 'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.5], 'circle-stroke-color': ['case', ['get', 'selected'], '#111', '#fff'] } })
    m.addLayer({ id: 'edit-names', type: 'symbol', source: 'edit-features', filter: ['in', ['get', 'kind'], ['literal', ['route', 'boulder']]], layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.5] }, paint: { 'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } })
    for (const kind of ['sector', 'area']) m.addLayer({ id: `edit-${kind}-names`, type: 'symbol', source: 'edit-features', minzoom: kind === 'area' ? 2 : 13, maxzoom: kind === 'area' ? 13 : 16,
      filter: ['==', ['get', 'kind'], kind], layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 13 }, paint: { 'text-color': kind === 'area' ? '#285b33' : '#2a6090', 'text-halo-color': '#fff', 'text-halo-width': 2 } })
    m.addLayer({ id: 'edit-vertices', type: 'circle', source: 'edit-handles', paint: { 'circle-radius': ['case', ['==', ['get', 'handle'], 'midpoint'], 4, 6], 'circle-color': ['case', ['get', 'route'], '#f2a23a', '#fff'], 'circle-stroke-color': ['case', ['get', 'selected'], '#e02929', '#194f7a'], 'circle-stroke-width': 2 } })
    m.addLayer({ id: 'edit-sketch-line', type: 'line', source: 'edit-sketch', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#d36b00', 'line-width': 3, 'line-dasharray': [2, 1] } })
    m.addLayer({ id: 'edit-sketch-points', type: 'circle', source: 'edit-sketch', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': '#ffbb44', 'circle-stroke-width': 2, 'circle-stroke-color': '#111' } })
    this.ready = true; this.render(); this.applyCursor(); this.hooks.loadVisible()
  }
  setTool(tool: EditingMap['tool']): void {
    this.hooks.dismissContext()
    this.cancelDrag(); this.tool = tool; this.drawing = []
    this.applyCursor()
    this.hooks.message(tool === 'route' ? 'Click to place a route. Hold Alt to avoid snapping.' : tool === 'boulder' ? 'Click perimeter corners, then click the first or last corner again to close. Enter also finishes; Escape cancels; Backspace removes the last corner.' : tool === 'move-boulder' ? 'Drag the selected boulder to move it and all attached routes.' : 'Select a route or boulder. Drag selected vertices; click small midpoint handles to add a vertex.')
    this.render()
  }
  finish(): void { if (this.tool === 'boulder') this.hooks.createBoulder([...this.drawing]) }
  cancel(): void { this.setTool('select') }
  select(key?: Key): void { this.selected = key; this.vertexSelection = undefined; this.render() }
  private point(id: number): Position { return this.preview.get(id) ?? this.graph.position(id) }
  private feature(geometry: GeoJSON.Geometry, properties: Record<string, any>): GeoJSON.Feature { return { type: 'Feature', geometry, properties } }
  private selectedWays(): Element[] {
    const e = this.selected && this.graph.get(this.selected)
    if (!e) return []
    try { return isBoulder(e) ? this.graph.rings(keyOf(e)) : isRoute(e) ? this.graph.attached(keyOf(e)) : [] } catch { return [] }
  }
  private groupPosition(e: Element, visited = new Set<Key>()): Position | undefined {
    if (visited.has(keyOf(e))) return
    visited.add(keyOf(e))
    if (e.type === 'node') return this.point(e.id)
    const positions: Position[] = []
    for (const member of e.members ?? []) {
      const child = this.graph.get(`${member.type}/${member.ref}`)
      const p = child && this.groupPosition(child, visited)
      if (p) positions.push(p)
    }
    if (positions.length) return [positions.reduce((sum, p) => sum + p[0], 0) / positions.length, positions.reduce((sum, p) => sum + p[1], 0) / positions.length]
    // Existing labels can provide a display-only fallback for partially loaded groups.
    const kind = groupKind(e)
    const tile = kind && this.map.querySourceFeatures('climbing', { sourceLayer: kind === 'area' ? 'areas' : 'sectors' }).find(f => Number(f.properties.osm_id) === e.id && f.properties.osm_type === e.type && f.geometry.type === 'Point')
    return tile ? (tile.geometry as GeoJSON.Point).coordinates as Position : undefined
  }
  render(): void {
    if (!this.ready) return
    const features: GeoJSON.Feature[] = [], handles: GeoJSON.Feature[] = []
    for (const e of this.graph.all()) {
      const key = keyOf(e), properties = { key, name: e.tags.name ?? '', selected: key === this.selected }
      const kind = groupKind(e)
      if (kind) {
        const position = this.groupPosition(e)
        if (position) features.push(this.feature({ type: 'Point', coordinates: position }, { ...properties, kind, name: e.tags.name || `Unnamed ${kind}` }))
      }
      if (isRoute(e)) features.push(this.feature({ type: 'Point', coordinates: this.point(e.id) }, { ...properties, kind: 'route', color: gradeColorForTags(e.tags) }))
      if (isBoulder(e) && e.type !== 'node') {
        try {
          const rings = this.graph.rings(key)
          if (e.type === 'way') features.push(this.feature({ type: 'Polygon', coordinates: [rings[0].nodes!.map(id => this.point(id))] }, { ...properties, kind: 'boulder' }))
          else {
            const outer = rings.filter(w => e.members?.find(m => m.type === 'way' && m.ref === w.id)?.role !== 'inner')
            const inner = rings.filter(w => e.members?.find(m => m.type === 'way' && m.ref === w.id)?.role === 'inner')
            const coordinates = outer.map(w => {
              const ring = w.nodes!.map(id => this.point(id))
              return [ring, ...inner.filter(h => pointInRing(this.point(h.nodes![0]), ring)).map(h => h.nodes!.map(id => this.point(id)))]
            })
            features.push(this.feature({ type: 'MultiPolygon', coordinates }, { ...properties, kind: 'boulder' }))
          }
        } catch { /* Unsupported/incomplete geometry stays visible in the base tiles. */ }
      }
    }
    for (const w of this.selectedWays()) {
      const ids = w.nodes ?? []
      for (let i = 0; i < ids.length - 1; i++) {
        const a = this.point(ids[i]), b = this.point(ids[i + 1])
        handles.push(this.feature({ type: 'Point', coordinates: a }, { handle: 'vertex', key: `node/${ids[i]}`, way: keyOf(w), route: isRoute(this.graph.get(`node/${ids[i]}`)), selected: this.vertexSelection?.node === `node/${ids[i]}` }))
        handles.push(this.feature({ type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }, { handle: 'midpoint', way: keyOf(w), segment: i, route: false, selected: false }))
      }
    }
    this.lastFeatures = features
    this.lastHandles = handles
    ;(this.map.getSource('edit-features') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
    ;(this.map.getSource('edit-handles') as GeoJSONSource).setData({ type: 'FeatureCollection', features: handles })
    const sketch: GeoJSON.Feature[] = this.drawing.map(p => this.feature({ type: 'Point', coordinates: p }, {}))
    if (this.drawing.length > 1) sketch.push(this.feature({ type: 'LineString', coordinates: this.drawing }, {}))
    if (this.snap) sketch.push(this.feature({ type: 'Point', coordinates: this.snap.position }, {}))
    ;(this.map.getSource('edit-sketch') as GeoJSONSource).setData({ type: 'FeatureCollection', features: sketch })
    // Hide stale tile versions of locally loaded routes and successfully drawn boulders,
    // plus deleted features. OSM types are part of identity (IDs overlap across types).
    const hidden = new Set(features.map(f => f.properties!.key as Key))
    for (const c of this.graph.changes()) if (c.action === 'delete' || c.before && isRoute(c.before) && !isRoute(c.after)) hidden.add(c.key)
    const signature = [...hidden].sort().join(',')
    if (signature === this.filterSignature) return
    this.filterSignature = signature
    for (const layer of this.map.getStyle().layers ?? []) {
      if (!('source' in layer) || layer.source !== 'climbing') continue
      if (!this.baseFilters.has(layer.id)) this.baseFilters.set(layer.id, this.map.getFilter(layer.id) ?? true)
      const tests = [...hidden].map(k => { const [type, id] = k.split('/'); return ['all', ['==', ['to-number', ['get', 'osm_id']], Number(id)], ['==', ['coalesce', ['get', 'osm_type'], 'node'], type]] })
      this.map.setFilter(layer.id, ['all', this.baseFilters.get(layer.id), ['!', ['any', ...tests]]] as any)
    }
  }
  snapAt(p: Position, exclude?: Key): Snap | undefined {
    const q = this.map.project(p)
    let result: Snap | undefined, distance = 13
    for (const way of this.graph.boulderWays()) {
      const ids = way.nodes ?? []
      if (exclude && ids.includes(this.graph.require(exclude).id)) continue
      for (let i = 0; i < ids.length - 1; i++) {
        if (!this.graph.get(`node/${ids[i]}`) || !this.graph.get(`node/${ids[i + 1]}`)) continue
        const a = this.map.project(this.graph.position(ids[i])), b = this.map.project(this.graph.position(ids[i + 1]))
        const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
        const t = length ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / length)) : 0
        const nearest = { x: a.x + t * dx, y: a.y + t * dy }, d = Math.hypot(q.x - nearest.x, q.y - nearest.y)
        if (d < distance) {
          const vertex = Math.hypot(q.x - a.x, q.y - a.y) < 9 ? ids[i] : Math.hypot(q.x - b.x, q.y - b.y) < 9 ? ids[i + 1] : undefined
          const ll = this.map.unproject([nearest.x, nearest.y])
          result = { way: keyOf(way), segment: i, vertex, position: vertex === undefined ? [ll.lng, ll.lat] : this.graph.position(vertex) }; distance = d
        }
      }
    }
    return result
  }
  private hits(e: MapMouseEvent, layers: string[]): MapGeoJSONFeature[] { return this.ready ? this.map.queryRenderedFeatures(e.point, { layers }) : [] }
  /** Hand cursor while panning, index finger over editable point features. */
  private applyCursor(e?: MapMouseEvent): void {
    if (!this.ready) return
    const canvas = this.map.getCanvas()
    if (!this.hooks.canInteract()) { canvas.style.cursor = ''; return }
    if (this.tool === 'route' || this.tool === 'boulder') { canvas.style.cursor = 'crosshair'; return }
    if (this.panning || this.drag) { canvas.style.cursor = 'grabbing'; return }
    if (e === undefined) { canvas.style.cursor = 'grab'; return }
    const layers = POINT_CURSOR_LAYERS.filter(id => this.map.getLayer(id))
    // queryRenderedFeatures lags a just-added handle, so also probe the latest
    // editor data (same fallback the drag handler uses).
    const overNode = (layers.length > 0 && this.map.queryRenderedFeatures(e.point, { layers }).length > 0)
      || this.pointHit(this.lastHandles, e.point, () => true, 8) !== undefined
      || this.pointHit(this.lastFeatures, e.point, f => f.properties?.kind === 'route', 8) !== undefined
    canvas.style.cursor = overNode ? 'pointer' : 'grab'
  }
  private context(e: MapMouseEvent): void {
    e.preventDefault(); e.originalEvent.preventDefault()
    this.hooks.dismissContext()
    if (!this.ready || this.committingDrag || !this.hooks.canInteract()) return
    if (this.tool !== 'select') {
      this.hooks.message('Finish or cancel the current drawing/move action before opening object actions.')
      return
    }
    const vertex = this.hits(e, ['edit-vertices']).find(f => f.properties.handle === 'vertex')
    const localRoute = this.hits(e, ['edit-routes'])[0]
    const tileRoute = this.hits(e, ['route', 'route-hit'])[0]
    const localBoulder = this.hits(e, ['edit-boulders', 'edit-outlines'])[0]
    const tileBoulder = this.hits(e, ['boulder', 'boulder-label'])[0]
    const feature = vertex ?? localRoute ?? tileRoute ?? localBoulder ?? tileBoulder
    if (!feature) return
    const props = feature.properties
    const key = props.key ?? `${props.osm_type ?? 'node'}/${Number(props.osm_id)}`
    if (!/^(node|way|relation)\/-?\d+$/.test(key)) return
    this.hooks.context({ key: key as Key, way: props.way as Key | undefined,
      position: [e.lngLat.lng, e.lngLat.lat], x: e.originalEvent.clientX, y: e.originalEvent.clientY })
  }
  private click(e: MapMouseEvent): void {
    if (!this.ready || !this.hooks.canInteract()) return
    if (this.suppressClick) { this.suppressClick = false; return }
    const p: Position = [e.lngLat.lng, e.lngLat.lat]
    if (this.tool === 'boulder') {
      const endpoints = [this.drawing[0], this.drawing[this.drawing.length - 1]].filter(Boolean)
      const closesOutline = endpoints.some(endpoint => {
        const screen = this.map.project(endpoint)
        return Math.hypot(screen.x - e.point.x, screen.y - e.point.y) <= 10
      })
      if (closesOutline) {
        if (this.drawing.length >= 3) this.finish()
        else this.hooks.message('Place at least three distinct perimeter corners before closing the outline.')
      } else { this.drawing.push(p); this.render() }
      return
    }
    if (this.tool === 'route') { this.hooks.createRoute(p, e.originalEvent.altKey ? undefined : this.snapAt(p)); return }
    const handle = this.hits(e, ['edit-vertices'])[0]
    if (handle) {
      const props = handle.properties
      if (props.handle === 'midpoint') this.hooks.insert(props.way as Key, props.segment, (handle.geometry as GeoJSON.Point).coordinates as Position)
      else if (props.route) this.hooks.select(props.key as Key)
      else { this.vertexSelection = { way: props.way as Key, node: props.key as Key }; this.hooks.vertex(this.vertexSelection.way, this.vertexSelection.node); this.render() }
      return
    }
    const local = this.hits(e, ['edit-area-names', 'edit-sector-names'])[0] ?? this.hits(e, ['edit-routes', 'edit-boulders'])[0]
    if (local) { this.hooks.select(local.properties.key as Key); return }
    const tile = this.hits(e, ['sector-label', ...AREA_LABEL_LAYERS])[0] ?? this.hits(e, ['route', 'route-hit'])[0] ?? this.hits(e, ['boulder', 'boulder-label', 'boulder-point', 'boulder-point-label', 'sector', 'area'])[0]
    if (tile) {
      const props = tile.properties, type = props.osm_type ?? 'node', id = Number(props.osm_id)
      if (['node', 'way', 'relation'].includes(type) && Number.isFinite(id)) this.hooks.select(`${type}/${id}` as Key)
    }
  }
  /** Nearest point feature in the latest editor data, in screen space. */
  private pointHit(source: GeoJSON.Feature[], point: { x: number; y: number }, match: (feature: GeoJSON.Feature) => boolean, maxDistance: number): GeoJSON.Feature | undefined {
    let best: GeoJSON.Feature | undefined, bestDistance = maxDistance
    for (const feature of source) {
      if (feature.geometry.type !== 'Point' || !match(feature)) continue
      const projected = this.map.project(feature.geometry.coordinates as Position)
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y)
      if (distance <= bestDistance) { bestDistance = distance; best = feature }
    }
    return best
  }
  /** Latest polygon feature containing a coordinate. */
  private polygonHit(source: GeoJSON.Feature[], longitude: number, latitude: number, match: (feature: GeoJSON.Feature) => boolean): GeoJSON.Feature | undefined {
    for (const feature of source) {
      if (!match(feature)) continue
      const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : []
      if (polygons.some(polygon => polygon.some(ring => pointInRing([longitude, latitude], ring as Position[])))) return feature
    }
    return undefined
  }
  private down(e: MapMouseEvent): void {
    if (!this.ready || this.committingDrag || !this.hooks.canInteract() || e.originalEvent.button !== 0 || this.tool === 'route' || this.tool === 'boulder') return
    // Prefer the rendered hit, but fall back to the latest data because a change
    // made moments ago may not have been re-parsed into the rendered tiles yet.
    const handle = this.hits(e, ['edit-vertices']).find(f => f.properties.handle === 'vertex')
      ?? this.pointHit(this.lastHandles, e.point, f => f.properties?.handle === 'vertex', 9)
    const routeHit = this.hits(e, ['edit-routes']).find(f => f.properties.key === this.selected)
      ?? this.pointHit(this.lastFeatures, e.point, f => f.properties?.kind === 'route', 9)
    const route = routeHit?.properties?.key === this.selected ? routeHit : undefined
    const whole = this.tool === 'move-boulder' && (this.hits(e, ['edit-boulders']).some(f => f.properties.key === this.selected)
      || !!this.polygonHit(this.lastFeatures, e.lngLat.lng, e.lngLat.lat, f => f.properties?.kind === 'boulder' && f.properties?.key === this.selected))
    const key = whole ? this.selected : handle?.properties?.key ?? route?.properties?.key
    if (!key) return
    e.preventDefault(); this.map.dragPan.disable()
    const start: Position = [e.lngLat.lng, e.lngLat.lat]
    let detachedOrigin: Position | undefined
    if (!whole && isRoute(this.graph.get(key)) && !this.graph.attached(key).length) {
      const origin = this.graph.position(this.graph.require(key).id), target = this.snapAt(origin, key)
      if (target) {
        const a = this.map.project(origin), b = this.map.project(target.position)
        if (Math.hypot(a.x - b.x, a.y - b.y) < .5) detachedOrigin = origin
      }
    }
    this.drag = { key, whole, start, current: start, moved: false, detachedOrigin }
    this.applyCursor(e)
  }
  private move(e: MapMouseEvent): void {
    if (!this.ready) return
    this.applyCursor(e)
    const p: Position = [e.lngLat.lng, e.lngLat.lat]
    if (!this.hooks.canInteract()) return
    if (this.tool === 'route') { this.snap = e.originalEvent.altKey ? undefined : this.snapAt(p); this.render(); return }
    if (!this.drag) return
    const d = this.drag, start = this.map.project(d.start)
    if (Math.hypot(start.x - e.point.x, start.y - e.point.y) < 3 && !d.moved) return
    d.moved = true; d.current = p; this.preview.clear(); this.snap = undefined
    if (d.whole) {
      for (const id of new Set(this.graph.rings(d.key).flatMap(w => w.nodes!))) { const old = this.graph.position(id); this.preview.set(id, [old[0] + p[0] - d.start[0], old[1] + p[1] - d.start[1]]) }
    } else {
      const origin = d.detachedOrigin && this.map.project(d.detachedOrigin)
      const leavingDetachedPoint = origin && Math.hypot(e.point.x - origin.x, e.point.y - origin.y) < 20
      if (isRoute(this.graph.get(d.key)) && !this.graph.attached(d.key).length && !e.originalEvent.altKey && !leavingDetachedPoint) this.snap = this.snapAt(p, d.key)
      this.preview.set(this.graph.require(d.key).id, this.snap?.position ?? p)
    }
    this.render()
  }
  private async up(e: MapMouseEvent): Promise<void> {
    const d = this.drag, snap = this.snap
    if (!d) return
    if (!d.moved) { this.cancelDrag(); return }
    this.drag = undefined
    this.map.dragPan.enable()
    this.committingDrag = true
    this.suppressClick = true
    // Keep the dropped geometry visible while first-use reference checks run.
    // Releasing the gesture must not revert to the graph's old coordinates.
    setTimeout(() => { this.suppressClick = false }, 0)
    try {
      if (d.whole) await this.hooks.moveBoulder(d.key, d.current[0] - d.start[0], d.current[1] - d.start[1])
      else await this.hooks.moveNode(d.key, d.current, snap)
    } catch (error) {
      this.hooks.message(error instanceof Error ? error.message : String(error))
    } finally {
      this.committingDrag = false
      this.preview.clear(); this.snap = undefined
      this.applyCursor(e)
      this.render() // Commit coordinates, or restore the original geometry on failure.
    }
  }
  private cancelDrag(): void {
    if (this.committingDrag) return
    this.drag = undefined; this.preview.clear(); this.snap = undefined; this.map.dragPan.enable(); this.render(); this.applyCursor()
  }
}
