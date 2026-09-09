// End-to-end local-edit workflow. No OSM writes or credentials are used.
// Run `npx playwright install chromium` once, then `npm run test:browser`.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const base = process.env.EDITOR_TEST_URL || 'http://127.0.0.1:5199/openbouldermap/'
const server = process.env.EDITOR_TEST_URL ? undefined : spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5199', '--strictPort'], { stdio: 'pipe' })
const errors = [], alerts = []
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
  page.on('dialog', async d => { if (d.type() === 'alert') alerts.push(d.message()); await d.accept() })
  // Keep the tests independent of external raster/glyph services.
  await page.route('https://tile.openstreetmap.org/**', r => r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }))
  await page.route('https://demotiles.maplibre.org/**', r => r.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) }))
  await page.route('https://overpass-api.de/api/interpreter', r => r.fulfill({ json: { elements: [] } }))
  page.on('request', request => {
    if (request.url().startsWith('https://api.openstreetmap.org/')) assert.equal(request.method(), 'GET', 'Editor must never write directly to OSM')
  })
  await page.goto(`${base}edit#19/0/0`)
  await page.waitForFunction(() => window.__map?.getLayer('edit-vertices'))
  const clickTool = label => page.locator('.geometry-toolbar').getByRole('button', { name: label, exact: true }).click()
  const features = () => page.evaluate(() => window.__map.getSource('edit-features').serialize().data.features)
  const graphDraft = () => page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('openbouldermap.editor.v1')).graph))
  const until = async fn => { for (let i = 0; i < 100; i++) { if (await fn()) return; await page.waitForTimeout(50) } throw new Error('Condition timed out') }
  const drag = async (x, y, tx, ty) => { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(tx, ty, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(150) }

  await clickTool('+ Boulder')
  for (const [x, y] of [[350, 300], [500, 300], [500, 450], [350, 450]]) await page.mouse.click(x, y)
  await clickTool('Finish outline')
  await page.getByRole('heading', { name: 'Edit boulder', exact: true }).waitFor()
  await page.locator('#sidebar').getByLabel('Name', { exact: true }).fill('Browser test rock')
  await page.getByRole('heading', { name: 'Edit boulder', exact: true }).click()
  assert.equal((await features()).filter(f => f.properties.kind === 'boulder').length, 1)

  await clickTool('+ Route'); await page.mouse.click(350, 375)
  await page.getByRole('heading', { name: 'Edit route', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Detach from boulder', exact: true }).waitFor()
  const attached = (await features()).find(f => f.properties.kind === 'route')
  const beforeMove = (await features()).find(f => f.properties.kind === 'boulder').geometry.coordinates[0]
  await drag(350, 375, 320, 375)
  const afterMove = (await features()).find(f => f.properties.kind === 'boulder').geometry.coordinates[0]
  assert.notDeepEqual(afterMove, beforeMove, 'Dragging attached route must reshape boulder')
  await page.getByRole('button', { name: 'Detach from boulder', exact: true }).click()
  await page.getByText('Independent route. Drop onto').waitFor()
  const detachedOutline = (await features()).find(f => f.properties.kind === 'boulder').geometry
  await drag(320, 375, 250, 375)
  assert.deepEqual((await features()).find(f => f.properties.kind === 'boulder').geometry, detachedOutline)
  assert.notDeepEqual((await features()).find(f => f.properties.kind === 'route').geometry, attached.geometry)

  // Nested creation stays local to the dialogs until a final atomic link.
  await page.getByRole('button', { name: 'Choose / create sector', exact: true }).click()
  await page.locator('dialog').getByText('Create missing sector', { exact: true }).click()
  await page.locator('dialog').getByLabel('Name', { exact: true }).fill('Test sector')
  await page.getByRole('button', { name: 'Choose / create area (optional)', exact: true }).click()
  const areaDialog = page.locator('dialog').last()
  await areaDialog.getByText('Create missing area', { exact: true }).click()
  await areaDialog.getByLabel('Name', { exact: true }).fill('Test area')
  await areaDialog.getByRole('button', { name: 'Create and link area', exact: true }).click()
  await page.getByRole('button', { name: 'Create and link sector', exact: true }).click()
  await page.locator('#sidebar').getByRole('button', { name: 'Test sector', exact: true }).waitFor()
  let draft = await graphDraft()
  const relations = Object.values(draft.state.overrides).filter(e => e?.type === 'relation')
  assert.equal(relations.length, 2); assert.ok(relations.every(e => e.members.length === 1))

  await clickTool('Undo'); await until(async () => !await page.locator('#sidebar').getByRole('button', { name: 'Test sector', exact: true }).count())
  await clickTool('Redo'); await page.locator('#sidebar').getByRole('button', { name: 'Test sector', exact: true }).waitFor()

  // Export must preserve the session and must not make any write request.
  await clickTool('Review changes')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Check current OSM data and download .osc', exact: true }).click()
  const download = await downloadPromise
  const xml = await readFile(await download.path(), 'utf8')
  assert.match(xml, /<create>/); assert.match(xml, /Test sector/); assert.match(xml, /Test area/)
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
  await page.getByRole('button', { name: 'Detach from boulder', exact: true }).waitFor()
  assert.deepEqual((await features()).find(f => f.properties.kind === 'boulder').geometry.coordinates[0], beforeJoin, 'Joining an existing vertex must not insert a duplicate')
  await page.getByRole('button', { name: 'Delete route', exact: true }).click()
  await page.getByRole('heading', { name: 'Boulder perimeter vertex', exact: true }).waitFor()
  assert.equal((await features()).filter(f => f.properties.kind === 'route').length, 0)
  assert.deepEqual((await features()).find(f => f.properties.kind === 'boulder').geometry.coordinates[0], beforeJoin)
  await page.getByRole('button', { name: 'Delete perimeter vertex', exact: true }).click()
  await page.getByRole('heading', { name: 'Edit boulder', exact: true }).waitFor()
  assert.equal((await features()).find(f => f.properties.kind === 'boulder').geometry.coordinates[0].length, beforeJoin.length - 1)

  // Group search includes locally created parents; deleting the area preserves its sector.
  await clickTool('Find sector / area')
  await page.getByRole('textbox', { name: 'Search area by name' }).fill('Test area')
  await page.getByRole('textbox', { name: 'Search area by name' }).press('Enter')
  await page.locator('.parent-results').getByRole('button', { name: /Test area/ }).click()
  await page.getByRole('heading', { name: 'Edit area', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Delete area', exact: true }).click()
  await until(async () => !Object.values((await graphDraft()).state.overrides).some(e => e?.tags?.climbing === 'area'))
  assert.ok(Object.values((await graphDraft()).state.overrides).some(e => e?.tags?.climbing === 'crag'))
  await clickTool('Discard local changes')
  await until(async () => (await features()).length === 0)
  assert.equal(await page.evaluate(() => localStorage.getItem('openbouldermap.editor.v1')), null)
  assert.deepEqual(alerts, []); assert.deepEqual(errors, [])
  console.log('Browser editor workflow passed: draw, snap/join, drag, detach, inline hierarchy, undo/redo, export, recovery, safe deletion, search and discard.')
} finally {
  await browser?.close()
  server?.kill()
}
