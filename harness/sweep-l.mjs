// SWEEP cell L -- pin-born float completed via out-pin pull, INPUT flavour.
//
// Scene: A(loader) -> S1(save) model link puts an input-passthrough pin on S1-in-0.
// A comb exists between two OTHER plain links (L2->T2, L3->T3). The pin is dragged
// onto the IN gate body: parks as a dangling lane (floating link from A, floatfrom
// recorded on the chain's terminus reroute -- drag.js connectFloatingReroute patch).
// Then the lane's OUT tooth is pulled onto S2's node BODY: combgestures' pointerup
// falls through its 20px slot-proximity search to lc.dropLinks, core connects
// A->S2 through the lane, 'link-created' fires, and drag.js is supposed to inherit
// pin provenance from the floatfrom record (floatFromOf) and recordProvenance on
// S2. INPUT flavour has NO owned-primitive fallback in the ledger (reanchor.js
// build pass 2 vs pass 1), so a missing/mismatched record = immediate reversion:
// the completed link draws from A's true output instead of S1's pin.
//
// Invariants after every step:
//   1 ANCHOR    passthrough draws start on S1's pin (<=1.5px), never within 30px
//               of the true origin (A's out slot); no route minted from A's out.
//   2 NO ORPHANS no lane/reroute with zero linkIds AND zero floatingLinkIds; no
//               comb record below 2 lanes after a settle.
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
const dist = (p, q) => (p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : Infinity)

// Scene at grid multiples of 10, everything interactive out of x>1560 && y>780.
const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 60, 60)
  const S1 = mk('CheckpointSave', 560, 60)
  const S2 = mk('CheckpointSave', 1140, 560)
  const L2 = mk('CheckpointLoaderSimple', 60, 300)
  const T2 = mk('CheckpointSave', 1440, 80)
  const L3 = mk('CheckpointLoaderSimple', 60, 620)
  const T3 = mk('CheckpointSave', 1440, 300)
  A.connect(0, S1, 0) // model: the input-passthrough seed
  L2.connect(0, T2, 0)
  L3.connect(0, T3, 0)
  const l2 = [...g._links.values()].find((l) => String(l.origin_id) === String(L2.id)).id
  const l3 = [...g._links.values()].find((l) => String(l.origin_id) === String(L3.id)).id
  return { A: String(A.id), S1: String(S1.id), S2: String(S2.id), l2, l3 }
})
await page.waitForTimeout(1500) // input-passthrough pin sync
await page.evaluate((ids) => {
  const id = window.__cablemanagementCombs.create(ids.l2, ids.l3, 700, 300)
  window.__cablemanagementCombs.move(id, 'out', 1060, 300)
}, ids)

const settle = () => page.evaluate(async () => {
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 200)) }
})
// Fresh draw capture: reset map, burn frames, THEN read (ghost-route trap).
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
// S1's input-passthrough pin: screen centre + the same point in graph coords
// (recomputed per read -- the invariant's baseline is the pin, wherever it is).
const pinInfo = () => page.evaluate((ids) => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === ids.S1 && x.dataset.cablemanagementIndex === '0'
  )
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r.width) return null
  const c = window.app.canvas, cr = c.canvas.getBoundingClientRect()
  const sx = r.x + r.width / 2, sy = r.y + r.height / 2
  return {
    screen: [sx, sy],
    graph: [(sx - cr.left) / c.ds.scale - c.ds.offset[0], (sy - cr.top) / c.ds.scale - c.ds.offset[1]]
  }
}, ids)
const orphanScan = () => page.evaluate(() => {
  const g = window.app.graph
  const carries = (r) => (r?.linkIds?.size ?? 0) + (r?.floatingLinkIds?.size ?? 0) > 0
  const out = { orphanReroutes: [], deadLanes: [], thinCombs: [] }
  for (const r of g.reroutes?.values?.() ?? []) {
    if (!carries(r)) out.orphanReroutes.push(r.id)
  }
  for (const c of g.extra?.cablemanagement_combs ?? []) {
    if (c.lanes.length < 2) out.thinCombs.push(c.id)
    for (const l of c.lanes) {
      const ri = g.reroutes.get(l.in), ro = g.reroutes.get(l.out)
      if (ri && ro && !carries(ri) && !carries(ro)) out.deadLanes.push(l)
    }
  }
  return out
})
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(from[0] + 40, from[1] + 20, { steps: 4 })
  await page.mouse.move(to[0], to[1], { steps: 12 })
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(800)
  await settle()
}

