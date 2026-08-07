// SWEEP cell H -- in-tooth detach of a passthrough lane (widget flavour).
// Scene: one loader A, three loaders B1..B3 fed from A's ckpt_name pin (hidden
// primitive H drives all three), links combed into a 3-lane comb (create + api.add
// -- three lanes so the comb survives one detach). Then: mouse-pull lane l1's IN
// tooth 100px away (detachLane: lane spliced, partner out-tooth deleted, freed dot
// keeps the link), drag the freed dot another 80px, serialize+configure. After
// every step: invariant 1 (every link draws from the pin, never from H's slot; no
// route starts at H's slot) and invariant 2 (no wireless lanes, no orphan
// reroutes, no under-2-lane comb records).
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
const fresh = () => page.evaluate(async () => {
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})
const screenOfGraph = (gx, gy) => page.evaluate(([gx, gy]) => {
  const { ds } = window.app.canvas
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
}, [gx, gy])
const slotPt = (key) => page.evaluate((k) => {
  const r = document.querySelector(`[data-slot-key="${k}"]`)?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, key)
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
}

// --- scene: A + three consumers, grid multiples, away from the minimap corner
const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 80, 100)
  const B1 = mk('CheckpointLoaderSimple', 1200, 60)
  const B2 = mk('CheckpointLoaderSimple', 1200, 360)
  const B3 = mk('CheckpointLoaderSimple', 1200, 660)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1800))
  return {
    A: String(A.id), B1: String(B1.id), B2: String(B2.id), B3: String(B3.id),
    i1: B1.inputs.findIndex((s) => s.widget?.name === 'ckpt_name'),
    i2: B2.inputs.findIndex((s) => s.widget?.name === 'ckpt_name'),
    i3: B3.inputs.findIndex((s) => s.widget?.name === 'ckpt_name')
  }
})
const pinPt = () => page.evaluate((i) => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget'
  )
  const r = el?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, ids)
await drag(await pinPt(), await slotPt(`${ids.B1}-in-${ids.i1}`))
await page.waitForTimeout(1200)
await drag(await pinPt(), await slotPt(`${ids.B2}-in-${ids.i2}`))
await page.waitForTimeout(1200)
await drag(await pinPt(), await slotPt(`${ids.B3}-in-${ids.i3}`))
await page.waitForTimeout(1200)

// --- comb: create on l1+l2, third lane via api.add
const cids = await page.evaluate((ids) => {
  const g = window.app.graph
  const byTarget = (t) => [...g._links.values()].find((l) => String(l.target_id) === String(t))?.id ?? null
  const l1 = byTarget(ids.B1), l2 = byTarget(ids.B2), l3 = byTarget(ids.B3)
  if (l1 == null || l2 == null || l3 == null) return { l1, l2, l3, combId: null }
  const combId = window.__cablemanagementCombs.create(l1, l2, 700, 300)
  window.__cablemanagementCombs.move(combId, 'out', 1000, 300)
  window.__cablemanagementCombs.add(combId, l3)
  return { combId, l1, l2, l3 }
}, ids)
ok('scene: three passthrough links combed', cids.combId != null, JSON.stringify(cids))
if (cids.combId == null) { console.log('FAIL'); await b.close(); process.exit(1) }

// Full-truth snapshot; draws read from the LAST fresh() capture.
const snap = (tag) => page.evaluate((arg) => {
  const g = window.app.graph
  const H = g.nodes.find((n) => n.properties?.['cablemanagement.owned'])
  const hOut = H ? H.getConnectionPos(false, 0) : null
  const draw = window.__cablemanagementDraw ?? new Map()
  const links = {}
  for (const k of ['l1', 'l2', 'l3']) {
    const l = g._links.get(Number(arg[k]))
    links[k] = l ? { id: l.id, parentId: l.parentId ?? null, draw: draw.get(l.id) ?? null } : null
  }
  const routes = window.__cablemanagementPathing.routes()
  const nearH = hOut
    ? routes.filter((r) => Math.hypot(r.pts[0][0] - hOut[0], r.pts[0][1] - hOut[1]) < 30).map((r) => r.key)
    : []
  const reroutes = [...(g.reroutes?.values() ?? [])].map((r) => ({
    id: r.id, pos: r.pos.slice(),
    links: [...(r.linkIds ?? [])], floats: [...(r.floatingLinkIds ?? [])]
  }))
  const orphanRr = reroutes.filter((r) => !r.links.length && !r.floats.length).map((r) => r.id)
  const combs = (g.extra?.cablemanagement_combs ?? []).map((c) => ({ id: c.id, lanes: c.lanes.map((l) => ({ ...l })) }))
  const wireless = []
  for (const c of g.extra?.cablemanagement_combs ?? []) {
    for (const l of c.lanes) {
      const ri = g.reroutes?.get?.(l.in), ro = g.reroutes?.get?.(l.out)
      const carries = (r) => !!(r?.linkIds?.size || r?.floatingLinkIds?.size)
      if (ri && ro && !carries(ri) && !carries(ro)) wireless.push({ ...l })
    }
  }
  const under2 = (g.extra?.cablemanagement_combs ?? []).filter((c) => c.lanes.length < 2).map((c) => c.id)
  return { tag: arg.tag, hOut, links, nearH, reroutes, orphanRr, combs, wireless, under2, ledger: window.__cablemanagement.ledger().size }
}, { ...cids, tag })

