import type { StyleSpecification } from 'maplibre-gl'
import { CLIMBING_PMTILES_URL, SATELLITE_TILES } from './config'
import libertyStyle from './basemaps/liberty.json'
import { routeGradeColorExpression, UNKNOWN_GRADE_COLOR } from './grades'

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

// Official OpenFreeMap Liberty style, bundled from
// https://tiles.openfreemap.org/styles/liberty (see basemaps/LICENSE.md).
const BASEMAP_STYLE = libertyStyle as unknown as StyleSpecification

export function buildStyle(maxRank = 1): StyleSpecification {
  return {
    ...BASEMAP_STYLE,
    sources: {
      ...BASEMAP_STYLE.sources,
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
      // Prefix every Liberty layer so the background selector toggles the
      // complete style, including labels and Natural Earth shading.
      ...BASEMAP_STYLE.layers.map(layer => ({ ...layer, id: `basemap-${layer.id}` })),
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
