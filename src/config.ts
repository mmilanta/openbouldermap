// Central config: tile source URLs, initial view, zoom range.

// Initial map view — world overview. Areas appear first, followed by sectors,
// then physical boulders and problems as the user zooms in.
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

// Aerial imagery is offered as an editing aid. It is intentionally not the
// default map: editors opt into it when tracing or checking rock geometry.
export const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// Deployment base path (Vite base). Kept in one place so the editor can build
// absolute URLs for its /edit view without hard-coding the repository path.
export const BASE_URL = import.meta.env.BASE_URL || '/'
export const EDIT_PATH = `${BASE_URL}edit`

// The climbing-only PMTiles archive is served as a static file.
export const CLIMBING_PMTILES_URL = `pmtiles://${location.origin}${BASE_URL}tiles/climbing.pmtiles`
export const CLIMBING_METADATA_URL = `${BASE_URL}tiles/climbing-metadata.json`
