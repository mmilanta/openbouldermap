# OpenBoulderMap — Requirements (v1)

A bouldering map built on OpenStreetMap data. OSM is the **source of truth**; the app only renders a derived snapshot. v1 targets a single area (**Chironico, Ticino, Switzerland**) as a vertical slice. Images and account features are out of scope.

> Status legend: **[confirmed]** = you explicitly decided this; **[default]** = I chose a sensible value, please confirm or change.

---

## 1. Goals & non-goals

### Goals (v1)
1. Show a **hiking-style basemap** (elevation/contours, paths, terrain) for the Chironico area.
2. Highlight **boulder areas** (OSM polygons) as filled dark-gray polygons.
3. Show **boulder routes** (OSM points) as dots colored by grade (green=easy → red=hard).
4. Click a route → a **sidebar** with its details (name, grade, start, description, FA, links).
5. OSM remains the source of truth; we only ship a **derived, regenerable snapshot** (PMTiles). Nothing is hand-edited in our own DB.

### Non-goals (v1)
- No user accounts, ticks, logbooks, leaderboards, lists. **[confirmed]**
- No in-app editing of OSM data. **[default]**
- No image upload / photo gallery / topos. **[confirmed]** (placeholder hook only.)
- No grade-range or start-type filtering UI. **[confirmed]**
- No mobile/responsive design — desktop-first. **[confirmed]**
- No multilingual UI — English only. **[confirmed]**
- No global coverage — Chironico only. **[confirmed]**

### Future (explicitly deferred, design must not preclude)
- Additional bouldering areas; a regional/global extract.
- Automatic/scheduled tile refresh; cloud or small local-server hosting.
- Route filtering by grade/start.
- Images (likely Wikimedia Commons, à la OpenClimbing).
- Grouping routes under their boulder.

---

## 2. Scope: Chironico

- **Area of interest (AOI) bbox** [corrected]: `8.820, 46.405, 8.875, 46.445` (lon/lat). The original `8.635–8.690` was ~18 km too far west and covered none of Chironico's climbing features; real boulders/routes sit at lon ~8.84, lat ~46.42. See §3.6 for the data audit that surfaced this.
- Initial map view: centered on AOI, zoom 15. minZoom 11, maxZoom 18 (tiles generated to z16; MapLibre overzoomes 17–18).
- Basemap tiles generated for the AOI (a few km² → tiny PMTiles, easily self-hosted).
- Climbing features fetched/generated for the AOI.

---

## 3. Data model (OSM → app)

### 3.1 Boulders (areas)
A feature is a **boulder** for v1 iff it has **all three** tags:
- `climbing=boulder`
- `natural` is `bare_rock` **or** `stone`
- `sport=climbing`

**[confirmed]** — strict AND (the `natural` value was widened from `bare_rock`-only to `{bare_rock, stone}` after the data audit showed Chironico boulders use both). Looser matching is deferred.

Geometry: OSM ways/relations (closed polygons or multipolygons). Render as **filled dark-gray polygons** with a subtle outline. **[confirmed]**

### 3.2 Routes (points)
A feature is a **route** for v1 iff:
- `climbing=route_bottom`

**[confirmed]** — primary signal. Other climbing points (`climbing=route_top`, etc.) are ignored in v1.

Each route is rendered **independently** (no grouping under boulder). **[confirmed]**

Rendered as **dots**, color = grade (see 3.3). **[confirmed]**

### 3.3 Grades
- Display grade system: **Fontainebleau (`climbing:grade:font`)**. **[confirmed]**
- Color scale green (easy) → red (hard). Exact gradient stops defined in the style spec (see §6). **[default]**
- Routes missing `climbing:grade:font`: rendered in a neutral gray with a "grade unknown" note in the sidebar. **[default]**

### 3.4 Surfaced tags in the sidebar
For a selected route, show (present-then-show):
- `name`
- `climbing:grade:font` (rendered as "Grade")
- `climbing:start` (sit / stand / crouch / …)
- `description`
- `climbing:fa` (or `fa`) — first ascensionist
- `climbing:length`
- `url` (external link, if present)
- `wikimedia_commons` / `image` (v1: show as a link only; rendering images is deferred)
- OSM permalink to the feature (`https://www.openstreetmap.org/?...` or node/way id)

**[confirmed]** (set agreed in Q&A; ordering/format to be finalized in design).

### 3.5 Source of truth & licensing
- OSM is the only source of climbing data. We do not edit or augment it in our stack.
- Derived PMTiles are ODbL-compliant provided we **attribute OSM** (visible in the map UI + an "About" note). **[default]**
- Project code license: **MIT**. **[confirmed]**

### 3.6 Data audit — Chironico in OSM (2026-06 extract)

