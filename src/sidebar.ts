// Sidebar rendering for selected route / boulder features.

import { parsePath, renderPhotoBlock, createPathEditor, stringifyPath, PathPoint } from './photos'
import { gradeColor } from './grades'

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

  const links: string[] = []
  if (url) links.push(`<a href="${url}" target="_blank" rel="noopener">external link</a>`)
  if (img) links.push(`<a href="${img.startsWith('File:') ? 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(img) : img}" target="_blank" rel="noopener">image (Wikimedia)</a>`)
  links.push(`<a href="${osmPermalink(lat, lon)}" target="_blank" rel="noopener">view on OSM</a>`)
  links.push(`<a href="${osmEditLink(lat, lon)}" target="_blank" rel="noopener">edit in iD</a>`)
  html.push(el('div', 'links', links.join(' · ')))

  render(html)
}

export function showBoulder(props: Record<string, any>, lon: number, lat: number): void {
  const name = pick(props, 'name') ?? 'Unnamed boulder'
  const desc = pick(props, 'description')
  const wikiImg = pick(props, 'wikimedia_commons')

  const html: HTMLElement[] = [el('h1', 'route-name', name)]

  // Boulder overview photo (no paths — route paths are shown when clicking routes)
  if (wikiImg && wikiImg.startsWith('File:')) {
    html.push(renderPhotoBlock(wikiImg, []))
  }

  if (desc) html.push(row('Description', desc))
  html.push(el('div', 'muted', 'Boulder area (climbing=boulder). Route list is deferred to a later version.'))
  html.push(el('div', 'links', `<a href="${osmPermalink(lat, lon)}" target="_blank" rel="noopener">view on OSM</a> · <a href="${osmEditLink(lat, lon)}" target="_blank" rel="noopener">edit in iD</a>`))
  render(html)
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
