import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { INITIAL_VIEW } from './config'
import { buildStyle } from './style'
import { showRoute, showBoulder, hideSidebar } from './sidebar'

// Register the pmtiles:// protocol so MapLibre can read our static archive.
const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile as any)

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(),
  center: INITIAL_VIEW.center,
  zoom: INITIAL_VIEW.zoom,
  minZoom: INITIAL_VIEW.minZoom,
  maxZoom: INITIAL_VIEW.maxZoom,
  hash: true,
  attributionControl: { compact: true }
})

map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

map.on('load', () => {
  // Cursor: pointer over clickable route/boulder layers.
  const interactiveLayers = ['route-hit', 'route', 'boulder']
  for (const l of interactiveLayers) {
    map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''))
  }
})

map.on('click', (e) => {
  // Prefer routes, then boulders.
  const routeHits = map.queryRenderedFeatures(e.point, { layers: ['route-hit', 'route'] })
  if (routeHits.length > 0) {
    const f = routeHits[0]
    const [lon, lat] = (f.geometry as any).coordinates ?? [e.lngLat.lng, e.lngLat.lat]
    showRoute(f.properties ?? {}, lon, lat)
    return
  }
  const boulderHits = map.queryRenderedFeatures(e.point, { layers: ['boulder'] })
  if (boulderHits.length > 0) {
    const f = boulderHits[0]
    const coords = (f.geometry as any)?.coordinates
    const lon = Array.isArray(coords) ? coords[0] : e.lngLat.lng
    const lat = Array.isArray(coords) ? coords[1] : e.lngLat.lat
    showBoulder(f.properties ?? {}, lon, lat)
    return
  }
  hideSidebar()
})