Querying the Geofabrik Switzerland PBF inside the corrected AOI revealed the **real** distribution of climbing tags, which differs from the assumption in `idea.md`:

| Feature | Tagging | Count in AOI | In v1? |
|---|---|---|---|
| Boulder **polygons** | `climbing=boulder` + `natural∈{bare_rock,stone}` + `sport=climbing` (way) | 13 | yes → `boulders` layer |
| Boulder **points** | `climbing=boulder` + `climbing:boulder=yes` + `natural=stone` (node), mostly named `Chironico Boulder Area X Blocco Y` | 227 | **no** — out of scope (§3.1 requires polygons) |
| Routes | `climbing=route_bottom` (node) with `climbing:grade:font`, `climbing:start`, `description`, `name` | 14 (all in Sector 10) | yes → `routes` layer |

Implications / open decisions:
- The v1 map is **sparse**: 13 boulder polygons + 14 routes clustered in one sector. This is faithful to OSM, not a bug.
- The **227 boulder points** are the bulk of mapped Chironico boulders but carry no grade/route info. Surfacing them (as a separate neutral `boulder_points` layer, distinct from the spec's `boulders` polygons) is a tempting v1.1 enhancement — deferred, pending confirmation that mixing point- and polygon-boulders won't confuse the data model.
- Only Sector 10 has `route_bottom` points; other sectors' boulders have no per-route tags in OSM. Cannot be fixed without editing OSM (out of scope, §3.5).

---

## 4. Architecture (Approach 3: vector tiles + client style)

### 4.1 Pipeline (run on laptop, manual, for v1)
1. Obtain an OSM PBF extract for the AOI (e.g., via Overpass `--clip` to a bbox, or a Geofabrik Switzerland extract clipped to the AOI). Stored locally as input; not the source of truth.
2. **Tilemaker** with a custom Lua/tag transform + JSON layer config → generates **PMTiles** containing:
   - a **basemap** layer set (terrain/hillshade source, contour lines, paths, roads, water, buildings-minimal) styled as a hiking map, and
   - a **boulders** layer (polygons from §3.1),
   - a **routes** layer (points from §3.2, carrying the tags from §3.4 as feature properties).
3. Output: a single `chironico.pmtiles` (or a basemap PMTiles + a climbing PMTiles; see §4.3 decision). **[default]** — single file unless size/style separation argues otherwise.
4. Re-run manually whenever you want fresh data. **[confirmed]**

> Note: contours/elevation require an elevation source (e.g., Copernicus DEM / SRTM) merged into the basemap tiles. This is a Tilemaker/raster-source concern; tracked as a design task, not a v1 blocker. **[default]**

### 4.2 Runtime (no server for v1)
- Static file hosting, **local only** for v1: serve `chironico.pmtiles` and the app over a local static server (e.g., `vite preview` / `python -m http.server` / a local nginx). **[confirmed]**
- The app loads PMTiles via the `pmtiles` JS protocol into **MapLibre GL JS**; features are queryable client-side (`queryRenderedFeatures`) for the sidebar. No backend, no DB, no API. **[confirmed]**
- Designed so that future hosting on Cloudflare R2 + Pages, or a small local server, is a config change only (static files + range requests). **[confirmed]**

### 4.3 Tile layering decision **[default — confirm]**
Recommendation: **two PMTiles files** —
- `basemap.pmtiles` (hiking style: contours, paths, terrain, water, roads) — can be regenerated independently and reused across areas later,
- `climbing.pmtiles` (boulders + routes + their tags) — small, regenerable from OSM alone.

Rationale: keeps the OSM-derived climbing data clearly separated; lets you swap basemaps; makes the "OSM is the source of truth" boundary explicit. If a single file is simpler to ship, that's acceptable for v1; revisit when adding a second area.

### 4.4 Stack **[confirmed]**
- Frontend: **Vite + TypeScript + MapLibre GL JS** (no React framework mandated for v1; if a component model is desired, plain TS + a tiny view layer or Preact — decide in design). **[default]** plain TS/Vite unless you prefer React/Preact.
- Tile generation: **Tilemaker** (C++, fast, Lua config, outputs MBTiles→PMTiles via `pmtiles` convert, or native PMTiles).
- PMTiles JS: `pmtiles` package + MapLibre `PMTilesProtocol`.
- License: MIT.
- No CI for v1; manual rebuild. **[confirmed]**

---

## 5. Map UX

### 5.1 Basemap
- Hiking map: **elevation contours, hillshade/terrain shading, footpaths & hiking paths, minor roads, water, minimal buildings.** **[confirmed]**
- Dim/suppressed non-relevant features so boulders stand out. **[default]**

### 5.2 Boulders
- Filled **dark-gray** polygons, thin outline. **[confirmed]**
- Boulder `name` label appears at higher zoom (≥ z15). **[default]**
- Hover: slight highlight. **[default]**

### 5.3 Routes
- **Dots**, color from green (easy) to red (hard) per Font grade. **[confirmed]**
- Appear from a min-zoom to avoid clutter (default z15+). **[default]**
- Hover: tooltip with name + grade. **[default]**
- Click: opens sidebar (see §6).

### 5.4 Interactions
- Click route → **sidebar** on the right with the tags from §3.4. **[confirmed]**
- Click boulder polygon → sidebar shows boulder `name`/`description` if present; lists are deferred. **[default]**
- Click empty map → sidebar closes. **[default]**
- No search, no filtering, no routing for v1. **[confirmed]**

### 5.5 Attribution
- Visible OSM attribution in the map corner. **[required for ODbL]**
- "About" note: data © OpenStreetMap contributors; basemap elevation source (e.g., Copernicus DEM) credited. **[default]**

---

## 6. Sidebar / detail panel (spec to be finalized)

Right-hand sidebar. On route selection shows a structured view of §3.4 tags. **[confirmed]** layout.

Proposed fields order **[default]**:
1. Name (or "Untitled route")
2. Grade (Font) — colored chip matching the dot color
3. Start (sit/stand/…)
4. Description
5. First ascent (`climbing:fa`/`fa`)
6. Length (`climbing:length`)
7. Links: `url` (if present), OSM permalink, Wikimedia image link (if present)

Missing fields are hidden, not shown as empty. **[default]**

---

## 7. Grade → color scale **[default — confirm]**

Continuous green→yellow→red across the Font range present in Chironico. Tentative stops:

| Font | Color (HSL, illustrative) |
|------|--------------------------|
| <4   | `#2e7d32` deep green |
| 4    | `#43a047` green |
| 5A–5B | `#7cb342` light green |
| 5C–6A | `#c0ca33` lime |
| 6A+–6B | `#fdd835` yellow |
| 6B+–6C | `#ffb300` amber |
| 6C+–7A | `#fb8c00` orange |
| 7A+–7B | `#f4511e` red-orange |
| 7B+–7C | `#e53935` red |
| ≥7C+ | `#b71c1c` dark red |
| unknown | `#9e9e9e` gray |

Exact hex to be set in a single style constant. Finer half-grades interpolate within their band.

---

## 8. Success criteria (v1 done = all true)
1. Local static server serves the app + PMTiles with no external runtime dependencies (except optional basemap sources if not self-hosted — but for v1 basemap is self-hosted).
2. Chironico boulder polygons render as dark-gray filled areas over a hiking basemap with contours & paths.
3. Chironico route points render as grade-colored dots.
4. Clicking a route opens the sidebar showing the tags in §3.4 from the OSM-derived data.
5. OSM attribution is visible.
6. Rebuilding the PMTiles from a fresh OSM extract is a documented one-command process.
7. Code is MIT-licensed; no GPL/AGPL code vendored (OpenClimbing/OpenBeta used as reference only). **[confirmed]**

---

## 9. Open items to confirm before build
1. **AOI bbox** for Chironico (§2) — **resolved** (corrected to `8.820,46.405,8.875,46.445`; the original was 18 km too far west).
2. **One vs two PMTiles files** (§4.3) — keeping the **single-file** approach for v1 (`tiles/chironico.pmtiles`); split deferred until a second area is added.
3. **Elevation/contour source** (§4.1) — Copernicus DEM (GLO-30, CC-BY) confirmed; `data/dem_n46e008.tif`, contours via `scripts/generate-contours.py`.
4. **Frontend framework** — plain TS/Vite confirmed.
5. **Grade color stops** (§7) — implemented as-is in `src/grades.ts`.
6. **Basemap style** — lightweight custom hiking style, generated from OSM via planetiler (`scripts/schema.yml`). **Note**: the original spec said *Tilemaker*; the build actually uses **planetiler** (custom-map schema), which serves the same role and is already wired up.
7. **Sidebar for boulder click** (§5.4) — minimal boulder-name sidebar kept.
8. **[new]** Surface the 227 boulder **points** (§3.6) as a neutral `boulder_points` layer? Deferred to v1.1 — pending confirmation.

---

## 10. Reference projects (read-only inspiration, not vendored)
- **OpenClimbing** (`jvaclavik/openclimbing`, GPL) — reference for OSM climbing tag handling, grade coloring, and MapLibre climbing-layer styling. Do **not** copy code (license incompatible with MIT).
- **OpenBeta** (`OpenBeta/open-tacos`, AGPL) — philosophically misaligned (own MongoDB, not OSM); not used as a base. Noted for completeness only.
