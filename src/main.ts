import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { INITIAL_VIEW } from './config'
import { buildStyle } from './style'
import { showRoute, showBoulder, hideSidebar, setRouteNavigator, setSectorNavigator } from './sidebar'

// Register the pmtiles:// protocol so MapLibre can read our static archive.
const protocol = new Protocol({ metadata: true })
maplibregl.addProtocol('pmtiles', protocol.tile as any)

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(),
  center: INITIAL_VIEW.center,
  zoom: INITIAL_VIEW.zoom,
  minZoom: INITIAL_VIEW.minZoom,
  maxZoom: INITIAL_VIEW.maxZoom,
  hash: true,
  preserveDrawingBuffer: true,
  attributionControl: { compact: true }
})

map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

// Store for debugging
;(window as any).__map = map

setRouteNavigator(route => {
  map.flyTo({ center: [route.lon, route.lat], zoom: 19, essential: true })
})
setSectorNavigator((lon, lat) => {
  map.flyTo({ center: [lon, lat], zoom: 14, essential: true })
})

map.on('load', () => {
  // Cursor: pointer over clickable layers.
  const interactiveLayers = [
    'route-label', 'route-hit', 'route',
    'boulder-label', 'boulder-point-label', 'boulder', 'boulder-point',
    'sector-label', 'sector', 'area-label', 'area'
  ]
  for (const l of interactiveLayers) {
    map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''))
  }
})

map.on('click', (e) => {
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

  // Prefer problems over physical boulder geometry.
  const routeHits = map.queryRenderedFeatures(e.point, { layers: ['route-label', 'route-hit', 'route'] })
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
    showBoulder({ ...(f.properties ?? {}), ...(layerKind ? { kind: layerKind } : {}) }, lon, lat)
    return
  }
  hideSidebar()
})
