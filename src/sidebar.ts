// Sidebar rendering for selected route / boulder features.

import { parsePath, renderPhotoBlock } from './photos'
import { gradesFromTags, gradeLabel, routeGradeColor, type Grade } from './grades'
import { fetchProblemSector, fetchSectorArea, fetchAreaSectors, fetchSectorRoutes, type SectorRoute, type SectorSummary } from './sectorRoutes'
import { isEditMode } from './editMode'
import { withLocalRouteEdits } from './localEdits'
import { selectRoute } from './selection'
import type { NearbyBoulderRoute } from './boulderRoutes'

function el(tag: string, cls: string, html: string): HTMLElement {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  n.innerHTML = html
  return n
}

function row(label: string, value: string): HTMLElement {
  const d = el('div', 'field', '')
  d.appendChild(el('div', 'field-label', label))
  d.appendChild(el('div', 'field-value', value))
  return d
}

function pick(props: Record<string, any>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = props[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v)
  }
  return undefined
}

function osmPermalink(lat: number, lon: number, zoom = 18): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`
}

function osmEditLink(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/edit?editor=id#map=18/${lat}/${lon}`
}

const sidebarEl = document.getElementById('sidebar')!
const contentEl = document.getElementById('sidebar-content')!
document.getElementById('sidebar-close')!.addEventListener('click', hideSidebar)

let routeNavigator: ((route: SectorRoute) => void) | undefined
let sectorNavigator: ((lon: number, lat: number) => void) | undefined

interface HierarchyLocation {
  id: number
  name: string
  lon: number
  lat: number
}

export function setRouteNavigator(navigate: (route: SectorRoute) => void): void {
  routeNavigator = navigate
}

export function setSectorNavigator(navigate: (lon: number, lat: number) => void): void {
  sectorNavigator = navigate
}

export function hideSidebar(): void {
  selectRoute(undefined)
  sidebarEl.classList.add('hidden')
}

export function showRoute(props: Record<string, any>, lon: number, lat: number): void {
  if (String(props.osm_type ?? 'node') === 'node') {
    selectRoute(Number(props.osm_id))
  } else {
    selectRoute(undefined)
  }

  if (isEditMode()) {
    void import('./editor').then(({ showRouteEditor }) => showRouteEditor(props, lon, lat))
    return
  }

  const grades = gradesFromTags(props)
  const name = pick(props, 'name') ?? 'Untitled route'
  const start = pick(props, 'climbing:start')
  const desc = pick(props, 'description')
  const fa = pick(props, 'climbing:fa', 'fa')
  const len = pick(props, 'climbing:length')
  const url = pick(props, 'url')
  const img = pick(props, 'wikimedia_commons', 'image')

  const html: HTMLElement[] = []
  html.push(el('h1', 'route-name', name))

  if (grades.length) {
    const wrap = el('div', 'grade-row', '')
    for (const grade of grades) wrap.appendChild(gradeChip(grade))
    if (start) wrap.appendChild(el('span', 'start-tag', startStart(start)))
    html.push(wrap)
  } else {
    html.push(el('div', 'grade-row', '<span class="grade-chip unknown">grade unknown</span>'))
  }

  // Photo + path overlay (read-only in the viewer; editing lives in /edit)
  if (img && img.startsWith('File:')) {
    const pathStr = pick(props, 'wikimedia_commons:path')
    const existingPoints = parsePath(pathStr)
    const color = routeGradeColor(props)
    html.push(renderPhotoBlock(img, existingPoints.length > 0 ? [{ points: existingPoints, color }] : []))
  }

  if (desc) html.push(row('Description', desc))
  if (fa) html.push(row('First ascent', fa))
  if (len) html.push(row('Length', len + ' m'))

  const sectorLink = el('div', 'problem-sector-link', '')
  html.push(sectorLink)

  const links: string[] = []
  if (url) links.push(`<a href="${url}" target="_blank" rel="noopener">external link</a>`)
  if (img) links.push(`<a href="${img.startsWith('File:') ? 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(img) : img}" target="_blank" rel="noopener">image (Wikimedia)</a>`)
  links.push(`<a href="${osmPermalink(lat, lon)}" target="_blank" rel="noopener">view on OSM</a>`)
  links.push(`<a href="${osmEditLink(lat, lon)}" target="_blank" rel="noopener">edit in iD</a>`)
  html.push(el('div', 'links', links.join(' · ')))

  render(html)
  loadProblemSectorLink(sectorLink, props, lon, lat)
}

