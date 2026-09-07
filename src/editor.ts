// In-browser editor for existing bouldering route nodes.
//
// v0 scope: modify route nodes only. The editor accumulates tag changes in
// memory and finally exports them as an OSM OsmChange (.osc) file that can be
// uploaded with JOSM / iD / osmium. No data is written anywhere automatically.

import { parsePath, stringifyPath, createPathEditor, renderPhotoBlock, PathPoint } from './photos'
import { gradeColor } from './grades'
import { BASE_URL, EDIT_PATH } from './config'
import { fetchProblemSector, fetchSectorRoutes, type SectorRoute } from './sectorRoutes'

const sidebarEl = document.getElementById('sidebar')!
const contentEl = document.getElementById('sidebar-content')!

// ---------------------------------------------------------------------------
//  Edit mode detection
// ---------------------------------------------------------------------------

export function isEditMode(): boolean {
  const path = location.pathname.replace(/\/+$/, '') || '/'
  const editPath = EDIT_PATH.replace(/\/+$/, '')
  return path === editPath || new URLSearchParams(location.search).get('edit') === '1'
}

// ---------------------------------------------------------------------------
//  Floating pencil / exit button
// ---------------------------------------------------------------------------

export function initEditorButton(): void {
  const button = document.getElementById('edit-toggle') as HTMLButtonElement | null
  const oscButton = document.getElementById('osc-toggle') as HTMLButtonElement | null
  if (!button) return

  const sync = () => {
    const editing = isEditMode()
    button.textContent = editing ? '✕' : '✎'
    button.classList.toggle('editing', editing)
    button.title = editing
      ? 'Leave the editor and go back to the map'
      : 'Edit bouldering routes'
    button.setAttribute('aria-label', button.title)

    if (oscButton) {
      oscButton.hidden = !editing
      oscButton.title = 'Download an OSM changefile with all your local edits'
    }
    syncOscButton()
  }
  sync()

  button.addEventListener('click', () => {
    const hash = window.location.hash
    if (isEditMode()) {
      window.location.assign(`${BASE_URL}${hash}`)
    } else {
      window.location.assign(`${EDIT_PATH}${hash}`)
    }
  })

  oscButton?.addEventListener('click', () => {
    downloadOsc()
  })
}

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface OsmNode {
  type: 'node'
  id: number
  lat: number
  lon: number
  version?: number
  tags?: Record<string, string>
}

interface RouteEdit {
  id: number
  osmType: string
  lat: number
  lon: number
  version?: number

  // Authoritative current tags fetched from the live OSM API.
  originalTags: Record<string, string>
  originalImage: string

  liveLoaded: boolean
  loading: boolean
  liveError?: string

  // Current editor values.
  name: string
  grade: string
  description: string
  image: string
  path: string
  sit: boolean

  // Keys whose value the user has explicitly changed while editing.
  dirty: Set<string>

  // Routes in the same sector (the app's current block grouping), used as
  // reference lines while drawing on a shared image.
  blockRoutes?: SectorRoute[]
  blockRoutesLoading?: Promise<SectorRoute[]>
}

const edits = new Map<number, RouteEdit>()
const nodeCache = new Map<number, Promise<OsmNode>>()
let currentEditId: number | undefined
let previewTimer: number | undefined

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function el(tag: string, cls: string, html = ''): HTMLElement {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  node.innerHTML = html
  return node
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&apos;'
    }
  })
}

function normalizeGrade(value: string): string {
  return value.trim().toUpperCase()
}

/**
 * Accept either a `File:…` tag value or a full Wikimedia Commons URL and
 * normalize it to the `File:…` form stored in OSM.
 */
