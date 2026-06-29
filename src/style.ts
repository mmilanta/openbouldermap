import type { StyleSpecification } from 'maplibre-gl'
import { PMTILES_URL } from './config'
import { gradeColorExpression, UNKNOWN_GRADE_COLOR } from './grades'

// All layers come from a single self-hosted PMTiles source whose source-layers
// are produced by scripts/schema.yml (planetiler):
//   landcover, water, waterway, transportation, buildings, contours, boulders, routes
const SRC = 'chironico'

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources: {
      [SRC]: { type: 'vector', url: PMTILES_URL, attribution: '' }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f5f3ee' } },

      // --- landcover (wood / grass / scrub / rock / wetland / meadow / farmland) ---
      // Schema emits raw `natural` and `landuse`; we map them to fills here so
      // that tile generation stays dumb and rendering is tweakable without a rebuild.
      {
        id: 'landcover',
        type: 'fill',
        source: SRC,
        'source-layer': 'landcover',
        paint: {
          'fill-color': [
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
          ],
          'fill-opacity': 0.9
        }
      },

      // --- water ---
      {
        id: 'water',
        type: 'fill',
        source: SRC,
        'source-layer': 'water',
        paint: { 'fill-color': '#bfe0f0' }
      },
      {
        id: 'waterway',
        type: 'line',
        source: SRC,
        'source-layer': 'waterway',
        paint: { 'line-color': '#bfe0f0', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 2.5] }
      },

      // --- buildings (faint) ---
      {
        id: 'buildings',
        type: 'fill',
        source: SRC,
        'source-layer': 'buildings',
        paint: { 'fill-color': '#e6e2da', 'fill-opacity': 0.6 }
      },

      // --- transportation: roads + hiking paths/tracks (schema emits `highway`) ---
      {
        id: 'road',
        type: 'line',
        source: SRC,
        'source-layer': 'transportation',
        filter: ['in', ['get', 'highway'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'living_street', 'service']]],
        paint: { 'line-color': '#cfcabd', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 16, 2] }
      },
      {
        id: 'path',
        type: 'line',
        source: SRC,
        'source-layer': 'transportation',
        filter: ['in', ['get', 'highway'], ['literal', ['path', 'footway', 'track', 'cycleway', 'steps', 'pedestrian']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#9a6b3f',
          'line-dasharray': [1, 0.4],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 1.2, 17, 2.4]
        }
      },

      // --- contours ---
      {
        id: 'contour',
        type: 'line',
        source: SRC,
        'source-layer': 'contours',
        paint: { 'line-color': '#b08a5a', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 0.9], 'line-opacity': 0.7 }
      },
      {
        id: 'contour-label',
        type: 'symbol',
        source: SRC,
        'source-layer': 'contours',
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'text-field': '{height} m',
          'text-size': 9,
          'text-font': ['Noto Sans Regular'],
          'text-max-angle': 30
        },
        paint: { 'text-color': '#7a5a36', 'text-halo-color': '#f5f3ee', 'text-halo-width': 1.5 }
      },

      // --- boulders: dark-gray filled polygons ---
      {
        id: 'boulder',
        type: 'fill',
        source: SRC,
        'source-layer': 'boulders',
        paint: { 'fill-color': '#4a4a4a', 'fill-opacity': 0.85, 'fill-outline-color': '#2b2b2b' }
      },
      {
        id: 'boulder-name',
        type: 'symbol',
        source: SRC,
        'source-layer': 'boulders',
        minzoom: 15,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-font': ['Noto Sans Italic'],
          'text-optional': true
        },
        paint: { 'text-color': '#222', 'text-halo-color': '#f5f3ee', 'text-halo-width': 1.5 }
      },

      // --- routes: grade-colored dots, clickable ---
      {
        id: 'route',
        type: 'circle',
        source: SRC,
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
        // enlarged, invisible hit area for easier clicking
        id: 'route-hit',
        type: 'circle',
        source: SRC,
        'source-layer': 'routes',
        minzoom: 12,
        paint: { 'circle-color': '#000', 'circle-opacity': 0, 'circle-radius': 12 }
      }
    ]
  }
}

export { UNKNOWN_GRADE_COLOR }
