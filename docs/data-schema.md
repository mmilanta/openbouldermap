# OpenBoulderMap — data schema

OpenStreetMap is the **source of truth**. The app renders a derived, regenerable
snapshot (`tiles/climbing.pmtiles`); nothing in this repository is authoritative
over OSM.

The climbing hierarchy is the one used by the OSM wiki and by OpenClimbing:

```
problem   node       climbing=route_bottom   (+ climbing:boulder=yes)
  │  member of   (optional)
crag      relation   type=site + climbing=crag + climbing:boulder=yes
  │  member of   (optional)
area      relation   type=site + climbing=area + climbing:boulder=yes
  │  member of   (optional, recursive)
(nested area)        type=site + climbing=area + climbing:boulder=yes
```

There is **no separate "boulder level"**. In bouldering, a `climbing=crag`
relation *is* the boulder: the smallest indivisible climbing unit that directly
contains problems. Groupings above it are `climbing=area`, which nest
recursively.

The **physical rock** is a separate object and is not part of the containment
chain:

```
physical boulder   node / way / multipolygon   climbing=boulder + natural=bare_rock|stone + sport=climbing
```

---

## 1. Why this shape

This matches the OSM wiki and the OpenClimbing community consensus:

* **OSM wiki** — `climbing=crag`: *"A small area with climbing routes, often just
  a small cliff face or **a few boulders**."* `climbing=area`: *"A region with
  numerous climbing routes … Areas can be nested within parent areas."*
  Boulders with several routes are *"mapped as a site or crag in combination with
  `climbing:boulder=yes`."*
* **OpenClimbing** (`src/server/climbing-tiles/overpass/overpassToGeojsons.ts`) —
  only `climbing=crag` and `climbing=area` relations are treated as containers:
  ```ts
  if (!['area', 'crag'].includes(relation.tags?.climbing)) continue;
  const isRoute = (m) => ['route', 'route_bottom'].includes(m.tags.climbing);
  ```
  A crag holds the routes (`routeCount = members.filter(isRoute).length`); an area
  groups crags and other areas, and a derived **super-area** is *"an area which
  has another area among its members"*. Areas are rendered two levels deep.
* **Community thread** (*Bouldering mapping conventions*) — elnappo: *"A sport
  climbing crag with multiple routes translates into a boulder with multiple
  boulder problems"*; jvaclavik: *"use `climbing=crag` for a single 'rock' … and
  `climbing=area` for what we might normally call a sector … `area` can be used
  recursively for any higher-level logical grouping."* The four-level
  `route → boulder → crag → area` was explicitly rejected as *"too complicated."*

The `climbing=boulder` **relation-as-container** idea (a distinct boulder group
level) was raised in the thread but left unresolved; OpenClimbing and the wiki do
not use it, so this project does not either.

---

## 2. Entities

### 2.1 Problem (bouldering line)

A single boulder problem — a **point**, not a drawn line. The geographic line only
exists as a photo overlay (`wikimedia_commons:path`).

| Tag | Required | Meaning |
|---|---|---|
| `climbing=route_bottom` | yes | the problem's start |
| `climbing:boulder=yes` | yes | marks a bouldering problem (vs a roped route) |
| `sport=climbing` | yes | |
| `name` | optional | problem name |
| `climbing:grade:font` / `climbing:grade:hueco` / `climbing:grade:*` | optional | grades |
| `climbing:start`, `climbing:fa`, `climbing:length`, `description`, `url` | optional | |
| `wikimedia_commons`, `wikimedia_commons:path` | optional | photo + drawn line |

`climbing=route_top` points exist but are **not used** by the app. (`climbing=route`
is treated as a route by OpenClimbing; this app only renders `route_bottom`.)

### 2.2 Crag — the bouldering unit

The smallest indivisible climbing unit; it directly contains the problems. For
bouldering, one crag relation **represents one boulder**.

| Tag | Required | Meaning |
|---|---|---|
| `type=site` | yes | |
| `climbing=crag` | yes | this relation is a crag |
| `climbing:boulder=yes` | **yes** | it is a *bouldering* crag (a boulder) |
| `sport=climbing` | yes | the editor always writes it; iD warns without it |
| `site=climbing` | yes | the editor always writes it; iD warns without it |
| `name` | optional | boulders are often unnamed |

Members: the `climbing=route_bottom` problems **and** the physical rock
way(s)/node(s), with empty roles.

> `climbing:boulder=yes` is load-bearing: the worldwide dump has ~4,464
> `climbing=crag` site relations **without** it (roped crags); only ~392 bouldering
> ones.

### 2.3 Area and super-area

A logical grouping of crags (and/or other areas). Recursive.

| Tag | Required | Meaning |
|---|---|---|
| `type=site` | yes | |
| `climbing=area` | yes | |
| `climbing:boulder=yes` | **yes** | it is a *bouldering* area |
| `sport=climbing` | yes | the editor always writes it; iD warns without it |
| `site=climbing` | optional | not required on an area, but the editor writes it too |
| `name` | usually | |
| `description` | optional | |

Members: crag relations and/or nested area relations. An area whose members
include another area is a **super-area** (derived, not a separate tag).

In Chironico terms:

```
Chironico   climbing=area   (super-area)
 └─ Paese    climbing=area   (area)
     └─ <boulder>   climbing=crag + climbing:boulder=yes
         └─ <problem>   climbing=route_bottom
```

### 2.4 Physical rock

| Tag | Required | Meaning |
|---|---|---|
| `climbing=boulder` | yes | this object is a boulder rock |
| `natural=bare_rock` \| `stone` | yes | attached to ground / freestanding |
| `sport=climbing` | yes | |
| `name` | optional | rock name |

