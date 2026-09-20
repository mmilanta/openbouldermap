// Central config: tile source URLs, initial view, zoom range.

// Initial map view — world overview. Areas appear first, followed by sectors,
// then physical boulders and problems as the user zooms in.
export const INITIAL_VIEW = {
  center: [8.22, 46.82] as [number, number],
  zoom: 3,
  minZoom: 1,
  maxZoom: 22
}

// Basemap: OpenFreeMap vector tiles (free, no API key, no usage limits). The
// TileJSON URL is used so MapLibre resolves the current versioned tile path.
// https://openfreemap.org/
export const BASEMAP_SOURCE_URL = 'https://tiles.openfreemap.org/planet'
export const BASEMAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

// Aerial imagery is offered as an editing aid. It is intentionally not the
// default map: editors opt into it when tracing or checking rock geometry.
export const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// Deployment base path (Vite base). Kept in one place so the editor can build
// absolute URLs for its /edit view without hard-coding the repository path.
// Guard `import.meta.env` so pure modules can also be imported outside Vite
// (e.g. in unit tests).
const viteEnv = (import.meta as any).env ?? {}
export const BASE_URL = viteEnv.BASE_URL || '/'
export const EDIT_PATH = `${BASE_URL}edit`

// The climbing-only PMTiles archive is served as a static file.
const origin = typeof location !== 'undefined' ? location.origin : ''
export const CLIMBING_PMTILES_URL = `pmtiles://${origin}${BASE_URL}tiles/climbing.pmtiles`
export const CLIMBING_METADATA_URL = `${BASE_URL}tiles/climbing-metadata.json`
// Static viewer search index, generated from the same PBF as the tiles. The
// viewer fetches it lazily on first search interaction.
export const CLIMBING_SEARCH_URL = `${BASE_URL}tiles/climbing-search.json`