export function showBoulder(
  props: Record<string, any>,
  lon: number,
  lat: number,
  nearbyRoutes?: NearbyBoulderRoute[]
): void {
  selectRoute(undefined)
  props = { ...props, __lon: lon, __lat: lat }
  const kind = pick(props, 'kind')
  if (isEditMode()) {
    void import('./editor').then(({ showBoulderEditor }) => showBoulderEditor(props, lon, lat))
    return
  }

  const fallbackName = kind === 'area' ? 'Unnamed bouldering area' : kind === 'sector' ? 'Unnamed sector' : 'Unnamed boulder'
  const name = pick(props, 'name') ?? fallbackName
  const desc = pick(props, 'description')
  const wikiImg = pick(props, 'wikimedia_commons')

  const html: HTMLElement[] = [el('h1', 'route-name', name)]

  // Boulder overview photo (no paths — route paths are shown when clicking routes)
  if (wikiImg && wikiImg.startsWith('File:')) {
    html.push(renderPhotoBlock(wikiImg, []))
  }

  if (desc) html.push(row('Description', desc))
  const typeDescription = kind === 'area'
    ? 'Bouldering area (climbing=area).'
    : kind === 'sector'
      ? 'Bouldering sector (climbing=crag).'
      : 'Physical boulder (climbing=boulder).'
  html.push(el('div', 'muted', typeDescription))

  const hierarchyLinks = kind === 'area'
    ? buildAreaSectorLinks(props) ?? buildAreaSectorsPlaceholder()
    : kind === 'sector'
      ? buildSectorAreaLink(props) ?? buildSectorAreaPlaceholder()
      : undefined
  if (hierarchyLinks) html.push(hierarchyLinks)

  const routeList = kind === 'sector'
    ? buildSectorRouteList(props)
    : nearbyRoutes?.length
      ? buildBoulderRouteList(nearbyRoutes)
      : undefined
  if (routeList) html.push(routeList)

  html.push(el('div', 'links', `<a href="${osmPermalink(lat, lon)}" target="_blank" rel="noopener">view on OSM</a> · <a href="${osmEditLink(lat, lon)}" target="_blank" rel="noopener">edit in iD</a>`))
  render(html)

  if (kind === 'area' && hierarchyLinks?.classList.contains('loading-sector-links')) {
    void loadAreaSectorLinks(hierarchyLinks, props, lon, lat)
  }
  if (kind === 'sector' && hierarchyLinks?.classList.contains('loading-area-link')) {
    void loadSectorAreaLink(hierarchyLinks, props, lon, lat)
  }
  if (routeList && kind === 'sector') loadSectorRoutes(routeList, {
    id: Number(props.osm_id),
    name,
    lon,
    lat
  })
}

function hierarchyButton(label: string, location: HierarchyLocation, kind: 'area' | 'sector'): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'problem-sector-button hierarchy-button'
  button.textContent = label
  button.addEventListener('click', () => {
    sectorNavigator?.(location.lon, location.lat)
    const linkedProperties = kind === 'area'
      ? { sectors: (location as any).sectors }
      : {
          parent_area_id: (location as any).parent_area_id,
          parent_area_name: (location as any).parent_area_name,
          parent_area_lon: (location as any).parent_area_lon,
          parent_area_lat: (location as any).parent_area_lat,
          parent_area_sectors: (location as any).parent_area_sectors
        }
    showBoulder({ name: location.name, kind, osm_id: location.id, osm_type: 'relation', ...linkedProperties }, location.lon, location.lat)
  })
  return button
}

