// SWEEP CELL D -- disconnect a combed link into a floating lane, then delete the float.
//
// Scene: widget passthrough pin dragged to two loaders (hidden primitive H feeds
// H->B1 and H->B2), both links combed. Steps:
//   1. Grab B1's ckpt input dot, release over EMPTY canvas, dismiss the popup.
//      Expectation (cell premise): core keeps the reroute chain alive as a
//      FLOATING link riding the teeth. Invariant 1 after: the float (ledger
//      floating case, reanchor.js section 3 owned-origin fallback) and the
//      surviving sibling both draw from the pin, never from H's output; no
//      route starts at H.
//   2. Delete the floating link (inspect the instance: link.disconnect /
//      graph.removeFloatingLink). Invariant 2 after: no tooth lingers with zero
//      LIVE linkIds and zero LIVE floatingLinkIds, no comb lane survives
//      wireless, a comb below two wired lanes decomposes, and
//      graph.extra.cablemanagement_floatfrom holds no entry for a dead reroute
//      (reanchor.js prune()).
//
// KNOWN CORE WRINKLE (found reading the 1.48 bundle): LGraph.createReroute(pos,
// <LLink>) seeds floatingLinkIds = [link.id] even for a REAL link, and
// LLink.disconnect(graph, 'output') only mints the floating chain when
// lastReroute.floatingLinkIds.size === 0. Comb teeth are all born via
// createReroute(pos, link), so the phantom seed may veto the float entirely --
// if so, step 1's core assert goes red and step 2 asserts invariant 2 against
// whatever the disconnect left behind. Live-id counting (ids intersected with
// g._links / g.floatingLinks) keeps the orphan check honest either way.
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
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity)

// ---- scene: A's widget pin -> B1.ckpt_name and B2.ckpt_name, then comb -------------
const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
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
  await page.mouse.move(from[0], from[1]); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
}
// Burn redraw frames with capture on, then read (ghost-route trap).
const fresh = () => page.evaluate(async () => {
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})
// Popup + connector snapshot (link-release menu diagnosis).
const gesture = () => page.evaluate(() => ({
  connecting: window.app.canvas.linkConnector.isConnecting,
  menu: !!document.querySelector('.litecontextmenu'),
  search: !!document.querySelector('.node-search-box-dialog-mask')
}))

await drag(await pinPt(), await slotPt(`${ids.B1}-in-${ids.i1}`))
await page.waitForTimeout(400)
await drag(await pinPt(), await slotPt(`${ids.B2}-in-${ids.i2}`))
await page.waitForTimeout(400)

const combed = await page.evaluate((ids) => {
  const g = window.app.graph
  const l1 = [...g._links.values()].find(l => String(l.target_id) === String(ids.B1))
  const l2 = [...g._links.values()].find(l => String(l.target_id) === String(ids.B2))
  if (!l1 || !l2) return { l1: null, l2: null }
  const id = window.__cablemanagementCombs.create(l1.id, l2.id, 700, 260)
  window.__cablemanagementCombs.move(id, 'out', 1000, 260)
  return { l1: l1.id, l2: l2.id, combId: id }
}, ids)
ok('scene built: two passthrough links to comb', combed.l1 != null && combed.l2 != null, JSON.stringify(combed))
if (combed.l1 == null) { console.log('FAIL'); await b.close(); process.exit(1) }

// Tooth truth: raw id sets plus LIVE counts (ids actually present in g._links /
// g.floatingLinks -- createReroute's phantom seed makes raw sets lie).
const toothState = () => page.evaluate((arg) => {
  const g = window.app.graph
  const sum = (r) => r ? {
    id: r.id,
    links: [...(r.linkIds ?? [])],
    floats: [...(r.floatingLinkIds ?? [])],
    liveLinks: [...(r.linkIds ?? [])].filter(id => g._links.has(id)).length,
    liveFloats: [...(r.floatingLinkIds ?? [])].filter(id => g.floatingLinks?.has?.(id)).length
  } : null
  const rec = (g.extra?.cablemanagement_combs ?? [])[0] ?? null
  return {
    lanes: rec ? rec.lanes.map(l => ({ in: sum(g.reroutes?.get?.(l.in)), out: sum(g.reroutes?.get?.(l.out)) })) : null,
    reroutes: [...(g.reroutes?.values?.() ?? [])].map(sum),
    floats: [...(g.floatingLinks?.values?.() ?? [])].map(f => ({ id: f.id, origin: String(f.origin_id), parentId: f.parentId ?? null }))
  }
}, {})

