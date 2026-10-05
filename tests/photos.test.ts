import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePath, pathSegments } from '../src/photos.ts'
import { stringifyPath } from '../src/editing/photoPath.ts'

test('mixed solid and dotted photo paths survive a round trip', () => {
  const points = [
    { x: 0.1, y: 0.2, dotted: false },
    { x: 0.3, y: 0.4, dotted: true },
    { x: 0.5, y: 0.6, dotted: true },
    { x: 0.7, y: 0.8, dotted: false }
  ]
  const serialized = stringifyPath(points)
  assert.equal(serialized, '0.10,0.20:|0.30,0.40:|0.50,0.60|0.70,0.80')
  assert.deepEqual(parsePath(serialized), points)
  assert.deepEqual(parsePath('0.1,0.2b:|0.3,0.4a'), points.slice(0, 2))
  assert.deepEqual(parsePath('0.1,0.2|:0.3,0.4'), points.slice(0, 2))
})

test('render runs cover each segment once and keep styles at transitions', () => {
  const points = parsePath('0.1,0.2|0.2,0.3:|0.3,0.4:|0.4,0.5|0.5,0.6')
  assert.deepEqual(pathSegments(points), [
    { points: points.slice(0, 2), dotted: false },
    { points: points.slice(1, 4), dotted: true },
    { points: points.slice(3, 5), dotted: false }
  ])
  assert.deepEqual(pathSegments([]), [])
  assert.deepEqual(pathSegments(points.slice(0, 1)), [])
})
