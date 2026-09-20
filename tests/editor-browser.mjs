// End-to-end local-edit workflow. No OSM writes or credentials are used.
// Run `npx playwright install chromium` once, then `npm run test:browser`.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const base = process.env.EDITOR_TEST_URL || 'http://127.0.0.1:5199/'
const server = process.env.EDITOR_TEST_URL ? undefined : spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5199', '--strictPort'], { stdio: 'pipe' })
const errors = [], alerts = []
const editorChunkRequests = []
let overpassRequests = 0
let dismissNextConfirmation = false
let browser
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) break } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  page.on('pageerror', e => { errors.push(e.message); console.error(e) })
  if (process.env.DEBUG_EDITOR) page.on('console', m => console.log(m.type(), m.text()))
  page.on('dialog', async d => {
    if (d.type() === 'alert') alerts.push(d.message())
    if (d.type() === 'confirm' && dismissNextConfirmation) { dismissNextConfirmation = false; await d.dismiss() }
    else await d.accept()
  })
  // Keep the tests independent of external raster/glyph services.
  await page.route('https://tile.openstreetmap.org/**', r => r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }))
  await page.route('https://demotiles.maplibre.org/**', r => r.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) }))
  await page.route('https://tiles.openfreemap.org/**', route => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/planet') return route.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, vector_layers: [] } })
    if (pathname.endsWith('.json')) return route.fulfill({ json: {} })
    if (pathname.endsWith('.png')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
    return route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) })
  })
  await page.route('https://overpass-api.de/api/interpreter', r => { overpassRequests++; return r.fulfill({ json: { elements: [] } }) })
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (/\/src\/editor|editor-[\w-]+\.js|\/src\/editing\//.test(path)) editorChunkRequests.push(path)
    if (request.url().startsWith('https://api.openstreetmap.org/')) assert.equal(request.method(), 'GET', 'Editor must never write directly to OSM')
  })
  // View mode must not download the lazily-loaded editor chunk.
  await page.goto(base)
  await page.waitForFunction(() => window.__map?.isStyleLoaded())
  assert.deepEqual(editorChunkRequests, [], 'Viewer must not load the editor chunk')
  await page.goto(`${base}edit#19/0/0`)
  await page.waitForFunction(() => window.__map?.getLayer('edit-vertices'))
  const clickTool = label => page.locator('.geometry-toolbar').getByRole('button', { name: label, exact: true }).click()
  const features = () => page.evaluate(() => window.__map.getSource('edit-features').serialize().data.features)
  const graphDraft = () => page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('openbouldermap.editor.v1')).graph))
  const until = async fn => { for (let i = 0; i < 100; i++) { if (await fn()) return; await page.waitForTimeout(50) } throw new Error('Condition timed out') }
  const drag = async (x, y, tx, ty) => { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(tx, ty, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(150) }
  const contextAction = async (x, y, label) => {
    await page.mouse.click(x, y, { button: 'right' })
    await page.getByRole('menuitem', { name: label, exact: true }).click()
  }
  const controls = await page.evaluate(() => {
    const download = document.getElementById('osc-toggle')
    const rect = download.getBoundingClientRect(), font = getComputedStyle(download).font
    return [...document.querySelectorAll('.geometry-toolbar button:not([hidden])')].map(b => ({
      aligned: Math.abs(b.getBoundingClientRect().y - rect.y) < 1,
      sameFont: getComputedStyle(b).font === font
    }))
  })
  assert.ok(controls.every(b => b.aligned && b.sameFont), 'Tools must share the download button’s row and font')
  assert.equal(await page.getByRole('button', { name: 'Discard local changes', exact: true }).count(), 0)

  await clickTool('+ Boulder')
  for (const [x, y] of [[350, 300], [500, 300], [500, 450], [350, 450]]) await page.mouse.click(x, y)
  await page.mouse.click(350, 300) // Close by clicking the starting vertex again.
  await page.getByRole('heading', { name: 'Edit boulder', exact: true }).waitFor()
  await page.locator('#sidebar').getByLabel('Name', { exact: true }).fill('Browser test rock')
  await page.getByRole('heading', { name: 'Edit boulder', exact: true }).click()
  assert.equal((await features()).filter(f => f.properties.kind === 'boulder').length, 1)

  // Cursor affordances: index finger over nodes, drag hand elsewhere.
  await page.mouse.move(350, 300)
  await page.waitForFunction(() => window.__map.getCanvas().style.cursor === 'pointer')
  await page.mouse.move(600, 250)
  await page.waitForFunction(() => window.__map.getCanvas().style.cursor === 'grab')

  await clickTool('+ Route'); await page.mouse.click(350, 375)
  await page.getByRole('heading', { name: 'Edit route', exact: true }).waitFor()
  // Grade editor: choose the scale and store Font and Hueco grades separately.
  const gradeSystem = page.locator('#sidebar').getByLabel('Grade system', { exact: true })
  const gradeValue = page.locator('#sidebar').getByLabel('Grade value', { exact: true })
  await gradeSystem.selectOption('climbing:grade:hueco')
  await gradeValue.fill('V4')
  await gradeSystem.selectOption('climbing:grade:font')
  await gradeValue.fill('6C')
  await page.getByRole('button', { name: 'Attached to Browser test rock', exact: true }).waitFor()
  assert.equal(await page.locator('#sidebar').getByRole('button', { name: 'Detach from boulder', exact: true }).count(), 0)
  const attached = (await features()).find(f => f.properties.kind === 'route')
  const beforeMove = (await features()).find(f => f.properties.kind === 'boulder').geometry.coordinates[0]
  await drag(350, 375, 320, 375)
  const afterMove = (await features()).find(f => f.properties.kind === 'boulder').geometry.coordinates[0]
  assert.notDeepEqual(afterMove, beforeMove, 'Dragging attached route must reshape boulder')
  await contextAction(320, 375, 'Detach from boulder')
  await page.getByText('Independent route. Drop onto').waitFor()
  const detachedOutline = (await features()).find(f => f.properties.kind === 'boulder').geometry
  await drag(320, 375, 250, 375)
  assert.deepEqual((await features()).find(f => f.properties.kind === 'boulder').geometry, detachedOutline)
  assert.notDeepEqual((await features()).find(f => f.properties.kind === 'route').geometry, attached.geometry)
  await page.mouse.click(250, 375, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete climbing route', exact: true }).waitFor()
  assert.equal(await page.getByRole('menuitem', { name: 'Detach from boulder', exact: true }).count(), 0)
  assert.equal(await page.getByRole('menuitem', { name: 'Delete perimeter vertex', exact: true }).count(), 0)
  await page.keyboard.press('Escape')

  // Nested creation stays local to the dialogs until a final atomic link.
  await page.getByRole('button', { name: 'Choose / create sector', exact: true }).click()
  await page.locator('dialog').getByLabel('Name', { exact: true }).fill('Test sector')
  await page.getByRole('button', { name: 'Choose / create area (optional)', exact: true }).click()
  const areaDialog = page.locator('dialog').last()
  await areaDialog.getByLabel('Name', { exact: true }).fill('Test area')
  await areaDialog.getByRole('button', { name: 'OK', exact: true }).click()
  await page.getByRole('heading', { name: 'Choose area', exact: true }).waitFor({ state: 'detached' })
  await page.locator('dialog').getByRole('button', { name: 'OK', exact: true }).click()
  await page.locator('#sidebar').getByRole('button', { name: 'Test sector', exact: true }).waitFor()
  let draft = await graphDraft()
  const relations = Object.values(draft.state.overrides).filter(e => e?.type === 'relation')
  assert.equal(relations.length, 2); assert.ok(relations.every(e => e.members.length === 1))

  await clickTool('Undo'); await until(async () => !await page.locator('#sidebar').getByRole('button', { name: 'Test sector', exact: true }).count())
  await clickTool('Redo'); await page.locator('#sidebar').getByRole('button', { name: 'Test sector', exact: true }).waitFor()

  // Export must preserve the session and must not make any write request.
  assert.equal(await page.locator('.geometry-toolbar').getByRole('button', { name: 'Review changes', exact: true }).count(), 0)
  await page.locator('#osc-toggle').click() // The single download entry point opens review.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Check current OSM data and download .osc', exact: true }).click()
  const download = await downloadPromise
  const xml = await readFile(await download.path(), 'utf8')
  assert.match(xml, /<create>/); assert.match(xml, /Test sector/); assert.match(xml, /Test area/)
  assert.match(xml, /k="climbing:grade:font" v="6C"/)
  assert.match(xml, /k="climbing:grade:hueco" v="V4"/)
  assert.doesNotMatch(xml, /<modify>|<delete>/)
  await page.locator('dialog').getByRole('button', { name: 'Close', exact: true }).click()

  // Reload restores all geometry, hierarchy and undo history.
  const beforeReload = await graphDraft()
  await page.reload(); await page.waitForFunction(() => window.__map?.getLayer('edit-vertices'))
  await until(async () => (await features()).length >= 2)
  assert.deepEqual((await graphDraft()).state, beforeReload.state)

  // Join an ordinary vertex, then delete the route without changing the outline.
  await page.waitForFunction(() => window.__map.queryRenderedFeatures({ layers: ['edit-routes'] }).length > 0)
  const routeScreen = await page.evaluate(() => {
    const route = window.__map.getSource('edit-features').serialize().data.features.find(f => f.properties.kind === 'route')
    return window.__map.project(route.geometry.coordinates)
  })
  await page.mouse.click(routeScreen.x, routeScreen.y)
  await page.getByRole('heading', { name: 'Edit route', exact: true }).waitFor()
  const beforeJoin = (await features()).find(f => f.properties.kind === 'boulder').geometry.coordinates[0]
  await drag(routeScreen.x, routeScreen.y, 500, 300)
  await page.getByRole('button', { name: 'Attached to Browser test rock', exact: true }).waitFor()
  assert.deepEqual((await features()).find(f => f.properties.kind === 'boulder').geometry.coordinates[0], beforeJoin, 'Joining an existing vertex must not insert a duplicate')
  assert.equal(await page.locator('#sidebar').getByRole('button', { name: 'Delete route', exact: true }).count(), 0)
  await contextAction(500, 300, 'Delete climbing route')
  await page.getByRole('heading', { name: 'Boulder perimeter vertex', exact: true }).waitFor()
  assert.equal((await features()).filter(f => f.properties.kind === 'route').length, 0)
  assert.deepEqual((await features()).find(f => f.properties.kind === 'boulder').geometry.coordinates[0], beforeJoin)
  await contextAction(500, 300, 'Delete perimeter vertex')
  await page.getByRole('heading', { name: 'Edit boulder', exact: true }).waitFor()
  assert.equal((await features()).find(f => f.properties.kind === 'boulder').geometry.coordinates[0].length, beforeJoin.length - 1)

  // Group search includes locally created parents; deleting the area preserves its sector.
  await clickTool('Find sector / area')
  // Remote parent discovery comes from the static index, never Overpass.
  const searchIndex = await (await fetch(`${base}tiles/climbing-index.json`)).json()
  const remoteSector = searchIndex.sectors.find(row => typeof row[1] === 'string' && row[1].length >= 5)
  const sectorBox = page.getByRole('textbox', { name: 'Search sector by name' })
  await sectorBox.fill(remoteSector[1])
  await sectorBox.press('Enter')
  await page.locator('.parent-result button', { hasText: remoteSector[1] }).first().waitFor()
  await page.getByRole('textbox', { name: 'Search area by name' }).fill('Test area')
  await page.getByRole('textbox', { name: 'Search area by name' }).press('Enter')
  await page.locator('.parent-results').getByRole('button', { name: /Test area/ }).click()
  await page.getByRole('heading', { name: 'Edit area', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Delete area', exact: true }).click()
  await until(async () => !Object.values((await graphDraft()).state.overrides).some(e => e?.tags?.climbing === 'area'))
  assert.ok(Object.values((await graphDraft()).state.overrides).some(e => e?.tags?.climbing === 'crag'))
  // Right-click works on an unselected boulder, not just the selected sidebar object.
  await contextAction(400, 390, 'Delete boulder')
  await until(async () => !(await features()).some(f => f.properties.kind === 'boulder'))
  await clickTool('Undo')
  await until(async () => (await features()).some(f => f.properties.kind === 'boulder'))

  // Escape dismisses a context menu without deleting anything.
  await page.waitForFunction(() => window.__map.queryRenderedFeatures({ layers: ['edit-boulders'] }).length > 0)
  await page.mouse.click(400, 390, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete boulder', exact: true }).waitFor()
  await page.keyboard.press('ArrowUp')
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Delete boulder')
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Move entire boulder')
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('menu').count(), 0)

  // The existing X is the only discard/exit action, and cancelling preserves work.
  const beforeExit = await graphDraft()
  dismissNextConfirmation = true
  await page.locator('#edit-toggle').click()
  assert.deepEqual((await graphDraft()).state, beforeExit.state)
  assert.ok(new URL(page.url()).pathname.endsWith('/edit'))
  await page.locator('#edit-toggle').click()
  await page.waitForURL(url => url.pathname === new URL(base).pathname)
  assert.equal(await page.evaluate(() => localStorage.getItem('openbouldermap.editor.v1')), null)
  // The viewer has no edit entry button: the editor is reachable only by URL.
  assert.equal(await page.locator('#edit-toggle').isVisible(), false)
  await page.goto(`${base}edit#19/0/0`)
  await page.waitForFunction(() => window.__map?.getLayer('edit-vertices'))

  // Clicking the last vertex again also finishes, without duplicating it.
  await clickTool('+ Boulder')
  for (const [x, y] of [[350, 300], [500, 300], [500, 450]]) await page.mouse.click(x, y)
  await page.mouse.click(500, 450)
  await page.getByRole('heading', { name: 'Edit boulder', exact: true }).waitFor()
  const closed = (await features()).find(f => f.properties.kind === 'boulder').geometry.coordinates[0]
  assert.equal(closed.length, 4)
  assert.deepEqual(closed[0], closed.at(-1))
  await clickTool('Undo')
  assert.equal((await features()).filter(f => f.properties.kind === 'boulder').length, 0)
  assert.deepEqual(alerts, []); assert.deepEqual(errors, [])
  assert.equal(overpassRequests, 0, 'editor parent search must not call Overpass')
  console.log('Browser editor workflow passed: draw, snap/join, drag, detach, inline hierarchy, undo/redo, export, recovery, safe deletion, search and discard.')
} finally {
  await browser?.close()
  server?.kill()
}
