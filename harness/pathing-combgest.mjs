// Comb gesture layer: real mouse drags through every verb.
// (1) reroute dropped on reroute -> comb with 2 lanes, both source dots absorbed;
// (2) reroute dropped on a gate -> third lane; (3) gate body drag moves the gate
// and its teeth; (4) hover glyph click flips the gate's pin side; (5) pulling an
// in-tooth detaches its lane (freed dot survives) and, at one lane left, the comb
// auto-decomposes.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
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
const settle = () => page.evaluate(async () => {
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 200)) }
})
const screen = (gx, gy) => page.evaluate(([gx, gy]) => {
  const { ds } = window.app.canvas
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
}, [gx, gy])
const drag = async (fx, fy, tx, ty) => {
  const [sx, sy] = await screen(fx, fy)
  const [ex, ey] = await screen(tx, ty)
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(ex, ey, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  await settle()
}

// Scene: three links, a free reroute on each.
await page.evaluate(() => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('CheckpointLoaderSimple', 60, 100)
  const t1 = mk('CheckpointSave', 1480, 120)
  const s2 = mk('CheckpointLoaderSimple', 60, 400)
  const t2 = mk('CheckpointSave', 1480, 420)
  const s3 = mk('CheckpointLoaderSimple', 60, 700)
  const t3 = mk('CheckpointSave', 1480, 720)
  s1.connect(0, t1, 0); s2.connect(0, t2, 0); s3.connect(0, t3, 0)
  const links = [...g._links.values()]
  g.createReroute([700, 200], links[0])
  g.createReroute([700, 500], links[1])
  g.createReroute([700, 800], links[2])
})
await settle()

// (1) create: drag reroute 2 onto reroute 1
await drag(700, 500, 700, 200)
const c1 = await page.evaluate(() => {
  const g = window.app.graph
  const recs = g.extra?.cablemanagement_combs ?? []
  return { combs: recs.length, lanes: recs[0]?.lanes.length, reroutes: g.reroutes.size, rec: recs[0] }
})
ok('drop on reroute creates comb', c1.combs === 1, `combs=${c1.combs}`)
ok('two lanes, both dots absorbed', c1.lanes === 2 && c1.reroutes === 5, `lanes=${c1.lanes} reroutes=${c1.reroutes}`)

// (2) enroll: drag reroute 3 onto the out-gate's "+" square (lane creation
// moved there in the #4 new-lane-drop-spot round; body is join-or-nothing)
const gateMid = await page.evaluate(() => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const h = 24 + (c.lanes.length - 1) * 20
  return [c.out.pos[0] + 12, c.out.pos[1] + h + 4 + 12]
})
await drag(700, 800, gateMid[0], gateMid[1])
const c2 = await page.evaluate(() => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  return { lanes: rec.lanes.length, reroutes: g.reroutes.size, crossings: window.__cablemanagementPathing.routes().filter((r) => r.key.includes('|X')).length }
})
ok('drop on gate enrolls third lane', c2.lanes === 3 && c2.reroutes === 6, `lanes=${c2.lanes} reroutes=${c2.reroutes}`)
ok('three ribbon crossings live', c2.crossings === 3, `got ${c2.crossings}`)

// (3) gate drag: grab the out-gate body, pull it 360 right
const before = await page.evaluate(() => window.app.graph.extra.cablemanagement_combs[0].out.pos.slice())
const h3 = await page.evaluate(() => 24 + (window.app.graph.extra.cablemanagement_combs[0].lanes.length - 1) * 20)
await drag(before[0] + 8, before[1] + h3 - 6, before[0] + 8 + 360, before[1] + h3 - 6)
const c3 = await page.evaluate(() => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  const tooth = g.reroutes.get(rec.lanes[0].out)
  return { pos: rec.out.pos.slice(), tooth: tooth.pos.slice() }
})
ok('gate body drag moves the gate', Math.abs(c3.pos[0] - before[0] - 360) <= 10, `x ${before[0]} -> ${c3.pos[0]}`)
ok('teeth follow the gate', Math.abs(c3.tooth[0] - (c3.pos[0] + 24)) < 1, `toothX=${c3.tooth[0]} gateX=${c3.pos[0]}`)

// (4) flip: hover the in-gate body, click the glyph at its top
const inPos = await page.evaluate(() => window.app.graph.extra.cablemanagement_combs[0].in.pos.slice())
const [hx, hy] = await screen(inPos[0] + 12, inPos[1] + 30)
await page.mouse.move(hx, hy)
await page.waitForTimeout(150)
const [fx, fy] = await screen(inPos[0] + 12, inPos[1] + 9)
await page.mouse.move(fx, fy)
await page.waitForTimeout(150)
await page.mouse.down(); await page.mouse.up()
await page.waitForTimeout(300)
await settle()
const c4 = await page.evaluate(() => window.app.graph.extra.cablemanagement_combs[0].in.pins)
ok('glyph click flips the gate', c4 === 'right', `pins=${c4}`)
await page.evaluate(() => { window.app.graph.extra.cablemanagement_combs[0].in.pins = 'left' })
await settle()

// (5) detach: pull lane 0's in-tooth far away; then lane 1's -> auto-decompose
const t0 = await page.evaluate(() => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  return { rid: rec.lanes[0].in, pos: g.reroutes.get(rec.lanes[0].in).pos.slice() }
})
await drag(t0.pos[0], t0.pos[1], t0.pos[0] - 150, t0.pos[1] - 80)
const c5 = await page.evaluate(([rid]) => {
  const g = window.app.graph
  return {
    lanes: g.extra.cablemanagement_combs[0]?.lanes.length,
    reroutes: g.reroutes.size,
    freedAlive: !!g.reroutes.get(rid),
    freedPos: g.reroutes.get(rid)?.pos.slice()
  }
}, [t0.rid])
ok('in-tooth pull detaches its lane', c5.lanes === 2 && c5.reroutes === 5, `lanes=${c5.lanes} reroutes=${c5.reroutes}`)
ok('freed dot survives away from gate', c5.freedAlive && Math.abs(c5.freedPos[0] - (t0.pos[0] - 150)) < 15, `pos=${c5.freedPos}`)

const t1r = await page.evaluate(() => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  return g.reroutes.get(rec.lanes[0].in).pos.slice()
})
await drag(t1r[0], t1r[1], t1r[0] - 150, t1r[1] + 120)
const c6 = await page.evaluate(() => {
  const g = window.app.graph
  return { combs: (g.extra.cablemanagement_combs ?? []).length, reroutes: g.reroutes.size, crossings: window.__cablemanagementPathing.routes().filter((r) => r.key.includes('|X')).length }
})
ok('second-to-last pull decomposes', c6.combs === 0 && c6.crossings === 0, `combs=${c6.combs} crossings=${c6.crossings}`)

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
