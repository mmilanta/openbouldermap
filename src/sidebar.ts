// Sidebar rendering for selected route / boulder features.

import { parsePath, renderPhotoBlock, createPathEditor, stringifyPath, PathPoint } from './photos'
import { gradeColor } from './grades'
import { fetchProblemSector, fetchSectorRoutes, type SectorRoute, type SectorSummary } from './sectorRoutes'

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

export function setRouteNavigator(navigate: (route: SectorRoute) => void): void {
  routeNavigator = navigate
}

export function setSectorNavigator(navigate: (lon: number, lat: number) => void): void {
  sectorNavigator = navigate
}

export function hideSidebar(): void {
  sidebarEl.classList.add('hidden')
}

export function showRoute(props: Record<string, any>, lon: number, lat: number): void {
  const grade = pick(props, 'climbing:grade:font')
  const name = pick(props, 'name') ?? 'Untitled route'
  const start = pick(props, 'climbing:start')
  const desc = pick(props, 'description')
  const fa = pick(props, 'climbing:fa', 'fa')
  const len = pick(props, 'climbing:length')
  const url = pick(props, 'url')
  const img = pick(props, 'wikimedia_commons', 'image')

  const html: HTMLElement[] = []
  html.push(el('h1', 'route-name', name))

  if (grade) {
    const chip = el('span', 'grade-chip', grade) as HTMLElement
    chip.style.backgroundColor = gradeColorFor(grade)
    const wrap = el('div', 'grade-row', '')
    wrap.appendChild(chip)
    if (start) wrap.appendChild(el('span', 'start-tag', startStart(start)))
    html.push(wrap)
  } else {
    html.push(el('div', 'grade-row', '<span class="grade-chip unknown">grade unknown</span>'))
  }

  // Photo + path overlay
  if (img && img.startsWith('File:')) {
    const pathStr = pick(props, 'wikimedia_commons:path')
    const existingPoints = parsePath(pathStr)
    const color = grade ? gradeColorFor(grade) : '#9e9e9e'
    html.push(renderPhotoBlock(img, existingPoints.length > 0 ? [{ points: existingPoints, color, label: grade ?? undefined }] : []))
    // Edit button + result string
    html.push(buildPathControls(img, existingPoints, (newPoints) => {
      showRoute({ ...props, 'wikimedia_commons:path': stringifyPath(newPoints) }, lon, lat)
    }, () => {
      showRoute(props, lon, lat)
    }))
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

export function showBoulder(props: Record<string, any>, lon: number, lat: number): void {
  const kind = pick(props, 'kind')
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

  const routeList = kind === 'sector' ? buildSectorRouteList(props) : undefined
  if (routeList) html.push(routeList)

  html.push(el('div', 'links', `<a href="${osmPermalink(lat, lon)}" target="_blank" rel="noopener">view on OSM</a> · <a href="${osmEditLink(lat, lon)}" target="_blank" rel="noopener">edit in iD</a>`))
  render(html)

  if (routeList) loadSectorRoutes(routeList, {
    id: Number(props.osm_id),
    name,
    lon,
    lat
  })
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

      const grade = route.properties['climbing:grade:font']
      if (grade) {
        const badge = document.createElement('span')
        badge.className = 'sector-route-grade'
        badge.textContent = String(grade)
        badge.style.backgroundColor = gradeColorFor(String(grade))
        button.appendChild(badge)
      }

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

function gradeColorFor(g: string): string {
  return gradeColor(g)
}

// ---------------------------------------------------------------------------
//  Path editor controls  (Edit button, serialized result, Copy, iD link)
// ---------------------------------------------------------------------------

function buildPathControls(
  imageFilename: string,
  existingPoints: PathPoint[],
  onPathChanged: (newPoints: PathPoint[]) => void,
  onCancel: () => void,
): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'path-controls'

  // Edit button
  const editBtn = document.createElement('button')
  editBtn.className = 'path-edit-btn'
  editBtn.textContent = existingPoints.length > 0 ? '✎ Edit path' : '+ Add path'
  editBtn.addEventListener('click', () => {
    createPathEditor(imageFilename, existingPoints, {
      onDone: onPathChanged,
      onCancel,
    })
  })
  wrap.appendChild(editBtn)

  // Show serialized path string if it exists
  if (existingPoints.length > 0) {
    const str = stringifyPath(existingPoints)
    const field = document.createElement('div')
    field.className = 'path-result'

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'path-result-input'
    input.value = str
    input.readOnly = true
    input.title = 'Copy this value into the wikimedia_commons:path tag on OpenStreetMap'
    field.appendChild(input)

    const copyBtn = document.createElement('button')
    copyBtn.className = 'path-copy-btn'
    copyBtn.textContent = 'Copy'
    copyBtn.addEventListener('click', () => {
      const fullTag = `wikimedia_commons:path=${str}`
      navigator.clipboard.writeText(fullTag).then(() => {
        copyBtn.textContent = 'Copied!'
        setTimeout(() => { copyBtn.textContent = 'Copy' }, 1500)
      })
    })
    field.appendChild(copyBtn)

    wrap.appendChild(field)

    // iD editor link
    const hint = document.createElement('div')
    hint.className = 'path-hint'
    hint.innerHTML = `
      Paste the value above into the <code>wikimedia_commons:path</code> tag on
      <a href="https://www.openstreetmap.org/edit?editor=id" target="_blank" rel="noopener">OpenStreetMap iD editor</a>
    `
    wrap.appendChild(hint)
  }

  return wrap
}
