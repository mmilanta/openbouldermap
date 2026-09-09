import test from 'node:test'
import assert from 'node:assert/strict'
import { EditingMap } from '../src/editing/map.ts'
import { EditGraph, type Position } from '../src/editing/model.ts'

// A synchronous map double records every submitted frame, including frames too
// short to reliably catch with screenshots. The safety check stays asynchronous.
function setup() {
  const originalWindow = globalThis.window
  const target = new EventTarget()
  globalThis.window = target as unknown as Window & typeof globalThis
  const handlers = new Map<string, (...args: any[]) => any>()
  const sources = new Map<string, any>(), frames: Position[] = []
  const graph = new EditGraph()
  graph.ingest([
    ...[[1, 1], [3, 1], [3, 3], [1, 3]].map(([lon, lat], i) => ({ type: 'node' as const, id: i + 1, version: 1, lon, lat, tags: {} })),
    { type: 'way', id: 10, version: 1, tags: { climbing: 'boulder', natural: 'stone' }, nodes: [1, 2, 3, 4, 1] }
  ])
  let whole = false
  const map = {
    on: (event: string, handler: (...args: any[]) => any) => { handlers.set(event, handler) },
    doubleClickZoom: { disable() {} }, dragPan: { enable() {}, disable() {} },
    addSource: (id: string) => sources.set(id, {
      setData(data: any) {
        if (id === 'edit-features') {
          const boulder = data.features.find((f: any) => f.properties.key === 'way/10')
          if (boulder) frames.push([...boulder.geometry.coordinates[0][0]] as Position)
        }
      }
    }),
    getSource: (id: string) => sources.get(id), addLayer() {},
    getStyle: () => ({ layers: [] }), getCanvas: () => ({ style: {} }),
    project: (p: Position) => ({ x: p[0] * 100, y: p[1] * 100 }),
    queryRenderedFeatures: (_point: unknown, { layers }: { layers: string[] }) =>
      !whole && layers.includes('edit-vertices') ? [{ properties: { handle: 'vertex', key: 'node/1', way: 'way/10' } }]
        : whole && layers.includes('edit-boulders') ? [{ properties: { key: 'way/10' } }] : []
  }
  const finished: Position[][] = [], messages: string[] = []
  let resolve!: () => void, reject!: (error: Error) => void
  const safetyCheck = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  const editor = new EditingMap(map as any, graph, {
    select() {}, context() {}, dismissContext() {}, vertex() {}, insert() {}, createRoute() {},
    createBoulder: points => { finished.push(points); editor.setTool('select') },
    moveNode: async (key, p) => { await safetyCheck; graph.transaction('Move vertex', () => graph.moveNode(key, p)) },
    moveBoulder: async (key, dx, dy) => { await safetyCheck; graph.transaction('Move boulder', () => graph.moveBoulder(key, dx, dy)); editor.setTool('select') },
    message: text => messages.push(text), loadVisible() {}, canInteract: () => true
  })
  graph.onChange = () => editor.render()
  handlers.get('load')!(); editor.select('way/10')
  const event = (x: number, y: number) => ({ point: { x, y }, lngLat: { lng: x / 100, lat: y / 100 }, originalEvent: { button: 0, altKey: false }, preventDefault() {} })
  return {
    graph, editor, frames, finished, messages, resolve, reject,
    emit: (name: string, x: number, y: number) => handlers.get(name)!(event(x, y)),
    whole: () => { whole = true; editor.setTool('move-boulder') },
    blur: () => target.dispatchEvent(new Event('blur')),
    cleanup: () => { globalThis.window = originalWindow }
  }
}

for (const endpoint of ['first', 'last'] as const) test(`clicking the ${endpoint} corner closes an outline without adding a duplicate`, () => {
  const s = setup()
  try {
    s.editor.setTool('boulder')
    for (const p of [[100, 100], [300, 100], [300, 300]]) s.emit('click', p[0], p[1])
    s.emit('click', endpoint === 'first' ? 102 : 298, endpoint === 'first' ? 101 : 301)
    assert.deepEqual(s.finished, [[[1, 1], [3, 1], [3, 3]]])
    assert.equal(s.editor.tool, 'select')
  } finally { s.cleanup() }
})

test('clicking an endpoint with fewer than three corners does not add a duplicate or close', () => {
  const s = setup()
  try {
    s.editor.setTool('boulder'); s.emit('click', 100, 100); s.emit('click', 100, 100)
    s.emit('click', 300, 100); s.emit('click', 100, 100)
    assert.deepEqual(s.editor.drawing, [[1, 1], [3, 1]])
    assert.equal(s.finished.length, 0)
    assert.match(s.messages.at(-1)!, /at least three/)
  } finally { s.cleanup() }
})

for (const whole of [false, true]) test(`${whole ? 'whole-boulder' : 'vertex'} preview remains at the drop position during first-use safety checks`, async () => {
  const s = setup()
  try {
    if (whole) s.whole()
    s.emit('mousedown', 100, 100); s.emit('mousemove', 80, 100)
    const frameCount = s.frames.length
    const pending = s.emit('mouseup', 80, 100)
    s.blur() // Browser blur must not clear an in-flight commit preview either.
    s.editor.render() // Background OSM loading may trigger additional renders.
    assert.deepEqual(s.graph.position(1), [1, 1], 'Original graph remains unchanged until checks pass')
    assert.deepEqual(s.frames.at(-1), [.8, 1], 'Preview must not flash back to the original location')
    s.resolve(); await pending
    assert.deepEqual(s.graph.position(1), [.8, 1])
    assert.ok(s.frames.slice(frameCount).every(p => p[0] === .8 && p[1] === 1))
  } finally { s.cleanup() }
})

test('failed movement safety check restores the original geometry after retaining its pending preview', async () => {
  const s = setup()
  try {
    s.emit('mousedown', 100, 100); s.emit('mousemove', 80, 100)
    const pending = s.emit('mouseup', 80, 100)
    assert.deepEqual(s.frames.at(-1), [.8, 1])
    s.reject(new Error('Reference check failed')); await pending
    assert.deepEqual(s.frames.at(-1), [1, 1]); assert.equal(s.graph.changes().length, 0)
    assert.match(s.messages.at(-1)!, /Reference check failed/)
  } finally { s.cleanup() }
})
