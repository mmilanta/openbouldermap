# OpenBoulderMap

A worldwide bouldering map built on OpenStreetMap data. OSM is the **source of
truth**; the app only renders a derived, regenerable snapshot (PMTiles).

**Live map:** [mmilanta.github.io/openbouldermap](https://mmilanta.github.io/openbouldermap)

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

## Editor

The desktop-first editor is available under `/edit` (the pencil button in the
top-left corner). The agreed scope is in
[`editor-feature-request.md`](editor-feature-request.md).

### Geometry and details

- **+ Boulder**: click at least three perimeter corners, then click the starting
  corner or the last corner again to close the outline (or press Enter).
  Escape cancels; Backspace removes the last unfinished corner.
- Select a boulder to drag its vertices, insert vertices using the small midpoint
  handles, or right-click an ordinary vertex and choose **Delete perimeter vertex**. **Move entire boulder**
  moves the outline and all attached routes together.
- **+ Route**: click to place a standalone route or snap it onto a boulder edge.
  Dropping onto an ordinary existing vertex joins the points rather than creating
  duplicates. Vertices already representing another route cannot be joined.
- An attached route **is the perimeter node**: moving it reshapes the rock.
  Right-click the route and choose **Detach from boulder** to leave an ordinary
  vertex behind and move the route independently. Hold **Alt** to avoid snapping when placing or dragging a route.
- Edit route names, Font grades, start types, descriptions, Commons photographs,
  and photo route lines (`wikimedia_commons:path`). Boulders support name and
  description editing.
- Simple closed ways and multipolygons made of closed rings support geometry
  editing. Legacy point boulders support details only. Fragmented multipolygons,
  joins that would destroy other tags/references, and movement of geometry shared
  with non-boulder ways require JOSM instead. Invalid outlines are rejected.

### Sectors and areas

- A **route**, not a boulder, belongs to at most one sector; a sector belongs to
  at most one area. Either parent is optional. These are relationships, not drawn
  boundaries.
- From a route, choose or create its sector. From a sector, choose or create its
  area. Search by name uses Overpass for discovery and the live OSM API when a
  result is selected. Local parents can be reused in the same session.
- Missing sectors and areas are created inline during linking. Nested creation
  remains a form draft until the final link is confirmed, and commits as one
  undoable action. There is no standalone parent-creation tool.
- **Find sector / area** opens existing groupings to edit their names,
  descriptions, and memberships or inspect their contents.

### Safe deletion, drafts, and export

- Right-click a route, boulder, or perimeter vertex for its delete action. Attached
  routes also offer **Detach from boulder**, and boulders offer **Move entire boulder**.
  These geometry actions are not in the sidebar. Escape or clicking elsewhere
  dismisses the menu without changing anything.
- Deleting an attached route leaves its perimeter vertex. Deleting a boulder
  preserves its routes and their sector memberships. Deleting a sector or area
  deletes only the relationship, never its contents. Unlinking is separate from
  deletion. Unrelated references that prevent safe deletion are reported.
- Undo/redo covers geometry, details, attachment, membership, creation, and
  deletion. Keyboard shortcuts: **Ctrl/Cmd+Z** and **Ctrl/Cmd+Shift+Z** outside
  text fields.
- Unpublished drafts, including undo history and original OSM versions, are saved
  in browser local storage. On return, choose whether to restore or discard the
  draft. The top-row **✕** asks for confirmation, then discards all local changes
  and the saved draft and leaves edit mode; Cancel keeps your work. If browser storage
  is unavailable or full, the editor warns that the draft is not saved. Detail
  edits and completed geometry/linking actions are recoverable; unfinished
  outlines, photo drawings, and parent-creation dialogs are not. Leaving with an
  unfinished action prompts a warning.
- **⬇ Download .osc** opens the review/confirmation dialog showing all creations,
  modifications, deletions, geometry changes, membership changes, and validation
  warnings. Download the changefile from that dialog after reviewing it.
- Before downloading, the editor checks affected original versions and known
  references against live OSM. Network failures or detected conflicts block
  export without discarding the local work. JOSM must still perform its own
  validation and conflict checks before upload.
- Download the `.osc` file, open it in [JOSM](https://josm.openstreetmap.de/), and
  review and upload there. Exporting retains the draft and **does not publish**
  anything. After uploading through JOSM, discard the old local draft before
  starting another editing session.

Nothing is written to OpenStreetMap automatically. Local previews are visible in
edit mode; the normal map remains the derived OSM tile snapshot.

### Editor tests

```bash
npm run typecheck
npm test                         # pure geometry, history, export, and mocked OSM safety tests
npx playwright install chromium # one-time browser installation
npm run test:browser             # starts its own local Vite server; no OSM writes
npm run build
```

The browser test exercises drawing, snapping/joining, shared-node dragging,
detachment, nested parent creation, undo/redo, export, recovery, deletion, search,
and discard. `BROWSER_EXECUTABLE` can select an existing Chromium installation;
`EDITOR_TEST_URL` can target an already-running development server.

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

## Daily worldwide data updates

The repo ships with a fully automated data pipeline
([`.github/workflows/update-data.yml`](.github/workflows/update-data.yml)) that runs every day
at 05:17 UTC:

1. **Download** — runs one global climbing-key query against the Overpass API. The tag-indexed
   query downloads only climbing objects and their referenced geometry as a small PBF.
2. **Update** — rebuilds the worldwide `tiles/climbing.pmtiles` with Planetiler v0.10.2.
3. **PR** — if the tiles changed, opens `chore: update climbing tiles` from the `data-update`
   branch. No changes → no PR.
4. **Auto-merge** — merges the PR (squash) and cleans up the branch. If "Allow auto-merge"
   is disabled in the repo settings it falls back to merging immediately.
5. **Deploy** — deploys the merged result to GitHub Pages (the merge uses `GITHUB_TOKEN`, so
   the normal push-triggered deploy does not fire for it).

Run it any time with the **Run workflow** button (Actions → Daily worldwide data update).

> **Required repo setting**: to create PRs, the pipeline needs **Settings → Actions → General →
> Workflow permissions → "Allow GitHub Actions to create and approve pull requests"** enabled
> (GitHub leaves this off by default for personal repos). Without it, the branch is pushed but
> the PR step fails.

> Note: OSM metadata can change even when no new boulders were mapped, so the workflow may
> create an update PR every day.

## OSM data coverage

Climbing features depend on OSM contributors mapping them. Popular bouldering
destinations in Europe (Fontainebleau, Chironico, Magic Wood, Albarracín, etc.)
are well-mapped. Coverage elsewhere varies.

The global Overpass query uses the `climbing` tag index and includes referenced
geometry. The resulting PBF is tiny enough that Planetiler processes it quickly.

## License

MIT. Data © OpenStreetMap contributors (ODbL).
Basemap tiles from OpenFreeMap (OSM-derived, ODbL-compliant).
