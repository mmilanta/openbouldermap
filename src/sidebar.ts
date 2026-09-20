// Sidebar rendering for the bouldering hierarchy.
//
// All data comes from the static hierarchy index (src/hierarchy.ts); the viewer
// never calls the live OSM API.
//
//   area  -> immediate sub-areas and boulders, each with its contents
//   boulder -> its problems, grouped by photo
//   problem -> full route detail with the photo/path overlay

import { parsePath, renderPhotoBlock, wikimediaUrl } from './photos'
import { gradesFromTags, gradeLabel, routeGradeColor, type Grade } from './grades'
import { groupLabelFor, loadHierarchy, type Area, type Hierarchy, type Problem, type Sector } from './hierarchy'
import { selectRoute } from './selection'

function el(tag: string, cls: string, html: string): HTMLElement {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  n.innerHTML = html
  return n
}

function txt(tag: string, cls: string, value: string): HTMLElement {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  n.textContent = value
  return n
}

function row(label: string, value: string): HTMLElement {
  const d = el('div', 'field', '')
  d.appendChild(txt('div', 'field-label', label))
  d.appendChild(txt('div', 'field-value', value))
  return d
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

// Clicking a hierarchy item flies to the zoom where that item is actually
// shown: a problem at its name zoom, a boulder in its label band, and an area
// at the middle of its band (band 0 = deepest).
const BOULDER_ZOOM = 18
const PROBLEM_ZOOM = 20
const areaZoom = (band: number): number => Math.max(3, 16 - 2 * band)

let navigator: ((lon: number, lat: number, zoom: number) => void) | undefined

export function setNavigator(fn: (lon: number, lat: number, zoom: number) => void): void {
  navigator = fn
}

export function hideSidebar(): void {
  selectRoute(undefined)
  sidebarEl.classList.add('hidden')
}

function problemProps(problem: Problem): Record<string, string> {
  const props: Record<string, string> = { name: problem.name }
  if (problem.font) props['climbing:grade:font'] = problem.font
  if (problem.hueco) props['climbing:grade:hueco'] = problem.hueco
  return props
}

function gradeChip(grade: Grade): HTMLElement {
  const chip = document.createElement('span')
  chip.className = 'grade-chip'
  chip.textContent = gradeLabel(grade)
  chip.title = grade.system.label
  return chip
}

function gradeBadge(grade: Grade): HTMLElement {
  const badge = document.createElement('span')
  badge.className = 'sector-route-grade'
  badge.textContent = gradeLabel(grade)
  badge.title = grade.system.label
  return badge
}

// ---- breadcrumb -----------------------------------------------------

interface Crumb { label: string; onClick?: () => void }

function breadcrumb(items: Crumb[]): HTMLElement {
  const nav = el('nav', 'breadcrumb', '')
  items.forEach((item, index) => {
    if (index > 0) nav.appendChild(el('span', 'breadcrumb-sep', '›'))
    const button = document.createElement('button')
    button.type = 'button'
    button.className = index === items.length - 1 ? 'breadcrumb-link current' : 'breadcrumb-link'
    button.textContent = item.label
    if (item.onClick) button.addEventListener('click', item.onClick)
    nav.appendChild(button)
  })
  return nav
}

function areaCrumbs(hierarchy: Hierarchy, areaId: number, onNavigate: (id: number) => void): Crumb[] {
  return hierarchy.areaPath(areaId).map(area => ({
    label: area.name || 'Unnamed area',
    onClick: () => onNavigate(area.id)
  }))
}

// ---- rows -----------------------------------------------------------

function hierarchyContent(label: string, kind: string, meta: string): HTMLElement[] {
  const main = el('span', 'hierarchy-main', '')
  main.appendChild(txt('span', 'hierarchy-name', label))
  if (meta) main.appendChild(txt('span', 'hierarchy-meta', meta))

  const right = el('span', 'hierarchy-right', '')
  right.appendChild(txt('span', 'search-result-kind', kind))
  right.appendChild(el('span', 'sector-route-arrow', '→'))

  return [main, right]
}

function hierarchyRow(label: string, kind: string, meta: string, onOpen: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'sector-route hierarchy-row'
  for (const node of hierarchyContent(label, kind, meta)) button.appendChild(node)
  button.addEventListener('click', onOpen)
  return button
}

// A boulder in an area list is a box: its header opens the boulder, and every
// problem inside is listed beneath it, one per line, with its grade.
function boulderGroup(hierarchy: Hierarchy, sector: Sector): HTMLElement {
  const group = el('div', 'hierarchy-group', '')

  const header = document.createElement('button')
  header.type = 'button'
  header.className = 'hierarchy-boulder'
  const kind = groupLabelFor('s', sector.rock !== null)
  for (const node of hierarchyContent(sector.name || 'Unnamed boulder', kind, '')) {
    header.appendChild(node)
  }
  header.addEventListener('click', () => void openBoulder(sector.id, true))
  group.appendChild(header)

  const problems = sector.problems.map(index => hierarchy.problems[index]).filter(Boolean)
  if (problems.length) {
    const list = el('div', 'hierarchy-problems', '')
    for (const problem of problems) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'hierarchy-problem'
      button.appendChild(txt('span', 'name', problem.name || 'Untitled problem'))
      const grades = gradesFromTags(problemProps(problem)).map(grade => gradeLabel(grade))
      button.appendChild(txt('span', 'grade', grades.join(' · ') || '—'))
      button.addEventListener('click', () => void openProblem(problem.id, true))
      list.appendChild(button)
    }
    group.appendChild(list)
  }

  return group
}

