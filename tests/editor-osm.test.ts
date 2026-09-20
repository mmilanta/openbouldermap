import test from 'node:test'
import assert from 'node:assert/strict'
import { EditGraph, type Element } from '../src/editing/model.ts'
import { OsmReader } from '../src/editing/osm.ts'

const rock: Element = { type: 'way', id: 10, version: 1, tags: { climbing: 'boulder', natural: 'stone' }, nodes: [1, 2, 3, 1] }
const nodes: Element[] = [
  { type: 'node', id: 1, version: 1, lon: 0, lat: 0, tags: { climbing: 'route_bottom', name: 'Route' } },
  { type: 'node', id: 2, version: 1, lon: 1, lat: 0, tags: {} },
  { type: 'node', id: 3, version: 1, lon: 0, lat: 1, tags: {} }
]
async function mockApi(fn: (path: string, init?: RequestInit) => Element[] | number, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const result = fn(String(url).replace('https://api.openstreetmap.org/api/0.6/', ''), init)
    return typeof result === 'number' ? new Response('', { status: result }) : Response.json({ elements: result })
  }
  try { await run() } finally { globalThis.fetch = original }
}
const standard = (path: string): Element[] => {
  if (path.endsWith('/relations.json')) return []
  if (path.endsWith('/ways.json')) return [rock]
  if (path === 'way/10/full.json') return [rock, ...nodes]
  if (path === 'way/10.json') return [rock]
  if (path.startsWith('node/')) return nodes.filter(n => `node/${n.id}.json` === path)
  throw new Error(`Unexpected request ${path}`)
}

test('selecting a route discovers its shared boulder and full perimeter', async () => {
  await mockApi(standard, async () => {
    const g = new EditGraph(), reader = new OsmReader(g)
    await reader.select('node/1')
    assert.equal(g.attached('node/1')[0].id, 10); assert.deepEqual(g.position(3), [0, 1])
    await reader.geometry(['node/1'])
    g.transaction('move', () => g.moveNode('node/1', [-.1, 0]))
    await reader.preflight()
  })
})
test('moving geometry shared with unrelated ways is blocked', async () => {
  const path: Element = { ...rock, id: 11, tags: { highway: 'path' } }
  await mockApi(p => p === 'node/1/ways.json' ? [rock, path] : p === 'way/11/full.json' ? [path, ...nodes] : standard(p), async () => {
    const g = new EditGraph(), reader = new OsmReader(g)
    await reader.select('node/1')
    await assert.rejects(reader.geometry(['node/1']), /non-boulder geometry/)
    assert.equal(g.changes().length, 0)
  })
})
test('export preflight blocks changed OSM versions without discarding local work', async () => {
  let updated = false
  await mockApi(p => updated && p === 'node/1.json' ? [{ ...nodes[0], version: 2 }] : standard(p), async () => {
    const g = new EditGraph(), reader = new OsmReader(g)
    await reader.select('node/1'); g.transaction('rename', () => g.setTags('node/1', { name: 'Local name' })); updated = true
    await assert.rejects(reader.preflight(), /changed on OpenStreetMap/)
    assert.equal(g.require('node/1').tags.name, 'Local name'); assert.equal(g.require('node/1').version, 1)
  })
})
test('export preflight blocks newly added external references', async () => {
  let updated = false
  await mockApi(p => updated && p === 'node/1/ways.json' ? [rock, { ...rock, id: 99 }] : standard(p), async () => {
    const g = new EditGraph(), reader = new OsmReader(g)
    await reader.select('node/1'); g.transaction('detach', () => g.detach('node/1')); updated = true
    await assert.rejects(reader.preflight(), /references changed/)
  })
})
test('restored drafts preserve original reference snapshots for conflict detection', async () => {
  await mockApi(standard, async () => {
    const g = new EditGraph(), reader = new OsmReader(g)
    await reader.select('node/1'); g.transaction('detach', () => g.detach('node/1'))
    const restored = new EditGraph(), restoredReader = new OsmReader(restored)
    restored.restore(g.serialize()); restoredReader.restoreReferences(reader.serializeReferences())
    await restoredReader.preflight()
  })
})
test('deletion preflight handles removed nodes and never sends write requests', async () => {
  await mockApi((path, init) => { assert.ok(!init?.method || init.method === 'GET'); return standard(path) }, async () => {
    const g = new EditGraph(), reader = new OsmReader(g)
    await reader.prepareDelete('way/10'); g.transaction('delete boulder', () => g.deleteFeature('way/10'))
    await reader.preflight(); assert.match(g.exportOsc(), /<delete>/); assert.ok(g.get('node/1'))
  })
})
test('failed OSM requests remain retryable and never create partial local edits', async () => {
  let failing = true
  await mockApi(p => failing && p === 'node/1.json' ? 503 : standard(p), async () => {
    const g = new EditGraph(), reader = new OsmReader(g)
    await assert.rejects(reader.select('node/1'), /503/); assert.equal(g.changes().length, 0)
    failing = false; await reader.select('node/1'); assert.equal(g.attached('node/1').length, 1)
  })
})
