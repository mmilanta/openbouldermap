// Map themes: each theme overrides paint properties on themable layers.
// With a raster basemap, only the climbing-related layers are themable.

import type maplibregl from 'maplibre-gl'

export interface ThemeLayer {
  id: string
  paint: Record<string, any>
}

export interface Theme {
  name: string
  layers: ThemeLayer[]
}

export function applyTheme(map: maplibregl.Map, theme: Theme): void {
  for (const layer of theme.layers) {
    if (!map.getLayer(layer.id)) continue
    for (const [prop, value] of Object.entries(layer.paint)) {
      map.setPaintProperty(layer.id, prop, value)
    }
  }
}

export const THEMES: Theme[] = [
  {
    name: 'Default',
    layers: [
      { id: 'sector', paint: { 'fill-color': '#a0c8e0', 'fill-opacity': 0.15, 'fill-outline-color': '#4a90b8' } },
      { id: 'boulder', paint: { 'fill-color': '#4a4a4a', 'fill-opacity': 0.85, 'fill-outline-color': '#2b2b2b' } },
      { id: 'boulder-point', paint: { 'circle-color': '#555555' } }
    ]
  },
  {
    name: 'Dark',
    layers: [
      { id: 'sector', paint: { 'fill-color': '#5a7a9a', 'fill-opacity': 0.2, 'fill-outline-color': '#7ab0d8' } },
      { id: 'boulder', paint: { 'fill-color': '#d4d4d4', 'fill-opacity': 0.85, 'fill-outline-color': '#999' } },
      { id: 'boulder-point', paint: { 'circle-color': '#cccccc' } }
    ]
  },
  {
    name: 'Alpine',
    layers: [
      { id: 'sector', paint: { 'fill-color': '#b8d8e8', 'fill-opacity': 0.18, 'fill-outline-color': '#5a9ab8' } },
      { id: 'boulder', paint: { 'fill-color': '#5c5c5c', 'fill-opacity': 0.85, 'fill-outline-color': '#3a3a3a' } },
      { id: 'boulder-point', paint: { 'circle-color': '#666666' } }
    ]
  },
  {
    name: 'Outdoors',
    layers: [
      { id: 'sector', paint: { 'fill-color': '#a8d0a0', 'fill-opacity': 0.15, 'fill-outline-color': '#5a9a4a' } },
      { id: 'boulder', paint: { 'fill-color': '#333333', 'fill-opacity': 0.9, 'fill-outline-color': '#1a1a1a' } },
      { id: 'boulder-point', paint: { 'circle-color': '#444444' } }
    ]
  },
  {
    name: 'Minimal',
    layers: [
      { id: 'sector', paint: { 'fill-color': '#cccccc', 'fill-opacity': 0.1, 'fill-outline-color': '#999999' } },
      { id: 'boulder', paint: { 'fill-color': '#2e2e2e', 'fill-opacity': 0.9, 'fill-outline-color': '#111' } },
      { id: 'boulder-point', paint: { 'circle-color': '#333333' } }
    ]
  },
  {
    name: 'Vibrant',
    layers: [
      { id: 'sector', paint: { 'fill-color': '#90c8f0', 'fill-opacity': 0.2, 'fill-outline-color': '#3070c0' } },
      { id: 'boulder', paint: { 'fill-color': '#2c2c2c', 'fill-opacity': 0.92, 'fill-outline-color': '#000' } },
      { id: 'boulder-point', paint: { 'circle-color': '#333333' } }
    ]
  }
]

export const DEFAULT_THEME_NAME = 'Default'
