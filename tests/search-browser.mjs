// End-to-end test for the view-mode search bar.
//
// Picks its queries from the actual generated hierarchy index, so it stays
// valid when the worldwide data is refreshed. Run `npm run test:browser`.
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

  const data = await (await fetch(`${base}tiles/climbing-index.json`)).json()
  const areas = data.areas, sectors = data.sectors, problems = data.problems
  const sectorsById = new Map(sectors.map(row => [row[0], row]))

  const all = [
    ...areas.map(row => ({ name: row[1], kind: 'a' })),
    ...sectors.map(row => ({ name: row[1], kind: 's' })),
    ...problems.map(row => ({ name: row[0], kind: 'p' }))
  ].filter(entry => entry.name)
  const counts = new Map()
  for (const entry of all) counts.set(normalize(entry.name), (counts.get(normalize(entry.name)) ?? 0) + 1)
  const unique = (kind, extra = () => true) => all.find(entry => entry.kind === kind && counts.get(normalize(entry.name)) === 1 && extra(entry))

  const problem = unique('p', entry => {
    const row = problems.find(r => r[0] === entry.name)
    return row && row[2] >= 0 && (sectorsById.get(row[2])?.[1] || '').length > 0
  })
  const gradedProblem = unique('p', entry => {
    const row = problems.find(r => r[0] === entry.name)
    return row && (row[5] || row[6])
  })
  const sector = unique('s')
  const area = unique('a')
  assert.ok(problem && gradedProblem && sector && area, 'index must contain a unique problem with context, a graded problem, a boulder and an area')

  const problemRow = problems.find(r => r[0] === problem.name)
  const gradedRow = problems.find(r => r[0] === gradedProblem.name)
  const sectorName = sector.name
  const areaName = area.name

  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', e => { errors.push(e.message); console.error(e) })
  page.on('request', request => { if (request.url().includes('climbing-index.json')) indexRequests.push(request.url()) })
  // Keep the test independent of external raster/glyph/API services.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  await page.route('https://tile.openstreetmap.org/**', r => r.fulfill({ contentType: 'image/png', body: png }))
  await page.route('https://demotiles.maplibre.org/**', r => r.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) }))
  await page.route('https://tiles.openfreemap.org/**', route => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/planet') return route.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, vector_layers: [] } })
    if (pathname.endsWith('.json')) return route.fulfill({ json: {} })
    if (pathname.endsWith('.png')) return route.fulfill({ contentType: 'image/png', body: png })
    return route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) })
  })
  await page.route('https://api.openstreetmap.org/**', r => r.fulfill({ json: { elements: [] } }))

  await page.goto(base)
  await page.waitForFunction(() => window.__map?.isStyleLoaded())
  await page.waitForSelector('.search-input')
  assert.deepEqual(indexRequests, [], 'the hierarchy index must not load before interaction')

  const searchFor = async name => {
    await page.fill('.search-input', name)
    await page.waitForSelector('.search-result')
    const names = await page.$$eval('.search-result-name', els => els.map(e => e.textContent))
    assert.ok(names.includes(name), `expected "${name}" in results, got ${JSON.stringify(names.slice(0, 5))}`)
    return page.locator('.search-result', { hasText: name }).first()
  }

  // A problem result shows its full ancestor path, opens the route sidebar and
  // centers the map on it.
  const result = await searchFor(problemRow[0])
  const context = (await result.locator('.search-result-meta').textContent())?.trim()
  assert.ok(context && context.includes(sectorsById.get(problemRow[2])[1]), `expected sector context, got ${JSON.stringify(context)}`)
  await result.click()
  await page.waitForFunction(name => document.querySelector('#sidebar h1')?.textContent?.includes(name), problemRow[0])
  await page.waitForFunction(([lon, lat]) => {
    const c = window.__map.getCenter()
    return Math.abs(c.lat - lat) < 0.6 && Math.abs(c.lng - lon) < 0.6
  }, [problemRow[3], problemRow[4]], { timeout: 8000 })
  assert.ok(indexRequests.length >= 1, 'the index must load on first interaction')

  // A graded problem shows its V-grade and/or Font grade.
  const graded = await searchFor(gradedRow[0])
  const shown = (await graded.locator('.search-result-grade').allTextContents()).map(t => t.trim())
  const expected = [gradedRow[5], gradedRow[6]].filter(Boolean)
  assert.deepEqual(shown, expected, `expected grades ${JSON.stringify(expected)}, got ${JSON.stringify(shown)}`)

  // Keyboard navigation selects a boulder.
  await page.fill('.search-input', sectorName)
  await page.waitForSelector('.search-result')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForFunction(name => document.querySelector('#sidebar h1')?.textContent?.includes(name), sectorName)

  // An area result opens the area sidebar.
  await (await searchFor(areaName)).click()
  await page.waitForFunction(name => document.querySelector('#sidebar h1')?.textContent?.includes(name), areaName)

  assert.deepEqual(errors, [])
  console.log('Search workflow passed: lazy index load, problem/boulder/area results, keyboard and click navigation.')
} finally {
  await browser?.close()
  server?.kill()
}
