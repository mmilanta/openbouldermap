import type { Map as LibreMap } from 'maplibre-gl'

// Keep the existing editor key so saved background choices carry over.
const BACKGROUND_KEY = 'openbouldermap.editor.background'
type Background = 'map' | 'satellite'

export function initBackgroundControl(map: LibreMap): void {
  const label = document.createElement('label')
  label.className = 'map-background'
  const select = document.createElement('select')
  select.className = 'map-background-select'
  select.setAttribute('aria-label', 'Map background')
  for (const [value, text] of [['map', 'Street map'], ['satellite', 'Satellite imagery']] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    select.append(option)
  }
  try {
    select.value = localStorage.getItem(BACKGROUND_KEY) === 'satellite' ? 'satellite' : 'map'
  } catch { select.value = 'map' }

  const applyBackground = () => {
    const background = select.value as Background
    const attribution = document.getElementById('satellite-attribution')
    if (attribution) attribution.hidden = background !== 'satellite'
    // Only toggle background layers; climbing features and local edits stay visible.
    for (const layer of map.getStyle()?.layers ?? []) {
      if (layer.id.startsWith('basemap-')) {
        map.setLayoutProperty(layer.id, 'visibility', background === 'map' ? 'visible' : 'none')
      }
    }
    if (map.getLayer('satellite-raster')) {
      map.setLayoutProperty('satellite-raster', 'visibility', background === 'satellite' ? 'visible' : 'none')
    }
  }
  select.addEventListener('change', () => {
    applyBackground()
    try { localStorage.setItem(BACKGROUND_KEY, select.value) } catch { /* Selection works without storage. */ }
  })
  label.append(select)
  document.getElementById('app')!.append(label)
  map.on('style.load', applyBackground)
  applyBackground()
}
