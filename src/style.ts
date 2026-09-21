import type { StyleSpecification } from 'maplibre-gl'
import { BASEMAP_GLYPHS, BASEMAP_SOURCE_URL, CLIMBING_PMTILES_URL, SATELLITE_TILES } from './config'
import { routeGradeColorExpression, UNKNOWN_GRADE_COLOR } from './grades'

const BASEMAP = 'basemap'
const SATELLITE = 'satellite'
const CLIMBING = 'climbing'

// Areas appear as floating names only, one rank per zoom band, so labels of
// different levels are never visible at the same zoom. Rank is baked into the
// tiles by scripts/build-hierarchy.py; rank 6+ is a build-time error there.
const AREA_BAND_COUNT = 6

export const AREA_LABEL_LAYERS: string[] = Array.from(
  { length: AREA_BAND_COUNT },
  (_, band) => `area-label-${band}`
)

// Band 0 is the deepest area level present; higher bands are its ancestors. The
// root level (band === maxRank) has no ancestor to hand over to, so it stays
// visible all the way down to z7 instead of only its two-zoom slot.
function areaLabelLayers(maxRank: number): any[] {
  return Array.from({ length: AREA_BAND_COUNT }, (_, band) => {
    const naturalMin = 15 - 2 * band
    const maxzoom = 17 - 2 * band
    const minzoom = band === maxRank ? Math.min(7, naturalMin) : naturalMin
    return {
      id: `area-label-${band}`,
      type: 'symbol',
      source: CLIMBING,
      'source-layer': 'areas',
      minzoom,
      maxzoom,
      filter: ['==', ['get', 'band'], band],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 12, 15, 18],
        'text-anchor': 'center'
      },
      paint: {
        'text-color': '#285b33',
        'text-halo-color': 'rgba(255,255,255,0.9)',
        'text-halo-width': 2
      }
    }
  })
}

