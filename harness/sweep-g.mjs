// SWEEP cell G -- user reroute AND comb teeth on the same passthrough link.
// Widget-flavour combed pair (A pin -> B1.ckpt, A pin -> B2.ckpt, both lanes in one
// comb). Then a USER reroute is spliced into l1's chain on both sides of the comb:
//   r1 BEFORE the in-gate  -- createReroute(pos, reroute) inserts ahead of the tooth
//   r2 AFTER the out-gate  -- createReroute(pos, link) inserts before the final segment
// After every mutation (insert r1, insert r2, drag each dot 80px, serialize+configure):
//   INV1  the link still DRAWS from the passthrough pin (ledger start within 1.5px of
//         the baseline pin anchor), never within 30px of the hidden primitive's slot,
//         and no route starts at the true origin; the first segment runs pin -> r1
//         (chain order is graph truth, draw start is render truth).
//   INV2  no lane whose two live teeth both carry zero links + zero floats, no
//         reroute with empty linkIds + floatingLinkIds, no comb record below 2 lanes.
//   RIBBON the lane still renders as a comb crossing (route key `${link}|X...`).
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
const near = (p, q, tol) => !!p && !!q && Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol

// ---- scene: widget passthrough x2, combed --------------------------------------
const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 80, 100)
  const B1 = mk('CheckpointLoaderSimple', 1200, 60)
  const B2 = mk('CheckpointLoaderSimple', 1200, 420)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1800))
  return {
    A: String(A.id), B1: String(B1.id), B2: String(B2.id),
    i1: B1.inputs.findIndex(s => s.widget?.name === 'ckpt_name'),
    i2: B2.inputs.findIndex(s => s.widget?.name === 'ckpt_name')
  }
})
const pinPt = () => page.evaluate(i => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget'
  )
  const r = el?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, ids)
const slotPt = (key) => page.evaluate(k => {
  const r = document.querySelector(`[data-slot-key="${k}"]`)?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, key)
const screenOfGraph = (gx, gy) => page.evaluate(([gx, gy]) => {
  const { ds } = window.app.canvas
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
}, [gx, gy])
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]); await page.waitForTimeout(150)
  await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
}
await drag(await pinPt(), await slotPt(`${ids.B1}-in-${ids.i1}`))
await page.waitForTimeout(1200)
await drag(await pinPt(), await slotPt(`${ids.B2}-in-${ids.i2}`))
await page.waitForTimeout(1200)
await page.evaluate(() => {
  const g = window.app.graph
  const links = [...g._links.values()].map(l => l.id)
  const id = window.__cablemanagementCombs.create(links[0], links[1], 700, 260)
  window.__cablemanagementCombs.move(id, 'out', 1000, 260)
})

// ---- one audit per step: burn frames, capture draws, routes, orphans -----------
const audit = (tag, extra = {}) => page.evaluate(async (arg) => {
  const g = window.app.graph
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 160)) }
  const H = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  const hOut = H ? H.getConnectionPos(false, 0).slice() : null
  const l1 = [...g._links.values()].find(l => String(l.target_id) === String(arg.B1))
  const l2 = [...g._links.values()].find(l => String(l.target_id) === String(arg.B2))
  const draw = window.__cablemanagementDraw
  const routes = window.__cablemanagementPathing.routes()
  const nearOrigin = hOut
    ? routes.filter(r => Math.hypot(r.pts[0][0] - hOut[0], r.pts[0][1] - hOut[1]) < 30).map(r => r.key.slice(0, 48))
    : []
  const combs = g.extra?.cablemanagement_combs ?? []
  const load = (r) => (r?.linkIds?.size ?? 0) + (r?.floatingLinkIds?.size ?? 0)
  const orphanLanes = []
  for (const c of combs) c.lanes.forEach((l, i) => {
    const ri = g.reroutes.get(l.in), ro = g.reroutes.get(l.out)
    if (ri && ro && load(ri) === 0 && load(ro) === 0) orphanLanes.push({ comb: c.id, lane: i })
  })
  const orphanReroutes = [...(g.reroutes?.values() ?? [])].filter(r => load(r) === 0).map(r => r.id)
  const under2 = combs.filter(c => c.lanes.length < 2).map(c => c.id)
  const chainOf = (l) => { const out = []; let rid = l?.parentId; while (rid != null) { out.push(rid); rid = g.getReroute(rid)?.parentId } out.reverse(); return out }
  const ribbon1 = routes.filter(r => r.key.startsWith(`${l1?.id}|X`)).length
  const ribbon2 = routes.filter(r => r.key.startsWith(`${l2?.id}|X`)).length
  // every route belonging to l1, first/last points -- evidence for the segment map
  const l1routes = routes.filter(r => r.key.startsWith(`${l1?.id}|`))
    .map(r => ({ key: r.key.slice(0, 44), first: r.pts[0], last: r.pts[r.pts.length - 1] }))
  return {
    tag: arg.tag, hOut,
    l1: l1?.id ?? null, l2: l2?.id ?? null,
    d1: draw.get(l1?.id) ?? null, d2: draw.get(l2?.id) ?? null,
    chain1: chainOf(l1), chain2: chainOf(l2),
    nearOrigin, orphanLanes, orphanReroutes, under2,
    ribbon1, ribbon2, l1routes,
    lanes: combs[0]?.lanes.map(l => ({ ...l })) ?? [],
    r1pos: arg.r1 != null ? (g.reroutes.get(arg.r1)?.pos.slice() ?? null) : null,
    r2pos: arg.r2 != null ? (g.reroutes.get(arg.r2)?.pos.slice() ?? null) : null
  }
}, { ...ids, ...extra, tag })

