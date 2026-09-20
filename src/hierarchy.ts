// Static bouldering hierarchy, generated at build time by
// scripts/build-hierarchy.py into tiles/climbing-index.json.
//
// It is the viewer's only data source beyond the map tiles: search, the
// area/boulder panels and every route detail read from here, so the viewer
// never calls the live OSM API.
//
// Model: area (nested, ranked) -> sector (= boulder, 1:1 with a physical rock)
// -> problem. A sector is displayed as "Boulder" when its rock is linked, and
// as "Sector" otherwise.
import { CLIMBING_INDEX_URL } from './config'

export type PlaceKind = 'p' | 's' | 'a'
export type OsmType = 'n' | 'w' | 'r'

export interface Area {
  id: number
  name: string
  rank: number
  /** Display band counted from the deepest area level (0 = deepest). */
  band: number
  parent: number
  lon: number | null
  lat: number | null
  areas: number[]
  sectors: number[]
}

export interface Sector {
  id: number
  name: string
  parent: number
  lon: number | null
  lat: number | null
  rock: string | null
  /** Indices into Hierarchy.problems. */
  problems: number[]
}

export interface Problem {
  name: string
  id: number
  sector: number
  lon: number
  lat: number
  font: string
  hueco: string
  image: string
  path: string
  description: string
  fa: string
  length: string
  url: string
  start: string
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
  /** Ancestor names, root -> immediate parent (excludes the entry itself). */
  path: string[]
  /** Display label for the kind: Area, Boulder, Sector or Problem. */
  groupLabel: string
}

export interface Hierarchy {
  areas: Area[]
  sectors: Sector[]
  problems: Problem[]
  areaById: Map<number, Area>
  sectorById: Map<number, Sector>
  problemById: Map<number, number>
  areaPath(id: number): Area[]
  searchEntries: PlaceEntry[]
}

type AreaRow = [number, string, number, number, number | null, number | null, number[], number[], number]
type SectorRow = [number, string, number, number | null, number | null, string | null, number[]]
type ProblemRow = [string, number, number, number, number, string, string, string, string, string, string, string, string, string]

interface RawIndex {
  version: number
  areas: AreaRow[]
  sectors: SectorRow[]
  problems: ProblemRow[]
}

/** Case- and accent-insensitive form used for matching. */
export function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
}

export function groupLabelFor(kind: PlaceKind, hasRock: boolean): string {
  if (kind === 'a') return 'Area'
  if (kind === 's') return hasRock ? 'Boulder' : 'Sector'
  return 'Problem'
}

export function parseHierarchy(raw: RawIndex): Hierarchy {
  const areas: Area[] = raw.areas.map(row => ({
    id: row[0], name: row[1], rank: row[2], parent: row[3],
    lon: row[4], lat: row[5], areas: row[6], sectors: row[7], band: row[8]
  }))
  const sectors: Sector[] = raw.sectors.map(row => ({
    id: row[0], name: row[1], parent: row[2],
    lon: row[3], lat: row[4], rock: row[5], problems: row[6]
  }))
  const problems: Problem[] = raw.problems.map(row => ({
    name: row[0], id: row[1], sector: row[2], lon: row[3], lat: row[4],
    font: row[5], hueco: row[6], image: row[7], path: row[8],
    description: row[9], fa: row[10], length: row[11], url: row[12], start: row[13]
  }))

  const areaById = new Map(areas.map(area => [area.id, area]))
  const sectorById = new Map(sectors.map(sector => [sector.id, sector]))
  const problemById = new Map(problems.map((problem, index) => [problem.id, index]))

  const areaPath = (start: number): Area[] => {
    const chain: Area[] = []
    const seen = new Set<number>()
    let id = start
    while (id >= 0 && !seen.has(id)) {
      seen.add(id)
      const area = areaById.get(id)
      if (!area) break
      chain.push(area)
      id = area.parent
    }
    return chain.reverse()
  }

  const searchEntries: PlaceEntry[] = []

  for (const area of areas) {
    if (area.lon === null || area.lat === null) continue
    searchEntries.push({
      name: area.name, norm: normalize(area.name), kind: 'a', osm: 'r',
      id: area.id, lon: area.lon, lat: area.lat,
      path: areaPath(area.parent).map(parent => parent.name).filter(Boolean),
      groupLabel: groupLabelFor('a', false)
    })
  }

  for (const sector of sectors) {
    if (sector.lon === null || sector.lat === null) continue
    searchEntries.push({
      name: sector.name, norm: normalize(sector.name), kind: 's', osm: 'r',
      id: sector.id, lon: sector.lon, lat: sector.lat,
      path: areaPath(sector.parent).map(parent => parent.name).filter(Boolean),
      groupLabel: groupLabelFor('s', sector.rock !== null)
    })
  }

  for (const problem of problems) {
    const sector = problem.sector >= 0 ? sectorById.get(problem.sector) : undefined
    const path = sector
      ? [...areaPath(sector.parent).map(area => area.name), sector.name].filter(Boolean)
      : []
    searchEntries.push({
      name: problem.name, norm: normalize(problem.name), kind: 'p', osm: 'n',
      id: problem.id, lon: problem.lon, lat: problem.lat,
      font: problem.font || undefined, hueco: problem.hueco || undefined,
      path, groupLabel: groupLabelFor('p', false)
    })
  }

  return { areas, sectors, problems, areaById, sectorById, problemById, areaPath, searchEntries }
}

let hierarchy: Hierarchy | undefined
let loadPromise: Promise<Hierarchy> | undefined

export function loadHierarchy(): Promise<Hierarchy> {
  if (hierarchy) return Promise.resolve(hierarchy)
  if (!loadPromise) {
    loadPromise = fetch(CLIMBING_INDEX_URL)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<RawIndex>
      })
      .then(raw => {
        hierarchy = parseHierarchy(raw)
        return hierarchy
      })
      .catch(error => {
        loadPromise = undefined // Allow a retry on the next interaction.
        throw error
      })
  }
  return loadPromise
}