await fresh()
const base = await page.evaluate((arg) => {
  const g = window.app.graph
  const H = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  const rec = (g.extra?.cablemanagement_combs ?? [])[0] ?? null
  return {
    ...arg,
    H: H ? String(H.id) : null,
    hOut: H ? [...H.getConnectionPos(false, 0)] : null,
    d1: window.__cablemanagementDraw.get(arg.l1) ?? null,
    d2: window.__cablemanagementDraw.get(arg.l2) ?? null,
    lanes: rec ? rec.lanes.map(l => ({ ...l })) : null,
    ledger: window.__cablemanagement.ledger().size
  }
}, { ...ids, ...combed })
const pin = base.d1 ? [base.d1[0], base.d1[1]] : null
ok('baseline: hidden primitive H exists', !!base.H, JSON.stringify({ H: base.H }))
ok('baseline: comb holds 2 lanes', base.lanes?.length === 2, JSON.stringify(base.lanes))
ok('baseline: both links draw from one pin anchor', !!pin && dist([base.d2?.[0], base.d2?.[1]], pin) < 1.5,
  JSON.stringify({ d1: base.d1, d2: base.d2 }))
ok('baseline: pin anchor is not the true origin', dist(pin, base.hOut) > 30,
  JSON.stringify({ pin, hOut: base.hOut }))
console.log('    baseline teeth:', JSON.stringify(await toothState()))

// ---- step 1: disconnect B1's input into empty canvas ------------------------------
const dot = await slotPt(`${ids.B1}-in-${ids.i1}`)
const empty = await screenOfGraph(600, 660) // clear of nodes, gates, routes; far from minimap
await page.mouse.move(dot[0], dot[1])
await page.mouse.down()
await page.mouse.move(empty[0], empty[1], { steps: 12 })
await page.waitForTimeout(250)
await page.mouse.up()
await page.waitForTimeout(500)
console.log('    after release:', JSON.stringify(await gesture()))
await page.keyboard.press('Escape')
await page.waitForTimeout(600)
let gs = await gesture()
console.log('    after Escape:', JSON.stringify(gs))
if (gs.connecting || gs.menu || gs.search) {
  // The link-release CONTEXT MENU (server pins Comfy.LinkRelease.Action to it)
  // ignores Escape; its controller aborts -- running disconnectLinks + reset --
  // when a press lands outside it. Click far from menu/nodes/minimap.
  const away = await screenOfGraph(300, 660)
  await page.mouse.click(away[0], away[1])
  await page.waitForTimeout(600)
  gs = await gesture()
  console.log('    after dismiss click:', JSON.stringify(gs))
}
await fresh()

const s1 = await page.evaluate((base) => {
  const g = window.app.graph
  const stillLinked = [...g._links.values()].some(l => String(l.target_id) === String(base.B1))
  const floats = [...(g.floatingLinks?.values?.() ?? [])].map(f => ({
    id: f.id, origin: String(f.origin_id), parentId: f.parentId ?? null
  }))
  const f = floats.find(x => x.origin === base.H) ?? floats[0] ?? null
  const rec = (g.extra?.cablemanagement_combs ?? [])[0] ?? null
  const H = base.H ? (g.getNodeById(base.H) ?? g.getNodeById(Number(base.H))) : null
  const hOut = H ? [...H.getConnectionPos(false, 0)] : base.hOut
  const routes = window.__cablemanagementPathing.routes()
  const nearH = hOut ? routes.filter(r => Math.hypot(r.pts[0][0] - hOut[0], r.pts[0][1] - hOut[1]) < 30).map(r => r.key) : []
  return {
    stillLinked, floats, f,
    fd: f ? window.__cablemanagementDraw.get('f' + f.id) ?? null : null,
    d2: window.__cablemanagementDraw.get(base.l2) ?? null,
    lanes: rec?.lanes?.length ?? 0, hOut, nearH,
    connecting: window.app.canvas.linkConnector.isConnecting,
    ff: (() => { const b = g.extra?.cablemanagement_routes; const o = {}; for (const k of Object.keys(b?.claims?.floats ?? {})) o[k] = b.routes[b.claims.floats[k]]?.src ?? null; return Object.keys(o).length ? o : null })(),
    ledger: window.__cablemanagement.ledger().size
  }
}, base)
console.log('    teeth after disconnect:', JSON.stringify(await toothState()))
ok('[core] connector reset after dismissing the popup', !s1.connecting)
ok('[core] B1 input disconnected', !s1.stillLinked)
ok('[core] disconnect leaves a floating chain riding the teeth',
  s1.floats.length === 1 && s1.f?.origin === base.H, JSON.stringify(s1.floats))
if (s1.f) {
  ok('[inv1] float draws from the pin', s1.fd && pin && dist([s1.fd[0], s1.fd[1]], pin) < 1.5,
    JSON.stringify({ fd: s1.fd, pin }))
  ok('[inv1] float draw start clear of the true origin', dist(s1.fd ? [s1.fd[0], s1.fd[1]] : null, s1.hOut) > 30,
    JSON.stringify({ fd: s1.fd, hOut: s1.hOut }))
} else {
  console.log('    (skip) float-anchor invariants -- no float was minted (see core assert above)')
}
ok('[inv1] sibling combed link still draws from the pin', s1.d2 && pin && dist([s1.d2[0], s1.d2[1]], pin) < 1.5,
  JSON.stringify({ d2: s1.d2, pin }))
ok('[inv1] no route starts at the true origin', s1.nearH.length === 0, JSON.stringify(s1.nearH))

