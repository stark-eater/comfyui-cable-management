// Gate chrome round: hover control column (flip/labels/sort/collapse), sort
// modal, per-ribbon collapse, shift-drag grid snap, pointer cursor.
//   s1 sort glyph -> comfy modal -> drag row -> Apply reorders comb.lanes
//   s2 collapse glyph -> squares, stacked teeth, single-line ribbon
//   s3 hover expand glyph -> restore
//   s4 shift-drag on gate body snaps to grid
//   s5 pointer cursor over glyphs, cleared off them
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}

await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
  window.app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('EmptyLatentImage', 60, 100)
  const s2 = mk('CheckpointLoaderSimple', 60, 400)
  const y1 = mk('KSampler', 1200, 80)
  const y2 = mk('CheckpointSave', 1200, 400)
  const idx = y1.inputs.findIndex((s) => s.name === 'latent_image')
  s1.connect(0, y1, idx); s2.connect(0, y2, 0)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1500))
  window.__cablemanagementCombs.create(y1.inputs[idx].link, y2.inputs[0].link, 700, 250)
  await new Promise((r) => setTimeout(r, 900))
})

// slot centre in screen px: slot 0..3 of the hover column on the out gate
const slotPt = (slot) => page.evaluate((slot) => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const ds = window.app.canvas.ds
  const h = c.collapsed ? 24 : 24 + Math.max(2, c.lanes.length - 1) * 20
  const cy = c.out.pos[1] + h / 2 + (c.collapsed ? 0 : (slot - 1.5) * 14)
  return [(c.out.pos[0] + 12 + ds.offset[0]) * ds.scale, (cy + ds.offset[1]) * ds.scale]
}, slot)
const hoverThenClick = async (pt) => {
  await page.mouse.move(pt[0], pt[1] - 30)
  await page.waitForTimeout(400)
  await page.mouse.move(...pt)
  await page.waitForTimeout(400)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(900)
}

// ---- s1: sort modal ----
const before = await page.evaluate(() => window.app.graph.extra.cablemanagement_combs[0].lanes.map((l) => l.in))
await hoverThenClick(await slotPt(2))
const rows = await page.evaluate(() => [...document.querySelectorAll('.cablemanagement-sort-row')].map((r) => {
  const b = r.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]
}))
ok('s1: modal open with a row per lane', rows.length === 2, `rows=${rows.length}`)
if (rows.length === 2) {
  await page.mouse.move(rows[0][0], rows[0][1])
  await page.mouse.down()
  await page.mouse.move(rows[1][0], rows[1][1] + 14, { steps: 10 })
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.evaluate(() => {
    [...document.querySelectorAll('.cablemanagement-sort-buttons button')].find((b) => b.textContent === 'Apply').click()
  })
  await page.waitForTimeout(900)
}
const after = await page.evaluate(() => ({
  lanes: window.app.graph.extra.cablemanagement_combs[0].lanes.map((l) => l.in),
  gone: !document.querySelector('.cablemanagement-sort-row')
}))
ok('s1: Apply reorders lanes, modal closes', after.gone && after.lanes[0] === before[1] && after.lanes[1] === before[0],
  JSON.stringify({ before, after }))

// ---- s2: collapse ----
await hoverThenClick(await slotPt(3))
const col = await page.evaluate(() => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const g = window.app.graph
  const ys = c.lanes.flatMap((l) => [g.reroutes.get(l.in)?.pos[1], g.reroutes.get(l.out)?.pos[1]])
  return { collapsed: !!c.collapsed, stacked: new Set(ys).size === 1 }
})
ok('s2: collapsed, teeth stacked', col.collapsed && col.stacked, JSON.stringify(col))

// ---- s3: expand ----
await hoverThenClick(await slotPt(0)) // collapsed: single centred glyph
const exp = await page.evaluate(() => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const g = window.app.graph
  const ys = c.lanes.map((l) => g.reroutes.get(l.in)?.pos[1])
  return { collapsed: !!c.collapsed, spread: new Set(ys).size === c.lanes.length }
})
ok('s3: expand restores lanes', !exp.collapsed && exp.spread, JSON.stringify(exp))

// ---- s4: shift-drag snap ----
const dragPt = await page.evaluate(() => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const ds = window.app.canvas.ds
  const h = 24 + Math.max(2, c.lanes.length - 1) * 20
  return [(c.out.pos[0] + 3 + ds.offset[0]) * ds.scale, (c.out.pos[1] + h / 2 + ds.offset[1]) * ds.scale]
})
await page.keyboard.down('Shift')
await page.mouse.move(...dragPt)
await page.mouse.down()
await page.mouse.move(dragPt[0] + 87, dragPt[1] + 33, { steps: 8 })
await page.mouse.up()
await page.keyboard.up('Shift')
await page.waitForTimeout(600)
const snapped = await page.evaluate(() => {
  const p = window.app.graph.extra.cablemanagement_combs[0].out.pos
  return { pos: [...p], onGrid: p[0] % 10 === 0 && p[1] % 10 === 0 }
})
ok('s4: shift-drag snaps to grid', snapped.onGrid, JSON.stringify(snapped))

// ---- s5: pointer cursor ----
const g0 = await slotPt(0)
await page.mouse.move(g0[0], g0[1] - 30)
await page.waitForTimeout(300)
await page.mouse.move(...g0)
await page.waitForTimeout(300)
const onGlyph = await page.evaluate(() => window.app.canvas.canvas.style.cursor)
await page.mouse.move(g0[0] + 300, g0[1])
await page.waitForTimeout(300)
const offGlyph = await page.evaluate(() => window.app.canvas.canvas.style.cursor)
ok('s5: pointer cursor on glyph, cleared off', onGlyph === 'pointer' && offGlyph !== 'pointer', JSON.stringify({ onGlyph, offGlyph }))

ok('no page errors', errs.length === 0, errs.join(' | '))
await b.close()
if (!pass) process.exit(1)
console.log('PASS')
