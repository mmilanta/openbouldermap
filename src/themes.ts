// Map themes: each theme overrides specific layer paint properties.
// Add new themes here to try them in the UI switcher.

export interface ThemeLayer {
  id: string
  paint: Record<string, any>
}

export interface Theme {
  name: string
  layers: ThemeLayer[]
}

/**
 * Apply a theme to the map. For each layer in the theme, we call map.setPaintProperty.
 * Layers not mentioned keep their current (default) paint.
 */
export function applyTheme(map: maplibregl.Map, theme: Theme): void {
  for (const layer of theme.layers) {
    if (!map.getLayer(layer.id)) continue
    for (const [prop, value] of Object.entries(layer.paint)) {
      map.setPaintProperty(layer.id, prop, value)
    }
  }
}

import type maplibregl from 'maplibre-gl'

// ─── Pre-defined themes ─────────────────────────────────────────────

export const THEMES: Theme[] = [
  // --- Default (current) ---
  {
    name: 'Default',
    layers: [
      { id: 'background', paint: { 'background-color': '#f5f3ee' } },
      { id: 'landcover', paint: { 'fill-color': ['case',
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
      ] } },
      { id: 'water', paint: { 'fill-color': '#bfe0f0' } },
      { id: 'waterway', paint: { 'line-color': '#bfe0f0' } },
      { id: 'border', paint: { 'line-color': '#9b8c7c' } },
      { id: 'buildings', paint: { 'fill-color': '#e6e2da', 'fill-opacity': 0.6 } },
      { id: 'highway-major', paint: { 'line-color': '#cfcabd' } },
      { id: 'highway-secondary', paint: { 'line-color': '#d4cec2' } },
      { id: 'highway-local', paint: { 'line-color': '#d8d3c9' } },
      { id: 'path', paint: { 'line-color': '#9a6b3f' } },
      { id: 'boulder', paint: { 'fill-color': '#4a4a4a', 'fill-opacity': 0.85, 'fill-outline-color': '#2b2b2b' } },
    ]
  },

  // --- Dark mode (night / climbing topo) ---
  {
    name: 'Dark',
    layers: [
      { id: 'background', paint: { 'background-color': '#1a1a2e' } },
      { id: 'landcover', paint: { 'fill-color': '#16213e', 'fill-opacity': 0.9 } },
      { id: 'water', paint: { 'fill-color': '#0f3460' } },
      { id: 'waterway', paint: { 'line-color': '#0f3460' } },
      { id: 'border', paint: { 'line-color': '#3a3a55' } },
      { id: 'buildings', paint: { 'fill-color': '#1f1f3a', 'fill-opacity': 0.5 } },
      { id: 'highway-major', paint: { 'line-color': '#2d2d44' } },
      { id: 'highway-secondary', paint: { 'line-color': '#353550' } },
      { id: 'highway-local', paint: { 'line-color': '#3a3a55' } },
      { id: 'path', paint: { 'line-color': '#8b8b6c' } },
      { id: 'boulder', paint: { 'fill-color': '#d4d4d4', 'fill-opacity': 0.85, 'fill-outline-color': '#999' } },
    ]
  },

  // --- Alpine / Swiss-topo inspired ---
  {
    name: 'Alpine',
    layers: [
      { id: 'background', paint: { 'background-color': '#f9f6f0' } },
      { id: 'landcover', paint: { 'fill-color': ['case',
        ['in', ['get', 'natural'], ['literal', ['wood', 'forest']]], '#c8d8b8',
        ['in', ['get', 'landuse'], ['literal', ['forest']]], '#c8d8b8',
        ['==', ['get', 'natural'], 'scrub'], '#d4dfc0',
        ['in', ['get', 'natural'], ['literal', ['grassland', 'meadow']]], '#faf7ec',
        ['in', ['get', 'landuse'], ['literal', ['meadow', 'grass', 'village_green', 'recreation_ground', 'cemetery']]], '#faf7ec',
        ['==', ['get', 'natural'], 'heath'], '#d4dfc0',
        ['==', ['get', 'natural'], 'wetland'], '#d9e4cc',
        ['in', ['get', 'natural'], ['literal', ['bare_rock', 'rock', 'stone']]], '#e8e2d4',
        ['in', ['get', 'natural'], ['literal', ['scree', 'fell', 'shingle', 'sand', 'beach']]], '#ede8db',
        ['in', ['get', 'landuse'], ['literal', ['farmland', 'orchard', 'vineyard', 'greenhouse_horticulture', 'allotments']]], '#f4ecd8',
        '#f2ede2'
      ] } },
      { id: 'water', paint: { 'fill-color': '#b3d9ff' } },
      { id: 'waterway', paint: { 'line-color': '#b3d9ff' } },
      { id: 'border', paint: { 'line-color': '#b0a090' } },
      { id: 'buildings', paint: { 'fill-color': '#d4c9b2', 'fill-opacity': 0.5 } },
      { id: 'highway-major', paint: { 'line-color': '#d4c8b2' } },
      { id: 'highway-secondary', paint: { 'line-color': '#dad0bb' } },
      { id: 'highway-local', paint: { 'line-color': '#ded5c2' } },
      { id: 'path', paint: { 'line-color': '#8c5a35' } },
      { id: 'boulder', paint: { 'fill-color': '#5c5c5c', 'fill-opacity': 0.85, 'fill-outline-color': '#3a3a3a' } },
    ]
  },

  // --- Outdoorsy / AllTrails-like ---
  {
    name: 'Outdoors',
    layers: [
      { id: 'background', paint: { 'background-color': '#fbf9f2' } },
      { id: 'landcover', paint: { 'fill-color': ['case',
        ['in', ['get', 'natural'], ['literal', ['wood', 'forest']]], '#d0e0c8',
        ['in', ['get', 'landuse'], ['literal', ['forest']]], '#d0e0c8',
        ['==', ['get', 'natural'], 'scrub'], '#dae4cc',
        ['in', ['get', 'natural'], ['literal', ['grassland', 'meadow']]], '#f7f5e6',
        ['in', ['get', 'landuse'], ['literal', ['meadow', 'grass', 'village_green', 'recreation_ground', 'cemetery']]], '#f7f5e6',
        ['==', ['get', 'natural'], 'heath'], '#dae4cc',
        ['==', ['get', 'natural'], 'wetland'], '#e0e6d8',
        ['in', ['get', 'natural'], ['literal', ['bare_rock', 'rock', 'stone']]], '#e8e2d5',
        ['in', ['get', 'natural'], ['literal', ['scree', 'fell', 'shingle', 'sand', 'beach']]], '#ebe6da',
        ['in', ['get', 'landuse'], ['literal', ['farmland', 'orchard', 'vineyard', 'greenhouse_horticulture', 'allotments']]], '#f2ead5',
        '#f0ece2'
      ] } },
      { id: 'water', paint: { 'fill-color': '#a1cef5' } },
      { id: 'waterway', paint: { 'line-color': '#a1cef5' } },
      { id: 'border', paint: { 'line-color': '#b0a590' } },
      { id: 'buildings', paint: { 'fill-color': '#e0dcd2', 'fill-opacity': 0.45 } },
      { id: 'highway-major', paint: { 'line-color': '#c8bfae' } },
      { id: 'highway-secondary', paint: { 'line-color': '#cfc6b5' } },
      { id: 'highway-local', paint: { 'line-color': '#d4ccbc' } },
      { id: 'path', paint: { 'line-color': '#b57a3a', 'line-dasharray': [1, 0.5] } },
      { id: 'boulder', paint: { 'fill-color': '#333333', 'fill-opacity': 0.9, 'fill-outline-color': '#1a1a1a' } },
    ]
  },

  // --- Minimal / grayscale ---
  {
    name: 'Minimal',
    layers: [
      { id: 'background', paint: { 'background-color': '#fafaf9' } },
      { id: 'landcover', paint: { 'fill-color': '#f0efed', 'fill-opacity': 0.6 } },
      { id: 'water', paint: { 'fill-color': '#e0e4ea' } },
      { id: 'waterway', paint: { 'line-color': '#e0e4ea' } },
      { id: 'border', paint: { 'line-color': '#c0bdb8' } },
      { id: 'buildings', paint: { 'fill-color': '#e8e6e2', 'fill-opacity': 0.35 } },
      { id: 'highway-major', paint: { 'line-color': '#d4d2ce' } },
      { id: 'highway-secondary', paint: { 'line-color': '#dbd9d5' } },
      { id: 'highway-local', paint: { 'line-color': '#e0deda' } },
      { id: 'path', paint: { 'line-color': '#b0ada8' } },
      { id: 'boulder', paint: { 'fill-color': '#2e2e2e', 'fill-opacity': 0.9, 'fill-outline-color': '#111' } },
    ]
  },

  // --- Vibrant / playful ---
  {
    name: 'Vibrant',
    layers: [
      { id: 'background', paint: { 'background-color': '#fefffa' } },
      { id: 'landcover', paint: { 'fill-color': ['case',
        ['in', ['get', 'natural'], ['literal', ['wood', 'forest']]], '#b8d9a2',
        ['in', ['get', 'landuse'], ['literal', ['forest']]], '#b8d9a2',
        ['==', ['get', 'natural'], 'scrub'], '#c4dca5',
        ['in', ['get', 'natural'], ['literal', ['grassland', 'meadow']]], '#f5fbe0',
        ['in', ['get', 'landuse'], ['literal', ['meadow', 'grass', 'village_green', 'recreation_ground', 'cemetery']]], '#f5fbe0',
        ['==', ['get', 'natural'], 'heath'], '#c8dcaa',
        ['==', ['get', 'natural'], 'wetland'], '#d0e0b8',
        ['in', ['get', 'natural'], ['literal', ['bare_rock', 'rock', 'stone']]], '#e3ddd0',
        ['in', ['get', 'natural'], ['literal', ['scree', 'fell', 'shingle', 'sand', 'beach']]], '#e8e2d5',
        ['in', ['get', 'landuse'], ['literal', ['farmland', 'orchard', 'vineyard', 'greenhouse_horticulture', 'allotments']]], '#f3edda',
        '#eee9df'
      ] } },
      { id: 'water', paint: { 'fill-color': '#89cff0' } },
      { id: 'waterway', paint: { 'line-color': '#89cff0' } },
      { id: 'border', paint: { 'line-color': '#a89880' } },
      { id: 'buildings', paint: { 'fill-color': '#e2dcd0', 'fill-opacity': 0.5 } },
      { id: 'highway-major', paint: { 'line-color': '#c2b8a8' } },
      { id: 'highway-secondary', paint: { 'line-color': '#c9bfb0' } },
      { id: 'highway-local', paint: { 'line-color': '#cec5b7' } },
      { id: 'path', paint: { 'line-color': '#cc7733' } },
      { id: 'boulder', paint: { 'fill-color': '#2c2c2c', 'fill-opacity': 0.92, 'fill-outline-color': '#000' } },
    ]
  },
]

export const DEFAULT_THEME_NAME = 'Default'
