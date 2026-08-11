// SWEEP cell K -- copy/paste and delete of nodes whose links ride comb lanes.
//
// Scene: widget-flavour passthrough A ==pin==> B1, B2 (hidden primitive H feeds both),
// the two links combed (H->in-tooth->out-tooth->B). Copy A+H+B1+B2, paste (clones
// offset), settle. Asserts: pasted links exist (origin = pasted primitive H2), the
// comb record does NOT claim any pasted reroute (pasted teeth arrive as plain
// reroutes -- fine by spec), invariant 1 for the pasted links (no draw and no route
// from the true-origin primitive; paste fixups re-anchor to the pasted pin), original
// anchors untouched, invariant 2 globally. Then DELETE the original A+H+B1+B2:
// original lanes must not survive wireless, comb record pruned or gone, no orphan
// reroutes, pasted anchors still stand.
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
const bail = (why) => { console.log('BLOCKED:', why); process.exit(2) }

// ---- scene: A pin -> B1.ckpt_name, A pin -> B2.ckpt_name, both links combed --------
const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y, title) => { const n = L.createNode(t); n.pos = [x, y]; n.title = title; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 80, 100, 'A')
  const B1 = mk('CheckpointLoaderSimple', 1200, 60, 'B1')
  const B2 = mk('CheckpointLoaderSimple', 1200, 420, 'B2')
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1800))
  return {
    A: String(A.id), B1: String(B1.id), B2: String(B2.id),
    i1: B1.inputs.findIndex(s => s.widget?.name === 'ckpt_name'),
    i2: B2.inputs.findIndex(s => s.widget?.name === 'ckpt_name')
  }
})
const pinPt = (nid) => page.evaluate((nid) => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === nid && x.dataset.cablemanagementKind === 'widget'
  )
  const r = el?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, nid)
const slotPt = (key) => page.evaluate(k => {
  const r = document.querySelector(`[data-slot-key="${k}"]`)?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, key)
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
}
const p1 = await pinPt(ids.A)
if (!p1) bail('no widget pin on A')
await drag(p1, await slotPt(`${ids.B1}-in-${ids.i1}`))
await page.waitForTimeout(500)
await drag(await pinPt(ids.A), await slotPt(`${ids.B2}-in-${ids.i2}`))
await page.waitForTimeout(500)

const comb0 = await page.evaluate((ids) => {
  const g = window.app.graph
  const H = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  if (!H) return { err: 'no owned primitive after pin drags' }
  const links = [...g._links.values()].filter(l => String(l.origin_id) === String(H.id))
  const l1 = links.find(l => String(l.target_id) === String(ids.B1))
  const l2 = links.find(l => String(l.target_id) === String(ids.B2))
  if (!l1 || !l2) return { err: 'passthrough links missing', links: links.map(l => [l.id, String(l.target_id)]) }
  const cid = window.__cablemanagementCombs.create(l1.id, l2.id, 700, 260)
  window.__cablemanagementCombs.move(cid, 'out', 1000, 260)
  return { H: String(H.id), l1: l1.id, l2: l2.id, cid }
}, ids)
if (comb0.err) bail(comb0.err + ' ' + JSON.stringify(comb0.links ?? ''))

// Fresh draw capture: reset the map, burn frames (ghost-route trap).
const fresh = () => page.evaluate(async () => {
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})

// Page-side helpers are stringified into each evaluate (no shared scope).
const HELPERS = `
  const pinGraphPt = (nid) => {
    const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
      x => x.dataset.cablemanagementNode === String(nid) && x.dataset.cablemanagementKind === 'widget'
    )
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cr = window.app.canvas.canvas.getBoundingClientRect()
    const ds = window.app.canvas.ds
    return [
      (r.x + r.width / 2 - cr.left) / ds.scale - ds.offset[0],
      (r.y + r.height / 2 - cr.top) / ds.scale - ds.offset[1]
    ]
  }
  const orphanScan = (g) => {
    const orphanReroutes = [...(g.reroutes?.values() ?? [])]
      .filter(r => !(r.linkIds?.size) && !(r.floatingLinkIds?.size))
      .map(r => r.id)
    const combs = g.extra?.cablemanagement_combs ?? []
    const orphanLanes = [], thinCombs = []
    for (const c of combs) {
      if (c.lanes.length < 2) thinCombs.push(c.id)
      for (const l of c.lanes) {
        const rin = g.reroutes.get(l.in), rout = g.reroutes.get(l.out)
        if (rin && rout) {
          const n = (rin.linkIds?.size ?? 0) + (rin.floatingLinkIds?.size ?? 0) +
                    (rout.linkIds?.size ?? 0) + (rout.floatingLinkIds?.size ?? 0)
          if (n === 0) orphanLanes.push([c.id, l.in, l.out])
        }
      }
    }
    return { orphanReroutes, orphanLanes, thinCombs,
      combs: combs.map(c => ({ id: c.id, lanes: c.lanes.map(l => ({ ...l })) })) }
  }
  const near = (p, q, d) => p && q && Math.hypot(p[0] - q[0], p[1] - q[1]) < d
`