// baseline: both lanes draw from the pin; record the pin anchor in graph coords
const base = await audit('base')
console.log('  base evidence', JSON.stringify({ d1: base.d1, d2: base.d2, chain1: base.chain1, hOut: base.hOut }))
ok('[base] two combed links exist', base.l1 != null && base.l2 != null && base.ribbon1 > 0 && base.ribbon2 > 0,
  JSON.stringify({ l1: base.l1, l2: base.l2, ribbon1: base.ribbon1, ribbon2: base.ribbon2 }))
const basePin = base.d1 ? [base.d1[0], base.d1[1]] : null
ok('[base] both lanes draw from one pin anchor', near(base.d2, basePin, 1) && !near(basePin, base.hOut, 30),
  JSON.stringify({ basePin, d2: base.d2 }))
// ground the anchor against the DOM pin (graph coords via canvas rect + ds)
const domPin = await page.evaluate(i => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const c = window.app.canvas, cr = c.canvas.getBoundingClientRect()
  return [
    (r.x + r.width / 2 - cr.left) / c.ds.scale - c.ds.offset[0],
    (r.y + r.height / 2 - cr.top) / c.ds.scale - c.ds.offset[1]
  ]
}, ids)
ok('[base] anchor IS the DOM pin', near(basePin, domPin, 3), JSON.stringify({ basePin, domPin }))

const checkInv = (tag, a, expectChain1) => {
  ok(`[${tag}] inv1: l1 draws from the pin`, near(a.d1, basePin, 1.5), JSON.stringify(a.d1))
  ok(`[${tag}] inv1: l2 (sibling) draws from the pin`, near(a.d2, basePin, 1.5), JSON.stringify(a.d2))
  ok(`[${tag}] inv1: draw start never at true origin`,
    !!a.d1 && !!a.hOut && !near(a.d1, a.hOut, 30) && !near(a.d2, a.hOut, 30),
    JSON.stringify({ d1: a.d1, hOut: a.hOut }))
  ok(`[${tag}] inv1: no route minted from the true origin`, a.nearOrigin.length === 0, JSON.stringify(a.nearOrigin))
  ok(`[${tag}] ribbon still renders for both lanes`, a.ribbon1 > 0 && a.ribbon2 > 0,
    JSON.stringify({ ribbon1: a.ribbon1, ribbon2: a.ribbon2 }))
  ok(`[${tag}] inv2: no wireless lanes / orphan reroutes / sub-2-lane combs`,
    a.orphanLanes.length === 0 && a.orphanReroutes.length === 0 && a.under2.length === 0,
    JSON.stringify({ lanes: a.orphanLanes, reroutes: a.orphanReroutes, under2: a.under2 }))
  if (expectChain1) ok(`[${tag}] l1 chain order is ${JSON.stringify(expectChain1)}`,
    JSON.stringify(a.chain1) === JSON.stringify(expectChain1), JSON.stringify(a.chain1))
  // if a route exists for the pin->r1 segment (ends at the user dot), it must START at the pin
  if (a.r1pos) {
    const seg = a.l1routes.filter(r => near(r.last, a.r1pos, 12))
    ok(`[${tag}] first segment: pin -> user dot (${seg.length} routed)`,
      seg.every(r => near(r.first, basePin, 1.5) && !near(r.first, a.hOut, 30)),
      JSON.stringify(seg))
  }
}

