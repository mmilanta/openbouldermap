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

const cache = new Map<number, Promise<SectorRoute[]>>()
const parentCache = new Map<string, Promise<SectorSummary | undefined>>()

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
