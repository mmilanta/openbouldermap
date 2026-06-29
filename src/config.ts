// Central config: area of interest, tile archive URL, zoom range.

// Chironico, Ticino, Switzerland. Used both for tile generation (scripts/) and
// for the initial map view here.
// Chironico, Ticino, Switzerland. Climbing features sit at lon ~8.84,
// lat ~46.42 (the bouldering valley east of the village). Used both for tile
// generation (scripts/) and for the initial map view here.
export const AOI = {
  minLon: 8.820,
  minLat: 46.405,
  maxLon: 8.875,
  maxLat: 46.445
}

export const INITIAL_VIEW = {
  center: [(AOI.minLon + AOI.maxLon) / 2, (AOI.minLat + AOI.maxLat) / 2] as [number, number],
  zoom: 15,
  minZoom: 11,
  maxZoom: 18
}

// The PMTiles archive is served as a static file. In dev (vite) and in
// `vite preview` it is reachable at /tiles/chironico.pmtiles (see vite.config).
const base = import.meta.env.BASE_URL || '/'
export const PMTILES_URL = `pmtiles://${location.origin}${base}tiles/chironico.pmtiles`