function normalizeImage(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^File:/i.test(trimmed)) return `File:${trimmed.replace(/^File:/i, '').trim()}`

  const urlMatch = trimmed.match(/\/wiki\/(File:[^?#]+)/i)
  if (urlMatch) {
    try {
      const filename = decodeURIComponent(urlMatch[1].slice(5).replace(/_/g, ' '))
      return `File:${filename}`
    } catch {
      return trimmed
    }
  }
  return trimmed
}

function osmPermalink(lat: number, lon: number, zoom = 18): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`
}

function sameImage(a: string, b: string): boolean {
  const canonical = (value: string) => normalizeImage(value)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase()
  return canonical(a) === canonical(b)
}

async function loadBlockRoutes(edit: RouteEdit): Promise<SectorRoute[]> {
  if (edit.blockRoutes) return edit.blockRoutes
  if (edit.blockRoutesLoading) return edit.blockRoutesLoading

  edit.blockRoutesLoading = (async () => {
    const sector = await fetchProblemSector(edit.osmType, edit.id)
    const routes = sector ? await fetchSectorRoutes(sector.id) : []
    edit.blockRoutes = routes
    return routes
  })()

  try {
    return await edit.blockRoutesLoading
  } finally {
    edit.blockRoutesLoading = undefined
  }
}

function referencePaths(edit: RouteEdit, routes: SectorRoute[]): PathPoint[][] {
  return routes.flatMap(route => {
    const id = Number(route.properties.osm_id)
    if (id === edit.id) return []

    // Prefer values already changed during this editing session over the live
    // relation snapshot so switching between routes gives immediate feedback.
    const localEdit = edits.get(id)
    const image = localEdit?.image ?? String(route.properties.wikimedia_commons || route.properties.image || '')
    if (!sameImage(image, edit.image)) return []
    const path = localEdit?.path ?? String(route.properties['wikimedia_commons:path'] || '')
    const points = parsePath(path)
    return points.length > 1 ? [points] : []
  })
}

// ---------------------------------------------------------------------------
//  Live OSM node data
// ---------------------------------------------------------------------------

function fetchNode(id: number): Promise<OsmNode> {
  const cached = nodeCache.get(id)
  if (cached) return cached

  const request = fetch(`https://api.openstreetmap.org/api/0.6/node/${id}.json`)
    .then(async response => {
      if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`)
      return response.json() as Promise<{ elements: OsmNode[] }>
    })
    .then(({ elements }) => {
      const node = elements.find(element => element.type === 'node' && element.id === id)
      if (!node) throw new Error('Node not found in OSM API response')
      return node
    })

  nodeCache.set(id, request)
  request.catch(() => nodeCache.delete(id))
  return request
}

async function ensureLiveData(edit: RouteEdit): Promise<void> {
  if (edit.liveLoaded || edit.loading) return
  edit.loading = true
  updateStatus(edit)

  try {
    const node = await fetchNode(edit.id)
    edit.version = node.version
    edit.lat = node.lat
    edit.lon = node.lon
    edit.originalTags = { ...(node.tags ?? {}) }
    edit.originalImage = edit.originalTags.wikimedia_commons || edit.originalTags.image || ''

    if (!edit.dirty.has('name')) edit.name = edit.originalTags.name ?? ''
    if (!edit.dirty.has('climbing:grade:font')) edit.grade = edit.originalTags['climbing:grade:font'] ?? ''
    if (!edit.dirty.has('description')) edit.description = edit.originalTags.description ?? ''
    if (!edit.dirty.has('wikimedia_commons')) edit.image = edit.originalImage
    if (!edit.dirty.has('wikimedia_commons:path')) edit.path = edit.originalTags['wikimedia_commons:path'] ?? ''
    if (!edit.dirty.has('climbing:start')) edit.sit = edit.originalTags['climbing:start'] === 'sit'

    edit.liveLoaded = true
    edit.liveError = undefined
    if (currentEditId === edit.id) syncFormFromEdit(edit)
  } catch (error) {
    edit.liveError = error instanceof Error ? error.message : String(error)
    if (currentEditId === edit.id) updateStatus(edit)
  } finally {
    edit.loading = false
    if (currentEditId === edit.id) updateStatus(edit)
    syncOscButton()
  }
}

// ---------------------------------------------------------------------------
//  Editor form
// ---------------------------------------------------------------------------

export function showRouteEditor(props: Record<string, any>, lon: number, lat: number): void {
  const osmType = String(props.osm_type ?? 'node')
  const osmId = Number(props.osm_id)

  if (!Number.isFinite(osmId)) {
    renderNotice('This route has no OSM id, so it cannot be edited.')
    return
  }

  if (osmType !== 'node') {
    renderNotice(`This route is an OSM ${osmType}, but the v0 editor only supports nodes.`)
    return
  }

  const edit = getOrCreateEdit(osmId, osmType, props, lon, lat)
  currentEditId = edit.id
  renderEditForm(edit)
  void ensureLiveData(edit)
}

function getOrCreateEdit(
  id: number,
  osmType: string,
  props: Record<string, any>,
  lon: number,
  lat: number,
): RouteEdit {
  const existing = edits.get(id)
  if (existing) return existing

  const originalTags: Record<string, string> = {}
  for (const key of ['name', 'climbing:grade:font', 'climbing:start', 'description', 'wikimedia_commons', 'wikimedia_commons:path', 'image']) {
    const value = props[key]
    if (value !== undefined && value !== null) originalTags[key] = String(value)
  }
  const originalImage = originalTags.wikimedia_commons || originalTags.image || ''

  const edit: RouteEdit = {
    id,
    osmType,
    lat,
    lon,
    originalTags,
    originalImage,
    liveLoaded: false,
    loading: false,
    dirty: new Set<string>(),
    name: originalTags.name ?? '',
    grade: originalTags['climbing:grade:font'] ?? '',
    description: originalTags.description ?? '',
    image: originalImage,
    path: originalTags['wikimedia_commons:path'] ?? '',
    sit: originalTags['climbing:start'] === 'sit'
  }

  edits.set(id, edit)
  return edit
}

function renderNotice(message: string): void {
  contentEl.innerHTML = ''
  contentEl.appendChild(el('h1', 'route-name', 'Edit route'))
  contentEl.appendChild(el('div', 'muted', message))
  sidebarEl.classList.remove('hidden')
}

function field(labelText: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'editor-field'

  const label = document.createElement('label')
  label.className = 'editor-field-label'
  label.textContent = labelText

  wrap.appendChild(label)
  wrap.appendChild(control)
  return wrap
}

function updateStatus(edit: RouteEdit): void {
  const status = document.getElementById('editor-status')
  if (!status) return
  if (edit.liveError) {
    status.textContent = `Could not load OSM node data: ${edit.liveError}`
  } else if (edit.liveLoaded) {
    status.textContent = `OSM node #${edit.id} · version ${edit.version ?? '?'} · ready to export`
  } else {
    status.textContent = `Loading current OSM data for node #${edit.id}…`
  }
}

function syncFormFromEdit(edit: RouteEdit): void {
  const name = document.getElementById('edit-name') as HTMLInputElement | null
  const grade = document.getElementById('edit-grade') as HTMLInputElement | null
  const sit = document.getElementById('edit-sit') as HTMLInputElement | null
  const description = document.getElementById('edit-description') as HTMLTextAreaElement | null
  const image = document.getElementById('edit-image') as HTMLInputElement | null

  if (name && !edit.dirty.has('name')) name.value = edit.name
  if (grade && !edit.dirty.has('climbing:grade:font')) grade.value = edit.grade
  if (description && !edit.dirty.has('description')) description.value = edit.description
  if (image && !edit.dirty.has('wikimedia_commons')) image.value = edit.image
  if (sit && !edit.dirty.has('climbing:start')) sit.checked = edit.sit

  renderEditorPhotoArea(edit)
  updateStatus(edit)
}

function renderEditForm(edit: RouteEdit): void {
  contentEl.innerHTML = ''

  contentEl.appendChild(el('h1', 'route-name', 'Edit route'))

  const status = el('div', 'muted editor-status', '')
  status.id = 'editor-status'
  contentEl.appendChild(status)

  const form = document.createElement('form')
  form.className = 'editor-form'
  form.addEventListener('submit', event => {
    event.preventDefault()
  })

  // Attach the form before filling it so `renderEditorPhotoArea` can find the
  // `#editor-photo-area` element via document.getElementById.
  contentEl.appendChild(form)

  // Name
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.id = 'edit-name'
  nameInput.className = 'editor-input'
  nameInput.value = edit.name
  nameInput.placeholder = 'Route name'
  nameInput.addEventListener('input', () => {
    edit.name = nameInput.value
    edit.dirty.add('name')
    syncOscButton()
  })
  form.appendChild(field('Name', nameInput))

  // Grade
  const gradeInput = document.createElement('input')
  gradeInput.type = 'text'
  gradeInput.id = 'edit-grade'
  gradeInput.className = 'editor-input'
  gradeInput.value = edit.grade
  gradeInput.placeholder = 'e.g. 7C+'
  gradeInput.addEventListener('input', () => {
    edit.grade = gradeInput.value
    edit.dirty.add('climbing:grade:font')
    syncOscButton()
  })
  form.appendChild(field('Grade (Font)', gradeInput))

  // Sit start
  const sitCheck = document.createElement('input')
  sitCheck.type = 'checkbox'
  sitCheck.id = 'edit-sit'
  sitCheck.className = 'editor-check'
  sitCheck.checked = edit.sit
  sitCheck.addEventListener('change', () => {
    edit.sit = sitCheck.checked
    edit.dirty.add('climbing:start')
    syncOscButton()
  })

  const sitLabel = document.createElement('label')
  sitLabel.className = 'editor-check-label'
  sitLabel.appendChild(sitCheck)
  sitLabel.appendChild(document.createTextNode(' Sit start'))
  form.appendChild(field('Start', sitLabel))

  // Description
  const descInput = document.createElement('textarea')
  descInput.id = 'edit-description'
  descInput.className = 'editor-textarea'
  descInput.rows = 4
  descInput.value = edit.description
  descInput.placeholder = 'Description'
  descInput.addEventListener('input', () => {
    edit.description = descInput.value
    edit.dirty.add('description')
    syncOscButton()
  })
  form.appendChild(field('Description', descInput))

  // Wikimedia image
  const imageInput = document.createElement('input')
  imageInput.type = 'text'
  imageInput.id = 'edit-image'
  imageInput.className = 'editor-input'
  imageInput.value = edit.image
  imageInput.placeholder = 'File:Trieste_Gottardo.jpg'
  imageInput.addEventListener('input', () => {
    edit.image = imageInput.value
    edit.dirty.add('wikimedia_commons')
    syncOscButton()
    if (previewTimer) window.clearTimeout(previewTimer)
    previewTimer = window.setTimeout(() => {
      if (currentEditId !== edit.id) return
      renderEditorPhotoArea(edit)
    }, 400)
  })
  form.appendChild(field('Wikimedia image', imageInput))

  const photoArea = el('div', 'editor-photo-area', '')
  photoArea.id = 'editor-photo-area'
  form.appendChild(photoArea)
  renderEditorPhotoArea(edit)

  const hint = el('div', 'muted', 'Changes are kept locally. Use the ⬇ Download .osc button in the top-left corner to export all your edits, then open the file in JOSM to upload.')
  form.appendChild(hint)

  contentEl.appendChild(el('div', 'links',
    `<a href="${osmPermalink(edit.lat, edit.lon)}" target="_blank" rel="noopener">view on OSM</a>`))

  sidebarEl.classList.remove('hidden')
  updateStatus(edit)
}

// ---------------------------------------------------------------------------
//  Image + route path editing
// ---------------------------------------------------------------------------

function renderEditorPhotoArea(edit: RouteEdit): void {
  const container = document.getElementById('editor-photo-area')
  if (!container) return
  container.innerHTML = ''

  const file = normalizeImage(edit.image)
  if (!file.startsWith('File:')) {
    container.appendChild(el('div', 'muted', 'Set a Wikimedia image above to add a route path.'))
    return
  }

  const points = parsePath(edit.path)
  const color = edit.grade ? gradeColor(edit.grade) : '#9e9e9e'
  container.appendChild(renderPhotoBlock(file, points.length > 0 ? [{ points, color }] : []))
  container.appendChild(buildEditorPathControls(file, edit))
}

function buildEditorPathControls(imageFilename: string, edit: RouteEdit): HTMLElement {
  const existingPoints = parsePath(edit.path)
  const wrap = document.createElement('div')
  wrap.className = 'path-controls'

  const editBtn = document.createElement('button')
  editBtn.className = 'path-edit-btn'
  editBtn.textContent = existingPoints.length > 0 ? '✎ Edit path' : '+ Add path'
  editBtn.addEventListener('click', async () => {
    editBtn.disabled = true
    const originalLabel = editBtn.textContent
    editBtn.textContent = 'Loading routes…'

    let otherPaths: PathPoint[][] = []
    try {
      otherPaths = referencePaths(edit, await loadBlockRoutes(edit))
    } catch (error) {
      console.warn('Could not load other routes on this block', error)
    } finally {
      editBtn.disabled = false
      editBtn.textContent = originalLabel
    }

    createPathEditor(imageFilename, existingPoints, {
      onDone: (newPoints) => {
        edit.path = stringifyPath(newPoints)
        edit.dirty.add('wikimedia_commons:path')
        renderEditorPhotoArea(edit)
        syncOscButton()
      },
      onCancel: () => {}
    }, otherPaths)
  })
  wrap.appendChild(editBtn)

  if (existingPoints.length > 0) {
    const str = stringifyPath(existingPoints)
    const field = document.createElement('div')
    field.className = 'path-result'

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'path-result-input'
    input.value = str
    input.readOnly = true
    input.title = 'This value will be written to the wikimedia_commons:path tag'
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

    const hint = document.createElement('div')
    hint.className = 'path-hint'
    hint.innerHTML = 'Included as <code>wikimedia_commons:path</code> in the downloaded .osc changefile.'
    wrap.appendChild(hint)
  }

  return wrap
}

// ---------------------------------------------------------------------------
//  OsmChange export
// ---------------------------------------------------------------------------

function buildFinalTags(edit: RouteEdit): Record<string, string> {
  // Start from the complete set of live OSM tags. An OsmChange `<modify>`
  // replaces the whole element, so every unchanged tag must be present too.
  const tags: Record<string, string> = { ...edit.originalTags }

  const setTag = (key: string, value: string) => {
    if (value === '') delete tags[key]
    else tags[key] = value
  }

  setTag('name', edit.name.trim())
  setTag('climbing:grade:font', normalizeGrade(edit.grade))
  setTag('description', edit.description.trim())
  setTag('wikimedia_commons:path', edit.path.trim())

  const image = normalizeImage(edit.image)
  const originalImage = normalizeImage(edit.originalImage)
  if (image !== originalImage) setTag('wikimedia_commons', image)

  const originalSit = edit.originalTags['climbing:start'] === 'sit'
  if (edit.sit !== originalSit) {
    if (edit.sit) tags['climbing:start'] = 'sit'
    else delete tags['climbing:start']
  }

  return tags
}

function tagsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if ((a[key] ?? '') !== (b[key] ?? '')) return false
  }
  return true
}

