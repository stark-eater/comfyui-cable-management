// Passthrough x comb round (Barney's QA): a widget-passthrough drag parked on a
// comb gate must be a durable limbo, not a mayfly.
// (1) the park makes a floating lane (primitive materialised, float from its
//     output); (2) the lane SURVIVES the next graph-surface press -- two reapers
//     used to kill it there: drag.js finish() counted only real output links as
//     consumers, and reapIfUnused had the same blind spot (floating links live in
//     graph.floatingLinks, not outputs[0].links); (3) pulling the lane's out-pin
//     completes it onto a real input, link riding the lane teeth; (4) the host
//     widget's value reaches the consumer in the prompt; (5) a parked lane
//     survives serialize/configure.
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
const dragScreen = async (from, to) => {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(from[0] + 40, from[1] + 20, { steps: 4 })
  await page.mouse.move(to[0], to[1], { steps: 12 })
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(400)
  await settle()
}

const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CLIPTextEncode', 100, 620); A.title = 'A'
  const B = mk('CLIPTextEncode', 1500, 620); B.title = 'B'
  const w = A.widgets.find((w) => w.name === 'text')
  w.value = 'combed literal'
  w.callback?.(w.value)
  const s1 = mk('CheckpointLoaderSimple', 60, 60)
  const t1 = mk('CheckpointSave', 1500, 80)
  const s2 = mk('CheckpointLoaderSimple', 60, 300)
  const t2 = mk('CheckpointSave', 1500, 320)
  s1.connect(0, t1, 0); s2.connect(0, t2, 0)
  const [l1, l2] = [...g._links.values()].map((l) => l.id)
  const combId = window.__cablemanagementCombs.create(l1, l2, 700, 300)
  window.__cablemanagementCombs.move(combId, 'out', 1100, 300)
  return { A: String(A.id), B: String(B.id), combId }
})
await settle()

// (1) park: A's widget pin onto the in-gate body
const pin = await page.evaluate((i) => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget'
  )
  if (!p) return null
  const r = p.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
const gIn = await page.evaluate(() => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const h = 24 + (c.lanes.length - 1) * 20
  return [c.in.pos[0] + 18, c.in.pos[1] + h / 2]
})
await dragScreen(pin, await screenOfGraph(gIn[0], gIn[1]))
const parkState = () => page.evaluate(() => {
  const g = window.app.graph
  const prim = g.nodes.find((n) => n.type === 'PrimitiveNode')
  return {
    lanes: g.extra.cablemanagement_combs[0]?.lanes.length,
    floating: g.floatingLinks.size,
    prim: !!prim,
    crossings: window.__cablemanagementPathing.routes().filter((r) => r.key.includes('|X')).length
  }
})
let st = await parkState()
ok('widget drag parks a floating lane', st.lanes === 3 && st.floating === 1 && st.prim, JSON.stringify(st))
ok('parked lane rides the ribbon', st.crossings === 3, `crossings=${st.crossings}`)

// (2) the park survives an unrelated graph-surface press (the reaper trigger)
const empty = await screenOfGraph(400, 900)
await page.mouse.click(empty[0], empty[1])
await page.waitForTimeout(300)
await settle()
st = await parkState()
ok('park survives the next canvas press', st.lanes === 3 && st.floating === 1 && st.prim, JSON.stringify(st))

// (3) pull the lane's out-pin onto B's text input
const outTooth = await page.evaluate(() => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  return g.reroutes.get(rec.lanes[2].out)?.pos.slice()
})
const tgt = await page.evaluate((i) => {
  const B = window.app.graph.getNodeById(Number(i.B))
  const k = B.inputs.findIndex((s) => s.widget?.name === 'text')
  const d = document.querySelector(`[data-slot-key="${i.B}-in-${k}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
await dragScreen(await screenOfGraph(outTooth[0], outTooth[1]), tgt)
const done = await page.evaluate(async (i) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  const prim = g.nodes.find((n) => n.type === 'PrimitiveNode')
  const B = g.getNodeById(Number(i.B))
  const k = B.inputs.findIndex((s) => s.widget?.name === 'text')
  const link = B.inputs[k].link != null ? g._links.get(B.inputs[k].link) : null
  const chain = []
  let rid = link?.parentId
  while (rid != null) { chain.push(rid); rid = g.getReroute(rid)?.parentId }
  chain.reverse()
  const p = await window.app.graphToPrompt()
  return {
    lanes: rec?.lanes.length,
    floating: g.floatingLinks.size,
    prim: prim ? String(prim.id) : null,
    linked: !!link,
    origin: link ? String(link.origin_id) : null,
    chainMatches: JSON.stringify(chain) === JSON.stringify([rec.lanes[2].in, rec.lanes[2].out]),
    bText: p.output[i.B]?.inputs?.text
  }
}, ids)
ok('out-pin pull completes onto the input', done.linked && done.floating === 0 && done.lanes === 3, JSON.stringify(done))
ok('link originates at the owned primitive', done.prim && done.origin === done.prim)
ok('real link rides the lane teeth', done.chainMatches)
ok('host widget value reaches the prompt', done.bText === 'combed literal', JSON.stringify(done.bText))

// (5) a parked lane survives serialize/configure
const reload = await page.evaluate(async (i) => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CLIPTextEncode', 100, 620)
  const s1 = mk('CheckpointLoaderSimple', 60, 60)
  const t1 = mk('CheckpointSave', 1500, 80)
  const s2 = mk('CheckpointLoaderSimple', 60, 300)
  const t2 = mk('CheckpointSave', 1500, 320)
  s1.connect(0, t1, 0); s2.connect(0, t2, 0)
  const [l1, l2] = [...g._links.values()].map((l) => l.id)
  const combId = window.__cablemanagementCombs.create(l1, l2, 700, 300)
  window.__cablemanagementCombs.move(combId, 'out', 1100, 300)
  return { A: String(A.id), combId }
}, ids)
await settle()
const pin2 = await page.evaluate((i) => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget'
  )
  if (!p) return null
  const r = p.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, reload)
const gIn2 = await page.evaluate(() => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const h = 24 + (c.lanes.length - 1) * 20
  return [c.in.pos[0] + 18, c.in.pos[1] + h / 2]
})
await dragScreen(pin2, await screenOfGraph(gIn2[0], gIn2[1]))
const cycled = await page.evaluate(async () => {
  const app = window.app, g = app.graph
  const data = g.serialize()
  g.configure(data)
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 200)) }
  const prim = g.nodes.find((n) => n.type === 'PrimitiveNode')
  return {
    lanes: g.extra.cablemanagement_combs?.[0]?.lanes.length,
    floating: g.floatingLinks.size,
    prim: !!prim,
    crossings: window.__cablemanagementPathing.routes().filter((r) => r.key.includes('|X')).length
  }
})
ok('parked lane survives reload', cycled.lanes === 3 && cycled.floating === 1 && cycled.prim, JSON.stringify(cycled))

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
