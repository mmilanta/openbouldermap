# OpenBoulderMap

A bouldering map built on OpenStreetMap data. OSM is the **source of truth**; the
app only renders a derived, regenerable snapshot (PMTiles). v1 targets a single
area — **Chironico, Ticino, Switzerland** — as a vertical slice.

See [`requirements.md`](requirements.md) for the full spec and
[`idea.md`](idea.md) for the original brainstorm.

## Stack

- **Tile generation**: [planetiler](https://github.com/onthegomap/planetiler)
  (custom-map schema in `scripts/schema.yml`) → `tiles/chironico.pmtiles`.
- **Contours**: Copernicus DEM (GLO-30) → `scripts/generate-contours.py` →
  `data/contours.geojson`, merged into the same PMTiles.
- **Frontend**: Vite + TypeScript + MapLibre GL JS, reading the PMTiles via the
  `pmtiles` protocol (no server, static file hosting).

## Prerequisites

- Java ≥ 17 (planetiler)
- [`uv`](https://docs.astral.sh/uv/) (for the contour script's ephemeral env)
- Node ≥ 18 (Vite)
- Inputs already vendored in the repo (gitignored):
  - `planetiler.jar` (at repo root)
  - `data/switzerland.osm.pbf` (Geofabrik Switzerland extract)
  - `data/dem_n46e008.tif` (Copernicus DEM tile covering lon 8–9, lat 46–47)

## Build & run

```bash
# 1. (re)generate the PMTiles from OSM + DEM — one command
bash scripts/build-tiles.sh

# 2. start the app
npm install        # first time only
npm run dev        # http://localhost:5173
```

`npm run build` + `npm run preview` serves the production bundle; copy
`tiles/chironico.pmtiles` into `dist/tiles/` for a fully self-contained preview.

## What you see

- A hiking-style basemap (contours, paths, water, landcover, faint buildings).
- **Boulders**: dark-gray filled polygons (`climbing=boulder` +
  `natural∈{bare_rock,stone}` + `sport=climbing`).
- **Routes**: grade-colored dots (`climbing=route_bottom`), Font green→red.
- Click a route → sidebar with name, grade, start, description, FA, links.
- Click a boulder → sidebar with its name/description.
- OSM + Copernicus DEM attribution in the corner.

## Data reality (Chironico, 2026-06 extract)

OSM is sparse here: 13 boulder polygons, 14 `route_bottom` points (all in
Sector 10), and 227 boulder **points** without route/grade info (not surfaced in
v1 — see `requirements.md` §3.6). This is faithful to OSM, not a bug.

## License

MIT. Data © OpenStreetMap contributors (ODbL); DEM © Copernicus DEM.
