// Desktop OSM editor. All writes are local; publication is through an exported .osc.
import type { Map as LibreMap } from 'maplibre-gl'
import { BASE_URL, EDIT_PATH } from './config'
import { isEditMode } from './editMode'
import { setLocalRouteEdits } from './localEdits'
import { loadSearchIndex, matchPlaces, type PlaceEntry } from './searchIndex'
import { parsePath, renderPhotoBlock } from './photos'
import { createPathEditor, stringifyPath } from './editing/photoPath'
import { gradeSuggestions, isValidGrade, routeGradeColor } from './grades'
import { EditGraph, fatherKind, groupKind, isBoulder, isRoute, keyOf, type Element, type Key, type Position } from './editing/model'
import { OsmReader } from './editing/osm'
import { EditingMap, type Snap, type ContextTarget } from './editing/map'
import { MapContextMenu, type ContextAction } from './editing/context-menu'

const graph = new EditGraph()
const reader = new OsmReader(graph)
// The viewer renders route lists through a no-op resolver; install the real
// one so in-memory edits show up there while the editor is loaded.
setLocalRouteEdits(props => {
  const e = graph.get(`node/${Number(props.osm_id)}`)
  return e ? { ...props, ...e.tags } : props
})
const sidebar = document.getElementById('sidebar')!
const content = document.getElementById('sidebar-content')!
const DRAFT_KEY = 'openbouldermap.editor.v1'
const BACKGROUND_KEY = 'openbouldermap.editor.background'
type EditorBackground = 'map' | 'satellite'
let editingMap: EditingMap | undefined
let selected: Key | undefined
let busy = false
let draftSaved = true
let toolbar: HTMLElement | undefined
let visibleLoad: Promise<void> | undefined
const visibleLoaded = new Set<Key>()
const visibleFailed = new Set<Key>()
let reviewDialog: HTMLDialogElement | undefined
let contextMenu: MapContextMenu | undefined

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag); el.textContent = text; el.className = className; return el
}
function button(text: string, action: () => void, className = ''): HTMLButtonElement {
  const b = node('button', text, `editor-action ${className}`); b.type = 'button'; b.addEventListener('click', action); return b
}
function message(_text: string): void { syncToolbar() }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
async function run(action: () => Promise<void> | void): Promise<boolean> {
  if (busy) return false
  busy = true; syncToolbar(); content.inert = true
  try { await action(); return true }
  catch (error) { message(errorMessage(error)); window.alert(errorMessage(error)); return false }
  finally { busy = false; content.inert = false; syncToolbar(); editingMap?.render() }
}
function saveDraft(): void {
  try {
    if (graph.changes().length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ graph: graph.serialize(), references: reader.serializeReferences() }))
    else localStorage.removeItem(DRAFT_KEY)
    draftSaved = true
  } catch { draftSaved = false; message('Draft could not be saved in this browser. Export before leaving, or discard your changes.') }
}
graph.onChange = () => { editingMap?.render(); syncToolbar(); saveDraft() }

function setEditorBackground(map: LibreMap, background: EditorBackground): void {
  // The map may still be parsing its style when the editor chunk loads.
  if (!map.isStyleLoaded()) return
  // The OpenFreeMap basemap is a group of vector layers; toggle them together.
  for (const layer of map.getStyle().layers) {
    if (!layer.id.startsWith('basemap-')) continue
    map.setLayoutProperty(layer.id, 'visibility', background === 'map' ? 'visible' : 'none')
  }
  if (map.getLayer('satellite-raster')) map.setLayoutProperty('satellite-raster', 'visibility', background === 'satellite' ? 'visible' : 'none')
  const satelliteAttribution = document.getElementById('satellite-attribution')
  if (satelliteAttribution) satelliteAttribution.hidden = background !== 'satellite'
}

