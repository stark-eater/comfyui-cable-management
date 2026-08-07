// SWEEP cell C -- delete a combed passthrough link ENTIRELY: lane pins must not
// survive wireless. Scene: widget-flavour passthroughs H->B1 and H->B2 (one owned
// primitive H behind A's ckpt pin), both links combed. Two deletion paths:
//   (1) graph API: g.removeLink(l1). Core path: disconnectInput(slot, false) ->
//       LLink.disconnect(graph, undefined) -> wireless reroutes are DELETED, so
//       the dead lane's teeth should leave graph.reroutes and combPass should
//       auto-decompose the one-lane comb (teeth of the survivor stay as plain
//       reroutes still carrying their link).
//   (2) UI: grab B2's input dot, drop on empty canvas, Escape whatever release
//       menu opens (ROOT graph -- Escape is safe here).
// After each: invariant 2 (no lane whose two teeth both exist yet carry zero LIVE
// linkIds AND zero LIVE floatingLinkIds; no wireless reroute at all; any comb
// record below 2 lanes gone after a settle) and invariant 1 for the SURVIVOR
// (draw start within 1.5px of the baseline pin anchor, never within 30px of H's
// true output slot, no route minted from the true origin), plus the survivor's
// teeth keeping their link. Evidence records what core left behind for the dead
// lane: teeth deleted vs floating chain vs wireless teeth (the bug).
//
// STABLE RED (2026-08-06), path (1): the dead lane's teeth survive WIRELESS.
// Mechanism: core LGraph.createReroute(pos, before) seeds floatingLinkIds with
// [before.id] even when `before` is a REAL LLink (it only branches on
// `before instanceof Reroute`), so every comb tooth minted by combs.js enroll()
// (graph.createReroute([0,0], link)) is born with a GHOST floating id equal to
// its real link id -- no such entry ever exists in graph.floatingLinks. On
// removeLink, LLink.disconnect only deletes a reroute `if (!keepReroutes &&
// !reroute.totalLinks)`; totalLinks counts the ghost, so the teeth stay. combPass
// (combs.js) then validates lanes by tooth EXISTENCE only, keeps the dead lane,
// renders its gate pins wireless forever, and the comb never drops below 2 lanes
// so auto-decompose cannot fire. Path (2) under this server's 'context menu'
// release decree never deletes at all: the litecontextmenu opens, Escape CANCELS,
// core restores the link -- invariants hold vacuously (evidence, not a bug).
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
const slotPt = (key) => page.evaluate((k) => {
  const r = document.querySelector(`[data-slot-key="${k}"]`)?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, key)
const screenOfGraph = (gx, gy) => page.evaluate(([gx, gy]) => {
  const { ds } = window.app.canvas
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
}, [gx, gy])
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
}

