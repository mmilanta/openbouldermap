// Central config: area of interest, tile archive URL, zoom range.

// Switzerland bounding box (slightly padded). Used for tile generation (scripts/)
// and the initial map view here.
export const AOI = {
  minLon: 5.95,
  minLat: 45.82,
  maxLon: 10.49,
  maxLat: 47.81
}

export const INITIAL_VIEW = {
  center: [8.22, 46.82] as [number, number],
  zoom: 8,
  minZoom: 6,
  maxZoom: 20
}

// The PMTiles archive is served as a static file.
const base = import.meta.env.BASE_URL || '/'
export const PMTILES_URL = `pmtiles://${location.origin}${base}tiles/switzerland.pmtiles`