// ---- step 2: delete the float (or, absent one, audit what the disconnect left) ----
if (s1.f) {
  const del = await page.evaluate((base) => {
    const g = window.app.graph
    const f = [...(g.floatingLinks?.values?.() ?? [])].find(x => String(x.origin_id) === base.H)
      ?? [...(g.floatingLinks?.values?.() ?? [])][0]
    if (!f) return { present: false }
    const inst = {
      'link.disconnect': typeof f.disconnect,
      'graph.removeFloatingLink': typeof g.removeFloatingLink
    }
    // removeFloatingLink ONLY: calling disconnect first walks the chain and core
    // re-mints a replacement float through the surviving reroutes (the
    // reroutes-keep-floating-chain feature) -- that is correct core behaviour,
    // not residue. Removing the float outright leaves the teeth wireless, which
    // the extension's combPass liveness reaper must then clean up (the assert).
    let used = null, err = null
    try {
      for (const fl of [...(g.floatingLinks?.values?.() ?? [])]) g.removeFloatingLink(fl)
      used = 'graph.removeFloatingLink (all)'
    } catch (e) { err = String(e) }
    g.setDirtyCanvas(true, true)
    return { present: true, inst, used, err, remaining: g.floatingLinks?.size ?? 0 }
  }, base)
  console.log('    float delete:', JSON.stringify(del))
  ok('float instance found and a delete path exists', del.present && del.used && !del.err, JSON.stringify(del))
  await page.waitForTimeout(1200) // let combPass + the sync pass (prune) run
} else {
  await page.waitForTimeout(1200)
}
await fresh()

const s2 = await page.evaluate((base) => {
  const g = window.app.graph
  const live = (r) => ({
    id: r.id,
    links: [...(r.linkIds ?? [])],
    floats: [...(r.floatingLinkIds ?? [])],
    liveLinks: [...(r.linkIds ?? [])].filter(id => g._links.has(id)).length,
    liveFloats: [...(r.floatingLinkIds ?? [])].filter(id => g.floatingLinks?.has?.(id)).length
  })
  const reroutes = [...(g.reroutes?.values?.() ?? [])].map(live)
  const wireless = reroutes.filter(r => r.liveLinks + r.liveFloats === 0)
  const combs = (g.extra?.cablemanagement_combs ?? []).map(c => {
    const wired = c.lanes.filter(l => {
      const a = g.reroutes?.get?.(l.in), b = g.reroutes?.get?.(l.out)
      const tot = (r) => r ? live(r).liveLinks + live(r).liveFloats : 0
      return tot(a) + tot(b) > 0
    }).length
    return { id: c.id, lanes: c.lanes.length, wired }
  })
  const ff = (() => { const b = g.extra?.cablemanagement_routes; const o = {}; for (const k of Object.keys(b?.claims?.floats ?? {})) o[k] = b.routes[b.claims.floats[k]]?.src ?? null; return Object.keys(o).length ? o : null })()
  const ffDead = ff ? Object.keys(ff).filter(rid => !g.reroutes?.get?.(Number(rid))) : []
  const H = base.H ? (g.getNodeById(base.H) ?? g.getNodeById(Number(base.H))) : null
  const hOut = H ? [...H.getConnectionPos(false, 0)] : base.hOut
  const routes = window.__cablemanagementPathing.routes()
  const nearH = hOut ? routes.filter(r => Math.hypot(r.pts[0][0] - hOut[0], r.pts[0][1] - hOut[1]) < 30).map(r => r.key) : []
  return {
    floating: g.floatingLinks?.size ?? 0,
    reroutes, wireless, combs, ff, ffDead,
    d2: window.__cablemanagementDraw.get(base.l2) ?? null,
    survivorLinked: [...g._links.values()].some(l => String(l.target_id) === String(base.B2)),
    hOut, nearH, ledger: window.__cablemanagement.ledger().size
  }
}, base)
ok('no floating link remains', s2.floating === 0, `floating=${s2.floating}`)
ok('[inv2] no tooth lingers wireless (zero live linkIds + zero live floatingLinkIds)',
  s2.wireless.length === 0, JSON.stringify(s2.wireless))
ok('[inv2] no comb lane survives with wireless teeth',
  s2.combs.every(c => c.wired === c.lanes), JSON.stringify(s2.combs))
ok('[inv2] a comb below two wired lanes is decomposed after a settle',
  s2.combs.every(c => c.wired >= 2), JSON.stringify(s2.combs))
ok('[inv2] no floatfrom entry for a dead reroute (prune)', s2.ffDead.length === 0,
  JSON.stringify({ ff: s2.ff, dead: s2.ffDead }))
ok('[inv1] survivor still draws from the pin after the cleanup',
  s2.survivorLinked && s2.d2 && pin && dist([s2.d2[0], s2.d2[1]], pin) < 1.5,
  JSON.stringify({ d2: s2.d2, pin, survivorLinked: s2.survivorLinked }))
ok('[inv1] no route starts at the true origin after the cleanup', s2.nearH.length === 0, JSON.stringify(s2.nearH))

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
