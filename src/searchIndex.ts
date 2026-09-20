// Shared loader, parser and matcher for the static search index
// (tiles/climbing-search.json).
//
// Both the viewer search bar and the editor's sector/area picker use this, so
// discovering existing climbing features never depends on Overpass. The file is
// fetched lazily on first use and cached for the session.
import { CLIMBING_SEARCH_URL } from './config'

export type PlaceKind = 'p' | 's' | 'a'
export type OsmType = 'n' | 'w' | 'r'

// [name, kind, osm_type, osm_id, lon, lat, font, hueco, parent]
export type Row = [string, PlaceKind, OsmType, number, number, number, string?, string?, number?]

export interface SearchIndex {
  parents: [string, string][]
  rows: Row[]
}

export interface PlaceEntry {
  name: string
  norm: string
  kind: PlaceKind
  osm: OsmType
  id: number
  lon: number
  lat: number
  font?: string
  hueco?: string
  sector?: string
  area?: string
}

/** Case- and accent-insensitive form used for matching. */
export function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
}

export function parseSearchIndex(data: SearchIndex | Row[]): PlaceEntry[] {
  const file: SearchIndex = Array.isArray(data) ? { parents: [], rows: data } : data
  return file.rows.map(row => {
    const entry: PlaceEntry = {
      name: row[0],
      norm: normalize(row[0]),
      kind: row[1],
      osm: row[2],
      id: row[3],
      lon: row[4],
      lat: row[5]
    }
    if (row[1] === 'p') {
      entry.font = row[6] || undefined
      entry.hueco = row[7] || undefined
      const parent = file.parents[row[8] ?? -1]
      if (parent) {
        entry.sector = parent[0] || undefined
        entry.area = parent[1] || undefined
      }
    }
    return entry
  })
}

/** Substring matches for a query, optionally limited to one kind. */
export function matchPlaces(entries: PlaceEntry[], query: string, kind?: PlaceKind): PlaceEntry[] {
  const q = normalize(query.trim())
  if (!q) return []
  return entries.filter(entry => (kind === undefined || entry.kind === kind) && entry.norm.includes(q))
}

let entries: PlaceEntry[] | undefined
let loadPromise: Promise<PlaceEntry[]> | undefined

export function loadSearchIndex(): Promise<PlaceEntry[]> {
  if (entries) return Promise.resolve(entries)
  if (!loadPromise) {
    loadPromise = fetch(CLIMBING_SEARCH_URL)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<SearchIndex | Row[]>
      })
      .then(data => {
        entries = parseSearchIndex(data)
        return entries
      })
      .catch(error => {
        loadPromise = undefined // Allow a retry on the next interaction.
        throw error
      })
  }
  return loadPromise
}
