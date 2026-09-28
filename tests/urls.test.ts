import test from 'node:test'
import assert from 'node:assert/strict'
import { safeExternalUrl } from '../src/urls.ts'

test('only http(s) URLs from OSM tags become links', () => {
  assert.equal(safeExternalUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(safeExternalUrl('http://example.com'), 'http://example.com/')
  assert.equal(safeExternalUrl(' www.example.com/topo '), 'https://www.example.com/topo')
  assert.equal(safeExternalUrl('javascript:alert(1)'), undefined)
  assert.equal(safeExternalUrl('JavaScript:alert(1)'), undefined)
  assert.equal(safeExternalUrl('data:text/html,<script>alert(1)</script>'), undefined)
  assert.equal(safeExternalUrl('" onmouseover="alert(1)'), undefined)
  assert.equal(safeExternalUrl('not a url'), undefined)
  assert.equal(safeExternalUrl(''), undefined)
  assert.equal(safeExternalUrl(undefined), undefined)
  // Quotes survive only percent-encoded, never as attribute breakers.
  assert.ok(!safeExternalUrl('https://example.com/"><img src=x>')!.includes('"'))
})
