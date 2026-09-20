import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Protocol } from 'pmtiles'
import { CLIMBING_METADATA_URL, INITIAL_VIEW } from './config'
import { buildStyle } from './style'
import { showRoute, showBoulder, hideSidebar, setRouteNavigator, setSectorNavigator } from './sidebar'
import { isEditMode } from './editMode'
import { initSearch } from './search'
import { setSelectionMap } from './selection'
import { routesOnBoulder, setBoulderRoutesMap } from './boulderRoutes'

// Register the pmtiles:// protocol so MapLibre can read our static archive.
const protocol = new Protocol({ metadata: true })
maplibregl.addProtocol('pmtiles', protocol.tile as any)

// Explicitly point MapLibre at its worker. Without this, Vite's dep optimizer
// resolves the worker relative to the pre-bundled module (node_modules/.vite/deps)
// and the map fails to load any vector tiles. `?worker&url` routes the worker
// through Vite's worker pipeline, emitting a self-contained chunk in production.
maplibregl.setWorkerUrl(workerUrl)

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(),
  center: INITIAL_VIEW.center,
  zoom: INITIAL_VIEW.zoom,
  minZoom: INITIAL_VIEW.minZoom,
  maxZoom: INITIAL_VIEW.maxZoom,
  hash: true,
  canvasContextAttributes: { preserveDrawingBuffer: true },
  attributionControl: false
})

setSelectionMap(map)
setBoulderRoutesMap(map)

map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

// The update date belongs in the attribution bar rather than in a separate
// map control.
void fetch(CLIMBING_METADATA_URL)
  .then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json() as Promise<{ updated?: string }>
  })
  .then(metadata => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.updated ?? '')) return
    const attributionDate = document.getElementById('tile-attribution-date') as HTMLTimeElement | null
    if (attributionDate) {
      attributionDate.dateTime = metadata.updated!
      attributionDate.textContent = metadata.updated!
    }
  })
  .catch(() => { /* The map remains usable if update metadata is unavailable. */ })

// The editor is a separate chunk: viewers never download it. It is only
// requested when the app is served on the edit route. View mode instead gets
// the worldwide search bar, whose index loads lazily on first interaction.
if (isEditMode()) {
  void import('./editor').then(({ initEditorButton, initEditorMap }) => {
    initEditorButton(map)
    initEditorMap(map)
  })
} else {
  initSearch(map)
}

// Store for debugging
;(window as any).__map = map

setRouteNavigator(route => {
  map.flyTo({ center: [route.lon, route.lat], zoom: 19, essential: true })
})
setSectorNavigator((lon, lat) => {
  map.flyTo({ center: [lon, lat], zoom: 14, essential: true })
})

map.on('load', () => {
  // Edit mode owns its cursor: a hand for panning, index finger over nodes.
  if (isEditMode()) return
  // Cursor: pointer over clickable layers.
  const interactiveLayers = [
    'route-hit', 'route',
    'boulder-label', 'boulder-point-label', 'boulder', 'boulder-point',
    'sector-label', 'sector', 'area-label', 'area'
  ]
  for (const l of interactiveLayers) {
    map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''))
  }
})

map.on('click', (e) => {
  if (isEditMode()) return // The editor handles live geometry and local features.
  // Labels are explicit navigation targets. At sector zoom, route hit circles
  // may sit underneath a sector name, so the name must win the click.
  const hierarchyLabelHits = map.queryRenderedFeatures(e.point, {
    layers: ['sector-label', 'area-label']
  })
  if (hierarchyLabelHits.length > 0) {
    const f = hierarchyLabelHits[0]
    const coords = f.geometry.type === 'Point' ? (f.geometry as any).coordinates : undefined
    const lon = coords?.[0] ?? e.lngLat.lng
    const lat = coords?.[1] ?? e.lngLat.lat
    const kind = f.layer.id.startsWith('area') ? 'area' : 'sector'
    showBoulder({ ...(f.properties ?? {}), kind }, lon, lat)
    return
  }

  // Prefer problems over physical boulder geometry. Route names are not
  // clickable — selection happens on the grade-colored dot itself.
  const routeHits = map.queryRenderedFeatures(e.point, { layers: ['route-hit', 'route'] })
  if (routeHits.length > 0) {
    const f = routeHits[0]
    const [lon, lat] = (f.geometry as any).coordinates ?? [e.lngLat.lng, e.lngLat.lat]
    showRoute(f.properties ?? {}, lon, lat)
    return
  }
  // Physical boulders, sectors, and broad areas share the location sidebar.
  const boulderHits = map.queryRenderedFeatures(e.point, {
    layers: [
      'boulder-label', 'boulder-point-label', 'boulder', 'boulder-point',
      'sector-label', 'sector', 'area-label', 'area'
    ]
  })
  if (boulderHits.length > 0) {
    const f = boulderHits[0]
    const coords = f.geometry.type === 'Point' ? (f.geometry as any).coordinates : undefined
    const lon = coords?.[0] ?? e.lngLat.lng
    const lat = coords?.[1] ?? e.lngLat.lat
    const layerKind = f.layer.id.startsWith('area')
      ? 'area'
      : f.layer.id.startsWith('sector')
        ? 'sector'
        : undefined
    const nearbyRoutes = layerKind ? undefined : routesOnBoulder(f)
    showBoulder(
      { ...(f.properties ?? {}), ...(layerKind ? { kind: layerKind } : {}) },
      lon,
      lat,
      nearbyRoutes
    )
    return
  }
  hideSidebar()
})