// Build the scene fresh: two widget passthroughs off A's ckpt pin, combed.
// Returns ids + link ids + lane records + baseline draws (pin anchor + H truth).
const build = async () => {
  const ids = await page.evaluate(async () => {
    const app = window.app, g = app.graph, L = window.LiteGraph
    g.clear()
    app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
    const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
    const A = mk('CheckpointLoaderSimple', 80, 100)
    const B1 = mk('CheckpointLoaderSimple', 1200, 60)
    const B2 = mk('CheckpointLoaderSimple', 1200, 420)
    g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1800))
    return {
      A: String(A.id), B1: String(B1.id), B2: String(B2.id),
      i1: B1.inputs.findIndex((s) => s.widget?.name === 'ckpt_name'),
      i2: B2.inputs.findIndex((s) => s.widget?.name === 'ckpt_name')
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
  const comb = await page.evaluate((ids) => {
    const g = window.app.graph
    const l1 = [...g._links.values()].find((l) => String(l.target_id) === String(ids.B1))
    const l2 = [...g._links.values()].find((l) => String(l.target_id) === String(ids.B2))
    if (!l1 || !l2) return null
    const id = window.__cablemanagementCombs.create(l1.id, l2.id, 700, 260)
    window.__cablemanagementCombs.move(id, 'out', 1000, 260)
    const rec = g.extra.cablemanagement_combs.find((c) => c.id === id)
    const laneOf = (lid) => rec.lanes.find((l) => g.reroutes.get(l.in)?.linkIds?.has?.(lid)) ?? null
    return { combId: id, l1: l1.id, l2: l2.id, lane1: laneOf(l1.id), lane2: laneOf(l2.id) }
  }, ids)
  await fresh()
  const base = await page.evaluate((c) => {
    const g = window.app.graph
    const draw = window.__cablemanagementDraw
    const H = g.nodes.find((n) => n.properties?.['cablemanagement.owned'])
    return {
      d1: draw.get(c.l1) ?? null,
      d2: draw.get(c.l2) ?? null,
      hOut: H ? [...H.getConnectionPos(false, 0)] : null,
      H: H?.id ?? null
    }
  }, comb)
  return { ...ids, ...comb, base }
}

// Full post-mutation audit. dead/surv are lane records {in, out}; deadLink/survLink
// link ids. All invariant raw material in one snapshot (after a fresh()).
// "Wireless" counts LIVE wires only: a linkIds entry must resolve in g._links and a
// floatingLinkIds entry in g.floatingLinks. Ghost ids are dangling references, not
// wires -- core's LGraph.createReroute(pos, before) seeds floatingLinkIds with
// [before.id] even when `before` is a REAL LLink, so every comb tooth is born with
// a ghost floating id equal to its real link id, and LLink.disconnect's
// delete-if-unused check (!reroute.totalLinks) never fires for them.
const audit = (arg) => page.evaluate((a) => {
  const g = window.app.graph
  const combs = g.extra?.cablemanagement_combs ?? []
  const liveWires = (r) => {
    if (!r) return 0
    let n = 0
    for (const id of r.linkIds ?? []) if (g._links.has(id)) n++
    for (const id of r.floatingLinkIds ?? []) if (g.floatingLinks?.has?.(id)) n++
    return n
  }
  const tooth = (rid) => {
    const r = g.reroutes?.get?.(rid)
    return r
      ? {
          linkIds: [...(r.linkIds ?? [])],
          floating: [...(r.floatingLinkIds ?? [])],
          ghostFloating: [...(r.floatingLinkIds ?? [])].filter((id) => !g.floatingLinks?.has?.(id)),
          live: liveWires(r),
          pos: [...r.pos]
        }
      : null
  }
  // invariant 2 raw material
  const orphanLanes = []
  for (const c of combs) {
    c.lanes.forEach((l, i) => {
      const ri = g.reroutes.get(l.in), ro = g.reroutes.get(l.out)
      if (ri && ro && liveWires(ri) === 0 && liveWires(ro) === 0) {
        orphanLanes.push({ comb: c.id, lane: i, in: l.in, out: l.out })
      }
    })
  }
  const orphanReroutes = [...(g.reroutes?.values() ?? [])]
    .filter((r) => liveWires(r) === 0).map((r) => r.id)
  const thinCombs = combs.filter((c) => c.lanes.length < 2).map((c) => c.id)
  // survivor truth
  const surv = g._links.get(a.survLink) ?? null
  const chain = []
  let rid = surv?.parentId
  while (rid != null) { chain.push(rid); rid = g.getReroute(rid)?.parentId }
  chain.reverse()
  const H = g.nodes.find((n) => n.properties?.['cablemanagement.owned'])
  const hOut = H ? [...H.getConnectionPos(false, 0)] : null
  const draw = window.__cablemanagementDraw ?? new Map()
  const routes = window.__cablemanagementPathing.routes()
  const routesNearH = hOut
    ? routes.filter((r) => Math.hypot(r.pts[0][0] - hOut[0], r.pts[0][1] - hOut[1]) < 30).map((r) => r.key)
    : []
  return {
    combLanes: combs.map((c) => ({ id: c.id, lanes: c.lanes.length })),
    orphanLanes, orphanReroutes, thinCombs,
    deadLinkPresent: g._links.has(a.deadLink),
    deadTeeth: { in: tooth(a.dead.in), out: tooth(a.dead.out) },
    survTeeth: { in: tooth(a.surv.in), out: tooth(a.surv.out) },
    survivor: surv ? { id: surv.id, target: String(surv.target_id), chain } : null,
    survDraw: draw.get(a.survLink) ?? null,
    floats: [...(g.floatingLinks?.values() ?? [])].map((l) => ({
      id: l.id, parentId: l.parentId ?? null, origin: String(l.origin_id), target: String(l.target_id)
    })),
    floatDraws: [...(g.floatingLinks?.values() ?? [])].map((l) => draw.get(l.id) ?? null),
    hOut, routesNearH,
    ledger: window.__cablemanagement.ledger().size
  }
}, arg)

const dist = (p, q) => (p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : Infinity)

// What core left behind for the dead lane: cancelled vs floating chain vs
// wireless/ghost teeth vs deleted teeth (live floats only count as a chain).
const classify = (s) => {
  if (s.deadLinkPresent) return 'nothing -- release CANCELLED, link restored'
  if (!s.deadTeeth.in && !s.deadTeeth.out) return 'teeth deleted'
  const liveFloat = (s.deadTeeth.in?.live ?? 0) + (s.deadTeeth.out?.live ?? 0) > 0
  return liveFloat ? 'floating chain on the teeth' : 'wireless teeth (ghost floating ids only)'
}

// Shared assertion block for both deletion paths. pin = baseline anchor [x, y].
const assertInvariants = (tag, s, pin, survLane) => {
  ok(`${tag} [inv2] no lane with two wireless teeth`, s.orphanLanes.length === 0, JSON.stringify({ orphanLanes: s.orphanLanes, deadTeeth: s.deadTeeth }))
  ok(`${tag} [inv2] no wireless reroute lingers`, s.orphanReroutes.length === 0, JSON.stringify(s.orphanReroutes))
  ok(`${tag} [inv2] no comb record below 2 lanes after settle`, s.thinCombs.length === 0, JSON.stringify({ thin: s.thinCombs, combs: s.combLanes }))
  ok(`${tag} survivor link alive`, !!s.survivor, JSON.stringify(s.survivor))
  ok(`${tag} [inv1] survivor draws from the pin anchor`, dist(s.survDraw, pin) <= 1.5, JSON.stringify({ draw: s.survDraw, pin }))
  ok(`${tag} [inv1] survivor draw start not at true origin`, dist(s.survDraw, s.hOut) >= 30, JSON.stringify({ draw: s.survDraw, hOut: s.hOut }))
  ok(`${tag} [inv1] no route starts at the true origin`, s.routesNearH.length === 0, JSON.stringify(s.routesNearH))
  const inHas = s.survTeeth.in?.linkIds?.includes(s.survivor?.id)
  const outHas = s.survTeeth.out?.linkIds?.includes(s.survivor?.id)
  const rides = s.survivor && JSON.stringify(s.survivor.chain) === JSON.stringify([survLane.in, survLane.out])
  ok(`${tag} surviving link's teeth keep their link`, !!(inHas && outHas && rides), JSON.stringify({ survTeeth: s.survTeeth, chain: s.survivor?.chain, lane: survLane }))
}

// ---- Part 1: API delete (g.removeLink) ------------------------------------------
console.log('== part 1: g.removeLink(H->B1) ==')
const sc1 = await build()
ok('scene 1 built (2 links, comb, hidden primitive)', !!(sc1.l1 && sc1.l2 && sc1.lane1 && sc1.lane2 && sc1.base.H != null), JSON.stringify({ l1: sc1.l1, l2: sc1.l2, lane1: sc1.lane1, lane2: sc1.lane2, H: sc1.base.H }))
ok('scene 1 baseline: both links draw from the pin', dist(sc1.base.d1, sc1.base.d2) < 1 && dist(sc1.base.d1, sc1.base.hOut) >= 30, JSON.stringify(sc1.base))
const pin1 = [sc1.base.d1[0], sc1.base.d1[1]]

await page.evaluate((sc) => { window.app.graph.removeLink(sc.l1) }, sc1)
await page.waitForTimeout(600)
await fresh()
const s1 = await audit({ dead: sc1.lane1, surv: sc1.lane2, deadLink: sc1.l1, survLink: sc1.l2 })
console.log('  evidence:', JSON.stringify({ deadLinkPresent: s1.deadLinkPresent, deadTeeth: s1.deadTeeth, floats: s1.floats, combs: s1.combLanes, ledger: s1.ledger }))
console.log('  core left behind:', classify(s1))
ok('api: dead link gone from graph', !s1.deadLinkPresent)
assertInvariants('api:', s1, pin1, sc1.lane2)

// ---- Part 2: UI delete (input dot dropped on empty canvas + Escape) -------------
console.log('== part 2: UI drop of H->B2 input end on empty canvas ==')
const sc2 = await build()
ok('scene 2 built', !!(sc2.l1 && sc2.l2 && sc2.lane1 && sc2.lane2 && sc2.base.H != null), JSON.stringify({ l1: sc2.l1, l2: sc2.l2 }))
const pin2 = [sc2.base.d1[0], sc2.base.d1[1]]

// Grab B2's ckpt input dot and release over empty graph space (well clear of the
// minimap corner and every node/gate). A release menu or search box may open --
// Escape at ROOT is safe.
const dot2 = await slotPt(`${sc2.B2}-in-${sc2.i2}`)
const empty = await screenOfGraph(440, 700)
await page.mouse.move(dot2[0], dot2[1])
await page.mouse.down()
await page.mouse.move(empty[0], empty[1], { steps: 12 })
await page.waitForTimeout(250)
await page.mouse.up()
await page.waitForTimeout(600)
const menu = await page.evaluate(() =>
  ['.litecontextmenu', '.p-contextmenu', '.comfy-vue-node-search-container', '[data-testid*="search"]']
    .map((s) => [s, document.querySelectorAll(s).length]).filter(([, n]) => n > 0)
)
console.log('  release UI open:', JSON.stringify(menu))
await page.keyboard.press('Escape')
await page.waitForTimeout(800)
await fresh()
const s2 = await audit({ dead: sc2.lane2, surv: sc2.lane1, deadLink: sc2.l2, survLink: sc2.l1 })
console.log('  evidence:', JSON.stringify({ deadLinkPresent: s2.deadLinkPresent, deadTeeth: s2.deadTeeth, floats: s2.floats, floatDraws: s2.floatDraws, combs: s2.combLanes, ledger: s2.ledger }))
console.log('  core left behind:', classify(s2))
assertInvariants('ui: ', s2, pin2, sc2.lane1)

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
