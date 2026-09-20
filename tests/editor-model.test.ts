import test from 'node:test'
import assert from 'node:assert/strict'
import { EditGraph, isRoute, keyOf, validRing, type Element, type Key } from '../src/editing/model.ts'

const n = (id: number, lon: number, lat: number, tags = {}): Element => ({ type: 'node', id, lon, lat, version: 1, tags })
const routeTags = { climbing: 'route_bottom', 'climbing:boulder': 'yes', sport: 'climbing', name: 'Test route', 'climbing:grade:font': '7A' }
function fixture(): EditGraph {
  const g = new EditGraph()
  g.ingest([n(1, 0, 0, routeTags), n(2, 1, 0), n(3, 1, 1), n(4, 0, 1), n(5, 2, 0, { ...routeTags, name: 'Independent' }),
    { type: 'way', id: 1, version: 3, nodes: [1, 2, 3, 4, 1], tags: { climbing: 'boulder', natural: 'stone', sport: 'climbing', name: 'Rock', source: 'survey' } },
    { type: 'relation', id: 1, version: 2, members: [{ type: 'node', ref: 1, role: 'problem' }, { type: 'node', ref: 5, role: '' }], tags: { type: 'site', climbing: 'crag', 'climbing:boulder': 'yes', name: 'Sector', website: 'https://example.com' } },
    { type: 'relation', id: 2, version: 1, members: [{ type: 'relation', ref: 1, role: '' }], tags: { type: 'site', climbing: 'area', 'climbing:boulder': 'yes', name: 'Area' } }
  ])
  return g
}

test('moving a shared route changes the perimeter; whole boulder moves each node once', () => {
  const g = fixture()
  g.transaction('move route', () => g.moveNode('node/1', [-0.1, 0]))
  assert.deepEqual(g.position(g.require('way/1').nodes![0]), [-0.1, 0])
  g.transaction('move boulder', () => g.moveBoulder('way/1', 2, 3))
  assert.deepEqual(g.position(1), [1.9, 3]); assert.deepEqual(g.position(5), [2, 0])
  assert.equal(g.sectors('node/1')[0].id, 1)
  g.undo(); assert.deepEqual(g.position(1), [-0.1, 0]); g.redo(); assert.deepEqual(g.position(1), [1.9, 3])
})
test('detach keeps the route identity and sector, leaves one closed ordinary vertex', () => {
  const g = fixture()
  g.transaction('detach', () => g.detach('node/1'))
  const ids = g.require('way/1').nodes!
  assert.equal(ids[0], ids.at(-1)); assert.ok(ids[0] < 0); assert.equal(g.attached('node/1').length, 0)
  assert.deepEqual(g.require(`node/${ids[0]}`).tags, {})
  assert.equal(g.sectors('node/1')[0].id, 1)
  g.transaction('move freely', () => g.moveNode('node/1', [-1, -1])); assert.deepEqual(g.position(ids[0]), [0, 0])
  g.undo(); g.undo(); assert.deepEqual(g.require('way/1').nodes, [1, 2, 3, 4, 1])
})
test('snap onto edge inserts the route; snap onto ordinary vertex joins instead of duplicating', () => {
  const g = fixture()
  g.transaction('attach edge', () => g.attach('node/5', 'way/1', 1, [1, .5]))
  assert.deepEqual(g.require('way/1').nodes, [1, 2, 5, 3, 4, 1]); assert.equal(g.attached('node/5').length, 1)
  g.undo()
  g.transaction('join vertex', () => g.attach('node/5', 'way/1', 1, [1, 0], 2))
  assert.deepEqual(g.require('way/1').nodes, [1, 5, 3, 4, 1]); assert.equal(g.get('node/2'), undefined)
  assert.equal(g.require('node/5').tags.name, 'Independent'); assert.equal(g.sectors('node/5')[0].id, 1)
  assert.match(g.exportOsc(), /<delete>/)
})
test('joining occupied or tagged vertices never merges data', () => {
  const g = fixture(), before = g.serialize()
  assert.throws(() => g.transaction('bad join', () => g.attach('node/5', 'way/1', 0, [0, 0], 1)), /another route/)
  assert.equal(g.serialize(), before)
  g.transaction('tag vertex', () => g.setTags('node/2', { survey_point: 'yes' }))
  assert.throws(() => g.transaction('bad join', () => g.attach('node/5', 'way/1', 0, [1, 0], 2)), /other tags or references/)
})
test('delete attached route preserves outline vertex and unrelated tags, then vertex can be removed', () => {
  const g = fixture()
  g.transaction('unrelated tag', () => g.setTags('node/1', { survey_point: 'yes' }))
  g.transaction('delete route', () => g.deleteFeature('node/1'))
  assert.deepEqual(g.require('node/1').tags, { survey_point: 'yes' }); assert.equal(g.sectors('node/1').length, 0)
  assert.deepEqual(g.require('way/1').nodes, [1, 2, 3, 4, 1])
  g.transaction('remove vertex', () => g.removeVertex('way/1', 'node/1'))
  assert.deepEqual(g.require('way/1').nodes, [2, 3, 4, 2]); assert.ok(g.get('node/1'))
})
test('delete independent route removes point but never its sector', () => {
  const g = fixture(); g.transaction('delete', () => g.deleteFeature('node/5'))
  assert.equal(g.get('node/5'), undefined); assert.equal(g.require('relation/1').members!.length, 1)
})
test('delete boulder preserves routes and memberships and cleans unreferenced geometry', () => {
  const g = fixture(); g.transaction('delete boulder', () => g.deleteFeature('way/1'))
  assert.equal(g.get('way/1'), undefined); assert.ok(isRoute(g.get('node/1'))); assert.equal(g.get('node/2'), undefined)
  assert.equal(g.sectors('node/1')[0].id, 1)
  g.undo(); assert.ok(g.get('node/2')); assert.equal(g.attached('node/1').length, 1)
})
test('delete sector and area removes only grouping, not children', () => {
  const g = fixture(); g.transaction('delete sector', () => g.deleteFeature('relation/1'))
  assert.equal(g.require('relation/2').members!.length, 0); assert.ok(g.get('node/1')); assert.equal(g.sectors('node/1').length, 0)
  g.undo(); g.transaction('delete area', () => g.deleteFeature('relation/2'))
  assert.ok(g.get('relation/1')); assert.equal(g.sectors('node/1').length, 1); assert.equal(g.areas('relation/1').length, 0)
})
test('parent deletion refuses unrelated relations and vertex removal refuses routes', () => {
  const g = fixture()
  g.ingest([{ type: 'relation', id: 99, version: 1, tags: { type: 'collection' }, members: [{ type: 'way', ref: 1, role: 'rock' }] }])
  assert.throws(() => g.transaction('delete', () => g.deleteFeature('way/1')), /parent references/)
  assert.throws(() => g.transaction('remove vertex', () => g.removeVertex('way/1', 'node/1')), /Detach or delete/)
})
test('inline creation and assignment is atomic; rocks, routes and areas link by father', () => {
  const g = fixture(); let sector: Key, area: Key
  g.transaction('create hierarchy', () => {
    area = keyOf(g.createGroup('area', 'New area', 'Description'))
    sector = keyOf(g.createGroup('sector', 'New sector', 'Description'))
    g.assign(sector, area); g.assign('node/1', sector); g.assign('way/1', sector)
  })
  assert.equal(g.sectors('node/1')[0].id, Number(sector!.split('/')[1]))
  assert.equal(g.sectors('node/5')[0].id, 1)
  assert.equal(g.areas(sector!)[0].tags.name, 'New area')
  assert.deepEqual(g.parentGroups('way/1').map(e => e.id), [Number(sector!.split('/')[1])])
  g.undo(); assert.equal(g.get(sector!), undefined); assert.equal(g.get(area!), undefined); assert.equal(g.sectors('node/1')[0].id, 1)
  g.redo(); assert.equal(g.areas(sector!)[0].tags.name, 'New area')
})