await settle()
const basePin = await pinInfo()
ok('setup: input-passthrough pin present on S1-in-0', !!basePin, JSON.stringify(basePin))
if (!basePin) {
  console.log('page errors:', errs.length ? errs : 'none')
  console.log('FAIL')
  await b.close()
  process.exit(1)
}

// ---- step 1: park the pin drag on the IN gate body ------------------------------
const gIn = await page.evaluate(() => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const h = 24 + (c.lanes.length - 1) * 20
  const x = c.in.pins === 'left' ? c.in.pos[0] + 18 : c.in.pos[0] + 6
  return [x, c.in.pos[1] + h / 2]
})
await drag(basePin.screen, await screenOfGraph(gIn[0], gIn[1]))
await fresh()
const park = await page.evaluate((ids) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  const fl = [...(g.floatingLinks?.values?.() ?? [])]
  const ff = (() => { const b = g.extra?.cablemanagement_routes; const o = {}; for (const k of Object.keys(b?.claims?.floats ?? {})) o[k] = b.routes[b.claims.floats[k]]?.src ?? null; return Object.keys(o).length ? o : null })()
  let ffRec = null
  if (fl[0] && ff) {
    let rid = fl[0].parentId, guard = 0
    while (rid != null && guard++ < 50 && !ffRec) {
      ffRec = ff[String(rid)] ?? null
      if (!ffRec) rid = g.getReroute(rid)?.parentId
    }
  }
  const A = g.getNodeById(Number(ids.A))
  const aOut = A.getConnectionPos(false, 0)
  return {
    lanes: rec?.lanes.length, floating: fl.length,
    floatId: fl[0]?.id ?? null, floatParent: fl[0]?.parentId ?? null,
    lane2: rec?.lanes[2] ?? null, ff, ffRec,
    draw: fl[0] != null ? window.__cablemanagementDraw.get('f' + fl[0].id) ?? null : null,
    aOut: [aOut[0], aOut[1]],
    connecting: window.app.canvas.linkConnector.renderLinks.length
  }
}, ids)
const pinNow1 = await pinInfo()
console.log('   park state:', JSON.stringify(park))
ok('park: gate drop parks a dangling lane', park.lanes === 3 && park.floating === 1 && park.connecting === 0,
  JSON.stringify({ lanes: park.lanes, floating: park.floating, connecting: park.connecting }))
ok('park: floatfrom provenance recorded on the chain',
  !!park.ffRec && String(park.ffRec[0]) === ids.S1 && Number(park.ffRec[1]) === 0,
  JSON.stringify({ ffRec: park.ffRec, ff: park.ff }))
const floatStart = park.draw ? [park.draw[0], park.draw[1]] : null
ok('ANCHOR: float draws from S1 pin', !!pinNow1 && dist(floatStart, pinNow1.graph) <= 1.5,
  JSON.stringify({ start: floatStart, pin: pinNow1?.graph, d: +dist(floatStart, pinNow1?.graph).toFixed(2) }))
ok('ANCHOR: float start clear of true origin (A out)', dist(floatStart, park.aOut) >= 30,
  JSON.stringify({ start: floatStart, aOut: park.aOut, d: +dist(floatStart, park.aOut).toFixed(2) }))
let orph = await orphanScan()
ok('NO ORPHANS after park',
  !orph.orphanReroutes.length && !orph.deadLanes.length && !orph.thinCombs.length, JSON.stringify(orph))

