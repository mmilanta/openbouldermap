import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Regression: bouldering site relations are valid even without `site=climbing`
// (e.g. Schöllenen). They must still be emitted and listed as area children, so
// the precomputed hierarchy matches the live OSM API query.
const OPL = [
  'n101 v1 dV c1 t2020-01-01T00:00:00Z i1 uu x8.5700 y46.6670',
  'n102 v1 dV c1 t2020-01-01T00:00:00Z i1 uu x8.5710 y46.6680',
  'n103 v1 dV c1 t2020-01-01T00:00:00Z i1 uu x8.5800 y46.6600',
  'n104 v1 dV c1 t2020-01-01T00:00:00Z i1 uu x8.5810 y46.6610',
  'r100 v1 dV c1 t2020-01-01T00:00:00Z i1 uu Tclimbing=crag,climbing:boulder=yes,name=River,site=climbing,type=site Mn101@,n102@',
  'r200 v1 dV c1 t2020-01-01T00:00:00Z i1 uu Tclimbing=crag,climbing:boulder=yes,name=Schöllenen,type=site Mn103@,n104@',
  'r300 v1 dV c1 t2020-01-01T00:00:00Z i1 uu Tclimbing=area,climbing:boulder=yes,name=Göschenen,site=climbing,type=site Mr100@,r200@'
].join('\n') + '\n'

test('extract-sectors keeps bouldering sites that omit site=climbing', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'sectors-')), 'sectors.geojson')
  const result = spawnSync('python3', ['scripts/extract-sectors.py', out], { input: OPL, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)

  const features = JSON.parse(readFileSync(out, 'utf8')).features as Array<{ properties: Record<string, any> }>
  const byName = new Map(features.map(feature => [feature.properties.name, feature.properties]))

  assert.ok(byName.has('River'), 'sector with site=climbing should be emitted')
  assert.ok(byName.has('Schöllenen'), 'sector without site=climbing should be emitted')

  const area = byName.get('Göschenen')
  assert.equal(area?.kind, 'area')
  const childNames = (JSON.parse(area!.sectors) as Array<{ name: string }>).map(child => child.name).sort()
  assert.deepEqual(childNames, ['River', 'Schöllenen'])
})