// ---- baseline (before any copy/paste mutation) -------------------------------------
await fresh()
const base = await page.evaluate(new Function('c', HELPERS + `
  const g = window.app.graph
  const draw = window.__cablemanagementDraw
  const H = g.getNodeById(Number(c.H))
  const comb = (g.extra?.cablemanagement_combs ?? []).find(x => x.id === c.cid)
  return {
    d1: draw.get(c.l1) ?? null, d2: draw.get(c.l2) ?? null,
    pin: pinGraphPt(c.A),
    hOut: H.getConnectionPos(false, 0),
    laneIds: comb ? comb.lanes.flatMap(l => [l.in, l.out]) : [],
    lanes: comb ? comb.lanes.length : 0,
    rerouteIds: [...g.reroutes.keys()],
    scan: orphanScan(g)
  }
`), { ...ids, ...comb0 })
ok('baseline: both combed links draw from the pin', !!base.d1 && !!base.d2 && !!base.pin &&
  Math.hypot(base.d1[0] - base.pin[0], base.d1[1] - base.pin[1]) <= 4 &&
  Math.hypot(base.d2[0] - base.pin[0], base.d2[1] - base.pin[1]) <= 4,
  JSON.stringify({ d1: base.d1, d2: base.d2, pin: base.pin }))
ok('baseline: comb has 2 lanes, 4 teeth', base.lanes === 2 && base.laneIds.length === 4, JSON.stringify(base.laneIds))
ok('baseline: invariant 2 clean', base.scan.orphanReroutes.length === 0 && base.scan.orphanLanes.length === 0 && base.scan.thinCombs.length === 0, JSON.stringify(base.scan))

// ---- copy A + H + B1 + B2, paste ---------------------------------------------------
await page.mouse.click(300, 900) // focus the canvas on empty ground (clears selection)
await page.waitForTimeout(300)
const pre = await page.evaluate((c) => {
  const g = window.app.graph, canvas = window.app.canvas
  const sel = [c.A, c.H, c.B1, c.B2].map(id => g.getNodeById(Number(id))).filter(Boolean)
  canvas.selectItems(sel)
  return {
    selected: sel.length,
    nodes: g.nodes.map(n => String(n.id)),
    reroutes: [...g.reroutes.keys()],
    links: [...g._links.keys()]
  }
}, { ...ids, H: comb0.H })
ok('selection took A+H+B1+B2', pre.selected === 4, String(pre.selected))
await page.keyboard.press('Control+KeyC')
await page.waitForTimeout(400)
await page.keyboard.press('Control+KeyV')
await page.waitForTimeout(1800)

let added = await page.evaluate((pre) => {
  const g = window.app.graph
  return {
    nodes: g.nodes.filter(n => !pre.nodes.includes(String(n.id)))
      .map(n => ({ id: String(n.id), title: n.title, owned: !!n.properties?.['cablemanagement.owned'] })),
    reroutes: [...g.reroutes.keys()].filter(id => !pre.reroutes.includes(id))
  }
}, pre)
let pastePath = 'keyboard Ctrl+C/Ctrl+V'
if (added.nodes.length === 0) {
  // Keybinding path did not fire in this build -- fall back to the same funnel
  // programmatically (_deserializeItems is the single funnel either way).
  pastePath = 'programmatic copyToClipboard/pasteFromClipboard (keyboard produced nothing)'
  await page.evaluate((c) => {
    const g = window.app.graph, canvas = window.app.canvas
    canvas.selectItems([c.A, c.H, c.B1, c.B2].map(id => g.getNodeById(Number(id))).filter(Boolean))
    canvas.copyToClipboard()
    canvas.pasteFromClipboard({ position: [200, 160] })
  }, { ...ids, H: comb0.H })
  await page.waitForTimeout(1800)
  added = await page.evaluate((pre) => {
    const g = window.app.graph
    return {
      nodes: g.nodes.filter(n => !pre.nodes.includes(String(n.id)))
        .map(n => ({ id: String(n.id), title: n.title, owned: !!n.properties?.['cablemanagement.owned'] })),
      reroutes: [...g.reroutes.keys()].filter(id => !pre.reroutes.includes(id))
    }
  }, pre)
}
console.log('paste path:', pastePath)
console.log('added:', JSON.stringify(added))
if (added.nodes.length === 0) bail('paste produced no nodes by either path')

