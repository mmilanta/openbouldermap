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
  - An OSM PBF: the full planet (~95 GB) or a continent extract from [Geofabrik](https://download.geofabrik.de/)

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
2. The script also runs **`scripts/extract-sectors.py`** to turn nested `type=site` area/sector relations into `data/sectors.geojson` centroid points.
3. Planetiler processes the filtered PBF + site GeoJSON with `scripts/schema.yml` (`areas`, `sectors`, `boulders`, `boulder_points`, and `routes` layers) and writes `tiles/climbing.pmtiles`.
4. The frontend loads **two vector sources**:
   - `basemap` — `https://tiles.openfreemap.org/planet/{z}/{x}/{y}.mvt` (OpenFreeMap CDN, free)
   - `climbing` — `pmtiles://…/tiles/climbing.pmtiles` (local static file)
5. MapLibre progressively reveals the hierarchy: area names below z13, sector names from z13 to z16, boulder names from z16 to z19, and problem names from z19. Physical boulders and grade-colored problem dots also appear at z13.
6. Selecting a sector fetches its direct relation members from the live OSM API and shows its problems with grades. Selecting a problem flies the map to it at z19.

## Data model

### Boulders (areas)
`climbing=boulder` AND `natural∈{bare_rock,stone}` AND `sport=climbing` → dark-gray filled polygon.

### Routes (points)
`climbing=route_bottom` → grade-colored dot (Font scale, green→red).

### Areas and sectors
- **Areas** are `type=site` relations tagged `climbing=area` +
  `climbing:boulder=yes`. They contain sector relations; their names render below z13.
- **Sectors** are `type=site` relations tagged `climbing=crag` +
  `climbing:boulder=yes`. They directly contain problem nodes; their names render from z13 to z16.
- Polygon objects with the same classification render as subtle fills. Site relations
  render as centroid points generated recursively by `scripts/extract-sectors.py`.

Areas and sectors are represented by clickable names without dot markers. At z13,
physical boulders and problem dots appear. Boulder names replace sector names at z16
and stay above the problem dots until problem names replace them at z19.

## Weekly worldwide data updates

The repo ships with a fully automated data pipeline
([`.github/workflows/update-data.yml`](.github/workflows/update-data.yml)) that runs every Friday
at 05:17 UTC:

1. **Filter in parallel** — eight independent runners download and filter the latest Geofabrik
   continent extracts. Each runner stores only one continent and deletes it immediately after
   producing a tiny climbing-only PBF.
2. **Update** — merges the eight filtered extracts, then rebuilds the worldwide
   `tiles/climbing.pmtiles` with Planetiler v0.10.2.
3. **PR** — if the tiles changed, opens `chore: update climbing tiles` from the `data-update`
   branch. No changes → no PR.
4. **Auto-merge** — merges the PR (squash) and cleans up the branch. If "Allow auto-merge"
   is disabled in the repo settings it falls back to merging immediately.
5. **Deploy** — deploys the merged result to GitHub Pages (the merge uses `GITHUB_TOKEN`, so
   the normal push-triggered deploy does not fire for it).

Run it any time with the **Run workflow** button (Actions → Weekly worldwide data update).

> **Required repo setting**: to create PRs, the pipeline needs **Settings → Actions → General →
> Workflow permissions → "Allow GitHub Actions to create and approve pull requests"** enabled
> (GitHub leaves this off by default for personal repos). Without it, the branch is pushed but
> the PR step fails.

> Note: Extract metadata can change even when no new boulders were mapped, so the workflow
> may create an update PR every week.

## OSM data coverage

Climbing features depend on OSM contributors mapping them. Popular bouldering
destinations in Europe (Fontainebleau, Chironico, Magic Wood, Albarracín, etc.)
are well-mapped. Coverage elsewhere varies.

The continent filtering jobs run in parallel and output only climbing-tagged
features plus their referenced geometry. The resulting filtered PBFs are tiny
enough that merging them and running Planetiler takes little time.

## License

MIT. Data © OpenStreetMap contributors (ODbL).
Basemap tiles from OpenFreeMap (OSM-derived, ODbL-compliant).