const assertInv = (s, anchor) => {
  for (const k of ['l1', 'l2', 'l3']) {
    const L = s.links[k]
    ok(`${s.tag}: ${k} link alive`, !!L, L ? '' : 'link missing from graph')
    if (!L) continue
    const d = L.draw
    ok(`${s.tag}: inv1 ${k} draws from the pin`,
      d && Math.hypot(d[0] - anchor[0], d[1] - anchor[1]) <= 1.5,
      JSON.stringify({ draw: d, anchor }))
    ok(`${s.tag}: inv1 ${k} never draws from true origin`,
      !d || !s.hOut || Math.hypot(d[0] - s.hOut[0], d[1] - s.hOut[1]) >= 30,
      JSON.stringify({ draw: d, hOut: s.hOut }))
  }
  ok(`${s.tag}: inv1 no route starts at true origin`, s.nearH.length === 0, JSON.stringify(s.nearH))
  ok(`${s.tag}: inv2 no orphan reroutes`, s.orphanRr.length === 0, JSON.stringify(s.orphanRr))
  ok(`${s.tag}: inv2 no wireless lanes`, s.wireless.length === 0, JSON.stringify(s.wireless))
  ok(`${s.tag}: inv2 no under-2-lane comb records`, s.under2.length === 0, JSON.stringify(s.under2))
}

// --- baseline
await fresh()
const base = await snap('baseline')
ok('baseline: comb has 3 lanes', base.combs[0]?.lanes.length === 3, JSON.stringify(base.combs))
const anchor = base.links.l1?.draw ? [base.links.l1.draw[0], base.links.l1.draw[1]] : null
ok('baseline: l1 has a captured draw (anchor source)', !!anchor, JSON.stringify(base.links))
if (!anchor) { console.log('FAIL'); await b.close(); process.exit(1) }
assertInv(base, anchor)

// --- step 1: pull l1's IN tooth 100px away (detach)
const lane0 = await page.evaluate((c) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs.find((r) => r.id === c.combId)
  const lane = rec.lanes.find((l) => g.reroutes.get(l.in)?.linkIds?.has?.(Number(c.l1)))
  return lane ? { in: lane.in, out: lane.out, pos: g.reroutes.get(lane.in).pos.slice() } : null
}, cids)
ok('l1 lane located by its in-tooth', !!lane0, JSON.stringify(lane0))
const drop1 = [lane0.pos[0] - 60, lane0.pos[1] + 80] // 100px, into empty canvas
await drag(await screenOfGraph(lane0.pos[0], lane0.pos[1]), await screenOfGraph(drop1[0], drop1[1]))
await fresh()
const s1 = await snap('detach')
const rec1 = s1.combs.find((c) => c.id === cids.combId)
ok('detach: lane removed from the record', rec1?.lanes.length === 2 &&
  !rec1.lanes.some((l) => l.in === lane0.in || l.out === lane0.out), JSON.stringify(s1.combs))
ok('detach: partner out-tooth deleted', !s1.reroutes.some((r) => r.id === lane0.out),
  JSON.stringify(s1.reroutes.map((r) => r.id)))
const freed1 = s1.reroutes.find((r) => r.id === lane0.in)
ok('detach: freed dot survives and carries l1', !!freed1 && freed1.links.includes(Number(cids.l1)),
  JSON.stringify(freed1))
ok('detach: freed dot sits at the drop point', !!freed1 &&
  Math.hypot(freed1.pos[0] - drop1[0], freed1.pos[1] - drop1[1]) <= 15, JSON.stringify({ freed1, drop1 }))
ok('detach: l1 chains through the freed dot', s1.links.l1?.parentId === lane0.in, JSON.stringify(s1.links.l1))
assertInv(s1, anchor)

// --- step 2: drag the freed dot another 80px
const p2 = freed1 ? freed1.pos : drop1
const drop2 = [p2[0], p2[1] + 80]
await drag(await screenOfGraph(p2[0], p2[1]), await screenOfGraph(drop2[0], drop2[1]))
await fresh()
const s2 = await snap('dot-drag')
const freed2 = s2.reroutes.find((r) => r.id === lane0.in)
ok('dot-drag: freed dot moved to the new point', !!freed2 &&
  Math.hypot(freed2.pos[0] - drop2[0], freed2.pos[1] - drop2[1]) <= 15, JSON.stringify({ freed2, drop2 }))
ok('dot-drag: freed dot still carries l1', !!freed2 && freed2.links.includes(Number(cids.l1)), JSON.stringify(freed2))
ok('dot-drag: l1 still chains through the freed dot', s2.links.l1?.parentId === lane0.in, JSON.stringify(s2.links.l1))
ok('dot-drag: comb record untouched', s2.combs.find((c) => c.id === cids.combId)?.lanes.length === 2,
  JSON.stringify(s2.combs))
assertInv(s2, anchor)

// --- step 3: serialize + configure (client-side only; never saved to the server)
await page.evaluate(async () => {
  const g = window.app.graph
  const data = g.serialize()
  g.configure(data)
})
await page.waitForTimeout(2500)
await fresh()
const s3 = await snap('reload')
const rec3 = s3.combs.find((c) => c.id === cids.combId)
ok('reload: comb revives with 2 lanes', rec3?.lanes.length === 2, JSON.stringify(s3.combs))
const freed3 = s3.reroutes.find((r) => r.id === lane0.in)
ok('reload: freed dot revives carrying l1', !!freed3 && freed3.links.includes(Number(cids.l1)), JSON.stringify(freed3))
ok('reload: l1 still chains through the freed dot', s3.links.l1?.parentId === lane0.in, JSON.stringify(s3.links.l1))
assertInv(s3, anchor)

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
