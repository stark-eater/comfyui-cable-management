// MOVED links (core pickup of an EXISTING link by either end) dropped on
// ribbon surfaces -- the 2g straggler, ruled 2026-08-09: move never copies
// (every landing kills the donor link), and mismatched-polarity drops on gate
// pins are no-ops by force of logic ('there is no output-to-output drop').
// Scene per scenario: comb X1->Y1 / X2->Y2, separate plain A->B, free F/G.
//   s1 pickup at B.input -> IN gate body   = float lane from A, B empties
//   s2 pickup at B.input -> ribbon.input   = lane re-sources to A, B empties
//   s3 pickup at B.input -> ribbon.output  = polarity no-op, nothing changes
//   s4 shift at A.output -> OUT gate body  = float lane targeting B, A->B dies
//   s5 shift at A.output -> ribbon.input   = polarity no-op
//   s6 shift at A.output -> ribbon.output  = B joins lane X2's destinations
//                                            (already-correct core path, lock)
//   s7 fresh drags at gate pins, wrong polarity = no-ops, no release menu
// PCB render mode via sentinel (active() gates the comb gestures).
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2560, height: 1300 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}

await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(2600)

async function drag(from, to, mods = []) {
  for (const m of mods) await page.keyboard.down(m)
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
  for (const m of mods) await page.keyboard.up(m)
}
const dotPos = (id, idx, out) => page.evaluate(({ id, idx, out }) => {
  const d = document.querySelector(`[data-slot-key="${id}-${out ? 'out' : 'in'}-${idx}"]`)
  const r = d?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx, out })
const rrPt = (rid) => page.evaluate(({ rid }) => {
  const r = window.app.graph.reroutes.get(rid)
  if (!r) return null
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return [view.left + (r.pos[0] + ds.offset[0]) * ds.scale, view.top + (r.pos[1] + ds.offset[1]) * ds.scale]
}, { rid })
const gateBody = (side) => page.evaluate(({ side }) => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  const GATE_W = 24, PAD = 12
  const gate = comb[side]
  const [x, y] = gate.pos
  const h = PAD * 2 + Math.max(0, comb.lanes.length - 1) * 20
  const gx = gate.pins === 'left' ? x + GATE_W - 7 : x + 7
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return [view.left + (gx + ds.offset[0]) * ds.scale, view.top + (y + h / 2 + ds.offset[1]) * ds.scale]
}, { side })
const feed = (id, idx) => page.evaluate(({ id, idx }) => {
  const g = window.app.graph
  const n = g.getNodeById(Number(id))
  const lid = n.inputs?.[idx]?.link
  const link = lid != null ? g.getLink(lid) : null
  return { lid: lid ?? null, origin: link ? String(link.origin_id) : null, parent: link?.parentId ?? null, alive: !!link, dragging: link?._dragging ?? null }
}, { id, idx })
const liveOut = (id) => page.evaluate(({ id }) => {
  const g = window.app.graph
  const n = g.getNodeById(Number(id))
  return (n.outputs?.[0]?.links ?? []).filter((l) => g.getLink(l)).length
}, { id })
const world = () => page.evaluate(() => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs?.[0]
  return {
    lanes: comb?.lanes?.length ?? 0,
    teethAlive: comb ? comb.lanes.every((l) => g.reroutes.get(l.in) && g.reroutes.get(l.out)) : false,
    reroutes: g.reroutes.size,
    floats: [...(g.floatingLinks?.values?.() ?? [])].map((f) => ({ origin: String(f.origin_id), target: String(f.target_id) })),
    lastLinkId: g.state?.lastLinkId ?? null,
    menu: document.querySelectorAll('.litecontextmenu').length,
  }
})

