import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Protocol } from 'pmtiles'
import { CLIMBING_METADATA_URL, INITIAL_VIEW } from './config'
import { buildStyle, AREA_LABEL_LAYERS } from './style'
import { openArea, openBoulder, openProblem, hideSidebar, setNavigator } from './sidebar'
import { isEditMode } from './editMode'
import { initSearch } from './search'
import { setSelectionMap } from './selection'

// Register the pmtiles:// protocol so MapLibre can read our static archive.
const protocol = new Protocol({ metadata: true })
maplibregl.addProtocol('pmtiles', protocol.tile as any)

// Explicitly point MapLibre at its worker. Without this, Vite's dep optimizer
// resolves the worker relative to the pre-bundled module (node_modules/.vite/deps)
// and the map fails to load any vector tiles. `?worker&url` routes the worker
// through Vite's worker pipeline, emitting a self-contained chunk in production.
maplibregl.setWorkerUrl(workerUrl)

async function start(): Promise<void> {
  // Area zoom bands are anchored to the deepest level that actually exists, so
  // read the (tiny) metadata first. If it is unavailable the map still renders
  // with a single-level band layout.
  let maxRank = 1
  let updated: string | undefined
  try {
    const response = await fetch(CLIMBING_METADATA_URL)
    if (response.ok) {
      const metadata = (await response.json()) as { updated?: string; maxRank?: number }
      if (Number.isFinite(metadata.maxRank)) maxRank = metadata.maxRank!
      if (/^\d{4}-\d{2}-\d{2}$/.test(metadata.updated ?? '')) updated = metadata.updated
    }
  } catch {
    /* The map remains usable if update metadata is unavailable. */
  }

  const map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(maxRank),
    center: INITIAL_VIEW.center,
    zoom: INITIAL_VIEW.zoom,
    minZoom: INITIAL_VIEW.minZoom,
    maxZoom: INITIAL_VIEW.maxZoom,
    hash: true,
    canvasContextAttributes: { preserveDrawingBuffer: true },
    attributionControl: false
  })

  setSelectionMap(map)

  // The update date belongs in the attribution bar rather than in a separate
  // map control.
  if (updated) {
    const attributionDate = document.getElementById('tile-attribution-date') as HTMLTimeElement | null
    if (attributionDate) {
      attributionDate.dateTime = updated
      attributionDate.textContent = updated
    }
  }

  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

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

  setNavigator((lon, lat, zoom) => {
    map.flyTo({ center: [lon, lat], zoom, essential: true })
  })

  map.on('load', () => {
    // Edit mode owns its cursor: a hand for panning, index finger over nodes.
    if (isEditMode()) return
    const interactiveLayers = [
      'route-hit', 'route',
      'boulder-label', 'boulder-point-label', 'boulder', 'boulder-point',
      'sector-label', ...AREA_LABEL_LAYERS
    ]
    for (const l of interactiveLayers) {
      map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''))
    }
  })

  map.on('click', (e) => {
    if (isEditMode()) return // The editor handles live geometry and local features.

    const openFeature = (feature: maplibregl.MapGeoJSONFeature, open: (id: number) => void) => {
      const id = Number(feature.properties?.osm_id)
      if (Number.isFinite(id)) open(id)
    }

    // Area names win over boulder names, which win over the problem dots. Order
    // is fixed because ranks occupy disjoint zoom bands.
    const areaHits = map.queryRenderedFeatures(e.point, { layers: AREA_LABEL_LAYERS })
    if (areaHits.length > 0) {
      openFeature(areaHits[0], id => void openArea(id))
      return
    }

    const sectorHits = map.queryRenderedFeatures(e.point, { layers: ['sector-label'] })
    if (sectorHits.length > 0) {
      openFeature(sectorHits[0], id => void openBoulder(id))
      return
    }

    const routeHits = map.queryRenderedFeatures(e.point, { layers: ['route-hit', 'route'] })
    if (routeHits.length > 0) {
      openFeature(routeHits[0], id => void openProblem(id))
      return
    }

    // A physical rock linked to a boulder opens that boulder's relationship view.
    // Orphan rocks are inert.
    const rockHits = map.queryRenderedFeatures(e.point, {
      layers: ['boulder', 'boulder-label', 'boulder-point', 'boulder-point-label']
    })
    if (rockHits.length > 0) {
      const sector = Number(rockHits[0].properties?.sector)
      if (Number.isFinite(sector) && sector >= 0) void openBoulder(sector)
      return
    }

    hideSidebar()
  })
}

void start()
