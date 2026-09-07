// Map-side route selection highlight.
//
// The selected route keeps its grade colour but gets a thicker, darker border.
// Selection is driven through MapLibre feature state so the paint properties
// live in style.ts and the highlight moves/clears with the feature itself.

import type maplibregl from 'maplibre-gl'

let map: maplibregl.Map | undefined
let selectedRouteId: number | undefined

export function setSelectionMap(instance: maplibregl.Map): void {
  map = instance
}

export function selectRoute(osmId: number | undefined): void {
  if (!map || !map.isStyleLoaded()) return

  if (selectedRouteId !== undefined) {
    map.removeFeatureState({ source: 'climbing', sourceLayer: 'routes', id: selectedRouteId })
  }

  selectedRouteId = osmId !== undefined && Number.isFinite(osmId) ? osmId : undefined

  if (selectedRouteId !== undefined) {
    map.setFeatureState(
      { source: 'climbing', sourceLayer: 'routes', id: selectedRouteId },
      { selected: true }
    )
  }
}
