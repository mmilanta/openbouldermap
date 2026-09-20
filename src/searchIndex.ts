// Shared access to the static climbing hierarchy index
// (tiles/climbing-index.json, built by scripts/build-hierarchy.py).
//
// The viewer search bar and the editor's sector/area picker both read from it,
// so discovering existing climbing features never calls Overpass or the OSM API.
// The file is fetched lazily on first use and cached for the session.
import { loadHierarchy, normalize, type PlaceEntry, type PlaceKind, type OsmType } from './hierarchy'

export type { PlaceEntry, PlaceKind, OsmType }
export { normalize }
export { parseHierarchy } from './hierarchy'

let entries: PlaceEntry[] | undefined

export function loadSearchIndex(): Promise<PlaceEntry[]> {
  if (entries) return Promise.resolve(entries)
  return loadHierarchy().then(hierarchy => {
    entries = hierarchy.searchEntries
    return entries
  })
}

/** Substring matches for a query, optionally limited to one kind. */
export function matchPlaces(list: PlaceEntry[], query: string, kind?: PlaceKind): PlaceEntry[] {
  const q = normalize(query.trim())
  if (!q) return []
  return list.filter(entry => (kind === undefined || entry.kind === kind) && entry.norm.includes(q))
}
