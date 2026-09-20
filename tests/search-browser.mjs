// End-to-end test for the view-mode search bar.
//
// Picks its queries from the actual generated index, so it stays valid when the
// worldwide data is refreshed. Run `npm run test:browser`.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const base = 'http://127.0.0.1:5198/'
const server = process.env.SEARCH_TEST_URL ? undefined : spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5198', '--strictPort'], { stdio: 'pipe' })
const errors = [], indexRequests = []
let browser

/** Normalize the same way the client does, to detect unique names. */
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base)).ok) break } catch {}
    await new Promise(r => setTimeout(r, 100))
  }

  const data = await (await fetch(`${base}tiles/climbing-search.json`)).json()
  const rows = data.rows, parents = data.parents
  const counts = new Map()
  for (const row of rows) counts.set(normalize(row[0]), (counts.get(normalize(row[0])) ?? 0) + 1)
  const pick = (kind, extra = () => true) => rows.find(row => row[1] === kind && counts.get(normalize(row[0])) === 1 && extra(row))
  const problem = pick('p', row => row[7] >= 0 && parents[row[7]] && (parents[row[7]][0] || parents[row[7]][1]))
  const sector = pick('s')
  const area = pick('a')
  assert.ok(problem && sector && area, 'index must contain a unique problem with context, a sector and an area')

  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', e => { errors.push(e.message); console.error(e) })
  page.on('request', request => { if (request.url().includes('climbing-search.json')) indexRequests.push(request.url()) })
  // Keep the test independent of external raster/glyph/API services.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  await page.route('https://tile.openstreetmap.org/**', r => r.fulfill({ contentType: 'image/png', body: png }))
  await page.route('https://demotiles.maplibre.org/**', r => r.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) }))
  await page.route('https://overpass-api.de/**', r => r.fulfill({ json: { elements: [] } }))
  await page.route('https://api.openstreetmap.org/**', r => r.fulfill({ json: { elements: [] } }))

  await page.goto(base)
  await page.waitForFunction(() => window.__map?.isStyleLoaded())
  await page.waitForSelector('.search-input')
  assert.deepEqual(indexRequests, [], 'the search index must not load before interaction')

  const searchFor = async row => {
    await page.fill('.search-input', row[0])
    await page.waitForSelector('.search-result')
    const names = await page.$$eval('.search-result-name', els => els.map(e => e.textContent))
    assert.ok(names.includes(row[0]), `expected "${row[0]}" in results, got ${JSON.stringify(names.slice(0, 5))}`)
    return page.locator('.search-result', { hasText: row[0] }).first()
  }

  // A problem result shows its mapped sector/area context, opens the route
  // sidebar and centers the map on it.
  const problemRow = await searchFor(problem)
  const context = (await problemRow.locator('.search-result-meta').textContent())?.trim()
  assert.ok(context && context.includes(parents[problem[7]][0] || parents[problem[7]][1]), `expected sector/area context, got ${JSON.stringify(context)}`)
  await problemRow.click()
  await page.waitForFunction(name => document.querySelector('#sidebar h1')?.textContent?.includes(name), problem[0])
  await page.waitForFunction(([lon, lat]) => {
    const c = window.__map.getCenter()
    return Math.abs(c.lat - lat) < 0.6 && Math.abs(c.lng - lon) < 0.6
  }, [problem[4], problem[5]], { timeout: 8000 })
  assert.ok(indexRequests.length >= 1, 'the index must load on first interaction')

  // Keyboard navigation selects a sector.
  await page.fill('.search-input', sector[0])
  await page.waitForSelector('.search-result')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForFunction(name => document.querySelector('#sidebar h1')?.textContent?.includes(name), sector[0])

  // An area result opens the area sidebar.
  await (await searchFor(area)).click()
  await page.waitForFunction(name => document.querySelector('#sidebar h1')?.textContent?.includes(name), area[0])

  assert.deepEqual(errors, [])
  console.log('Search workflow passed: lazy index load, problem/sector/area results, keyboard and click navigation.')
} finally {
  await browser?.close()
  server?.kill()
}