function hasChanges(edit: RouteEdit): boolean {
  return !tagsEqual(buildFinalTags(edit), edit.originalTags)
}

function buildNodeChange(edit: RouteEdit): string | undefined {
  if (!hasChanges(edit)) return undefined

  const tags = buildFinalTags(edit)
  const tagXml = Object.entries(tags)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `    <tag k="${escapeXml(key)}" v="${escapeXml(value)}" />`)
    .join('\n')

  return [
    `  <node id="${edit.id}" lat="${edit.lat.toFixed(7)}" lon="${edit.lon.toFixed(7)}" version="${edit.version}">`,
    tagXml,
    '  </node>'
  ].join('\n')
}

function editedClimbCount(): number {
  let count = 0
  for (const edit of edits.values()) {
    if (hasChanges(edit)) count++
  }
  return count
}

function syncOscButton(): void {
  const countEl = document.getElementById('osc-count')
  if (countEl) countEl.textContent = String(editedClimbCount())
}

function downloadOsc(): void {
  const pending = [...edits.values()].filter(edit => !edit.liveLoaded || edit.version === undefined)
  if (pending.length > 0) {
    const failed = pending.filter(edit => edit.liveError)
    window.alert(
      failed.length > 0
        ? `Could not load current OSM data for ${failed.length} route(s). Those changes were not exported.`
        : `Still loading current OSM data for ${pending.length} route(s). Please wait a moment and try again.`
    )
    return
  }

  const nodes = [...edits.values()]
    .map(buildNodeChange)
    .filter((node): node is string => node !== undefined)

  if (nodes.length === 0) {
    window.alert('No changes yet. Edit a field above first.')
    return
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<osmChange version="0.6" generator="OpenBoulderMap editor">',
    '  <modify>',
    nodes.join('\n\n'),
    '  </modify>',
    '</osmChange>',
    ''
  ].join('\n')

  const blob = new Blob([xml], { type: 'application/x-osm+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'openbouldermap.osc'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
