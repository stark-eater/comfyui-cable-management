// QA bug (post-polish): canvas-born link drags had no preview snap. The Vue drag
// session that drives linkConnector.state.snapLinksPos only exists for drags
// started on slot DOM -- a pull from a floating reroute's slot nub (core-owned)
// never snapped, and the comb out-tooth pull's preview froze the moment the
// pointer entered node DOM (graph_mouse only updates over the canvas element).
// The gesture layer now drives snapLinksPos for canvas-born connector drags:
// compatible pin hover snaps to the pin, node hover snaps to the first compatible
// free slot, else the preview follows the pointer.
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
const screenOfGraph = (gx, gy) => page.evaluate(([gx, gy]) => {
  const { ds } = window.app.canvas
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
}, [gx, gy])
const slotGraphCentre = (key) => page.evaluate((key) => {
  const el = document.querySelector(`[data-slot-key="${key}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  const c = window.app.canvas, cr = c.canvas.getBoundingClientRect()
  return [
    (r.x + r.width / 2 - cr.left) / c.ds.scale - c.ds.offset[0],
    (r.y + r.height / 2 - cr.top) / c.ds.scale - c.ds.offset[1]
  ]
}, key)
const screenOfSlot = (key) => page.evaluate((key) => {
  const d = document.querySelector(`[data-slot-key="${key}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, key)

// Scene: combed pair + loader s3 (for the tooth pull), loader s4 with a floating
// reroute (for the core pull), and target T whose model input stays free.
const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('CheckpointLoaderSimple', 60, 60)
  const t1 = mk('CheckpointSave', 1500, 80)
  const s2 = mk('CheckpointLoaderSimple', 60, 300)
  const t2 = mk('CheckpointSave', 1500, 320)
  const s3 = mk('CheckpointLoaderSimple', 60, 620)
  const s4 = mk('CheckpointLoaderSimple', 420, 620)
  const T = mk('CheckpointSave', 900, 600)
  s1.connect(0, t1, 0); s2.connect(0, t2, 0)
  const [l1, l2] = [...g._links.values()].map((l) => l.id)
  const combId = window.__cablemanagementCombs.create(l1, l2, 700, 300)
  window.__cablemanagementCombs.move(combId, 'out', 1100, 300)
  const r = s4.connectFloatingReroute([700, 880], s4.outputs[0])
  return { s3: s3.id, s4: s4.id, T: T.id, combId, reroute: r.id, rPos: r.pos.slice() }
})
await settle()

const bodyCentre = await page.evaluate((ids) => {
  const n = window.app.graph.getNodeById(ids.T)
  const r = n.boundingRect
  return [r[0] + r[2] / 2, r[1] + r[3] * 0.75] // low half: away from the title, on the body
}, ids)
const modelPin = await slotGraphCentre(`${ids.T}-in-0`)

// --- Case A: core-owned pull from the floating reroute (shift+drag = dragFromReroute)
const rScreen = await screenOfGraph(ids.rPos[0], ids.rPos[1])
await page.mouse.move(rScreen[0], rScreen[1])
await page.waitForTimeout(400)
await page.keyboard.down('Shift')
await page.mouse.down()
const bodyScreen = await screenOfGraph(bodyCentre[0], bodyCentre[1])
await page.mouse.move(bodyScreen[0], bodyScreen[1], { steps: 15 })
await page.waitForTimeout(400)
const midA = await page.evaluate(() => {
  const lc = window.app.canvas.linkConnector
  return { connecting: lc.isConnecting, to: lc.state?.connectingTo, snap: lc.state?.snapLinksPos ?? null }
})
ok('reroute pull is a live input-seeking drag', midA.connecting && midA.to === 'input', JSON.stringify(midA))
const snappedA = midA.snap && Math.hypot(midA.snap[0] - modelPin[0], midA.snap[1] - modelPin[1]) < 3
ok('node-body hover snaps preview to the free model pin', snappedA, JSON.stringify({ snap: midA.snap, pin: modelPin }))
// Release on the BODY (core's own drop path; a release dead on the Vue pin dot
// sits on the node boundary where legacy getNodeOnPos misses -- harness trap).
await page.mouse.up()
await page.keyboard.up('Shift')
await page.waitForTimeout(500)
const dropA = await page.evaluate((ids) => {
  const g = window.app.graph
  const link = [...g._links.values()].find((l) => l.origin_id === ids.s4 && l.target_id === ids.T)
  return { linked: !!link, floating: g.floatingLinks.size, viaReroute: link?.parentId === ids.reroute }
}, ids)
ok('body release still connects through the reroute', dropA.linked && dropA.viaReroute && dropA.floating === 0, JSON.stringify(dropA))
await settle()

// --- Case B: comb out-tooth pull of a dangling lane, held over the node body
const gatePoint = await page.evaluate(() => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const h = 24 + (c.lanes.length - 1) * 20
  // "+" square below the gate: lane parking moved there (#4 drop spot)
  return [c.in.pos[0] + 12, c.in.pos[1] + h + 4 + 12]
})
const outPin3 = await screenOfSlot(`${ids.s3}-out-0`)
const gateScreen = await screenOfGraph(gatePoint[0], gatePoint[1])
await page.mouse.move(outPin3[0], outPin3[1])
await page.mouse.down()
await page.mouse.move(gateScreen[0], gateScreen[1], { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(400)
await settle()
const parked = await page.evaluate(() => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  return { lanes: rec.lanes.length, floating: g.floatingLinks.size, tooth: g.reroutes.get(rec.lanes[2]?.out)?.pos.slice() ?? null }
})
ok('output drag parks a dangling lane', parked.lanes === 3 && parked.floating === 1, JSON.stringify(parked))
const toothScreen = await screenOfGraph(parked.tooth[0], parked.tooth[1])
await page.mouse.move(toothScreen[0], toothScreen[1])
await page.mouse.down()
await page.mouse.move(bodyScreen[0], bodyScreen[1], { steps: 15 })
await page.waitForTimeout(400)
const midB = await page.evaluate(() => {
  const lc = window.app.canvas.linkConnector
  return { connecting: lc.isConnecting, snap: lc.state?.snapLinksPos ?? null }
})
const snappedB = midB.snap && Math.hypot(midB.snap[0] - modelPin[0], midB.snap[1] - modelPin[1]) < 3
ok('tooth pull is live over node DOM (no freeze)', midB.connecting === true, JSON.stringify(midB))
ok('tooth pull snaps preview to the free model pin', snappedB, JSON.stringify({ snap: midB.snap, pin: modelPin }))
await page.mouse.up()
await page.waitForTimeout(500)
await settle()
const dropB = await page.evaluate((ids) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  const link = [...g._links.values()].find((l) => l.origin_id === ids.s3 && l.target_id === ids.T)
  const chain = []
  let rid = link?.parentId
  while (rid != null) { chain.push(rid); rid = g.getReroute(rid)?.parentId }
  chain.reverse()
  // Replacing case A's link revives ITS chain as a float (core disconnect
  // behaviour: reroutes keep floating chains) -- the only float allowed here.
  const floats = [...g.floatingLinks.values()].map((l) => l.parentId)
  return {
    linked: !!link && link.target_slot === 0,
    floats,
    laneFloatGone: !floats.some((p) => p === rec.lanes[2].in || p === rec.lanes[2].out),
    rides: JSON.stringify(chain) === JSON.stringify([rec.lanes[2].in, rec.lanes[2].out])
  }
}, ids)
ok('body release resumes the lane onto the model input', dropB.linked && dropB.laneFloatGone && dropB.rides, JSON.stringify(dropB))

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
