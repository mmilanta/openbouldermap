import test from 'node:test'
import assert from 'node:assert/strict'
import { archiveUrl, resilientProtocol } from '../src/pmtilesProtocol.ts'

const ARCHIVE = 'https://example.org/tiles/climbing.pmtiles'

function fakeProtocol(failures: number) {
  let calls = 0
  const tiles = new Map<string, unknown>([[ARCHIVE, {}]])
  const protocol = {
    tiles,
    tilev4: async () => {
      calls++
      if (calls <= failures) throw new TypeError('Failed to fetch')
      return { data: new Uint8Array([1]), cacheControl: undefined, expires: undefined }
    }
  }
  return { protocol: protocol as any, calls: () => calls, tiles }
}

const noSleep = async () => {}

test('archiveUrl strips the protocol and the tile coordinates', () => {
  assert.equal(archiveUrl(`pmtiles://${ARCHIVE}`), ARCHIVE)
  assert.equal(archiveUrl(`pmtiles://${ARCHIVE}/12/2140/1456.mvt`), ARCHIVE)
  assert.equal(archiveUrl(`pmtiles://${ARCHIVE}/0/0/0`), ARCHIVE)
})

test('a transient failure is retried with a fresh archive instance', async () => {
  const { protocol, calls, tiles } = fakeProtocol(1)
  const handler = resilientProtocol(protocol, { sleep: noSleep })
  const result = await handler({ url: `pmtiles://${ARCHIVE}`, type: 'json' }, new AbortController())
  assert.deepEqual(result.data, new Uint8Array([1]))
  assert.equal(calls(), 2)
  // The possibly poisoned header cache must be dropped before retrying.
  assert.equal(tiles.has(ARCHIVE), false)
})

test('gives up after the configured number of attempts', async () => {
  const { protocol, calls } = fakeProtocol(Infinity)
  const handler = resilientProtocol(protocol, { attempts: 3, sleep: noSleep })
  await assert.rejects(handler({ url: `pmtiles://${ARCHIVE}/1/0/0.mvt` }, new AbortController()), /Failed to fetch/)
  assert.equal(calls(), 3)
})

test('aborted requests are never retried', async () => {
  const { protocol, calls } = fakeProtocol(Infinity)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(resilientProtocol(protocol, { sleep: noSleep })({ url: `pmtiles://${ARCHIVE}/1/0/0.mvt` }, controller))
  assert.equal(calls(), 1)
})
