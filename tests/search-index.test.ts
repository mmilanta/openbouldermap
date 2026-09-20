import test from 'node:test'
import assert from 'node:assert/strict'
import { matchPlaces, normalize, parseSearchIndex, type SearchIndex } from '../src/searchIndex.ts'

const index: SearchIndex = {
  parents: [['Gotthard Bouldering', 'Gottardo']],
  rows: [
    ['Tremola', 'p', 'n', 14201076723, 8.5845, 46.6587, '7B', '', 0],
    ['Gotthard Bouldering (Parking)', 's', 'r', 2, 8.56, 46.565],
    ['Gottardo', 'a', 'r', 3, 8.558, 46.568]
  ]
}

test('parses problems with grades and deduplicated parent context', () => {
  const [problem, sector, area] = parseSearchIndex(index)
  assert.equal(problem.name, 'Tremola')
  assert.equal(problem.kind, 'p')
  assert.equal(problem.font, '7B')
  assert.equal(problem.hueco, undefined)
  assert.equal(problem.sector, 'Gotthard Bouldering')
  assert.equal(problem.area, 'Gottardo')
  assert.equal(sector.kind, 's')
  assert.equal(area.kind, 'a')
})

test('still accepts the legacy bare-array index format', () => {
  const entries = parseSearchIndex([['Legacy', 's', 'r', 9, 1, 2]])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].name, 'Legacy')
  assert.equal(entries[0].sector, undefined)
})

test('matches substrings case- and accent-insensitively, filtered by kind', () => {
  const entries = parseSearchIndex(index)
  assert.deepEqual(matchPlaces(entries, 'trem').map(entry => entry.name), ['Tremola'])
  assert.deepEqual(matchPlaces(entries, 'gott', 's').map(entry => entry.name), ['Gotthard Bouldering (Parking)'])
  assert.deepEqual(matchPlaces(entries, 'GÖTT', 'a').map(entry => entry.name), ['Gottardo'])
  assert.deepEqual(matchPlaces(entries, '   '), [])
  assert.equal(normalize('Café'), 'cafe')
})
