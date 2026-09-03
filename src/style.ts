import type { StyleSpecification } from 'maplibre-gl'
import { BASEMAP_TILES, CLIMBING_PMTILES_URL } from './config'
import { gradeColorExpression, UNKNOWN_GRADE_COLOR } from './grades'

const BASEMAP = 'basemap'
const CLIMBING = 'climbing'

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      [BASEMAP]: {
        type: 'raster',
        tiles: [BASEMAP_TILES],
        tileSize: 256,
        attribution:
          '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a> contributors',
        minzoom: 0,
        maxzoom: 19
      },
      [CLIMBING]: {
        type: 'vector',
        url: CLIMBING_PMTILES_URL
      }
    },
    layers: [
      // ─── basemap (raster) ──────────────────────────────────────────
      { id: 'basemap-raster', type: 'raster', source: BASEMAP, minzoom: 0, maxzoom: 22 },

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
        minzoom: 13,
        paint: { 'fill-color': '#4a4a4a', 'fill-opacity': 0.85, 'fill-outline-color': '#2b2b2b' }
      },
      // ─── boulder points: named boulder markers ─────────────────────
      {
        id: 'boulder-point',
        type: 'circle',
        source: CLIMBING,
        'source-layer': 'boulder_points',
        minzoom: 13,
        paint: {
          'circle-color': '#555555',
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
          'circle-color': gradeColorExpression('climbing:grade:font') as any,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5.5, 17, 7],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.2,
          'circle-stroke-opacity': 0.9
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
      {
        id: 'boulder-label',
        type: 'symbol',
        source: CLIMBING,
        'source-layer': 'boulders',
        minzoom: 16,
        maxzoom: 19,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-anchor': 'center'
        },
        paint: {
          'text-color': '#1a1a1a',
          'text-halo-color': 'rgba(255,255,255,0.8)',
          'text-halo-width': 1.5
        }
      },
      {
        id: 'boulder-point-label',
        type: 'symbol',
        source: CLIMBING,
        'source-layer': 'boulder_points',
        minzoom: 16,
        maxzoom: 19,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 9,
          'text-anchor': 'left',
          'text-offset': [0.6, 0]
        },
        paint: {
          'text-color': '#333333',
          'text-halo-color': 'rgba(255,255,255,0.8)',
          'text-halo-width': 1.5
        }
      },

      // Labels are last so hierarchy names remain readable over markers.
      {
        id: 'area-label',
        type: 'symbol',
        source: CLIMBING,
        'source-layer': 'areas',
        minzoom: 2,
        maxzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 8, 14],
          'text-anchor': 'center'
        },
        paint: {
          'text-color': '#285b33',
          'text-halo-color': 'rgba(255,255,255,0.9)',
          'text-halo-width': 2
        }
      },
      {
        id: 'sector-label',
        type: 'symbol',
        source: CLIMBING,
        'source-layer': 'sectors',
        minzoom: 13,
        maxzoom: 16,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-anchor': 'center'
        },
        paint: {
          'text-color': '#2a6090',
          'text-halo-color': 'rgba(255,255,255,0.9)',
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