// Fresh graph per scenario. Comb lanes carry X1->Y1 and X2->Y2; A->B plain;
// F (free output) and G (free input) for the fresh-drag polarity checks.
const buildScene = async () => {
  const ids = await page.evaluate(async () => {
    const g = window.app.graph, L = window.LiteGraph; g.clear()
    const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
    { const taken = [L.STRAIGHT_LINK, L.LINEAR_LINK, L.SPLINE_LINK, L.HIDDEN_LINK]; let v = 64; while (taken.includes(v)) v++; window.app.canvas.links_render_mode = v } // PCB sentinel
    const src = (t, x, y) => { const n = L.createNode('EmptyLatentImage'); n.pos = [x, y]; n.title = t; g.add(n); return n }
    const snk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
    const X1 = src('X1', 150, 100), X2 = src('X2', 150, 420), A = src('A', 150, 740), F = src('F', 150, 1040)
    const Y1 = snk('Y1', 1450, 80), Y2 = snk('Y2', 1450, 470), B = snk('B', 1450, 860), G = snk('G', 1950, 470)
    const idx = Y1.inputs.findIndex((s) => s.name === 'latent_image')
    X1.connect(0, Y1, idx); X2.connect(0, Y2, idx); A.connect(0, B, idx)
    g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1500))
    const combId = window.__cablemanagementCombs.create(Y1.inputs[idx].link, Y2.inputs[idx].link, 1000, 280)
    await new Promise((r) => setTimeout(r, 900))
    const rec = g.extra.cablemanagement_combs.find((c) => c.id === combId)
    const l2 = Y2.inputs[idx].link
    const i2 = rec.lanes.findIndex((l) => g.reroutes.get(l.out)?.linkIds?.has?.(Number(l2)))
    const o = { idx, laneX2: { ...rec.lanes[i2] }, ab: B.inputs[idx].link }
    for (const n of [X1, X2, A, F, Y1, Y2, B, G]) o[n.title] = String(n.id)
    return o
  })
  return ids
}

// ---- s1: pickup at B.input -> IN gate body ----
{
  const ids = await buildScene()
  await drag(await dotPos(ids.B, ids.idx), await gateBody('in'))
  const w = await world(), bf = await feed(ids.B, ids.idx)
  const oldAlive = await page.evaluate(({ id }) => !!window.app.graph.getLink(id), { id: ids.ab })
  ok('s1: new floating lane parked (3 lanes, teeth alive)', w.lanes === 3 && w.teethAlive, JSON.stringify(w))
  ok('s1: exactly one float, sourced from A', w.floats.length === 1 && w.floats[0].origin === ids.A, JSON.stringify(w.floats))
  ok('s1: B emptied (donor killed)', bf.lid === null, JSON.stringify(bf))
  ok('s1: old A->B link dead, A has no live out links', !oldAlive && (await liveOut(ids.A)) === 0)
}

// ---- s2: pickup at B.input -> ribbon.input pin (lane X2) ----
{
  const ids = await buildScene()
  await drag(await dotPos(ids.B, ids.idx), await rrPt(ids.laneX2.in))
  const w = await world(), bf = await feed(ids.B, ids.idx), y2 = await feed(ids.Y2, ids.idx)
  ok('s2: lane X2 re-sourced to A through the lane', y2.origin === ids.A && y2.parent === ids.laneX2.out, JSON.stringify(y2))
  ok('s2: B emptied (move, not copy)', bf.lid === null, JSON.stringify(bf))
  ok('s2: X2 freed, comb intact', (await liveOut(ids.X2)) === 0 && w.lanes === 2 && w.teethAlive, JSON.stringify(w))
}

// ---- s3: pickup at B.input -> ribbon.output pin = polarity no-op ----
{
  const ids = await buildScene()
  const before = await world()
  await drag(await dotPos(ids.B, ids.idx), await rrPt(ids.laneX2.out))
  const w = await world(), bf = await feed(ids.B, ids.idx), y2 = await feed(ids.Y2, ids.idx)
  ok('s3: A->B untouched, same link, visible', bf.lid === ids.ab && bf.alive && bf.dragging === null, JSON.stringify(bf))
  ok('s3: lane X2 untouched', y2.origin === ids.X2 && y2.parent === ids.laneX2.out, JSON.stringify(y2))
  ok('s3: comb + graph unchanged, no menu',
    w.lanes === 2 && w.teethAlive && w.reroutes === before.reroutes && w.lastLinkId === before.lastLinkId && w.menu === 0,
    JSON.stringify(w))
}

