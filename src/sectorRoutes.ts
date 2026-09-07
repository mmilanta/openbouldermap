export interface SectorRoute {
  properties: Record<string, string | number>
  lon: number
  lat: number
}

interface OsmMember {
  type: 'node' | 'way' | 'relation'
  ref: number
}

interface OsmElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  nodes?: number[]
  members?: OsmMember[]
  tags?: Record<string, string>
}

export interface SectorSummary {
  id: number
  name: string
}

export interface SectorLocation extends SectorSummary {
  lon: number
  lat: number
}

const cache = new Map<number, Promise<SectorRoute[]>>()
const parentCache = new Map<string, Promise<SectorSummary | undefined>>()
const areaCache = new Map<number, Promise<SectorSummary | undefined>>()
const areaSectorsCache = new Map<number, Promise<SectorLocation[]>>()

/** Finds the bouldering sector relation that directly contains a problem. */
export function fetchProblemSector(osmType: string, osmId: number): Promise<SectorSummary | undefined> {
  const key = `${osmType}/${osmId}`
  const cached = parentCache.get(key)
  if (cached) return cached

  const request = fetch(`https://api.openstreetmap.org/api/0.6/${key}/relations.json`)
    .then(async response => {
      if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`)
      return response.json() as Promise<{ elements: OsmElement[] }>
    })
    .then(({ elements }) => {
      const sector = elements.find(element =>
        element.type === 'relation' &&
        element.tags?.climbing === 'crag' &&
        element.tags?.['climbing:boulder'] === 'yes'
      )
      return sector ? { id: sector.id, name: sector.tags?.name || 'Unnamed sector' } : undefined
    })

  parentCache.set(key, request)
  request.catch(() => parentCache.delete(key))
  return request
}

/** Finds the bouldering area relation that directly contains a sector. */
export function fetchSectorArea(sectorId: number): Promise<SectorSummary | undefined> {
  const cached = areaCache.get(sectorId)
  if (cached) return cached

  const request = fetch(`https://api.openstreetmap.org/api/0.6/relation/${sectorId}/relations.json`)
    .then(async response => {
      if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`)
      return response.json() as Promise<{ elements: OsmElement[] }>
    })
    .then(({ elements }) => {
      const area = elements.find(element =>
        element.type === 'relation' &&
        element.tags?.climbing === 'area' &&
        element.tags?.['climbing:boulder'] === 'yes'
      )
      return area ? { id: area.id, name: area.tags?.name || 'Unnamed bouldering area' } : undefined
    })

  areaCache.set(sectorId, request)
  request.catch(() => areaCache.delete(sectorId))
  return request
}

/** Fetches an area's direct sector members and derives their map locations. */
export function fetchAreaSectors(areaId: number): Promise<SectorLocation[]> {
  const cached = areaSectorsCache.get(areaId)
  if (cached) return cached

  const request = fetch(`https://api.openstreetmap.org/api/0.6/relation/${areaId}/full.json`)
    .then(async response => {
      if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`)
      return response.json() as Promise<{ elements: OsmElement[] }>
    })
    .then(async ({ elements }) => {
      const area = elements.find(element => element.type === 'relation' && element.id === areaId)
      if (!area?.members) return []

      const byId = new Map(elements.map(element => [`${element.type}/${element.id}`, element]))
      const sectors = area.members.flatMap(member => {
        if (member.type !== 'relation') return []
        const sector = byId.get(`relation/${member.ref}`)
        return sector?.tags?.climbing === 'crag' && sector.tags?.['climbing:boulder'] === 'yes'
          ? [sector]
          : []
      })

      // OSM's relation/full endpoint includes child relations themselves, but
      // does not recursively include their nodes. Fetch each sector in order to
      // derive a useful location from its problem members.
      return Promise.all(sectors.map(async sector => {
        const response = await fetch(`https://api.openstreetmap.org/api/0.6/relation/${sector.id}/full.json`)
        if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`)
        const result = await response.json() as { elements: OsmElement[] }
        const points = result.elements.filter((element): element is OsmElement & { lon: number; lat: number } =>
          element.type === 'node' && element.lon !== undefined && element.lat !== undefined
        )
        if (!points.length) return undefined
        return {
          id: sector.id,
          name: sector.tags?.name || 'Unnamed sector',
          lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
          lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length
        }
      })).then(found => found.filter((sector): sector is SectorLocation => sector !== undefined))
    })

  areaSectorsCache.set(areaId, request)
  request.catch(() => areaSectorsCache.delete(areaId))
  return request
}

/** Fetches the direct problem members of a sector relation from the live OSM API. */
export function fetchSectorRoutes(relationId: number): Promise<SectorRoute[]> {
  const cached = cache.get(relationId)
  if (cached) return cached

  const request = fetch(`https://api.openstreetmap.org/api/0.6/relation/${relationId}/full.json`)
    .then(async response => {
      if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`)
      return response.json() as Promise<{ elements: OsmElement[] }>
    })
    .then(({ elements }) => {
      const relation = elements.find(element => element.type === 'relation' && element.id === relationId)
      if (!relation?.members) return []

      const elementsById = new Map(elements.map(element => [`${element.type}/${element.id}`, element]))
      const nodesById = new Map(
        elements
          .filter(element => element.type === 'node' && element.lon !== undefined && element.lat !== undefined)
          .map(element => [element.id, element])
      )

      return relation.members.flatMap(member => {
        const element = elementsById.get(`${member.type}/${member.ref}`)
        if (!element || element.tags?.climbing !== 'route_bottom') return []

        let lon = element.lon
        let lat = element.lat
        if ((lon === undefined || lat === undefined) && element.nodes?.length) {
          const points = element.nodes.map(id => nodesById.get(id)).filter(Boolean) as OsmElement[]
          if (points.length) {
            lon = points.reduce((sum, point) => sum + point.lon!, 0) / points.length
            lat = points.reduce((sum, point) => sum + point.lat!, 0) / points.length
          }
        }
        if (lon === undefined || lat === undefined) return []

        return [{
          properties: {
            ...element.tags,
            osm_type: element.type,
            osm_id: element.id
          },
          lon,
          lat
        }]
      })
    })

  cache.set(relationId, request)
  request.catch(() => cache.delete(relationId))
  return request
}