Geometry: `node` (marker), `way` (closed outline) or `multipolygon` relation. The
crag relation should list the rock as a member so the boulder shape can be drawn.

---

## 3. Relationship rules

* **Optional at every level.** A problem may have no crag; a crag may have no
  area.
* **At most one parent per kind.** A problem belongs to ≤1 crag, a crag to ≤1
  area. (`assign()` in the editor removes the previous parent of the same kind.)
* **Membership, not geometry.** Being "in" a crag/area means being a relation
  member. Spatial position is only a discovery aid.
* **Empty member roles.**
* **Area nesting is allowed** (area → area → …), matching the wiki and
  OpenClimbing's "super-area".

### 3.1 Containment vs. geometry

| Relationship | Mechanism | Used by |
|---|---|---|
| **Containment** | problem node is a member of the crag relation | editor, tiles, search |
| **Geometry** | problem node is a vertex of the physical rock way (`attach`/`detach`), or lies near it | editor; viewer proximity (`src/boulderRoutes.ts`) |

---

## 4. Current snapshot

Worldwide, from the latest Overpass download:

| Entity | Count |
|---|---|
| problems (`climbing=route_bottom`) | 38,313 |
| `climbing=route_top` (unused) | 808 |
| physical rock markers (`climbing=boulder`, points) | 355 |
| physical rock ways (`natural`+`sport`) | 349 |
| bouldering crags (`climbing=crag`+`climbing:boulder=yes`) | 392 |
| bouldering areas (`climbing=area`+`climbing:boulder=yes`) | 41 (36 effective; 5 are child sites) |

Most problems have no crag parent yet — the rock is only present where someone
mapped it.

---

## 5. How the app derives the schema

```
Overpass (nwr["climbing"] + referenced geometry)
        │  scripts/download-overpass-climbing.sh
        ▼
data/overpass-climbing.osm.pbf
        │  osmium tags-filter (climbing keys only)
        ▼
data/climbing-filtered.osm.pbf
        │  scripts/build-hierarchy.py  (area tree + ranks, rock↔crag links, problems)
        ├── data/sectors.geojson       → area/sector label points (rank + counts)
        ├── data/boulders.geojson      → physical rock geometry (tagged with its crag)
        ├── tiles/climbing-index.json  → the viewer's tree + route records (no live API)
        │        └── planetiler + scripts/schema.yml
        ▼
tiles/climbing.pmtiles   layers: areas, sectors, boulders, boulder_points, routes
```

| Layer | Geometry | Source |
|---|---|---|
| `routes` | point | `climbing=route_bottom` (OSM) |
| `boulders` | polygon | `data/boulders.geojson` — physical rock, `sector` = its crag (`-1` if none) |
| `boulder_points` | point | `data/boulders.geojson` |
| `sectors` | centroid point | `data/sectors.geojson` — `climbing=crag` + `climbing:boulder=yes` (the bouldering unit), with `rank`, `problem_count`, `has_rock` |
| `areas` | centroid point | `data/sectors.geojson` — `climbing=area` + `climbing:boulder=yes`, with `rank`, `area_count`, `sector_count` |

> Note: the UI calls `climbing=crag` a **Boulder** when its physical rock is
> linked (and a **Sector** otherwise). `scripts/build-hierarchy.py` builds the
> **recursive** area tree, rejects trees deeper than rank 5 at build time, picks a
> canonical parent when a child has several, and links each crag to its single
> rock member and its direct problem members. Areas are rendered as floating
> names only, one rank per zoom band.

Frontend: `src/style.ts` (layers + per-rank reveal bands), `src/hierarchy.ts`
(the static index loader) and `src/sidebar.ts` / `src/search.ts` (area, boulder
and route panels + search). The viewer never calls the live OSM API.

---

## 6. Editor model (`src/editing/model.ts`)

| Concept | Code |
|---|---|
| problem | `isRoute(e)` → `node` with `climbing=route_bottom` |
| physical rock | `isBoulder(e)` → `climbing=boulder` + `natural∈{stone,bare_rock}` |
| crag / area | `groupKind(e)` → `type=site` + `climbing:boulder=yes`, then `climbing=crag`/`area` |
| parents | `sectors(route)`, `areas(sector)` |
| membership | `assign(child, parent)` — one parent of the matching kind |
| create group | `createGroup(kind, name, description)` |
| attach/detach | `attach()`, `detach()`, `moveBoulder()`, `insertVertex()`, `removeVertex()` |

Deletion: deleting a problem leaves its perimeter vertex; deleting a rock keeps
its problems and their memberships; deleting a crag/area deletes only the
relation.

---

## 7. History

1. Original model: `problem → sector (crag) → area`, physical rocks outside the
   hierarchy.
2. A distinct `climbing=boulder` **relation-as-container** level was tried
   (zbycz's unresolved suggestion): problems were wrapped in new
   `climbing=boulder` relations placed inside the existing `climbing=crag`
   sectors, giving `problem → boulder → crag → area`.
3. That four-level shape contradicts the wiki, OpenClimbing, and the thread's own
   conclusion, so it is corrected to the consensus model:
   * each `climbing=boulder` container → **`climbing=crag`** (the boulder *is* the crag),
   * each parent `climbing=crag` that grouped boulders → **`climbing=area`**.
4. Migration/repair scripts: `scripts/generate-boulder-restructure.py` (dispatch),
   `scripts/fix-boulder-restructure.py` (completes the first partial changeset),
   and the correction changeset described in `changes/`.

---

## 8. Open questions

* Whether the physical rock should stay a separate object (current) or be merged
  into the crag.
* How deeply the app should support nested areas (`extract-sectors.py` currently
  records only one parent level).
* Whether `climbing:boulder=yes` should be implied by `climbing=boulder`/context
  (kept explicit here as the cheap discriminator).