// OpenFreeMap basemap, styled lightly so the climbing overlay stands out. Every
// id starts with `basemap-` so the editor can toggle the whole group against the
// satellite raster. Layers follow the OpenMapTiles vector schema.
const BASEMAP_LAYERS: any[] = [
  { id: 'basemap-background', type: 'background', paint: { 'background-color': '#f5f2ec' } },
  { id: 'basemap-landcover-wood', type: 'fill', source: BASEMAP, 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': '#cfe0c2', 'fill-opacity': 0.7 } },
  { id: 'basemap-landcover-grass', type: 'fill', source: BASEMAP, 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'grass'], paint: { 'fill-color': '#dcebcd', 'fill-opacity': 0.6 } },
  { id: 'basemap-landcover-farmland', type: 'fill', source: BASEMAP, 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'farmland'], paint: { 'fill-color': '#eef0d5', 'fill-opacity': 0.6 } },
  { id: 'basemap-landcover-sand', type: 'fill', source: BASEMAP, 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'sand'], paint: { 'fill-color': '#f2eccb', 'fill-opacity': 0.6 } },
  { id: 'basemap-landcover-rock', type: 'fill', source: BASEMAP, 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'rock'], paint: { 'fill-color': '#e7e2da', 'fill-opacity': 0.6 } },
  { id: 'basemap-landcover-ice', type: 'fill', source: BASEMAP, 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'ice'], paint: { 'fill-color': '#eef5f9', 'fill-opacity': 0.85 } },
  { id: 'basemap-park', type: 'fill', source: BASEMAP, 'source-layer': 'park', paint: { 'fill-color': '#d5e7c4', 'fill-opacity': 0.45 } },
  { id: 'basemap-water', type: 'fill', source: BASEMAP, 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'fill-color': '#b7d3e6' } },
  { id: 'basemap-waterway', type: 'line', source: BASEMAP, 'source-layer': 'waterway', minzoom: 8, paint: { 'line-color': '#b7d3e6', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 16, 3] } },
  { id: 'basemap-boundary', type: 'line', source: BASEMAP, 'source-layer': 'boundary', minzoom: 1, filter: ['<=', ['get', 'admin_level'], 4], paint: { 'line-color': '#a9a29a', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 10, 1.5], 'line-dasharray': [3, 2] } },
  { id: 'basemap-road-casing', type: 'line', source: BASEMAP, 'source-layer': 'transportation', minzoom: 12, filter: ['all', ['match', ['get', 'brunnel'], ['bridge', 'tunnel'], false, true], ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'], true, false]], paint: { 'line-color': '#d8d3cb', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 7, 19, 14] } },
  { id: 'basemap-road', type: 'line', source: BASEMAP, 'source-layer': 'transportation', minzoom: 5, filter: ['all', ['match', ['get', 'brunnel'], ['bridge', 'tunnel'], false, true], ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false]], paint: { 'line-color': ['match', ['get', 'class'], 'motorway', '#f3b562', 'trunk', '#f3b562', 'primary', '#f6cc85', 'secondary', '#ffffff', 'tertiary', '#ffffff', 'minor', '#ffffff', 'service', '#f0ede8', '#ffffff'], 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 10, 1.2, 14, 3, 18, 8] } },
  { id: 'basemap-path', type: 'line', source: BASEMAP, 'source-layer': 'transportation', minzoom: 12, filter: ['match', ['get', 'class'], ['path', 'track', 'pedestrian'], true, false], paint: { 'line-color': '#b48a5a', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 2, 19, 4], 'line-dasharray': [2, 1.5] } },
  { id: 'basemap-rail', type: 'line', source: BASEMAP, 'source-layer': 'transportation', minzoom: 8, filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': '#c7c2bb', 'line-width': 1, 'line-dasharray': [3, 2] } },
  { id: 'basemap-building', type: 'fill', source: BASEMAP, 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': '#e5e0d8', 'fill-opacity': 0.7 } },
  { id: 'basemap-label-country', type: 'symbol', source: BASEMAP, 'source-layer': 'place', minzoom: 2, filter: ['==', ['get', 'class'], 'country'], layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 15], 'text-transform': 'uppercase', 'text-letter-spacing': 0.1 }, paint: { 'text-color': '#6b6b6b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } },
  { id: 'basemap-label-state', type: 'symbol', source: BASEMAP, 'source-layer': 'place', minzoom: 4, filter: ['==', ['get', 'class'], 'state'], layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 13] }, paint: { 'text-color': '#6b6b6b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } },
  { id: 'basemap-label-city', type: 'symbol', source: BASEMAP, 'source-layer': 'place', minzoom: 3, filter: ['match', ['get', 'class'], ['city', 'town'], true, false], layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 8, 14, 12, 18] }, paint: { 'text-color': '#333333', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } },
  { id: 'basemap-label-village', type: 'symbol', source: BASEMAP, 'source-layer': 'place', minzoom: 8, filter: ['==', ['get', 'class'], 'village'], layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 12, 14] }, paint: { 'text-color': '#444444', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } },
  { id: 'basemap-water-name', type: 'symbol', source: BASEMAP, 'source-layer': 'water_name', minzoom: 8, layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 14] }, paint: { 'text-color': '#5b7c95', 'text-halo-color': '#eaf2f8', 'text-halo-width': 1 } },
  { id: 'basemap-peak', type: 'symbol', source: BASEMAP, 'source-layer': 'mountain_peak', minzoom: 9, layout: { 'text-field': ['concat', ['coalesce', ['get', 'name'], ''], ['case', ['has', 'ele'], ['concat', '\n', ['to-string', ['get', 'ele']], ' m'], '']], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 13], 'text-anchor': 'top', 'text-offset': [0, 0.4], 'text-max-width': 9 }, paint: { 'text-color': '#6b5b4b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } }
]

