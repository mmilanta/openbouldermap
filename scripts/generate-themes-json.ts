/**
 * Generates themes.json — one complete MapLibre style for the Default theme.
 * Run: npx tsx scripts/generate-themes-json.ts
 *
 * To preview in Maputnik, first serve tiles locally:
 *   npm run serve-tiles         # starts pmtiles server on :8081
 * Then in Maputnik, the source will already point to localhost:8081.
 */
import { writeFileSync } from 'fs'
import { GRADE_COLORS, UNKNOWN_GRADE_COLOR } from '../src/grades'

// Where pmtiles serve runs (matches the npm script)
const TILE_SERVER = 'http://localhost:8081'

function gradeMatchExpr(): any[] {
  const expr: any[] = ['match', ['upcase', ['get', 'climbing:grade:font']]]
  for (const [g, c] of Object.entries(GRADE_COLORS)) expr.push(g, c)
  expr.push(UNKNOWN_GRADE_COLOR)
  return expr
}

const SRC = 'switzerland'
const LANDCOVER_EXPR = [
  'case',
  ['in', ['get', 'natural'], ['literal', ['wood', 'forest']]], '#dfead8',
  ['in', ['get', 'landuse'], ['literal', ['forest']]], '#dfead8',
  ['==', ['get', 'natural'], 'scrub'], '#e6eedd',
  ['in', ['get', 'natural'], ['literal', ['grassland', 'meadow']]], '#eef3e6',
  ['in', ['get', 'landuse'], ['literal', ['meadow', 'grass', 'village_green', 'recreation_ground', 'cemetery']]], '#eef3e6',
  ['==', ['get', 'natural'], 'heath'], '#e7eede',
  ['==', ['get', 'natural'], 'wetland'], '#e3e9d5',
  ['in', ['get', 'natural'], ['literal', ['bare_rock', 'rock', 'stone']]], '#d9d6cf',
  ['in', ['get', 'natural'], ['literal', ['scree', 'fell', 'shingle', 'sand', 'beach']]], '#ddd9d2',
  ['in', ['get', 'landuse'], ['literal', ['farmland', 'orchard', 'vineyard', 'greenhouse_horticulture', 'allotments']]], '#efe9d8',
  '#eae7e0'
]