// ---- step 1: user reroute BEFORE the in-gate ------------------------------------
const ins1 = await page.evaluate((arg) => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  const lane = comb.lanes.find(l => g.reroutes.get(l.in)?.linkIds?.has?.(arg.l1))
  if (!lane) return { r: null, lane: null }
  const r = g.createReroute([460, 180], g.reroutes.get(lane.in))
  g.setDirtyCanvas(true, true)
  return { r: r?.id ?? null, lane: { ...lane } }
}, { l1: base.l1 })
ok('[r1] reroute inserted before the in-tooth', ins1.r != null && ins1.lane != null, JSON.stringify(ins1))
const a1 = await audit('r1-inserted', { r1: ins1.r })
console.log('  r1 evidence', JSON.stringify({ chain1: a1.chain1, l1routes: a1.l1routes }))
checkInv('r1-inserted', a1, [ins1.r, ins1.lane.in, ins1.lane.out])

// ---- step 2: user reroute AFTER the out-gate ------------------------------------
// createReroute(pos, link) splices before the LINK's final segment: the new dot's
// parent must be the old link.parentId (the out-tooth), landing out-gate -> r2 -> B1.
const ins2 = await page.evaluate((arg) => {
  const g = window.app.graph
  const link = g._links.get(arg.l1)
  const parentBefore = link?.parentId ?? null
  const r = g.createReroute([1120, 180], link)
  g.setDirtyCanvas(true, true)
  return { r: r?.id ?? null, parentBefore, parentAfter: link?.parentId ?? null, rParent: r?.parentId ?? null }
}, { l1: base.l1 })
ok('[r2] reroute landed after the out-tooth', ins2.r != null &&
  ins2.parentBefore === ins1.lane.out && ins2.parentAfter === ins2.r && ins2.rParent === ins1.lane.out,
  JSON.stringify(ins2))
const a2 = await audit('r2-inserted', { r1: ins1.r, r2: ins2.r })
console.log('  r2 evidence', JSON.stringify({ chain1: a2.chain1, l1routes: a2.l1routes }))
checkInv('r2-inserted', a2, [ins1.r, ins1.lane.in, ins1.lane.out, ins2.r])

// ---- step 3: drag each user dot 80px (real mouse; plain drag moves the dot) ----
await drag(await screenOfGraph(460, 180), await screenOfGraph(460, 100))
const a3 = await audit('r1-moved', { r1: ins1.r, r2: ins2.r })
console.log('  r1-moved evidence', JSON.stringify({ r1pos: a3.r1pos, chain1: a3.chain1 }))
ok('[r1-moved] the dot actually moved ~80px', near(a3.r1pos, [460, 100], 15), JSON.stringify(a3.r1pos))
checkInv('r1-moved', a3, [ins1.r, ins1.lane.in, ins1.lane.out, ins2.r])

await drag(await screenOfGraph(1120, 180), await screenOfGraph(1120, 260))
const a4 = await audit('r2-moved', { r1: ins1.r, r2: ins2.r })
console.log('  r2-moved evidence', JSON.stringify({ r2pos: a4.r2pos, chain1: a4.chain1 }))
ok('[r2-moved] the dot actually moved ~80px', near(a4.r2pos, [1120, 260], 15), JSON.stringify(a4.r2pos))
checkInv('r2-moved', a4, [ins1.r, ins1.lane.in, ins1.lane.out, ins2.r])

// ---- step 4: serialize + configure roundtrip ------------------------------------
await page.evaluate(async () => {
  const app = window.app, g = app.graph
  const data = g.serialize()
  g.configure(data)
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 200)) }
})
await page.waitForTimeout(1200)
const a5 = await audit('reloaded', { r1: ins1.r, r2: ins2.r })
console.log('  reload evidence', JSON.stringify({ chain1: a5.chain1, lanes: a5.lanes, r1pos: a5.r1pos, r2pos: a5.r2pos, d1: a5.d1 }))
ok('[reloaded] user dots survive with their positions', near(a5.r1pos, [460, 100], 15) && near(a5.r2pos, [1120, 260], 15),
  JSON.stringify({ r1: a5.r1pos, r2: a5.r2pos }))
checkInv('reloaded', a5, [ins1.r, ins1.lane.in, ins1.lane.out, ins2.r])

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