test('areas nest by father; cycles and excessive depth are refused', () => {
  const g = fixture(); let a: Key, b: Key, c: Key
  g.transaction('nest', () => {
    a = keyOf(g.createGroup('area', 'A', ''))
    b = keyOf(g.createGroup('area', 'B', ''))
    c = keyOf(g.createGroup('area', 'C', ''))
    g.assign(b, a); g.assign(c, b)
  })
  assert.equal(g.parentGroups(c!)[0].tags.name, 'B')
  assert.throws(() => g.transaction('cycle', () => g.assign(a, c!)), /cycle/)
  assert.throws(() => g.transaction('self', () => g.assign(a, a!)), /cycle/)
  // Six nested levels would exceed the build cap of rank 5.
  const deep = new EditGraph(); const ids: Key[] = []
  deep.transaction('deep', () => { for (let i = 0; i < 6; i++) ids.push(keyOf(deep.createGroup('area', `L${i}`, ''))) })
  deep.transaction('link', () => { for (let i = 1; i < 6; i++) deep.assign(ids[i], ids[i - 1]) })
  let extra: Key = 'relation/-1'
  deep.transaction('extra', () => { extra = keyOf(deep.createGroup('area', 'Extra', '')) })
  assert.throws(() => deep.transaction('too deep', () => deep.assign(extra, ids[5])), /build limit/)
})
test('invalid outlines roll back all geometry changes including temporary nodes', () => {
  const g = fixture(), before = g.serialize()
  assert.throws(() => g.transaction('cross edges', () => g.moveNode('node/2', [-1, .5])), /Invalid boulder/)
  assert.equal(g.serialize(), before)
  assert.throws(() => g.transaction('create invalid', () => g.addBoulder([[0, 0], [1, 1], [0, 1], [1, 0]])), /Invalid boulder/)
  assert.equal(g.serialize(), before)
  assert.equal(validRing([[0, 0], [1, 0], [2, 0], [0, 0]]), false)
})
test('OSM identities include type; untouched tags, member roles and versions survive export', () => {
  const g = fixture()
  g.transaction('rename', () => { g.setTags('way/1', { name: 'Rock & <Friends>' }); g.setTags('relation/1', { description: 'Test' }) })
  const osc = g.exportOsc()
  assert.match(osc, /version="3"/); assert.match(osc, /Rock &amp; &lt;Friends&gt;/)
  assert.match(osc, /k="source" v="survey"/); assert.match(osc, /role="problem"/)
  assert.match(osc, /k="website" v="https:\/\/example.com"/); assert.equal(g.require('node/1').tags.name, 'Test route')
})
test('new then deleted objects are not exported; negative dependencies undo coherently', () => {
  const g = new EditGraph(); let rock: Key, route: Key
  g.transaction('create', () => {
    rock = keyOf(g.addBoulder([[0, 0], [1, 0], [1, 1]])); route = keyOf(g.addRoute([.5, 0])); g.attach(route, rock, 0, [.5, 0])
  })
  assert.match(g.exportOsc(), /<create>/); assert.doesNotMatch(g.exportOsc(), /<modify>|<delete>/)
  g.transaction('delete route', () => g.deleteFeature(route!)); g.transaction('delete rock', () => g.deleteFeature(rock!))
  assert.equal(g.changes().length, 0)
  g.undo(); g.undo(); assert.equal(g.attached(route!).length, 1)
  g.undo(); assert.equal(g.changes().length, 0)
})
test('downloads loaded after edits do not disappear on undo; pinned originals never update silently', () => {
  const g = fixture(); g.transaction('rename', () => g.setTags('node/1', { name: 'Changed' }))
  g.ingest([n(999, 10, 10), { ...n(1, 99, 99, { name: 'Remote' }), version: 9 }])
  g.undo(); assert.ok(g.get('node/999')); assert.equal(g.require('node/1').version, 1); assert.deepEqual(g.position(1), [0, 0])
})
test('closed multipolygon rings move together, preserve holes, and reject a hole outside its outer ring', () => {
  const g = new EditGraph()
  g.ingest([
    n(1, 0, 0), n(2, 10, 0), n(3, 10, 10), n(4, 0, 10),
    n(5, 2, 2, routeTags), n(6, 4, 2), n(7, 3, 4),
    { type: 'way', id: 1, version: 1, tags: {}, nodes: [1, 2, 3, 4, 1] },
    { type: 'way', id: 2, version: 1, tags: {}, nodes: [5, 6, 7, 5] },
    { type: 'relation', id: 1, version: 1, tags: { type: 'multipolygon', climbing: 'boulder', natural: 'stone' }, members: [{ type: 'way', ref: 1, role: 'outer' }, { type: 'way', ref: 2, role: 'inner' }] }
  ])
  assert.equal(g.attached('node/5')[0].id, 2)
  g.transaction('whole rock', () => g.moveBoulder('relation/1', 1, 1)); assert.deepEqual(g.position(5), [3, 3])
  const before = g.serialize()
  assert.throws(() => g.transaction('invalid hole', () => g.moveNode('node/5', [12, 12])), /Invalid multipolygon/)
  assert.equal(g.serialize(), before)
  g.transaction('delete rock', () => g.deleteFeature('relation/1'))
  assert.equal(g.get('way/1'), undefined); assert.equal(g.get('way/2'), undefined); assert.ok(isRoute(g.get('node/5')))
})
test('coordinate precision is validated before export and typed details coalesce into a single undo', () => {
  const g = fixture()
  g.transaction('typing', () => g.setTags('node/1', { name: 'A' }), 'name')
  g.transaction('typing', () => g.setTags('node/1', { name: 'AB' }), 'name')
  g.undo(); assert.equal(g.require('node/1').tags.name, 'Test route')
  g.redo(); assert.equal(g.require('node/1').tags.name, 'AB')
  assert.throws(() => g.transaction('tiny polygon', () => g.addBoulder([[0, 0], [.00000001, 0], [0, .00000001]])), /Invalid boulder/)
})
test('draft round trip retains history and discard clears all local changes', () => {
  const g = fixture(); g.transaction('detach', () => g.detach('node/1'))
  const restored = new EditGraph(); restored.restore(g.serialize())
  assert.equal(restored.exportOsc(), g.exportOsc()); restored.undo(); assert.equal(restored.changes().length, 0)
  restored.redo(); assert.equal(restored.attached('node/1').length, 0); restored.discard(); assert.equal(restored.changes().length, 0)
  assert.equal(restored.undoLabel, undefined)
})