const A2 = added.nodes.find(n => n.title === 'A' && !n.owned)?.id
const B1p = added.nodes.find(n => n.title === 'B1')?.id
const B2p = added.nodes.find(n => n.title === 'B2')?.id
const H2 = added.nodes.find(n => n.owned)?.id

// Bring the clones ON-SCREEN before asserting: an off-viewport paste leaves the
// pre-fixup routes immortal (the cull keeps out-of-view cache entries alive so
// panning does not reflow lanes) and the K3 route scan reads those ghosts --
// CU-5's paste offset landed the clones below the fold. Moving them also bumps
// the obstacle version, retiring every stale entry.
await page.evaluate((c) => {
  const g = window.app.graph
  const put = (id, x, y) => { const n = id && g.getNodeById(Number(id)); if (n) n.pos = [x, y] }
  put(c.A2, 80, 540)
  put(c.B1p, 1200, 520)
  put(c.B2p, 1200, 760)
  g.setDirtyCanvas(true, true)
}, { A2, B1p, B2p })
await page.waitForTimeout(600)

// ---- post-paste asserts ------------------------------------------------------------
await page.waitForTimeout(800)
await fresh()
const post = await page.evaluate(new Function('c', HELPERS + `
  const g = window.app.graph
  const draw = window.__cablemanagementDraw
  const gid = (id) => id == null ? null : g.getNodeById(Number(id))
  const B1p = gid(c.B1p), B2p = gid(c.B2p), H2 = gid(c.H2), H = gid(c.H)
  const lk = (n, idx) => n?.inputs?.[idx]?.link ?? null
  const l1p = lk(B1p, c.i1), l2p = lk(B2p, c.i2)
  const link = (id) => id == null ? null : (g.getLink ? g.getLink(id) : g._links.get(id))
  const comb = (g.extra?.cablemanagement_combs ?? []).find(x => x.id === c.cid)
  const laneIds = comb ? comb.lanes.flatMap(l => [l.in, l.out]) : []
  const hOut = H ? H.getConnectionPos(false, 0) : null
  const h2Out = H2 ? H2.getConnectionPos(false, 0) : null
  const routes = window.__cablemanagementPathing.routes()
  const nearOrigin = (o) => o ? routes.filter(r => near(r.pts[0], o, 30)).map(r => r.key) : []
  return {
    l1p, l2p,
    o1: link(l1p) ? String(link(l1p).origin_id) : null,
    o2: link(l2p) ? String(link(l2p).origin_id) : null,
    d1p: l1p != null ? draw.get(l1p) ?? null : null,
    d2p: l2p != null ? draw.get(l2p) ?? null : null,
    d1: draw.get(c.l1) ?? null, d2: draw.get(c.l2) ?? null,
    pin: pinGraphPt(c.A), pin2: c.A2 ? pinGraphPt(c.A2) : null,
    hOut, h2Out,
    routesNearH: nearOrigin(hOut), routesNearH2: nearOrigin(h2Out),
    laneIds, scan: orphanScan(g)
  }
`), { ...ids, ...comb0, A2, B1p, B2p, H2 })

ok('K1 pasted set complete (A2, B1\', B2\', prim H2)', !!(A2 && B1p && B2p && H2),
  JSON.stringify({ A2, B1p, B2p, H2 }))
ok('K1 pasted links exist and originate at the pasted primitive',
  post.l1p != null && post.l2p != null && post.o1 === String(H2) && post.o2 === String(H2),
  JSON.stringify({ l1p: post.l1p, l2p: post.l2p, o1: post.o1, o2: post.o2, H2 }))
const claimed = post.laneIds.filter(id => added.reroutes.includes(id))
ok('K2 comb record does not claim pasted reroutes', claimed.length === 0,
  JSON.stringify({ claimed, laneIds: post.laneIds, addedReroutes: added.reroutes }))
ok('K2 comb record still holds its original 4 teeth',
  post.laneIds.length === 4 && base.laneIds.every(id => post.laneIds.includes(id)),
  JSON.stringify({ base: base.laneIds, post: post.laneIds }))
const farFrom = (d, o) => d && o && Math.hypot(d[0] - o[0], d[1] - o[1]) >= 30
ok('K3 pasted links do not draw from the true origin (H2)',
  farFrom(post.d1p, post.h2Out) && farFrom(post.d2p, post.h2Out),
  JSON.stringify({ d1p: post.d1p, d2p: post.d2p, h2Out: post.h2Out, pin2: post.pin2 }))
ok('K3 no route starts at either primitive output',
  post.routesNearH.length === 0 && post.routesNearH2.length === 0,
  JSON.stringify({ nearH: post.routesNearH, nearH2: post.routesNearH2 }))