// ---- step 2: out-pin pull -> release on S2's node BODY --------------------------
const outTooth = await page.evaluate(() => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  return g.reroutes.get(rec.lanes[2].out).pos.slice()
})
const s2body = await page.evaluate((ids) => {
  const el = document.querySelector(`[data-node-id="${ids.S2}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
ok('setup: S2 node body reachable', !!s2body, JSON.stringify(s2body))
await drag(await screenOfGraph(outTooth[0], outTooth[1]), s2body)
await fresh()
const done = await page.evaluate((ids) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  const lane = rec?.lanes[2] ?? null
  const link = [...g._links.values()].find(
    (l) => String(l.origin_id) === ids.A && String(l.target_id) === ids.S2
  )
  const chain = []
  let rid = link?.parentId
  while (rid != null) { chain.push(rid); rid = g.getReroute(rid)?.parentId }
  chain.reverse()
  const S2 = g.getNodeById(Number(ids.S2))
  const A = g.getNodeById(Number(ids.A))
  const aOut = A.getConnectionPos(false, 0)
  const routes = window.__cablemanagementPathing.routes()
  const fromOrigin = link
    ? routes
        .filter((r) => String(r.key).startsWith(link.id + '|') && r.pts?.length)
        .filter((r) => Math.hypot(r.pts[0][0] - aOut[0], r.pts[0][1] - aOut[1]) < 30)
        .map((r) => r.key)
    : []
  return {
    linked: !!link, linkId: link?.id ?? null, targetSlot: link?.target_slot ?? null,
    floating: g.floatingLinks.size,
    chain, laneChain: lane ? [lane.in, lane.out] : null,
    prov: S2?.properties?.['cablemanagement.from'] ?? null,
    ff: (() => { const b = g.extra?.cablemanagement_routes; const o = {}; for (const k of Object.keys(b?.claims?.floats ?? {})) o[k] = b.routes[b.claims.floats[k]]?.src ?? null; return Object.keys(o).length ? o : null })(),
    draw: link ? window.__cablemanagementDraw.get(link.id) ?? null : null,
    aOut: [aOut[0], aOut[1]],
    connecting: window.app.canvas.linkConnector.renderLinks.length
  }
}, ids)
const pinNow2 = await pinInfo()
console.log('   completion state:', JSON.stringify(done))
ok('complete: out-pin pull lands A->S2, float retired',
  done.linked && done.floating === 0 && done.connecting === 0,
  JSON.stringify({ linked: done.linked, floating: done.floating, connecting: done.connecting }))
ok('complete: link rides the lane teeth',
  !!done.laneChain && JSON.stringify(done.chain) === JSON.stringify(done.laneChain),
  JSON.stringify({ chain: done.chain, lane: done.laneChain }))
const p0 = done.prov?.['0']
ok('complete: provenance recorded on S2 (cablemanagement.from)',
  !!p0 && String(p0[0]) === ids.S1 && Number(p0[1]) === 0 && p0[2] === done.linkId,
  JSON.stringify({ prov: done.prov, wantHost: ids.S1, wantLink: done.linkId }))
const doneStart = done.draw ? [done.draw[0], done.draw[1]] : null
ok('ANCHOR: completed link draws from S1 pin', !!pinNow2 && dist(doneStart, pinNow2.graph) <= 1.5,
  JSON.stringify({ start: doneStart, pin: pinNow2?.graph, d: +dist(doneStart, pinNow2?.graph).toFixed(2) }))
ok('ANCHOR: completed link start clear of true origin (A out)', dist(doneStart, done.aOut) >= 30,
  JSON.stringify({ start: doneStart, aOut: done.aOut, d: +dist(doneStart, done.aOut).toFixed(2) }))
ok('ANCHOR: no route minted from the true origin', done.fromOrigin?.length ? false : true,
  JSON.stringify(done.fromOrigin))
orph = await orphanScan()
ok('NO ORPHANS after completion',
  !orph.orphanReroutes.length && !orph.deadLanes.length && !orph.thinCombs.length, JSON.stringify(orph))

// ---- step 3: stability -- extra settle, no delayed reversion --------------------
await settle()
await fresh()
const later = await page.evaluate((arg) => {
  const g = window.app.graph
  const link = arg.linkId != null ? (g.getLink ? g.getLink(arg.linkId) : g._links.get(arg.linkId)) : null
  return { alive: !!link, draw: link ? window.__cablemanagementDraw.get(link.id) ?? null : null }
}, { linkId: done.linkId })
const pinNow3 = await pinInfo()
const laterStart = later.draw ? [later.draw[0], later.draw[1]] : null
ok('ANCHOR: pin anchor stable after extra frames (no reversion)',
  later.alive && !!pinNow3 && dist(laterStart, pinNow3.graph) <= 1.5,
  JSON.stringify({ start: laterStart, pin: pinNow3?.graph, d: +dist(laterStart, pinNow3?.graph).toFixed(2) }))

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
