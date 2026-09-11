import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyLive, toLiveFeatures, type OverpassElement } from '../src/editing/live.ts'

test('classifies live climbing objects with the same rules as the tile schema', () => {
  assert.equal(classifyLive({ type: 'node', id: 1, tags: { climbing: 'route_bottom' } }), 'route')
  assert.equal(classifyLive({ type: 'node', id: 2, tags: { climbing: 'boulder', natural: 'stone', sport: 'climbing' } }), 'boulder_point')
  assert.equal(classifyLive({ type: 'way', id: 3, tags: { climbing: 'boulder', natural: 'bare_rock', sport: 'climbing' } }), 'boulder')
  assert.equal(classifyLive({ type: 'relation', id: 4, tags: { type: 'site', climbing: 'crag', 'climbing:boulder': 'yes' } }), 'sector')
  assert.equal(classifyLive({ type: 'relation', id: 5, tags: { type: 'site', climbing: 'area', 'climbing:boulder': 'yes' } }), 'area')
  assert.equal(classifyLive({ type: 'way', id: 6, tags: { climbing: 'area', 'climbing:boulder': 'yes' } }), 'area')
  // Unrelated climbing tags must not be promoted to a bouldering feature.
  assert.equal(classifyLive({ type: 'node', id: 7, tags: { climbing: 'route_top' } }), undefined)
  assert.equal(classifyLive({ type: 'relation', id: 8, tags: { type: 'site', climbing: 'area' } }), undefined)
  assert.equal(classifyLive({ type: 'node', id: 9, tags: { climbing: 'area', 'climbing:boulder': 'yes' } }), undefined)
})

test('builds route points with grade color and a stable key', () => {
  const data = toLiveFeatures([
    { type: 'node', id: 42, lat: 46.42, lon: 8.84, tags: { climbing: 'route_bottom', name: 'Trieste', 'climbing:grade:font': '7C+' } }
  ])
  assert.equal(data.features.length, 1)
  const [feature] = data.features
  assert.equal(feature.geometry.type, 'Point')
  assert.deepEqual((feature.geometry as GeoJSON.Point).coordinates, [8.84, 46.42])
  assert.equal(feature.properties!.key, 'node/42')
  assert.equal(feature.properties!.osm_type, 'node')
  assert.equal(feature.properties!.osm_id, 42)
  assert.equal(feature.properties!.color, '#b71c1c')
})

test('closes boulder way rings into polygons', () => {
  const data = toLiveFeatures([
    { type: 'way', id: 10, tags: { climbing: 'boulder', natural: 'stone', sport: 'climbing' },
      geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }] }
  ])
  const geometry = data.features[0].geometry as GeoJSON.Polygon
  assert.deepEqual(geometry.coordinates[0], [[0, 0], [1, 0], [1, 1], [0, 0]])
})

test('represents site relations as centroid points', () => {
  const data = toLiveFeatures([
    { type: 'relation', id: 21057007, tags: { type: 'site', climbing: 'crag', 'climbing:boulder': 'yes', name: 'Paese' },
      members: [
        { type: 'node', ref: 1, role: '', lat: 10, lon: 20 },
        { type: 'node', ref: 2, role: '', lat: 20, lon: 40 }
      ] }
  ])
  const [feature] = data.features
  assert.equal(feature.properties!.kind, 'sector')
  assert.deepEqual((feature.geometry as GeoJSON.Point).coordinates, [30, 15])
})

test('assembles multipolygon boulders with inner rings from member geometry', () => {
  const ring = (a: number, b: number, c: number, d: number) => [
    { lat: a, lon: b }, { lat: a, lon: d }, { lat: c, lon: d }, { lat: c, lon: b }
  ]
  const data = toLiveFeatures([
    { type: 'relation', id: 11, tags: { type: 'multipolygon', climbing: 'boulder', natural: 'bare_rock', sport: 'climbing' },
      members: [
        { type: 'way', ref: 100, role: 'outer', geometry: ring(0, 0, 10, 10) },
        { type: 'way', ref: 101, role: 'inner', geometry: ring(2, 2, 4, 4) }
      ] }
  ])
  const geometry = data.features[0].geometry as GeoJSON.MultiPolygon
  assert.equal(geometry.coordinates.length, 1)
  assert.equal(geometry.coordinates[0].length, 2)
  assert.deepEqual(geometry.coordinates[0][0], [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])
  assert.deepEqual(geometry.coordinates[0][1], [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]])
})