function plural(count: number, singular: string, pluralWord = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralWord}`
}

function areaContents(area: Area): string {
  const parts: string[] = []
  if (area.areas.length) parts.push(plural(area.areas.length, 'sub-area'))
  if (area.sectors.length) parts.push(plural(area.sectors.length, 'boulder'))
  return parts.join(' · ')
}

// ---- panels ---------------------------------------------------------

function renderArea(hierarchy: Hierarchy, area: Area): void {
  const crumbs = areaCrumbs(hierarchy, area.id, id => void openArea(id, true))

  const nodes: HTMLElement[] = [
    breadcrumb(crumbs),
    txt('h1', 'route-name', area.name || 'Unnamed area'),
    el('div', 'panel-type', 'Area')
  ]

  const children: Array<{ label: string; sort: number; element: HTMLElement }> = []
  for (const childId of area.areas) {
    const child = hierarchy.areaById.get(childId)
    if (!child) continue
    const label = child.name || 'Unnamed area'
    children.push({
      label,
      sort: child.areas.length + child.sectors.length,
      element: hierarchyRow(label, 'Area', areaContents(child), () => void openArea(child.id, true))
    })
  }
  for (const sectorId of area.sectors) {
    const sector = hierarchy.sectorById.get(sectorId)
    if (!sector) continue
    children.push({
      label: sector.name || 'Unnamed boulder',
      sort: sector.problems.length,
      element: boulderGroup(hierarchy, sector)
    })
  }
  children.sort((a, b) => b.sort - a.sort || a.label.localeCompare(b.label))

  const section = el('section', 'sector-routes', '')
  section.appendChild(el('h2', 'sector-routes-title', 'Contains'))
  if (!children.length) {
    section.appendChild(el('div', 'muted', 'Nothing mapped inside yet.'))
  } else {
    const list = el('div', 'sector-route-list', '')
    for (const child of children) list.appendChild(child.element)
    section.appendChild(list)
  }
  nodes.push(section)

  render(nodes)
}

function imageKey(value: string): string {
  return value.replace(/^File:/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function renderBoulder(hierarchy: Hierarchy, sector: Sector): void {
  const nodes: HTMLElement[] = [
    breadcrumb([
      ...areaCrumbs(hierarchy, sector.parent, id => void openArea(id, true)),
      { label: sector.name || 'Unnamed boulder', onClick: () => void openBoulder(sector.id, true) }
    ]),
    txt('h1', 'route-name', sector.name || 'Unnamed boulder'),
    el('div', 'panel-type', `${groupLabelFor('s', sector.rock !== null)} · ${plural(sector.problems.length, 'problem')}`)
  ]

  const problems = sector.problems.map(index => hierarchy.problems[index]).filter(Boolean)
  const section = el('section', 'sector-routes boulder-routes', '')
  section.appendChild(el('h2', 'sector-routes-title', 'Problems'))

  if (!problems.length) {
    section.appendChild(el('div', 'muted', 'No problems mapped on this boulder yet.'))
    nodes.push(section)
    render(nodes)
    return
  }

  const sorted = [...problems].sort((a, b) =>
    imageKey(a.image).localeCompare(imageKey(b.image)) || a.name.localeCompare(b.name)
  )

  let previousImage: string | undefined
  let list: HTMLElement | undefined
  for (const problem of sorted) {
    const canonical = imageKey(problem.image)
    if (canonical !== previousImage) {
      previousImage = canonical
      if (problem.image.startsWith('File:')) {
        const sameImage = sorted.filter(other => imageKey(other.image) === canonical)
        const paths = sameImage.flatMap(other => {
          const points = parsePath(other.path)
          if (points.length < 2) return []
          return [{ points, color: routeGradeColor(problemProps(other)), key: String(other.id) }]
        })
        section.appendChild(renderPhotoBlock(problem.image, paths))
      }
      list = el('div', 'sector-route-list', '')
      section.appendChild(list)
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'sector-route'
    button.appendChild(txt('span', 'sector-route-name', problem.name || 'Untitled problem'))

    for (const grade of gradesFromTags(problemProps(problem))) button.appendChild(gradeBadge(grade))

    const highlight = (active: boolean) => {
      for (const line of section.querySelectorAll<SVGGElement>('.photo-route-line')) {
        line.classList.toggle('highlighted', active && line.dataset.routeKey === String(problem.id))
      }
    }
    button.addEventListener('mouseenter', () => highlight(true))
    button.addEventListener('mouseleave', () => highlight(false))
    button.addEventListener('focus', () => highlight(true))
    button.addEventListener('blur', () => highlight(false))
    button.addEventListener('click', () => void openProblem(problem.id, true))
    list!.appendChild(button)
  }

  nodes.push(section)
  render(nodes)
}

function renderProblem(hierarchy: Hierarchy, problem: Problem): void {
  const sector = problem.sector >= 0 ? hierarchy.sectorById.get(problem.sector) : undefined
  const props = problemProps(problem)
  const grades = gradesFromTags(props)

  const crumbs: Crumb[] = []
  if (sector) {
    crumbs.push(...areaCrumbs(hierarchy, sector.parent, id => void openArea(id, true)))
    crumbs.push({ label: sector.name || 'Unnamed boulder', onClick: () => void openBoulder(sector.id, true) })
  }
  crumbs.push({ label: problem.name || 'Untitled problem', onClick: () => void openProblem(problem.id, true) })

  const nodes: HTMLElement[] = [
    breadcrumb(crumbs),
    txt('h1', 'route-name', problem.name || 'Untitled problem')
  ]

  if (grades.length) {
    const wrap = el('div', 'grade-row', '')
    for (const grade of grades) wrap.appendChild(gradeChip(grade))
    if (problem.start) wrap.appendChild(txt('span', 'start-tag', startStart(problem.start)))
    nodes.push(wrap)
  } else {
    nodes.push(el('div', 'grade-row', '<span class="grade-chip unknown">grade unknown</span>'))
  }

  if (problem.image.startsWith('File:')) {
    const points = parsePath(problem.path)
    nodes.push(renderPhotoBlock(problem.image, points.length > 0 ? [{ points, color: routeGradeColor(props) }] : []))
  }

  if (problem.description) nodes.push(row('Description', problem.description))
  if (problem.fa) nodes.push(row('First ascent', problem.fa))
  if (problem.length) nodes.push(row('Length', `${problem.length} m`))

  const links: string[] = []
  if (problem.url) links.push(`<a href="${problem.url}" target="_blank" rel="noopener">external link</a>`)
  if (problem.image) {
    const href = problem.image.startsWith('File:')
      ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(problem.image)}`
      : wikimediaUrl(problem.image)
    links.push(`<a href="${href}" target="_blank" rel="noopener">image (Wikimedia)</a>`)
  }
  links.push(`<a href="${osmPermalink(problem.lat, problem.lon)}" target="_blank" rel="noopener">view on OSM</a>`)
  links.push(`<a href="${osmEditLink(problem.lat, problem.lon)}" target="_blank" rel="noopener">edit in iD</a>`)
  nodes.push(el('div', 'links', links.join(' · ')))

  render(nodes)
}

