import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A small OSM fragment exercising the consensus model:
//   Göschenen (area) > Schöllenen (area) > Schöllenen Boulder (crag + rock)
//   Göschenen (area) > River (crag, no rock, and no `site=climbing`)
// plus one problem inside each crag.
const OPL = [
  'n101 v1 dV c1 t2020-01-01T00:00:00Z i1 uu Tclimbing=route_bottom,name=Problem%20A x8.5700 y46.6670',
  'n103 v1 dV c1 t2020-01-01T00:00:00Z i1 uu Tclimbing=route_bottom,name=Problem%20B x8.5800 y46.6600',
  'n104 v1 dV c1 t2020-01-01T00:00:00Z i1 uu x8.5810 y46.6610',
  'n105 v1 dV c1 t2020-01-01T00:00:00Z i1 uu x8.5820 y46.6610',
  'n106 v1 dV c1 t2020-01-01T00:00:00Z i1 uu x8.5820 y46.6600',
  'n107 v1 dV c1 t2020-01-01T00:00:00Z i1 uu x8.5810 y46.6600',
  'w500 v1 dV c1 t2020-01-01T00:00:00Z i1 uu Tclimbing=boulder,natural=bare_rock,sport=climbing Nn104,n105,n106,n107,n104',
  'r100 v1 dV c1 t2020-01-01T00:00:00Z i1 uu Tclimbing=crag,climbing:boulder=yes,name=River,type=site Mn101@',
  'r400 v1 dV c1 t2020-01-01T00:00:00Z i1 uu Tclimbing=crag,climbing:boulder=yes,name=Schöllenen%20Boulder,type=site Mn103@,w500@',
  'r200 v1 dV c1 t2020-01-01T00:00:00Z i1 uu Tclimbing=area,climbing:boulder=yes,name=Schöllenen,type=site Mr400@',
  'r300 v1 dV c1 t2020-01-01T00:00:00Z i1 uu Tclimbing=area,climbing:boulder=yes,name=Göschenen,type=site Mr100@,r200@'
].join('\n') + '\n'

function build() {
  const dir = mkdtempSync(join(tmpdir(), 'hierarchy-'))
  const sectors = join(dir, 'sectors.geojson')
  const boulders = join(dir, 'boulders.geojson')
  const index = join(dir, 'index.json')
  const result = spawnSync('python3', ['scripts/build-hierarchy.py', sectors, boulders, index], { input: OPL, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return {
    index: JSON.parse(readFileSync(index, 'utf8')),
    sectors: JSON.parse(readFileSync(sectors, 'utf8')),
    boulders: JSON.parse(readFileSync(boulders, 'utf8'))
  }
}

test('nests areas, ranks them, and links crags to their problems', () => {
  const { index } = build()
  const areas = new Map(index.areas.map((row: any[]) => [row[0], row]))
  const sectors = new Map(index.sectors.map((row: any[]) => [row[0], row]))

  const root = areas.get(300)
  assert.equal(root[2], 0, 'top-level area ranks 0')
  assert.equal(root[8], 1, 'band counts from the deepest level: top level is band 1')
  assert.deepEqual(root[6], [200], 'child area')
  assert.deepEqual(root[7], [100], 'direct crag')

  const nested = areas.get(200)
  assert.equal(nested[2], 1, 'nested area ranks 1')
  assert.equal(nested[8], 0, 'deepest area level is band 0')
  assert.equal(nested[3], 300, 'nested area keeps its canonical parent')

  const river = sectors.get(100)
  assert.equal(river[2], 300)
  assert.equal(river[5], null, 'crag without a rock member has no rock link')
  assert.deepEqual(river[6], [0], 'problem index')

  const boulder = sectors.get(400)
  assert.equal(boulder[5], 'w/500', 'rock member is linked to the crag')
  assert.deepEqual(boulder[6], [1])
})

test('emits ranked label points and physical-rock geometry', () => {
  const { sectors, boulders } = build()
  const byId = new Map(sectors.features.map((f: any) => [f.properties.osm_id, f.properties]))
  assert.equal(byId.get(300).rank, 0)
  assert.equal(byId.get(300).band, 1)
  assert.equal(byId.get(200).rank, 1)
  assert.equal(byId.get(200).band, 0)
  assert.equal(byId.get(100).rank, 1, 'crag ranks just below its area')
  assert.equal(byId.get(400).rank, 2)
  assert.equal(byId.get(400).has_rock, 1)
  assert.equal(byId.get(400).problem_count, 1)

  assert.equal(boulders.features.length, 1)
  assert.equal(boulders.features[0].properties.sector, 400)
  assert.equal(boulders.features[0].geometry.type, 'Polygon')
})