const drift = (d, b) => d && b ? Math.hypot(d[0] - b[0], d[1] - b[1]) : Infinity
ok('K4 original anchors untouched by the paste',
  drift(post.d1, base.d1) <= 1.5 && drift(post.d2, base.d2) <= 1.5,
  JSON.stringify({ d1: post.d1, d2: post.d2, base: [base.d1, base.d2] }))
ok('K5 invariant 2 clean after paste',
  post.scan.orphanReroutes.length === 0 && post.scan.orphanLanes.length === 0 && post.scan.thinCombs.length === 0,
  JSON.stringify(post.scan))

// Pasted-anchor baseline for the delete step (pasted pin element centre, graph coords).
const pastedBase = { d1p: post.d1p, d2p: post.d2p }

// ---- delete the ORIGINAL A + H + B1 + B2 -------------------------------------------
await page.evaluate((c) => {
  const g = window.app.graph, canvas = window.app.canvas
  canvas.selectItems([c.A, c.H, c.B1, c.B2].map(id => g.getNodeById(Number(id))).filter(Boolean))
  canvas.deleteSelected()
}, { ...ids, H: comb0.H })
await page.waitForTimeout(1500)
await fresh()

const del = await page.evaluate(new Function('c', HELPERS + `
  const g = window.app.graph
  const draw = window.__cablemanagementDraw
  const gid = (id) => id == null ? null : g.getNodeById(Number(id))
  const B1p = gid(c.B1p), B2p = gid(c.B2p), H2 = gid(c.H2)
  const l1p = B1p?.inputs?.[c.i1]?.link ?? null
  const l2p = B2p?.inputs?.[c.i2]?.link ?? null
  const teeth = c.baseLanes.map(id => {
    const r = g.reroutes.get(id)
    return r ? { id, links: r.linkIds?.size ?? 0, floats: r.floatingLinkIds?.size ?? 0 } : { id, gone: true }
  })
  const combs = g.extra?.cablemanagement_combs ?? []
  const origComb = combs.find(x => x.id === c.cid) ?? null
  const h2Out = H2 ? H2.getConnectionPos(false, 0) : null
  const routes = window.__cablemanagementPathing.routes()
  return {
    originalsGone: [c.A, c.H, c.B1, c.B2].every(id => !gid(id)),
    teeth,
    origComb: origComb ? { id: origComb.id, lanes: origComb.lanes.map(l => ({ ...l })) } : null,
    combCount: combs.length,
    d1p: l1p != null ? draw.get(l1p) ?? null : null,
    d2p: l2p != null ? draw.get(l2p) ?? null : null,
    pin2: c.A2 ? pinGraphPt(c.A2) : null,
    h2Out,
    routesNearH2: h2Out ? routes.filter(r => near(r.pts[0], h2Out, 30)).map(r => r.key) : [],
    scan: orphanScan(g),
    allReroutes: [...g.reroutes.values()].map(r => ({ id: r.id, links: r.linkIds?.size ?? 0, floats: r.floatingLinkIds?.size ?? 0 }))
  }
`), { ...ids, ...comb0, A2, B1p, B2p, H2, baseLanes: base.laneIds })

ok('delete removed the original four nodes', del.originalsGone, JSON.stringify(del.teeth))
const wireless = del.teeth.filter(t => !t.gone && t.links === 0 && t.floats === 0)
ok('K6 no original tooth survives wireless', wireless.length === 0,
  JSON.stringify({ wireless, teeth: del.teeth }))
const deadRefs = del.origComb
  ? del.origComb.lanes.flatMap(l => [l.in, l.out]).filter(id => del.teeth.find(t => t.id === id && (t.gone || (t.links === 0 && t.floats === 0))))
  : []
ok('K6 comb record pruned or gone (no lanes over dead/wireless teeth)',
  !del.origComb || (deadRefs.length === 0 && del.origComb.lanes.length >= 2),
  JSON.stringify({ origComb: del.origComb, deadRefs }))
ok('K7 invariant 2 clean after delete',
  del.scan.orphanReroutes.length === 0 && del.scan.orphanLanes.length === 0 && del.scan.thinCombs.length === 0,
  JSON.stringify({ scan: del.scan, allReroutes: del.allReroutes }))
ok('K8 pasted links still pin-anchored after original delete',
  drift(del.d1p, pastedBase.d1p) <= 1.5 && drift(del.d2p, pastedBase.d2p) <= 1.5 &&
  farFrom(del.d1p, del.h2Out) && farFrom(del.d2p, del.h2Out),
  JSON.stringify({ d1p: del.d1p, d2p: del.d2p, base: pastedBase, h2Out: del.h2Out, pin2: del.pin2 }))
ok('K8 no route starts at the pasted primitive', del.routesNearH2.length === 0,
  JSON.stringify(del.routesNearH2))

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