function render(nodes: HTMLElement[]): void {
  contentEl.innerHTML = ''
  for (const node of nodes) contentEl.appendChild(node)
  sidebarEl.classList.remove('hidden')
}

function startStart(s: string): string {
  const m: Record<string, string> = { sit: 'sit start', stand: 'stand start', crouch: 'crouch start' }
  return m[s.toLowerCase()] ?? s
}

// ---- public entry points -------------------------------------------

export async function openArea(id: number, fly = false): Promise<void> {
  const hierarchy = await loadHierarchy()
  const area = hierarchy.areaById.get(id)
  if (!area) return
  if (fly && area.lon !== null && area.lat !== null) navigator?.(area.lon, area.lat, areaZoom(area.band))
  renderArea(hierarchy, area)
}

export async function openBoulder(id: number, fly = false): Promise<void> {
  const hierarchy = await loadHierarchy()
  const sector = hierarchy.sectorById.get(id)
  if (!sector) return
  if (fly && sector.lon !== null && sector.lat !== null) navigator?.(sector.lon, sector.lat, BOULDER_ZOOM)
  renderBoulder(hierarchy, sector)
}

export async function openProblem(id: number, fly = false): Promise<void> {
  const hierarchy = await loadHierarchy()
  const index = hierarchy.problemById.get(id)
  if (index === undefined) return
  const problem = hierarchy.problems[index]
  selectRoute(problem.id)
  if (fly) navigator?.(problem.lon, problem.lat, PROBLEM_ZOOM)
  renderProblem(hierarchy, problem)
}