function buildAreaSectorLinks(props: Record<string, any>): HTMLElement | undefined {
  const raw = pick(props, 'sectors')
  if (!raw) return undefined
  let sectors: HierarchyLocation[]
  try {
    sectors = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!Array.isArray(sectors) || !sectors.length) return undefined

  const section = el('section', 'sector-routes hierarchy-links', '')
  section.appendChild(el('h2', 'sector-routes-title', 'Sectors'))

  const list = el('div', 'sector-route-list', '')
  for (const sector of sectors) {
    if (!Number.isFinite(sector.id) || !Number.isFinite(sector.lon) || !Number.isFinite(sector.lat)) continue

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'sector-route'

    const name = document.createElement('span')
    name.className = 'sector-route-name'
    name.textContent = sector.name || 'Unnamed sector'
    button.appendChild(name)

    const arrow = document.createElement('span')
    arrow.className = 'sector-route-arrow'
    arrow.textContent = '→'
    button.appendChild(arrow)

    button.addEventListener('click', () => {
      const location = {
        ...sector,
        parent_area_id: Number(props.osm_id),
        parent_area_name: pick(props, 'name') ?? 'Unnamed bouldering area',
        parent_area_lon: Number((props as any).__lon),
        parent_area_lat: Number((props as any).__lat),
        parent_area_sectors: raw
      } as any
      sectorNavigator?.(location.lon, location.lat)
      showBoulder({ name: location.name, kind: 'sector', osm_id: location.id, osm_type: 'relation', ...location }, location.lon, location.lat)
    })

    list.appendChild(button)
  }

  if (list.children.length === 0) return undefined
  section.appendChild(list)
  return section
}

function buildAreaSectorsPlaceholder(): HTMLElement {
  const section = el('section', 'sector-routes hierarchy-links loading-sector-links', '')
  section.appendChild(el('h2', 'sector-routes-title', 'Sectors'))
  section.appendChild(el('div', 'muted', 'Loading sectors…'))
  return section
}

async function loadAreaSectorLinks(
  section: HTMLElement,
  props: Record<string, any>,
  areaLon: number,
  areaLat: number
): Promise<void> {
  const areaId = Number(props.osm_id)
  if (!Number.isFinite(areaId)) {
    section.remove()
    return
  }

  try {
    const sectors = await fetchAreaSectors(areaId)
    if (!section.isConnected) return
    if (!sectors.length) {
      section.replaceChildren(el('h2', 'sector-routes-title', 'Sectors'))
      section.appendChild(el('div', 'muted', 'No sectors found.'))
      return
    }

    // Reuse the normal area renderer so sector navigation retains all parent
    // metadata when moving down and back up the hierarchy.
    const rendered = buildAreaSectorLinks({
      ...props,
      __lon: areaLon,
      __lat: areaLat,
      sectors: JSON.stringify(sectors)
    })
    if (rendered) section.replaceWith(rendered)
  } catch (error) {
    if (!section.isConnected) return
    const status = section.querySelector('.muted')
    if (status) status.textContent = error instanceof Error ? `Could not load sectors: ${error.message}` : 'Could not load sectors.'
  }
}

function buildSectorAreaLink(props: Record<string, any>): HTMLElement | undefined {
  const area: HierarchyLocation = {
    id: Number(props.parent_area_id),
    name: pick(props, 'parent_area_name') ?? 'Unnamed bouldering area',
    lon: Number(props.parent_area_lon),
    lat: Number(props.parent_area_lat),
    sectors: pick(props, 'parent_area_sectors')
  } as HierarchyLocation
  if (![area.id, area.lon, area.lat].every(Number.isFinite)) return undefined

  const section = el('section', 'sector-routes hierarchy-links', '')
  section.appendChild(el('h2', 'sector-routes-title', 'Area'))
  section.appendChild(hierarchyButton(`← ${area.name}`, area, 'area'))
  return section
}

function buildSectorAreaPlaceholder(): HTMLElement {
  const section = el('section', 'sector-routes hierarchy-links loading-area-link', '')
  section.appendChild(el('h2', 'sector-routes-title', 'Area'))
  section.appendChild(el('div', 'muted area-link-status', 'Loading area…'))
  return section
}