export function initEditorButton(map: LibreMap): void {
  const toggle = document.getElementById('edit-toggle') as HTMLButtonElement
  const exportButton = document.getElementById('osc-toggle') as HTMLButtonElement
  const editing = isEditMode()
  toggle.textContent = editing ? '✕' : '✎'
  toggle.title = editing ? 'Discard local changes and leave edit mode' : 'Edit OpenStreetMap features'
  toggle.setAttribute('aria-label', toggle.title)
  toggle.classList.toggle('editing', editing)
  // The edit entry button only belongs on the editor page; the viewer is
  // reachable strictly by navigating to /edit (or the GitHub Pages redirect).
  toggle.hidden = !editing
  exportButton.hidden = !editing
  exportButton.title = 'Review local changes and download an OSM changefile'
  toggle.addEventListener('click', async () => {
    if (busy) return
    if (editing) {
      if (!confirm('Leave edit mode and discard ALL local changes and the saved draft? This cannot be undone. Download your .osc file first if you want to keep the changes.')) return
      const discarded = await run(async () => {
        await visibleLoad?.catch(() => {})
        // Remove the recoverable copy before throwing away the in-memory edits.
        localStorage.removeItem(DRAFT_KEY)
        contextMenu?.close(); editingMap?.cancel(); graph.discard(); graph.base = {}
        reader.reset(); visibleLoaded.clear(); visibleFailed.clear(); selected = undefined
        editingMap?.select(undefined)
      })
      if (!discarded) return
    }
    location.assign(`${editing ? BASE_URL : EDIT_PATH}${location.hash}`)
  })
  exportButton.addEventListener('click', showReview)
  if (!editing) return

  const backgroundLabel = node('label', '', 'editor-background')
  const background = node('select', '', 'editor-background-select')
  background.setAttribute('aria-label', 'Map background')
  for (const [value, label] of [['map', 'Street map'], ['satellite', 'Satellite imagery']] as const) {
    const option = node('option', label); option.value = value; background.append(option)
  }
  try { background.value = localStorage.getItem(BACKGROUND_KEY) === 'satellite' ? 'satellite' : 'map' } catch { background.value = 'map' }
  const applyBackground = () => setEditorBackground(map, background.value as EditorBackground)
  background.addEventListener('change', () => {
    applyBackground()
    try { localStorage.setItem(BACKGROUND_KEY, background.value) } catch { /* The control still works without persistence. */ }
  })
  backgroundLabel.append(background)
  document.getElementById('editor-controls')!.insertBefore(backgroundLabel, toggle)
  // The persisted choice is read before MapLibre necessarily has its style
  // layers. Apply it now for attribution, then again once the map is ready.
  applyBackground()
  if (!map.isStyleLoaded()) map.once('load', applyBackground)

  contextMenu = new MapContextMenu()
  toolbar = node('div', '', 'geometry-toolbar')
  toolbar.setAttribute('aria-label', 'Editing tools')
  const tools: [string, string, () => void][] = [
    ['route', '+ Route', () => void run(async () => { await loadVisible(); editingMap?.setTool('route') })],
    ['rock', '+ Rock', () => editingMap?.setTool('boulder')],
    ['sector', '+ Boulder', () => void run(() => createGroup('sector'))],
    ['area', '+ Area', () => void run(() => createGroup('area'))],
    ['cancel', 'Cancel action', () => editingMap?.cancel()],
    ['undo', 'Undo', () => { editingMap?.cancel(); graph.undo(); renderSelected() }],
    ['redo', 'Redo', () => { editingMap?.cancel(); graph.redo(); renderSelected() }],
    ['find', 'Find boulder / area', () => findGroup()]
  ]
  const icons: Record<string, string> = { undo: '↶', redo: '↷' }
  for (const [id, title, action] of tools) {
    const b = button(icons[id] ?? title, () => { if (!busy) action() })
    b.className = `edit-toggle editor-tool${icons[id] ? ' editor-tool-icon' : ''}`
    b.title = title; b.setAttribute('aria-label', title); b.dataset.tool = id
    toolbar.append(b)
  }
  document.getElementById('editor-controls')!.insertBefore(toolbar, toggle)
  try {
    const saved = localStorage.getItem(DRAFT_KEY)
    if (saved) {
      if (confirm('Restore your unpublished OpenBoulderMap editing draft? Cancel discards the saved draft.')) {
        const draft = JSON.parse(saved)
        reader.restoreReferences(draft.references)
        graph.restore(draft.graph)
        message('Draft restored. Original OSM versions will be checked before export. Nothing has been published.')
      } else localStorage.removeItem(DRAFT_KEY)
    }
  } catch (error) { draftSaved = false; message(`Could not restore draft: ${errorMessage(error)}. Use ✕ to discard the draft and leave edit mode.`) }
  window.addEventListener('beforeunload', event => {
    if ((!draftSaved && graph.changes().length) || busy || editingMap?.drawing.length || document.querySelector('dialog[open] details[open], .editor-backdrop')) { event.preventDefault(); event.returnValue = '' }
  })
  window.addEventListener('keydown', event => {
    if (busy || document.querySelector('dialog[open], .editor-backdrop, .map-context-menu') || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
    if (event.key === 'Escape') editingMap?.cancel()
    if (event.key === 'Enter' && editingMap?.tool === 'boulder') editingMap.finish()
    if (event.key === 'Backspace' && editingMap?.tool === 'boulder') { event.preventDefault(); editingMap.drawing.pop(); editingMap.render() }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); editingMap?.cancel(); event.shiftKey ? graph.redo() : graph.undo(); renderSelected()
    }
  })
  syncToolbar()
}
function createGroup(kind: 'sector' | 'area'): void {
  let key: Key | undefined
  graph.transaction(`Create ${kind === 'sector' ? 'boulder' : 'area'}`, () => { key = keyOf(graph.createGroup(kind, '', '')) })
  if (key) selectLocal(key)
}
function syncToolbar(): void {
  const count = graph.changes().length
  document.getElementById('osc-count')!.textContent = String(count)
  for (const b of toolbar?.querySelectorAll('button') ?? []) {
    b.disabled = busy || b.dataset.tool === 'undo' && !graph.undoLabel || b.dataset.tool === 'redo' && !graph.redoLabel
    if (b.dataset.tool === 'cancel') b.hidden = !editingMap || editingMap.tool === 'select'
    if (b.dataset.tool === 'route' || b.dataset.tool === 'rock') b.setAttribute('aria-pressed', String((b.dataset.tool === 'rock' ? 'boulder' : 'route') === editingMap?.tool))
    if (b.dataset.tool === 'undo') b.title = graph.undoLabel ?? 'Nothing to undo'
    if (b.dataset.tool === 'redo') b.title = graph.redoLabel ?? 'Nothing to redo'
  }
  ;(document.getElementById('osc-toggle') as HTMLButtonElement).disabled = busy
  ;(document.getElementById('edit-toggle') as HTMLButtonElement).disabled = busy
  toolbar?.classList.toggle('is-busy', busy)
}
export function initEditorMap(map: LibreMap): void {
  if (!isEditMode()) return
  editingMap = new EditingMap(map, graph, {
    canInteract: () => !busy && !document.querySelector('dialog[open], .editor-backdrop'),
    message,
    loadVisible: () => { void loadVisible().catch(error => message(`Could not load snapping geometry: ${errorMessage(error)}. Select a boulder to retry.`)) },
    select: key => void select(key),
    context: target => openObjectMenu(target),
    dismissContext: () => contextMenu?.close(),
    vertex: (way, vertex) => renderVertex(way, vertex),
    createRoute: (p, snap) => void run(async () => {
      await prepareSnap(snap)
      let key: Key | undefined
      graph.transaction('Create route', () => { key = keyOf(graph.addRoute(p)); if (snap) graph.attach(key, snap.way, snap.segment, snap.position, snap.vertex) })
      editingMap!.setTool('select'); selectLocal(key!)
    }),
    createBoulder: points => void run(() => {
      if (points.length < 3) throw new Error('Place at least three perimeter corners before finishing')
      let key: Key | undefined
      graph.transaction('Create boulder', () => { key = keyOf(graph.addBoulder(points)) })
      editingMap!.setTool('select'); selectLocal(key!)
    }),
    moveNode: (key, p, snap) => run(async () => {
      await reader.geometry([key]); await prepareSnap(snap)
      graph.transaction(snap ? 'Attach route to boulder' : 'Move shared vertex / route', () => {
        if (snap) graph.attach(key, snap.way, snap.segment, snap.position, snap.vertex)
        else graph.moveNode(key, p)
      }); renderSelected()
    }),
    moveBoulder: (key, dx, dy) => run(async () => {
      const nodes = [...new Set(graph.rings(key).flatMap(w => w.nodes!))].map(id => `node/${id}` as Key)
      await reader.geometry(nodes)
      graph.transaction('Move entire boulder and attached routes', () => graph.moveBoulder(key, dx, dy)); editingMap!.setTool('select'); renderSelected()
    }),
    insert: (way, segment, p) => void run(() => {
      let id = 0
      graph.transaction('Insert perimeter vertex', () => { id = graph.insertVertex(way, segment, p) })
      editingMap!.vertexSelection = { way, node: `node/${id}` }; renderVertex(way, `node/${id}`)
    })
  })
}
function openObjectMenu(target: ContextTarget): void {
  if (busy || !contextMenu || !editingMap) return
  const token = contextMenu.open(target.x, target.y)
  void run(async () => {
    await reader.select(target.key)
    if (!contextMenu!.isOpen(token)) return
    let key = target.key, way = target.way
    let feature = graph.require(key)
    // A right-click on an unselected boulder's actual corner targets that vertex,
    // even though its editing handles were not visible before the click.
    if (isBoulder(feature) && feature.type !== 'node') {
      const snap = editingMap!.snapAt(target.position)
      if (snap?.vertex !== undefined && graph.rings(key).some(ring => keyOf(ring) === snap.way)) {
        key = `node/${snap.vertex}`; way = snap.way
        await reader.select(key)
        if (!contextMenu!.isOpen(token)) return
        feature = graph.require(key)
      }
    }
    const actions: ContextAction[] = []
    let title = feature.tags.name || key
    if (isRoute(feature)) {
      selected = key; editingMap!.select(key); renderSelected()
      title = feature.tags.name || 'Climbing route'
      if (graph.attached(key).length) actions.push({ label: 'Detach from boulder', run: () => void run(async () => {
        await reader.geometry([key])
        graph.transaction('Detach route from boulder', () => graph.detach(key)); renderSelected()
        message('Detached. Drag the route away freely; hold Alt to prevent snapping elsewhere.')
      }) })
      actions.push({ label: 'Delete climbing route', danger: true, run: () => deleteSelected(key) })
    } else if (feature.type === 'node' && way) {
      const ring = graph.require(way)
      const owner = isBoulder(ring) ? ring : graph.parents(way).find(isBoulder)
      if (!owner) throw new Error('This vertex does not belong to an editable rock.')
      selected = keyOf(owner); editingMap!.select(selected)
      editingMap!.vertexSelection = { way, node: key }; renderVertex(way, key)
      title = 'Rock perimeter vertex'
      const ringKey = way
      actions.push({ label: 'Delete perimeter vertex', danger: true, run: () => void run(async () => {
        await reader.references(key)
        graph.transaction('Remove perimeter vertex', () => graph.removeVertex(ringKey, key))
        editingMap!.vertexSelection = undefined; renderSelected()
      }) })
    } else if (isBoulder(feature) && feature.type !== 'node') {
      selected = key; editingMap!.select(key); renderSelected()
      title = feature.tags.name || 'Rock'
      actions.push({ label: 'Move entire rock', run: () => editingMap!.setTool('move-boulder') },
        { label: 'Delete rock', danger: true, run: () => deleteSelected(key) })
    }
    if (contextMenu!.isOpen(token)) contextMenu!.fill(title, actions)
  }).then(success => { if (!success && contextMenu?.isOpen(token)) contextMenu.close() })
}