const style = {
  version: 8,
  name: 'OpenBoulderMap — Switzerland',
  // Standard XYZ tiles served by `pmtiles serve` — Maputnik understands this.
  sources: {
    switzerland: {
      type: 'vector',
      tiles: [`${TILE_SERVER}/{z}/{x}/{y}`],
      minzoom: 11,
      maxzoom: 16
    }
  },
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f5f3ee' } },

    {
      id: 'landcover', type: 'fill', source: SRC, 'source-layer': 'landcover',
      paint: { 'fill-color': LANDCOVER_EXPR, 'fill-opacity': 0.9 }
    },

    {
      id: 'water', type: 'fill', source: SRC, 'source-layer': 'water',
      paint: { 'fill-color': '#bfe0f0' }
    },
    {
      id: 'waterway', type: 'line', source: SRC, 'source-layer': 'waterway',
      paint: {
        'line-color': '#bfe0f0',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 2.5]
      }
    },

    {
      id: 'buildings', type: 'fill', source: SRC, 'source-layer': 'buildings',
      paint: { 'fill-color': '#e6e2da', 'fill-opacity': 0.6 }
    },

    {
      id: 'border', type: 'line', source: SRC, 'source-layer': 'boundaries',
      minzoom: 6,
      paint: {
        'line-color': '#9b8c7c',
        'line-dasharray': [4, 3],
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 10, 0.8, 14, 1.2]
      }
    },

    {
      id: 'highway-major', type: 'line', source: SRC, 'source-layer': 'transportation',
      minzoom: 7,
      filter: ['in', ['get', 'highway'], ['literal', ['motorway', 'trunk', 'primary']]],
      paint: {
        'line-color': '#cfcabd',
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 10, 2, 14, 3.5]
      }
    },
    {
      id: 'highway-secondary', type: 'line', source: SRC, 'source-layer': 'transportation',
      minzoom: 9,
      filter: ['in', ['get', 'highway'], ['literal', ['secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']]],
      paint: {
        'line-color': '#d4cec2',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 14, 2]
      }
    },
    {
      id: 'highway-local', type: 'line', source: SRC, 'source-layer': 'transportation',
      minzoom: 12,
      filter: ['in', ['get', 'highway'], ['literal', ['unclassified', 'residential', 'living_street', 'service']]],
      paint: {
        'line-color': '#d8d3c9',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 16, 1.5]
      }
    },
    {
      id: 'path', type: 'line', source: SRC, 'source-layer': 'transportation',
      minzoom: 13,
      filter: ['in', ['get', 'highway'], ['literal', [
        'path', 'footway', 'track', 'cycleway', 'steps', 'pedestrian'
      ]]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#9a6b3f',
        'line-dasharray': [1, 0.4],
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 15, 1.2, 17, 2.4]
      }
    },

    {
      id: 'place-country', type: 'symbol', source: SRC, 'source-layer': 'places',
      minzoom: 4, maxzoom: 24,
      filter: ['==', ['get', 'place'], 'country'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 12, 10, 20]
      },
      paint: {
        'text-color': '#333',
        'text-halo-color': '#f5f3ee',
        'text-halo-width': 2
      }
    },
    {
      id: 'place-canton', type: 'symbol', source: SRC, 'source-layer': 'places',
      minzoom: 6, maxzoom: 24,
      filter: ['==', ['get', 'place'], 'state'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 11, 15]
      },
      paint: {
        'text-color': '#444',
        'text-halo-color': '#f5f3ee',
        'text-halo-width': 1.5
      }
    },
    {
      id: 'place-city', type: 'symbol', source: SRC, 'source-layer': 'places',
      minzoom: 8, maxzoom: 24,
      filter: ['==', ['get', 'place'], 'city'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 12, 16]
      },
      paint: {
        'text-color': '#222',
        'text-halo-color': '#f5f3ee',
        'text-halo-width': 1.5
      }
    },
    {
      id: 'place-town', type: 'symbol', source: SRC, 'source-layer': 'places',
      minzoom: 10, maxzoom: 24,
      filter: ['==', ['get', 'place'], 'town'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 14]
      },
      paint: {
        'text-color': '#333',
        'text-halo-color': '#f5f3ee',
        'text-halo-width': 1.5
      }
    },
    {
      id: 'place-village', type: 'symbol', source: SRC, 'source-layer': 'places',
      minzoom: 12, maxzoom: 24,
      filter: ['==', ['get', 'place'], 'village'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 15, 13]
      },
      paint: {
        'text-color': '#444',
        'text-halo-color': '#f5f3ee',
        'text-halo-width': 1.5
      }
    },

    {
      id: 'boulder', type: 'fill', source: SRC, 'source-layer': 'boulders',
      paint: {
        'fill-color': '#4a4a4a',
        'fill-opacity': 0.85,
        'fill-outline-color': '#2b2b2b'
      }
    },

    {
      id: 'route', type: 'circle', source: SRC, 'source-layer': 'routes',
      minzoom: 12,
      paint: {
        'circle-color': gradeMatchExpr(),
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5.5, 17, 7],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.2,
        'circle-stroke-opacity': 0.9
      }
    },

    {
      id: 'route-hit', type: 'circle', source: SRC, 'source-layer': 'routes',
      minzoom: 12,
      paint: { 'circle-color': '#000', 'circle-opacity': 0, 'circle-radius': 12 }
    }
  ]
}

writeFileSync('themes.json', JSON.stringify(style, null, 2))
console.log('Wrote themes.json (Default only)')