async function loadSectorAreaLink(
  section: HTMLElement,
  props: Record<string, any>,
  sectorLon: number,
  sectorLat: number
): Promise<void> {
  const sectorId = Number(props.osm_id)
  if (!Number.isFinite(sectorId)) {
    section.remove()
    return
  }

  try {
    const area = await fetchSectorArea(sectorId)
    if (!section.isConnected) return
    if (!area) {
      section.remove()
      return
    }

    // The area relation response has no geometry. Use the sector location as a
    // safe navigation fallback; the area view still exposes its sectors.
    section.replaceChildren(el('h2', 'sector-routes-title', 'Area'))
    section.classList.remove('loading-area-link')
    section.appendChild(hierarchyButton(`← ${area.name}`, {
      ...area,
      lon: sectorLon,
      lat: sectorLat
    }, 'area'))
  } catch {
    if (section.isConnected) section.remove()
  }
}

function imageKey(value: string): string {
  return value.replace(/^File:/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function buildBoulderRouteList(routes: NearbyBoulderRoute[]): HTMLElement {
  const section = el('section', 'sector-routes boulder-routes', '')
  section.appendChild(el('h2', 'sector-routes-title', 'Problems'))

  // Nearby routes originate in the static map tiles. Apply any in-memory
  // editor changes before grouping images and drawing their path overlays.
  const sorted = routes.map(route => ({
    ...route,
    properties: withLocalRouteEdits(route.properties)
  })).sort((a, b) => {
    const aImage = pick(a.properties, 'wikimedia_commons', 'image') ?? ''
    const bImage = pick(b.properties, 'wikimedia_commons', 'image') ?? ''
    return imageKey(aImage).localeCompare(imageKey(bImage)) ||
      String(a.properties.name || '').localeCompare(String(b.properties.name || ''))
  })

  let previousImage: string | undefined
  let list: HTMLElement | undefined
  for (const route of sorted) {
    const image = pick(route.properties, 'wikimedia_commons', 'image') ?? ''
    const canonicalImage = imageKey(image)
    if (canonicalImage !== previousImage) {
      previousImage = canonicalImage
      if (image.startsWith('File:')) {
        const sameImageRoutes = sorted.filter(candidate =>
          imageKey(pick(candidate.properties, 'wikimedia_commons', 'image') ?? '') === canonicalImage
        )
        const paths = sameImageRoutes.flatMap(candidate => {
          const points = parsePath(pick(candidate.properties, 'wikimedia_commons:path'))
          if (points.length < 2) return []
          return [{
            points,
            color: routeGradeColor(candidate.properties),
            key: String(candidate.properties.osm_id)
          }]
        })
        section.appendChild(renderPhotoBlock(image, paths))
      }
      list = el('div', 'sector-route-list', '')
      section.appendChild(list)
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'sector-route'
    const routeKey = String(route.properties.osm_id)
    button.dataset.routeKey = routeKey

    const routeName = document.createElement('span')
    routeName.className = 'sector-route-name'
    routeName.textContent = String(route.properties.name || 'Untitled problem')
    button.appendChild(routeName)

    for (const grade of gradesFromTags(route.properties)) button.appendChild(sectorGradeBadge(grade))

    const highlight = (active: boolean) => {
      for (const line of section.querySelectorAll<SVGGElement>('.photo-route-line')) {
        line.classList.toggle('highlighted', active && line.dataset.routeKey === routeKey)
      }
    }
    button.addEventListener('mouseenter', () => highlight(true))
    button.addEventListener('mouseleave', () => highlight(false))
    button.addEventListener('focus', () => highlight(true))
    button.addEventListener('blur', () => highlight(false))
    button.addEventListener('click', () => {
      routeNavigator?.(route)
      showRoute(route.properties, route.lon, route.lat)
    })
    list!.appendChild(button)
  }

  return section
}

function buildSectorRouteList(props: Record<string, any>): HTMLElement {
  const section = el('section', 'sector-routes', '')
  section.appendChild(el('h2', 'sector-routes-title', 'Problems'))
  const status = el('div', 'muted sector-routes-status', Number.isFinite(Number(props.osm_id)) ? 'Loading problems…' : 'Problem list unavailable.')
  section.appendChild(status)
  return section
}

interface SectorLocation extends SectorSummary {
  lon?: number
  lat?: number
}

async function loadSectorRoutes(section: HTMLElement, sector: SectorLocation): Promise<void> {
  if (!Number.isFinite(sector.id)) return

  try {
    const routes = await fetchSectorRoutes(sector.id)
    if (!section.isConnected) return

    const status = section.querySelector('.sector-routes-status')
    status?.remove()
    if (!routes.length) {
      section.appendChild(el('div', 'muted', 'No problem members found.'))
      return
    }

    const list = el('div', 'sector-route-list', '')
    for (const route of routes) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'sector-route'

      const name = document.createElement('span')
      name.className = 'sector-route-name'
      name.textContent = String(route.properties.name || 'Untitled problem')
      button.appendChild(name)

      for (const grade of gradesFromTags(route.properties)) button.appendChild(sectorGradeBadge(grade))

      button.addEventListener('click', () => {
        const routeWithSector: SectorRoute = {
          ...route,
          properties: {
            ...route.properties,
            parent_sector_id: sector.id,
            parent_sector_name: sector.name,
            parent_sector_lon: sector.lon ?? '',
            parent_sector_lat: sector.lat ?? ''
          }
        }
        routeNavigator?.(routeWithSector)
        showRoute(routeWithSector.properties, route.lon, route.lat)
      })
      list.appendChild(button)
    }
    section.appendChild(list)
  } catch (error) {
    if (!section.isConnected) return
    const status = section.querySelector('.sector-routes-status')
    if (status) status.textContent = error instanceof Error ? `Could not load problems: ${error.message}` : 'Could not load problems.'
  }
}

async function loadProblemSectorLink(
  container: HTMLElement,
  props: Record<string, any>,
  routeLon: number,
  routeLat: number
): Promise<void> {
  const osmType = pick(props, 'osm_type')
  const osmId = Number(props.osm_id)
  if (!osmType || !Number.isFinite(osmId)) {
    container.remove()
    return
  }

  try {
    const knownId = Number(props.parent_sector_id)
    const sector = Number.isFinite(knownId)
      ? { id: knownId, name: pick(props, 'parent_sector_name') ?? 'Unnamed sector' }
      : await fetchProblemSector(osmType, osmId)
    if (!container.isConnected) return
    if (!sector) {
      container.remove()
      return
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'problem-sector-button'
    button.textContent = `Sector: ${sector.name}`
    button.addEventListener('click', async () => {
      let sectorLon = Number(props.parent_sector_lon)
      let sectorLat = Number(props.parent_sector_lat)
      if (!Number.isFinite(sectorLon) || !Number.isFinite(sectorLat)) {
        const routes = await fetchSectorRoutes(sector.id)
        sectorLon = routes.length ? routes.reduce((sum, route) => sum + route.lon, 0) / routes.length : routeLon
        sectorLat = routes.length ? routes.reduce((sum, route) => sum + route.lat, 0) / routes.length : routeLat
      }
      sectorNavigator?.(sectorLon, sectorLat)
      showBoulder({ name: sector.name, kind: 'sector', osm_id: sector.id, osm_type: 'relation' }, sectorLon, sectorLat)
    })
    container.replaceChildren(button)
  } catch {
    if (container.isConnected) container.remove()
  }
}

function render(nodes: HTMLElement[]): void {
  contentEl.innerHTML = ''
  for (const n of nodes) contentEl.appendChild(n)
  sidebarEl.classList.remove('hidden')
}

function startStart(s: string): string {
  const m: Record<string, string> = { sit: 'sit start', stand: 'stand start', crouch: 'crouch start' }
  return m[s.toLowerCase()] ?? s
}

function gradeChip(grade: Grade): HTMLElement {
  const chip = document.createElement('span')
  chip.className = 'grade-chip'
  chip.textContent = gradeLabel(grade)
  chip.style.backgroundColor = grade.color
  chip.title = grade.system.label
  return chip
}

function sectorGradeBadge(grade: Grade): HTMLElement {
  const badge = document.createElement('span')
  badge.className = 'sector-route-grade'
  badge.textContent = gradeLabel(grade)
  badge.style.backgroundColor = grade.color
  badge.title = grade.system.label
  return badge
}

