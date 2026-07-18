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

      // ─── sectors: bouldering areas (climbing:boulder=yes) ──────────
      {
        id: 'sector',
        type: 'fill',
        source: CLIMBING,
        'source-layer': 'sectors',
        minzoom: 12,
        paint: {
          'fill-color': '#a0c8e0',
          'fill-opacity': 0.15,
          'fill-outline-color': '#4a90b8'
        }
      },
      {
        id: 'sector-label',
        type: 'symbol',
        source: CLIMBING,
        'source-layer': 'sectors',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-anchor': 'center'
        },
        paint: {
          'text-color': '#2a6090',
          'text-halo-color': 'rgba(255,255,255,0.8)',
          'text-halo-width': 1.5
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
      {
        id: 'boulder-label',
        type: 'symbol',
        source: CLIMBING,
        'source-layer': 'boulders',
        minzoom: 15,
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

      // ─── boulder points: named boulder markers ─────────────────────
      {
        id: 'boulder-point',
        type: 'circle',
        source: CLIMBING,
        'source-layer': 'boulder_points',
        minzoom: 14,
        paint: {
          'circle-color': '#555555',
          'circle-radius': 4,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1
        }
      },
      {
        id: 'boulder-point-label',
        type: 'symbol',
        source: CLIMBING,
        'source-layer': 'boulder_points',
        minzoom: 15,
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

      // ─── routes: grade-colored dots ────────────────────────────────
      {
        id: 'route',
        type: 'circle',
        source: CLIMBING,
        'source-layer': 'routes',
        minzoom: 12,
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
        minzoom: 12,
        paint: { 'circle-color': '#000', 'circle-opacity': 0, 'circle-radius': 12 }
      }
    ]
  }
}

export { UNKNOWN_GRADE_COLOR }
