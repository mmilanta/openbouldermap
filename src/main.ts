import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { INITIAL_VIEW } from './config'
import { buildStyle } from './style'
import { showRoute, showBoulder, hideSidebar } from './sidebar'
import { THEMES, applyTheme } from './themes'

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

map.on('load', () => {
  // Cursor: pointer over clickable layers.
  const interactiveLayers = ['route-hit', 'route', 'boulder', 'boulder-point', 'sector']
  for (const l of interactiveLayers) {
    map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''))
  }
})

// --- Theme switcher ---
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement
for (const t of THEMES) {
  const opt = document.createElement('option')
  opt.value = t.name
  opt.textContent = t.name
  themeSelect.appendChild(opt)
}
themeSelect.addEventListener('change', () => {
  const theme = THEMES.find(t => t.name === themeSelect.value)
  if (theme) applyTheme(map, theme)
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
  // Boulder polygons, boulder points, and sectors all show the boulder sidebar.
  const boulderHits = map.queryRenderedFeatures(e.point, { layers: ['boulder', 'boulder-point', 'sector'] })
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