// ---- s4: shift pickup at A.output -> OUT gate body ----
{
  const ids = await buildScene()
  await drag(await dotPos(ids.A, 0, true), await gateBody('out'), ['Shift'])
  const w = await world(), bf = await feed(ids.B, ids.idx)
  const oldAlive = await page.evaluate(({ id }) => !!window.app.graph.getLink(id), { id: ids.ab })
  ok('s4: new floating lane parked (3 lanes, teeth alive)', w.lanes === 3 && w.teethAlive, JSON.stringify(w))
  ok('s4: exactly one float, targeting B', w.floats.length === 1 && w.floats[0].target === ids.B, JSON.stringify(w.floats))
  ok('s4: A->B dead -- no double feed', !oldAlive && bf.lid === null && (await liveOut(ids.A)) === 0, JSON.stringify(bf))
}

// ---- s5: shift pickup at A.output -> ribbon.input pin = polarity no-op ----
{
  const ids = await buildScene()
  const before = await world()
  await drag(await dotPos(ids.A, 0, true), await rrPt(ids.laneX2.in), ['Shift'])
  const w = await world(), bf = await feed(ids.B, ids.idx), y2 = await feed(ids.Y2, ids.idx)
  ok('s5: A->B untouched, same link, visible', bf.lid === ids.ab && bf.alive && bf.dragging === null, JSON.stringify(bf))
  ok('s5: lane X2 + graph unchanged, no menu',
    y2.origin === ids.X2 && w.lanes === 2 && w.teethAlive && w.lastLinkId === before.lastLinkId && w.menu === 0,
    JSON.stringify(w))
}

// ---- s6: shift pickup at A.output -> ribbon.output pin (regression lock) ----
{
  const ids = await buildScene()
  await drag(await dotPos(ids.A, 0, true), await rrPt(ids.laneX2.out), ['Shift'])
  const w = await world(), bf = await feed(ids.B, ids.idx), y2 = await feed(ids.Y2, ids.idx)
  const oldAlive = await page.evaluate(({ id }) => !!window.app.graph.getLink(id), { id: ids.ab })
  ok('s6: B joined lane X2 destinations (fed from X2 through the lane)',
    bf.origin === ids.X2 && bf.parent === ids.laneX2.out, JSON.stringify(bf))
  ok('s6: old A->B dead, A freed', !oldAlive && (await liveOut(ids.A)) === 0)
  ok('s6: Y2 kept its feed, comb intact', y2.origin === ids.X2 && w.lanes === 2 && w.teethAlive, JSON.stringify(w))
}

// ---- s7: fresh drags, wrong polarity, on gate pins = no-ops ----
{
  const ids = await buildScene()
  const before = await world()
  // fresh source drag (destination-seeking) on ribbon.output
  await drag(await dotPos(ids.F, 0, true), await rrPt(ids.laneX2.out))
  const w1 = await world()
  ok('s7: fresh output-drag on ribbon.output = no-op, no menu',
    (await liveOut(ids.F)) === 0 && w1.lanes === 2 && w1.lastLinkId === before.lastLinkId && w1.menu === 0,
    JSON.stringify(w1))
  // fresh consumer drag (source-seeking) on ribbon.input
  await drag(await dotPos(ids.G, ids.idx), await rrPt(ids.laneX2.in))
  const w2 = await world(), gf = await feed(ids.G, ids.idx)
  ok('s7: fresh input-drag on ribbon.input = no-op, no menu',
    gf.lid === null && w2.lanes === 2 && w2.teethAlive && w2.lastLinkId === before.lastLinkId && w2.menu === 0,
    JSON.stringify({ gf, w2 }))
}

console.log('page errors:', errs.length ? errs.slice(0, 8) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