export function buildStyle(maxRank = 1): StyleSpecification {
  return {
    version: 8,
    glyphs: BASEMAP_GLYPHS,
    sources: {
      [BASEMAP]: {
        type: 'vector',
        url: BASEMAP_SOURCE_URL,
        attribution:
          '<a href="https://openfreemap.org/" target="_blank">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a> contributors'
      },
      [SATELLITE]: {
        type: 'raster',
        tiles: [SATELLITE_TILES],
        tileSize: 256,
        attribution:
          'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        minzoom: 0,
        maxzoom: 19
      },
      [CLIMBING]: {
        type: 'vector',
        url: CLIMBING_PMTILES_URL,
        promoteId: { routes: 'osm_id' }
      }
    },
    layers: [
      // ─── basemap (OpenFreeMap vector) ────────────────────
      ...BASEMAP_LAYERS,
      {
        id: 'satellite-raster',
        type: 'raster',
        source: SATELLITE,
        minzoom: 0,
        maxzoom: 22,
        layout: { visibility: 'none' }
      },

      // ─── areas: broad destinations visible at country/region zoom ─
      {
        id: 'area',
        type: 'fill',
        source: CLIMBING,
        'source-layer': 'areas',
        minzoom: 2,
        maxzoom: 13,
        paint: {
          'fill-color': '#5b8f65',
          'fill-opacity': 0.16,
          'fill-outline-color': '#386b43'
        }
      },

      // ─── sectors: immediate parents of boulder problems ───────────
      {
        id: 'sector',
        type: 'fill',
        source: CLIMBING,
        'source-layer': 'sectors',
        minzoom: 13,
        maxzoom: 16,
        paint: {
          'fill-color': '#a0c8e0',
          'fill-opacity': 0.15,
          'fill-outline-color': '#4a90b8'
        }
      },
      // ─── boulder polygons: climbing=boulder + natural=bare_rock ────
      {
        id: 'boulder',
        type: 'fill',
        source: CLIMBING,
        'source-layer': 'boulders',
        minzoom: 12,
        paint: {
          // Rocks without a boulder relation are dimmed and not clickable.
          'fill-color': ['case', ['==', ['get', 'sector'], -1], '#9aa5ae', '#4a4a4a'],
          'fill-opacity': ['case', ['==', ['get', 'sector'], -1], 0.3, 0.85],
          'fill-outline-color': ['case', ['==', ['get', 'sector'], -1], '#b6bfc7', '#2b2b2b']
        }
      },
      // ─── boulder points: named boulder markers ─────────────────────
      {
        id: 'boulder-point',
        type: 'circle',
        source: CLIMBING,
        'source-layer': 'boulder_points',
        minzoom: 12,
        paint: {
          'circle-color': ['case', ['==', ['get', 'sector'], -1], '#aab4bc', '#555555'],
          'circle-radius': 4,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1
        }
      },
      // ─── routes: grade-colored dots ────────────────────────────────
      {
        id: 'route',
        type: 'circle',
        source: CLIMBING,
        'source-layer': 'routes',
        minzoom: 13,
        paint: {
          'circle-color': routeGradeColorExpression() as any,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5.5, 17, 7],
          'circle-stroke-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            '#111111',
            '#ffffff'
          ],
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            3.5,
            1.2
          ],
          'circle-stroke-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            1,
            0.9
          ]
        }
      },
      {
        id: 'route-hit',
        type: 'circle',
        source: CLIMBING,
        'source-layer': 'routes',
        minzoom: 13,
        paint: { 'circle-color': '#000', 'circle-opacity': 0, 'circle-radius': 12 }
      },

      // Boulder names are deliberately above route dots. A physical boulder's
      // label must remain readable even when several problems surround it.
      // Hierarchy labels are last so names stay readable over markers. Each
      // rank owns an exclusive zoom band; boulders get the band after rank 5.
      ...areaLabelLayers(maxRank),
      {
        id: 'sector-label',
        type: 'symbol',
        source: CLIMBING,
        'source-layer': 'sectors',
        minzoom: 17,
        maxzoom: 19,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 16,
          'text-anchor': 'center'
        },
        paint: {
          'text-color': '#2a6090',
          'text-halo-color': 'rgba(255,255,255,0.9)',
          'text-halo-width': 1.5
        }
      },
      // A rock linked to a boulder takes the boulder's name, so only orphan
      // rocks carry their own label (drawn in front, dimmed to match the fill).
      {
        id: 'boulder-label',
        type: 'symbol',
        source: CLIMBING,
        'source-layer': 'boulders',
        minzoom: 17,
        maxzoom: 19,
        filter: ['==', ['get', 'sector'], -1],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-anchor': 'center'
        },
        paint: {
          'text-color': '#6b7580',
          'text-halo-color': 'rgba(255,255,255,0.85)',
          'text-halo-width': 1.5
        }
      },
      {
        id: 'boulder-point-label',
        type: 'symbol',
        source: CLIMBING,
        'source-layer': 'boulder_points',
        minzoom: 17,
        maxzoom: 19,
        filter: ['==', ['get', 'sector'], -1],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 9,
          'text-anchor': 'left',
          'text-offset': [0.6, 0]
        },
        paint: {
          'text-color': '#6b7580',
          'text-halo-color': 'rgba(255,255,255,0.85)',
          'text-halo-width': 1.5
        }
      },
      {
        id: 'route-label',
        type: 'symbol',
        source: CLIMBING,
        'source-layer': 'routes',
        minzoom: 19,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.8,
          'text-justify': 'auto'
        },
        paint: {
          'text-color': '#202020',
          'text-halo-color': 'rgba(255,255,255,0.9)',
          'text-halo-width': 1.5
        }
      }
    ]
  }
}

export { UNKNOWN_GRADE_COLOR }
