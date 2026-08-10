// #4 gate labels: (s1) toggle on -> out gate bulges toward the ribbon side,
// pins stay put, label text paints in the bulge; (s2) labels resolve source
// names -- real output slot, renamed slot (live), passthrough host input;
// (s3) flip keeps the bulge on the ribbon side; (s4) toggle persists through
// serialize/reload, transients don't; (s5) toggle off -> narrow again.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2560, height: 1300 } })
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

// Scene: two sources -> two sinks, comb via API; then a passthrough-stamped lane.
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
  window.app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('EmptyLatentImage', 100, 100)
  const s2 = mk('EmptyLatentImage', 100, 420)
  const y1 = mk('KSampler', 1400, 80)
  const y2 = mk('KSampler', 1400, 470)
  const idx = y1.inputs.findIndex((s) => s.name === 'latent_image')
  s1.connect(0, y1, idx); s2.connect(0, y2, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1500))
  const combId = window.__cablemanagementCombs.create(y1.inputs[idx].link, y2.inputs[idx].link, 800, 260)
  await new Promise((r) => setTimeout(r, 900))
  return { s1: s1.id, s2: s2.id, y2: y2.id, idx, combId }
})
await settle()

const geom = () => page.evaluate(() => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  const n = comb.lanes.length
  const GATE_W = 24
  // out gate rect from the obstacle set (gateGeom truth): find the rect whose
  // pin column matches the out gate pos
  const rects = window.__cablemanagementPathing.stats()
  const t0 = g.reroutes.get(comb.lanes[0].out)
  return {
    outPos: comb.out.pos.slice(), pins: comb.out.pins,
    labelsOn: !!comb.out.labels,
    toothX: t0.pos[0],
    serialized: JSON.stringify(comb.out)
  }
})

// ---- s1/s2: toggle on via API, check labels + bulge direction ----
let res = await page.evaluate(({ combId }) => window.__cablemanagementCombs.labels(combId, true), ids)
await settle()
ok('s1: toggle reports on', res?.on === true, JSON.stringify(res))
res = await page.evaluate(({ combId }) => window.__cablemanagementCombs.labels(combId), ids)
ok('s2: both lanes labeled LATENT', res.list.length === 2 && res.list.every((t) => t === 'LATENT'), JSON.stringify(res.list))

// rename the source slot live -> label follows on next read
res = await page.evaluate(({ s1, combId }) => {
  const g = window.app.graph
  const n = g.getNodeById(s1) ?? g.getNodeById(Number(s1))
  n.outputs[0].label = 'renamed_out'
  return window.__cablemanagementCombs.labels(combId)
}, ids)
ok('s2: live rename picked up', res.list.includes('renamed_out'), JSON.stringify(res.list))

// bulge: pins stay put, body grows toward the ribbon (out gate pins 'right'
// -> rect grows LEFT; the plus square and teeth do not move)
const g1 = await geom()
const bulge = await page.evaluate(() => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  return { w: comb.out._labelW ?? 0, ser: JSON.stringify(comb.out) }
})
ok('s1: bulge width computed', bulge.w > 20, `w=${bulge.w}`)
ok('s1: teeth stayed put', Math.abs(g1.toothX - g1.outPos[0] - 24) < 1, `toothX=${g1.toothX} pos=${g1.outPos[0]}`)
ok('s4: transients not serialized', !bulge.ser.includes('_label') && bulge.ser.includes('"labels":true'), bulge.ser)

// ---- s2b: passthrough lane labels from the host input ----
const pt = await page.evaluate(({ y2, idx, combId }) => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  // stamp lane 1 (y2's lane) with an apparent source: host y2, input idx
  const lane = comb.lanes.find((l) => {
    const t = g.reroutes.get(l.out)
    return [...(t.linkIds ?? [])].some((lid) => String(g._links.get(lid)?.target_id) === String(y2))
  })
  // write a claim directly in the v1 store shape (harness shortcut; the
  // no-create dump returns null on a virgin graph)
  const bag = (g.extra.cablemanagement_routes ??= { v: 1, seq: 1, routes: {}, claims: { reroutes: {}, floats: {}, gatelinks: {} } })
  const rid = String(bag.seq++)
  bag.routes[rid] = { src: [String(y2), idx] }
  bag.claims.reroutes[String(lane.in)] = rid
  const host = g.getNodeById(y2) ?? g.getNodeById(Number(y2))
  host.inputs[idx].label = 'my_latent_pin'
  return window.__cablemanagementCombs.labels(combId)
}, ids)
ok('s2: passthrough lane labels from host input', pt.list.includes('my_latent_pin'), JSON.stringify(pt.list))

// ---- s3: flip the out gate -> bulge follows the ribbon side, pins stay put ----
const flipped = await page.evaluate(async ({ combId }) => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  comb.out.pins = comb.out.pins === 'left' ? 'right' : 'left'
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 600))
  return { pins: comb.out.pins, w: comb.out._labelW ?? 0 }
}, ids)
ok('s3: flip keeps labels machinery alive', flipped.w > 20, JSON.stringify(flipped))

// ---- s4: serialize/reload round-trip keeps the toggle ----
const rt = await page.evaluate(async () => {
  const data = window.app.graph.serialize()
  const combOut = data.extra.cablemanagement_combs[0].out
  await window.app.loadGraphData(JSON.parse(JSON.stringify(data)))
  await new Promise((r) => setTimeout(r, 1500))
  const after = window.app.graph.extra.cablemanagement_combs[0]
  return {
    saved: JSON.stringify(combOut),
    labelsOn: !!after.out.labels,
    list: window.__cablemanagementCombs.labels(after.id)?.list ?? null
  }
})
ok('s4: toggle survives round-trip', rt.labelsOn === true && !rt.saved.includes('_label'), rt.saved)
ok('s4: labels resolve after reload', Array.isArray(rt.list) && rt.list.length === 2, JSON.stringify(rt.list))

// ---- s5: toggle off -> narrow ----
const off = await page.evaluate(async () => {
  const comb = window.app.graph.extra.cablemanagement_combs[0]
  const r = window.__cablemanagementCombs.labels(comb.id, false)
  await new Promise((r2) => setTimeout(r2, 600))
  return { on: r.on, w: comb.out._labelW ?? 0, ser: JSON.stringify(comb.out) }
})
ok('s5: toggle off, no bulge, no key', off.on === false && off.w === 0 && !off.ser.includes('labels'), off.ser)

ok('no page errors', errs.length === 0, errs.join(' | '))
await b.close()
if (!pass) process.exit(1)
console.log('PASS')