async function loadVisible(): Promise<void> {
  if (!editingMap || !editingMap.map.getLayer('edit-vertices')) return
  if (visibleLoad) return visibleLoad
  const map = editingMap.map
  // Only load physical boulders currently visible. Relations are loaded in full,
  // including ring nodes, before being offered as snap targets.
  const keys = [...new Set(map.queryRenderedFeatures({ layers: ['boulder', 'boulder-label'] }).map(f => `${f.properties.osm_type}/${f.properties.osm_id}` as Key))].filter(k => /^(way|relation)\/\d+$/.test(k) && !visibleLoaded.has(k) && !visibleFailed.has(k))
  if (!keys.length) return
  visibleLoad = (async () => {
    const failures: string[] = []
    for (const key of keys) {
      try { await reader.select(key); visibleLoaded.add(key) }
      catch (error) { visibleFailed.add(key); failures.push(`${key}: ${errorMessage(error)}`) }
    }
    editingMap?.render()
    if (failures.length) throw new Error(failures.join('\n'))
  })()
  try { await visibleLoad } finally { visibleLoad = undefined }
}
async function prepareSnap(snap?: Snap): Promise<void> {
  if (!snap) return
  await reader.load(snap.way, true)
  if (snap.vertex !== undefined) await reader.references(`node/${snap.vertex}`)
}
async function select(key: Key): Promise<void> {
  await run(async () => {
    message(`Loading current OSM data for ${key}…`)
    await reader.select(key)
    visibleFailed.delete(key)
    selectLocal(key)
    const e = graph.require(key), map = editingMap?.map
    let position: Position | undefined
    if (e.type === 'node') position = [e.lon!, e.lat!]
    else if (isBoulder(e)) {
      try {
        const points = graph.rings(key).flatMap(w => w.nodes!.slice(0, -1).map(id => graph.position(id)))
        position = [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length]
      } catch { /* Unsupported geometry remains available in the details panel. */ }
    }
    if (map && position && (!map.getBounds().contains(position) || map.getZoom() < 17)) map.flyTo({ center: position, zoom: 19 })
  })
}
function selectLocal(key: Key): void {
  selected = key; editingMap?.setTool('select'); editingMap?.select(key); renderSelected()
  message(`${key} · Local changes only. Drag selected vertices; Alt disables snapping. Detach routes before independent movement.`)
}
export function showRouteEditor(props: Record<string, any>, _lon: number, _lat: number): void {
  void select(`${props.osm_type ?? 'node'}/${Number(props.osm_id)}` as Key)
}
export function showBoulderEditor(props: Record<string, any>, _lon: number, _lat: number): void {
  void select(`${props.osm_type ?? 'way'}/${Number(props.osm_id)}` as Key)
}
function beginPanel(title: string): void { content.replaceChildren(node('h1', title, 'route-name')); sidebar.classList.remove('hidden') }
function textField(parent: HTMLElement, label: string, value: string, onChange: (value: string) => void, multiline = false): HTMLInputElement | HTMLTextAreaElement {
  const wrap = node('label', '', 'editor-field'), title = node('span', label, 'editor-field-label')
  const input = multiline ? node('textarea') : node('input')
  input.className = multiline ? 'editor-textarea' : 'editor-input'; input.value = value
  if (input instanceof HTMLTextAreaElement) input.rows = 3
  input.addEventListener('input', () => {
    if (busy) return
    try { onChange(input.value) } catch (error) { message(errorMessage(error)); alert(errorMessage(error)); input.value = value }
  })
  wrap.append(title, input); parent.append(wrap); return input
}
function renderSelected(): void {
  if (!selected || !graph.get(selected)) {
    selected = undefined; editingMap?.select(undefined); beginPanel('Edit mode'); content.append(node('p', 'Select a feature, create one, or review your local changes.')); return
  }
  const key = selected, e = graph.require(key), kind = groupKind(e)
  const title = isRoute(e) ? 'route' : isBoulder(e) ? 'rock' : kind === 'sector' ? (cragHasRock(key) ? 'boulder' : 'sector') : kind
  if (!title) { beginPanel('Unsupported feature'); content.append(node('p', 'This object is not a supported climbing feature. Use JOSM to edit it.')); return }
  beginPanel(`Edit ${title}`)
  content.append(node('p', `${key}${e.version ? ` · OSM version ${e.version}` : ' · new local feature'} · not published`, 'muted'))
  const form = node('div', '', 'editor-form'); content.append(form)
  const editTag = (tag: string, v: string) => graph.transaction(`Edit ${title} ${tag}`, () => graph.setTags(key, { [tag]: v }), `${key}:${tag}`)
  textField(form, 'Name', e.tags.name ?? '', v => editTag('name', v))
  textField(form, 'Description', e.tags.description ?? '', v => editTag('description', v), true)
  if (isRoute(e)) {
    const gradeSystems: Array<{ tag: string; label: string }> = [
      { tag: 'climbing:grade:font', label: 'Font' },
      { tag: 'climbing:grade:hueco', label: 'Hueco' }
    ]
    const gradeWrap = node('div', '', 'editor-field')
    gradeWrap.append(node('span', 'Grade', 'editor-field-label'))
    const gradeRow = node('div', '', 'editor-grade')
    const gradeSystem = node('select', '', 'editor-input editor-grade-system')
    gradeSystem.setAttribute('aria-label', 'Grade system')
    for (const system of gradeSystems) { const option = node('option', system.label); option.value = system.tag; gradeSystem.append(option) }
    const gradeList = node('datalist')
    gradeList.id = `grade-values-${Math.random().toString(36).slice(2)}`
    const gradeInput = node('input', '', 'editor-input editor-grade-value')
    gradeInput.placeholder = 'e.g. 6A+ / V3'
    gradeInput.setAttribute('aria-label', 'Grade value')
    gradeInput.setAttribute('list', gradeList.id)
    const gradeError = node('span', '', 'editor-grade-error')
    const setInvalid = (invalid: boolean) => {
      gradeInput.classList.toggle('invalid', invalid)
      gradeError.textContent = invalid ? `Enter a valid ${gradeSystem.selectedOptions[0]?.textContent ?? 'grade'} grade.` : ''
    }
    const fillSuggestions = () => {
      gradeList.replaceChildren()
      for (const value of gradeSuggestions(gradeSystem.value)) { const option = document.createElement('option'); option.value = value; gradeList.append(option) }
    }
    const syncGradeInput = () => {
      gradeInput.value = graph.require(key).tags[gradeSystem.value] ?? ''
      setInvalid(false)
      fillSuggestions()
    }
    gradeSystem.addEventListener('change', syncGradeInput)
    gradeInput.addEventListener('input', () => {
      if (busy) return
      const tag = gradeSystem.value, current = graph.require(key).tags[tag] ?? '', value = gradeInput.value.trim().toUpperCase()
      if (!value) {
        setInvalid(false)
        if (current) try { editTag(tag, '') } catch (error) { message(errorMessage(error)); alert(errorMessage(error)); gradeInput.value = current }
        return
      }
      if (!isValidGrade(tag, value)) { setInvalid(true); return }
      setInvalid(false)
      if (value === current) return
      try { editTag(tag, value) } catch (error) { message(errorMessage(error)); alert(errorMessage(error)); gradeInput.value = current }
    })
    gradeInput.addEventListener('blur', () => {
      if (!gradeInput.classList.contains('invalid')) return
      setInvalid(false)
      gradeInput.value = graph.require(key).tags[gradeSystem.value] ?? ''
    })
    syncGradeInput()
    gradeRow.append(gradeSystem, gradeInput, gradeList)
    gradeWrap.append(gradeRow, gradeError)
    form.append(gradeWrap)
    const startLabel = node('label', 'Start type', 'editor-field'), start = node('select', '', 'editor-input')
    const values = [...new Set(['', 'sit', 'stand', 'crouch', e.tags['climbing:start'] ?? ''])]
    for (const v of values) { const o = node('option', v || 'Unknown'); o.value = v; start.append(o) }
    start.value = e.tags['climbing:start'] ?? ''; start.addEventListener('change', () => {
      try { editTag('climbing:start', start.value) } catch (error) { alert(errorMessage(error)); start.value = graph.require(key).tags['climbing:start'] ?? '' }
    }); startLabel.append(start); form.append(startLabel)
    const photo = node('div', '', 'editor-photo-area')
    let photoTimer: ReturnType<typeof setTimeout> | undefined
    textField(form, 'Wikimedia Commons photograph', e.tags.wikimedia_commons ?? e.tags.image ?? '', v => {
      graph.transaction('Edit route photograph', () => graph.setTags(key, { wikimedia_commons: normalizeImage(v), ...(!v.trim() ? { image: '' } : {}) }), `${key}:photo`)
      clearTimeout(photoTimer)
      photoTimer = setTimeout(() => { if (photo.isConnected && graph.get(key)) renderPhoto(photo, key) }, 400)
    })
    form.append(photo); renderPhoto(photo, key)
    const attached = graph.attached(key)
    form.append(node('h2', 'Rock outline', 'sector-routes-title'))
    if (attached.length) {
      for (const w of attached) {
        const owner = isBoulder(w) ? w : graph.parents(keyOf(w)).find(isBoulder) ?? w
        form.append(button(`Attached to ${owner.tags.name || keyOf(owner)}`, () => void select(keyOf(owner))))
      }
      form.append(node('p', 'Moving this route also reshapes the rock. Right-click the route to detach it or delete it.', 'muted'))
    } else form.append(node('p', 'Independent route. Drop onto a rock edge to attach; hold Alt to keep it independent.', 'muted'))
    renderFather(form, key)
  } else if (isBoulder(e)) {
    if (e.type === 'node') form.append(node('p', 'Legacy point rock: details only. Creating point rocks and converting them to outlines are outside this editor’s scope.'))
    else {
      try {
        const rings = graph.rings(key)
        form.append(node('p', 'Drag a vertex to reshape. Click a small midpoint to insert a vertex. Right-click an ordinary vertex to remove it, or right-click the rock to delete it.', 'muted'))
        form.append(button('Move entire rock', () => editingMap?.setTool('move-boulder')))
        const routes = [...new Set(rings.flatMap(w => w.nodes!))].flatMap(id => { const n = graph.get(`node/${id}`); return isRoute(n) ? [n!] : [] })
        form.append(node('h2', 'Attached routes', 'sector-routes-title'))
        for (const route of routes) form.append(button(route.tags.name || keyOf(route), () => void select(keyOf(route))))
      } catch (error) { form.append(node('p', errorMessage(error), 'editor-warning')) }
    }
    renderFather(form, key)
  } else if (kind) {
    renderChildren(form, key, e, kind)
    renderFather(form, key)
  }
  if (kind) form.append(button(`Delete ${title}`, () => deleteSelected(key), 'danger'))
  if (e.id > 0) {
    const link = node('a', 'View object on OpenStreetMap', 'osm-link'); link.href = `https://www.openstreetmap.org/${key}`; link.target = '_blank'; link.rel = 'noopener'; content.append(link)
  }
}
function renderVertex(way: Key, vertex: Key): void {
  beginPanel('Rock perimeter vertex')
  content.append(node('p', vertex), node('p', 'Drag this point to reshape the rock. Right-click it and choose Delete perimeter vertex to connect its neighbours.'))
  content.append(button('Back to feature', renderSelected))
}
function cragHasRock(key: Key): boolean {
  const e = graph.get(key)
  return !!e?.members?.some(m => isBoulder(graph.get(`${m.type}/${m.ref}`)))
}
function renderChildren(form: HTMLElement, key: Key, e: Element, kind: 'sector' | 'area'): void {
  const members = (e.members ?? []).map(m => graph.get(`${m.type}/${m.ref}`)).filter(Boolean) as Element[]
  const section = (title: string, items: Element[], empty: string) => {
    form.append(node('h2', title, 'sector-routes-title'))
    if (items.length) for (const item of items) form.append(button(item.tags.name || keyOf(item), () => void select(keyOf(item))))
    else form.append(node('p', empty, 'muted'))
  }
  if (kind === 'sector') {
    section('Rocks', members.filter(isBoulder), 'No rocks. Draw one (+ Rock), then set its Boulder to this one.')
    section('Problems', members.filter(isRoute), 'No problems. Draw one (+ Route), then set its Boulder to this one.')
  } else {
    section('Sub-areas', members.filter(m => groupKind(m) === 'area'), 'No sub-areas. Create one (+ Area), then set its Area to this one.')
    section('Boulders', members.filter(m => groupKind(m) === 'sector'), 'No boulders. Create one (+ Boulder), then set its Area to this one.')
  }
}
/** The single, uniform parent control shown on every object. */
function renderFather(form: HTMLElement, key: Key): void {
  const kind = fatherKind(graph.get(key))
  if (!kind) return
  const label = kind === 'sector' ? 'Boulder' : 'Area'
  const parent = label.toLowerCase()
  const groups = graph.parentGroups(key)
  form.append(node('h2', label, 'sector-routes-title'))
  if (groups.length > 1) form.append(node('p', `Conflicting ${parent} memberships: choose one parent or unlink all before export.`, 'editor-warning'))
  if (!groups.length) form.append(node('p', `No ${parent} assigned.`, 'muted'))
  for (const group of groups) form.append(button(group.tags.name || keyOf(group), () => void select(keyOf(group))))
  form.append(button(`${groups.length ? 'Change' : 'Choose / create'} ${parent}`, () => parentPicker(kind, choice => run(async () => {
    await prepareChoice(choice)
    graph.transaction(`${groups.length ? 'Change' : 'Assign'} ${parent}`, () => graph.assign(key, materialize(choice)))
    renderSelected()
  }))))
  if (groups.length) form.append(button(`Unlink ${parent}`, () => void run(() => { graph.transaction(`Unlink ${parent}`, () => graph.assign(key)); renderSelected() })))
}
function deleteSelected(key: Key): void {
  const e = graph.require(key), kind = groupKind(e)
  const effect = isRoute(e) ? 'Delete this climbing route? If attached, an ordinary rock vertex will remain. Unrelated node information will be preserved.' : isBoulder(e) ? 'Delete this mapped rock from OSM? Its routes will remain as independent points, retaining their boulder membership.' : kind === 'sector' ? 'Delete only this boulder relationship? Its rocks and routes remain, without a boulder assignment.' : 'Delete only this area relationship? Its sub-areas and boulders remain, unassigned.'
  if (!confirm(effect)) return
  void run(async () => {
    await reader.prepareDelete(key)
    const attached = isRoute(e) ? graph.attached(key)[0] : undefined
    graph.transaction(`Delete ${kind ?? (isRoute(e) ? 'route' : 'boulder')}`, () => graph.deleteFeature(key))
    if (attached && graph.get(key)) {
      const owner = isBoulder(attached) ? attached : graph.parents(keyOf(attached)).find(isBoulder)
      if (owner) selectLocal(keyOf(owner))
      editingMap!.vertexSelection = { way: keyOf(attached), node: key }
      renderVertex(keyOf(attached), key)
      message('Route deleted locally; the ordinary perimeter vertex remains. You can remove it separately or undo the deletion.')
    } else renderSelected()
  })
}
function normalizeImage(v: string): string {
  const match = v.trim().match(/\/wiki\/(File:[^?#]+)/i)
  if (match) { try { return decodeURIComponent(match[1]).replace(/_/g, ' ') } catch { return v.trim() } }
  return v.trim().replace(/^file:/i, 'File:')
}
function renderPhoto(container: HTMLElement, key: Key): void {
  container.replaceChildren()
  const e = graph.require(key), image = e.tags.wikimedia_commons ?? e.tags.image ?? '', path = parsePath(e.tags['wikimedia_commons:path'])
  if (!image.startsWith('File:')) { container.append(node('p', 'Set a File:… Commons photograph to preview or draw the route line.', 'muted')); return }
  container.append(renderPhotoBlock(image, path.length ? [{ points: path, color: routeGradeColor(e.tags) }] : []))
  container.append(button(path.length ? 'Edit photo route line' : 'Add photo route line', () => void run(async () => {
    const sector = graph.sectors(key)[0]
    if (sector) await reader.load(keyOf(sector), true)
    const others = graph.all().filter(n => isRoute(n) && keyOf(n) !== key && (n.tags.wikimedia_commons ?? n.tags.image ?? '').replace(/_/g, ' ') === image.replace(/_/g, ' '))
      .map(n => parsePath(n.tags['wikimedia_commons:path'])).filter(p => p.length > 1)
    createPathEditor(image, path, {
      onDone: points => { graph.transaction('Edit photo route line', () => graph.setTags(key, { 'wikimedia_commons:path': stringifyPath(points) })); renderPhoto(container, key) },
      onCancel: () => {}
    }, others)
  })))
}

interface Choice { key?: Key; kind: 'sector' | 'area'; name?: string; description?: string }
function dialog(title: string): HTMLDialogElement {
  const d = node('dialog', '', 'editing-dialog'); d.append(node('h2', title))
  d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); return d
}
/** New parents remain form drafts until the final choice commits one atomic action. */
function parentPicker(kind: 'sector' | 'area', choose: (choice: Choice) => void | boolean | Promise<void | boolean>): void {
  const label = kind === 'sector' ? 'boulder' : 'area'
  const d = dialog(`Choose ${label}`)
  let pending = false
  d.addEventListener('cancel', event => { if (pending) event.preventDefault() })
  const closeWith = async (choice: Choice) => {
    if (pending) return
    pending = true; d.inert = true
    try { if (await choose(choice) !== false) d.close() }
    catch (error) { alert(errorMessage(error)) }
    finally { pending = false; d.inert = false }
  }
  let chosen: Element | undefined
  const search = searchBox(d, kind, e => { chosen = e }, { immediate: false, onReset: () => { chosen = undefined } })
  // Keep the inline creation form visible without an extra discovery click; the
  // note inside still asks users to search first. A new parent is created empty:
  // navigate to it afterwards to give it a father of its own.
  const create = node('details'); create.open = true; create.append(node('summary', `Create missing ${label}`)); d.append(create)
  create.append(node('p', 'Search existing matches first to avoid duplicates. This parent is only created when you confirm linking.', 'muted'))
  let name = '', description = ''
  textField(create, 'Name', '', v => { name = v })
  textField(create, 'Description', '', v => { description = v }, true)
  const actions = node('div', '', 'dialog-actions')
  actions.append(
    button('OK', () => void closeWith(chosen ? { key: keyOf(chosen), kind, name: chosen.tags.name } : { kind, name, description })),
    button('Cancel', () => d.close())
  )
  d.append(actions); search.focus()
}
interface SearchOptions { immediate?: boolean; onReset?: () => void }
function searchBox(parent: HTMLElement, kind: 'sector' | 'area', choose: (e: Element) => void, options: SearchOptions = {}): HTMLInputElement {
  const input = node('input', '', 'editor-input'); input.placeholder = `Search ${kind === 'sector' ? 'boulder' : 'area'} by name`; input.setAttribute('aria-label', input.placeholder)
  const results = node('div', '', 'parent-results')
  let request = 0
  let selectedRow: HTMLElement | undefined
  const renderResults = (found: Element[], resetSelection = false) => {
    results.replaceChildren()
    if (resetSelection) { selectedRow = undefined; options.onReset?.() }
    for (const e of found) {
      const details = [keyOf(e), e.members ? `${e.members.length} members` : '', e.tags.description || ''].filter(Boolean).join(' · ')
      const row = node('div', '', 'parent-result')
      row.append(button(`${e.tags.name || `Unnamed ${kind}`} · ${details}`, () => {
        if (options.immediate === false) {
          selectedRow?.classList.remove('selected')
          row.classList.add('selected'); selectedRow = row
        }
        choose(e)
      }))
      if (e.id > 0) {
        const link = node('a', 'View on OSM'); link.href = `https://www.openstreetmap.org/${keyOf(e)}`; link.target = '_blank'; link.rel = 'noopener'; row.append(link)
      }
      results.append(row)
    }
  }
  // Existing features come from the static search index, so discovery works
  // even when Overpass is unavailable. The picked object is then loaded from
  // the OSM API by the caller.
  const asElement = (entry: PlaceEntry): Element => ({
    type: entry.osm === 'r' ? 'relation' : entry.osm === 'w' ? 'way' : 'node',
    id: entry.id,
    tags: { type: 'site', name: entry.name, climbing: entry.kind === 's' ? 'crag' : 'area', 'climbing:boulder': 'yes' },
    ...(entry.osm === 'n' ? { lon: entry.lon, lat: entry.lat } : {})
  })
  const search = async () => {
    const token = ++request
    const query = input.value.trim()
    const local = graph.all().filter(e => groupKind(e) === kind)
    renderResults(local, true)
    if (query.length < 2) { results.append(node('p', 'Enter at least two characters to search OpenStreetMap by name. Local objects are listed above.', 'muted')); return }
    const status = node('div', '', 'search-status')
    status.append(node('span', '', 'search-spinner'), node('span', 'Searching… Local matches above are available now.', 'muted'))
    results.append(status)
    results.setAttribute('aria-busy', 'true')
    try {
      const list = await loadSearchIndex()
      if (token !== request || !parent.isConnected) return
      const localKeys = new Set(local.map(keyOf))
      const matches = matchPlaces(list, query, kind === 'sector' ? 's' : 'a').filter(entry => !localKeys.has(keyOf(asElement(entry))))
      const remote = matches.slice(0, 50).map(asElement)
      renderResults([...local, ...remote])
      if (!local.length && !remote.length) results.append(node('p', 'No matches found.'))
      else if (matches.length > remote.length) results.append(node('p', 'Showing up to 50 matches. Refine the name to narrow your search.', 'muted'))
    } catch (error) {
      if (token === request && parent.isConnected) { renderResults(local); results.append(node('p', errorMessage(error), 'editor-warning')) }
    } finally {
      if (token === request) results.removeAttribute('aria-busy')
    }
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void search() } })
  parent.append(input, button('Search', () => void search()), results)
  void search() // Show local (in-session) objects straight away.
  return input
}
async function prepareChoice(choice: Choice): Promise<void> {
  if (choice.key) await reader.select(choice.key)
}
function materialize(choice: Choice): Key {
  if (choice.key) return choice.key
  return keyOf(graph.createGroup(choice.kind, choice.name ?? '', choice.description ?? ''))
}
function findGroup(): void {
  const d = dialog('Find an existing boulder or area')
  d.append(node('h3', 'Boulders')); searchBox(d, 'sector', e => { d.close(); void select(keyOf(e)) })
  d.append(node('h3', 'Areas')); searchBox(d, 'area', e => { d.close(); void select(keyOf(e)) })
  d.append(button('Close', () => d.close()))
}
function showReview(): void {
  if (busy) return
  reviewDialog?.close(); reviewDialog = dialog('Review unpublished local changes')
  const d = reviewDialog
  d.append(node('p', 'Downloading does not publish to OpenStreetMap. Open the file in JOSM to validate, review conflicts, and upload. Your local draft is retained after downloading.'))
  const changes = graph.changes()
  if (!changes.length) d.append(node('p', 'No local changes.'))
  for (const c of changes) {
    const details = node('details', '', 'change-entry')
    details.append(node('summary', `${c.action.toUpperCase()} ${c.key} · ${(c.after ?? c.before)!.tags.name || 'Unnamed'}`))
    if (c.before && c.after) {
      const notes: string[] = []
      if (c.before.lon !== c.after.lon || c.before.lat !== c.after.lat) notes.push('Location moved (shared outlines may also change).')
      if (JSON.stringify(c.before.nodes) !== JSON.stringify(c.after.nodes)) notes.push('Perimeter vertices / route attachment changed.')
      if (JSON.stringify(c.before.members) !== JSON.stringify(c.after.members)) notes.push('Relationship membership changed.')
      if (JSON.stringify(c.before.tags) !== JSON.stringify(c.after.tags)) notes.push('Details or feature classification changed.')
      details.append(node('p', notes.join(' ')))
    }
    const diff = node('pre', JSON.stringify({ before: c.before ?? null, after: c.after ?? null }, null, 2)); details.append(diff); d.append(details)
  }
  const issues = graph.validate()
  for (const issue of issues) d.append(node('p', issue, 'editor-warning'))
  for (const warning of graph.warnings()) d.append(node('p', warning, 'editor-warning'))
  const status = node('p', '', 'muted'), download = button('Check current OSM data and download .osc', () => void run(async () => {
    download.disabled = true; status.textContent = 'Checking versions and references against live OSM. Nothing is being uploaded…'
    try {
      await reader.preflight()
      const xml = graph.exportOsc(), url = URL.createObjectURL(new Blob([xml], { type: 'application/x-osm+xml;charset=utf-8' }))
      const a = node('a'); a.href = url; a.download = 'openbouldermap.osc'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      status.textContent = 'Changefile downloaded. Not published: review and upload it through JOSM. Local draft retained.'
    } catch (error) { status.textContent = errorMessage(error); throw error }
    finally { download.disabled = false }
  }))
  download.disabled = !changes.length || !!issues.length
  d.append(status, download, button('Close', () => { if (!busy) d.close() }))
  d.addEventListener('cancel', event => { if (busy) event.preventDefault() })
}
