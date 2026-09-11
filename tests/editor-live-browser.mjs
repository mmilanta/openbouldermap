// Verifies edit-mode live data. At close zoom the live climbing layers replace
// the daily snapshot in view; zooming out falls back to the snapshot without
// making any further Overpass requests. No OSM writes are performed.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const base = process.env.EDITOR_TEST_URL || 'http://127.0.0.1:5198/openbouldermap/'
const server = process.env.EDITOR_TEST_URL ? undefined : spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5198', '--strictPort'], { stdio: 'pipe' })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
let primaryQueries = 0
let mirrorQueries = 0
let browser
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) break } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', e => { errors.push(e.message); console.error(e) })
  await page.route('https://tile.openstreetmap.org/**', r => r.fulfill({ contentType: 'image/png', body: PNG }))
  await page.route('https://demotiles.maplibre.org/**', r => r.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) }))
  await page.route('https://api.openstreetmap.org/**', r => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  // The primary mirror is down; the loader must fail over to another mirror.
  await page.route('https://overpass-api.de/api/interpreter', route => { primaryQueries++; return route.abort('failed') })
  await page.route('https://overpass.kumi.systems/api/interpreter', async route => {
    mirrorQueries++
    await route.fulfill({ json: { elements: [
      { type: 'node', id: 900001, lat: 0, lon: 0, tags: { climbing: 'route_bottom', name: 'Live route', 'climbing:grade:font': '7A' } }
    ] } })
  })
  await page.goto(`${base}edit#16/0/0`)
  await page.waitForFunction(() => window.__map?.getLayer('live-route'))
  // Live data replaces the snapshot for the visible view, despite the primary outage.
  await page.waitForFunction(() => window.__map.getLayoutProperty('live-route', 'visibility') === 'visible')
  assert.equal(await page.evaluate(() => window.__map.getLayoutProperty('route', 'visibility')), 'none')
  assert.match(await page.locator('.editor-live-status').textContent(), /Live/)
  assert.ok(primaryQueries >= 1 && mirrorQueries >= 1, 'Primary must fail over to a mirror')
  // Zooming out must fall back to the snapshot and stop querying Overpass.
  const primaryAtCloseZoom = primaryQueries, mirrorAtCloseZoom = mirrorQueries
  await page.evaluate(() => window.__map.jumpTo({ center: [0, 0], zoom: 4 }))
  await page.waitForFunction(() => window.__map.getLayoutProperty('route', 'visibility') === 'visible')
  assert.equal(await page.evaluate(() => window.__map.getLayoutProperty('live-route', 'visibility')), 'none')
  await page.waitForTimeout(700)
  assert.equal(primaryQueries, primaryAtCloseZoom, 'Zoomed-out views must not query Overpass')
  assert.equal(mirrorQueries, mirrorAtCloseZoom, 'Zoomed-out views must not query Overpass mirrors')
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('Live edit-mode data test passed: mirror failover, live layers at close zoom, and snapshot fallback on zoom-out without requests.')
} finally {
  await browser?.close()
  server?.kill()
}
