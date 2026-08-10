// Ribbon IN pins as link-drop targets (QA 2f). Handled at capture-phase pointerup
// (combgestures) because the Vue finalize's reroute-at-pointer stage claims success
// on drops core actually refuses, eating the release with no fallback.
//  swap    -- drop A2's output on the in-pin of C's lane: C re-sources through the lane
//  park    -- drag C3's input onto the IN gate body: enrolls as a source-dangling lane
//  connect -- drop A2's output on that lane's in-pin: real link lands, float retires
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2100, height: 1100 } })
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

async function drag(from, to) {
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
}
const pinPos = (id, idx) => page.evaluate(({ id, idx }) => {
  const p = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${idx}"]`)
  const r = p?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })
const dotPos = (id, idx, out) => page.evaluate(({ id, idx, out }) => {
  const d = document.querySelector(`[data-slot-key="${id}-${out ? 'out' : 'in'}-${idx}"]`)
  const r = d?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx, out })
// Screen point of the in-gate pin for the lane carrying/aimed-at a target, or the gate body.
const gatePoint = (laneIndex, where) => page.evaluate(({ laneIndex, where }) => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  const GATE_W = 24, PAD = 12, PITCH = 20
  const [x, y] = comb.in.pos
  const h = PAD * 2 + Math.max(0, comb.lanes.length - 1) * PITCH
  // 'body' points at the "+" square below the gate: lane creation moved there
  // (#4 new-lane drop spot); the body itself is connect-to-first-matching-pin.
  const gx = where === 'body'
    ? x + GATE_W / 2
    : (comb.in.pins === 'left' ? x + 5 : x + GATE_W - 5)
  const gy = where === 'body' ? y + h + 4 + GATE_W / 2 : y + PAD + laneIndex * PITCH
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return [view.left + (gx + ds.offset[0]) * ds.scale, view.top + (gy + ds.offset[1]) * ds.scale]
}, { laneIndex, where })

const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const A = L.createNode('EmptyLatentImage'); A.pos = [150, 120]; A.title = 'A'; g.add(A)
  const A2 = L.createNode('EmptyLatentImage'); A2.pos = [150, 760]; A2.title = 'A2'; g.add(A2)
  const mk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const B = mk('B', 640, 100), C = mk('C', 1500, 100), C2 = mk('C2', 1500, 520), C3 = mk('C3', 1500, 930)
  const idx = B.inputs.findIndex((s) => s.name === 'latent_image')
  A.connect(0, B, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), A2: String(A2.id), B: String(B.id), C: String(C.id), C2: String(C2.id), C3: String(C3.id), idx }
})
await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.C, ids.idx))
await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.C2, ids.idx))
const comb = await page.evaluate(async ({ ids }) => {
  const g = window.app.graph
  const l1 = g.getNodeById(Number(ids.C)).inputs[ids.idx].link
  const l2 = g.getNodeById(Number(ids.C2)).inputs[ids.idx].link
  const combId = window.__cablemanagementCombs.create(l1, l2, 1050, 330)
  await new Promise((x) => setTimeout(x, 900))
  const rec = g.extra.cablemanagement_combs.find((c) => c.id === combId)
  const laneC = rec.lanes.findIndex((l) => g.reroutes.get(l.out)?.linkIds?.has?.(Number(l1)))
  return { combId, laneC, lanes: rec.lanes.length }
}, { ids })
ok('setup: comb with 2 lanes, C rides a known lane', comb.lanes === 2 && comb.laneC >= 0, JSON.stringify(comb))

const feed = (id) => page.evaluate(({ id, idx }) => {
  const g = window.app.graph
  const l = g.getNodeById(Number(id)).inputs[idx].link
  const link = l != null ? g.getLink(l) : null
  return link ? { origin: String(link.origin_id), threaded: link.parentId != null } : null
}, { id, idx: ids.idx })

// swap: A2's output dropped on C's in-pin
await drag(await dotPos(ids.A2, 0, true), await gatePoint(comb.laneC, 'pin'))
const s1 = { c: await feed(ids.C), c2: await feed(ids.C2) }
ok('swap: C re-sources to A2 THROUGH its lane', s1.c?.origin === ids.A2 && s1.c?.threaded === true, JSON.stringify(s1.c))
ok('swap: C2 untouched (still A through its lane)', s1.c2?.origin === ids.A && s1.c2?.threaded === true, JSON.stringify(s1.c2))

// park: C3's input dragged onto the IN gate body -> source-dangling lane
await drag(await dotPos(ids.C3, ids.idx, false), await gatePoint(0, 'body'))
const s2 = await page.evaluate(({ ids }) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  const floats = [...(g.floatingLinks?.values?.() ?? [])].map((f) => ({ target: String(f.target_id), parentId: f.parentId }))
  return { lanes: rec.lanes.length, floats }
}, { ids })
ok('park: third lane enrolled, source-dangling float holds C3',
  s2.lanes === 3 && s2.floats.some((f) => f.target === ids.C3), JSON.stringify(s2))

