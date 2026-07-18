# OpenBoulderMap

A worldwide bouldering map built on OpenStreetMap data. OSM is the **source of
truth**; the app only renders a derived, regenerable snapshot (PMTiles).

- **Basemap**: vector tiles from [OpenFreeMap](https://openfreemap.org/) (free, no API key).
- **Climbing features**: tiny self-hosted PMTiles (boulders + routes only, a few MB globally).
- **Frontend**: Vite + TypeScript + MapLibre GL JS, reading climbing PMTiles via the `pmtiles` protocol.

See [`requirements.md`](requirements.md) for the original spec and
[`idea.md`](idea.md) for the brainstorm.

## Stack

- **Basemap**: [OpenFreeMap](https://openfreemap.org/) — Planetiler-generated vector tiles (landcover, water, roads, paths, places, buildings).
- **Climbing tile generation**: [planetiler](https://github.com/onthegomap/planetiler) (custom-map schema in `scripts/schema.yml`) → `tiles/climbing.pmtiles`.
  Input: an OSM PBF filtered with `osmium tags-filter` to only climbing-tagged objects.
- **Frontend**: Vite + TypeScript + MapLibre GL JS. Two sources: remote basemap + local climbing PMTiles.

## Prerequisites

- Java ≥ 17 (planetiler)
- [`osmium`](https://osmcode.org/osmium-tool/) (to filter OSM extracts)
- Node ≥ 18 (Vite)
- Inputs (not vendored):
  - `planetiler.jar` (at repo root, see [planetiler releases](https://github.com/onthegomap/planetiler/releases))
  - An OSM PBF: the full planet (~70 GB) or a continent extract from [Geofabrik](https://download.geofabrik.de/)

## Build & run

```bash
# 1. Build the climbing PMTiles from an OSM PBF
#    Download the planet (or a continent extract) first:
#      curl -Lo data/planet.osm.pbf https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf
#    Or grab a continent:
#      curl -Lo data/europe.osm.pbf https://download.geofabrik.de/europe-latest.osm.pbf
bash scripts/build-climbing-tiles.sh data/planet.osm.pbf     # or path to your PBF

# 2. Start the app
npm install        # first time only
npm run dev        # http://localhost:5173
```

`npm run build` + `npm run preview` serves the production bundle.

## How it works

1. **`scripts/build-climbing-tiles.sh`** filters the OSM PBF with `osmium tags-filter … climbing`, keeping only objects with any `climbing` tag. The filtered PBF is tiny (a few MB).
2. Planetiler processes the filtered PBF with `scripts/schema.yml` (only `boulders` and `routes` layers) and writes `tiles/climbing.pmtiles`.
3. The frontend loads **two vector sources**:
   - `basemap` — `https://tiles.openfreemap.org/planet/{z}/{x}/{y}.mvt` (OpenFreeMap CDN, free)
   - `climbing` — `pmtiles://…/tiles/climbing.pmtiles` (local static file)
4. MapLibre renders basemap layers first, then boulder polygons and route dots on top.

## Data model

### Boulders (areas)
`climbing=boulder` AND `natural∈{bare_rock,stone}` AND `sport=climbing` → dark-gray filled polygon.

### Routes (points)
`climbing=route_bottom` → grade-colored dot (Font scale, green→red).

## OSM data coverage

Climbing features depend on OSM contributors mapping them. Popular bouldering
destinations in Europe (Fontainebleau, Chironico, Magic Wood, Albarracín, etc.)
are well-mapped. Coverage elsewhere varies.

The planet PBF filtering step is fast — `osmium tags-filter` streams through
the file and outputs only climbing-tagged features. The resulting filtered PBF
is tiny enough that planetiler processes it in seconds.

## License

MIT. Data © OpenStreetMap contributors (ODbL).
Basemap tiles from OpenFreeMap (OSM-derived, ODbL-compliant).
