import test from 'node:test'
import assert from 'node:assert/strict'
import { matchPlaces, normalize } from '../src/searchIndex.ts'
import { parseHierarchy } from '../src/hierarchy.ts'

// Shape mirrors scripts/build-hierarchy.py output.
const raw = {
  version: 1,
  areas: [
    [3, 'Gottardo', 0, -1, 8.558, 46.568, [4], [2], 1],
    [4, 'Sub area', 1, 3, 8.56, 46.57, [], [], 0]
  ],
  sectors: [
    [2, 'Gotthard Bouldering', 3, 8.56, 46.565, 'w/42', [0]],
    [5, 'No Rock Sector', 4, 8.561, 46.571, null, []]
  ],
  problems: [
    ['Tremola', 14201076723, 2, 8.5845, 46.6587, '7B', '', '', '', '', '', '', '', 'sit']
  ]
}

test('builds the area path and full problem context', () => {
  const hierarchy = parseHierarchy(raw)
  const problem = hierarchy.searchEntries.find(entry => entry.kind === 'p')!
  assert.equal(problem.name, 'Tremola')
  assert.equal(problem.font, '7B')
  assert.equal(problem.hueco, undefined)
  assert.deepEqual(problem.path, ['Gottardo', 'Gotthard Bouldering'])

  const nested = hierarchy.searchEntries.find(entry => entry.id === 4)!
  assert.deepEqual(nested.path, ['Gottardo'], 'nested area keeps its ancestor path')
  assert.deepEqual(hierarchy.areaPath(4).map(area => area.name), ['Gottardo', 'Sub area'])
  assert.equal(hierarchy.areaById.get(4)!.band, 0, 'deepest area is band 0')
  assert.equal(hierarchy.areaById.get(3)!.band, 1, 'the level above is band 1')
})

test('a boulder relation with a rock is labelled Boulder, without one Sector', () => {
  const hierarchy = parseHierarchy(raw)
  const boulder = hierarchy.searchEntries.find(entry => entry.id === 2)!
  const sector = hierarchy.searchEntries.find(entry => entry.id === 5)!
  assert.equal(boulder.groupLabel, 'Boulder')
  assert.equal(sector.groupLabel, 'Sector')
})

test('sector problems are exposed as indices into the problem list', () => {
  const hierarchy = parseHierarchy(raw)
  const boulder = hierarchy.sectorById.get(2)!
  assert.deepEqual(boulder.problems, [0])
  assert.equal(hierarchy.problems[boulder.problems[0]].name, 'Tremola')
})

test('matches substrings case- and accent-insensitively, filtered by kind', () => {
  const entries = parseHierarchy(raw).searchEntries
  assert.deepEqual(matchPlaces(entries, 'trem').map(entry => entry.name), ['Tremola'])
  assert.deepEqual(matchPlaces(entries, 'gott', 's').map(entry => entry.name), ['Gotthard Bouldering'])
  assert.deepEqual(matchPlaces(entries, 'GÖTT', 'a').map(entry => entry.name), ['Gottardo'])
  assert.deepEqual(matchPlaces(entries, '   '), [])
  assert.equal(normalize('Café'), 'cafe')
})