// connect: A2's output dropped on the dangling lane's in-pin
const laneIdx = await page.evaluate(({ C3 }) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  for (let i = 0; i < rec.lanes.length; i++) {
    const l = rec.lanes[i]
    for (const f of g.floatingLinks?.values?.() ?? []) {
      if (f.parentId === l.in || f.parentId === l.out) return i
    }
  }
  return -1
}, { C3: ids.C3 })
ok('connect: dangling lane located', laneIdx >= 0, `lane=${laneIdx}`)
await drag(await dotPos(ids.A2, 0, true), await gatePoint(laneIdx, 'pin'))
const s3 = await page.evaluate(({ ids }) => {
  const g = window.app.graph
  const l = g.getNodeById(Number(ids.C3)).inputs[ids.idx].link
  const link = l != null ? g.getLink(l) : null
  return {
    c3: link ? { origin: String(link.origin_id), threaded: link.parentId != null } : null,
    floats: [...(g.floatingLinks?.values?.() ?? [])].length,
  }
}, { ids })
ok('connect: C3 fed by A2 through the lane, float retired',
  s3.c3?.origin === ids.A2 && s3.c3?.threaded === true && s3.floats === 0, JSON.stringify(s3))

// re-source a SOURCE-HANGING lane (Barney's floating-ribbon flow): pull B's pin
// onto the gate body -> lane parks with a float that has an origin but no
// target; drop A2's output on its in-pin -> the float's source is replaced.
await drag(await pinPos(ids.B, ids.idx), await gatePoint(0, 'body'))
const h1 = await page.evaluate(({ ids }) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  for (let i = 0; i < rec.lanes.length; i++) {
    const l = rec.lanes[i]
    for (const f of g.floatingLinks?.values?.() ?? []) {
      if ((f.parentId === l.in || f.parentId === l.out) && String(f.target_id) === '-1') {
        return { lane: i, origin: String(f.origin_id), lanes: rec.lanes.length }
      }
    }
  }
  return null
}, { ids })
ok('hang: pin pull parked as a source-hanging lane', !!h1 && h1.lanes === 4, JSON.stringify(h1))
await drag(await dotPos(ids.A2, 0, true), await gatePoint(h1.lane, 'pin'))
const h2 = await page.evaluate(({ ids, lane }) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  const l = rec.lanes[lane]
  if (!l) return { gone: true }
  for (const f of g.floatingLinks?.values?.() ?? []) {
    if (f.parentId === l.in || f.parentId === l.out) {
      return { origin: String(f.origin_id), target: String(f.target_id), teeth: !!(g.reroutes.get(l.in) && g.reroutes.get(l.out)) }
    }
  }
  return { noFloat: true, teeth: !!(g.reroutes.get(l.in) && g.reroutes.get(l.out)) }
}, { ids, lane: h1?.lane ?? -1 })
ok("hang: the lane's hanging source swapped to A2, teeth intact",
  h2.origin === ids.A2 && h2.target === '-1' && h2.teeth === true, JSON.stringify(h2))

// PIN-SOURCED drop (QA floating_input.json): pull from a passthrough pin onto a
// live lane's in-pin -- the lane re-sources to the pin's true origin AND the
// consumer's record names the PIN (apparent source), not the origin.
const pinCase = await page.evaluate(async ({ ids }) => {
  const g = window.app.graph, L = window.LiteGraph
  const E = L.createNode('KSampler'); E.pos = [640, 660]; E.title = 'E'; g.add(E)
  g.getNodeById(Number(ids.A)).connect(0, E, ids.idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1500))
  return { E: String(E.id) }
}, { ids })
await drag(await pinPos(pinCase.E, ids.idx), await gatePoint(comb.laneC, 'pin'))
const p1 = await page.evaluate(({ ids }) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(ids.C))
  const lid = C.inputs[ids.idx].link
  const link = lid != null ? g.getLink(lid) : null
  return {
    origin: link ? String(link.origin_id) : null, threaded: link?.parentId != null,
    rec: C.properties?.['cablemanagement.from']?.[String(ids.idx)] ?? null,
  }
}, { ids })
ok('pin-pull: C re-sources through the lane to the pin’s true origin',
  p1.origin === ids.A && p1.threaded === true, JSON.stringify(p1))
ok('pin-pull: record names the pulled pin (apparent source)',
  String(p1.rec?.[0]) === pinCase.E && p1.rec?.[1] === ids.idx, JSON.stringify(p1.rec))

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
