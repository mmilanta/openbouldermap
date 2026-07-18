// Central config: tile source URLs, initial view, zoom range.

// Initial map view — world overview.
// The user zooms into an area to see boulders/routes appear (z12+).
export const INITIAL_VIEW = {
  center: [8.22, 46.82] as [number, number],
  zoom: 3,
  minZoom: 1,
  maxZoom: 20
}

// Basemap tiles. Currently using OpenStreetMap raster tiles (free, no API key).
// For vector basemap when OpenFreeMap is back:
//   https://tiles.openfreemap.org/planet/{z}/{x}/{y}.mvt
// Or for a richer outdoor vector basemap (free tier, needs signup):
//   https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=YOUR_KEY
export const BASEMAP_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

// The climbing-only PMTiles archive is served as a static file.
const base = import.meta.env.BASE_URL || '/'
export const CLIMBING_PMTILES_URL = `pmtiles://${location.origin}${base}tiles/climbing.pmtiles`
