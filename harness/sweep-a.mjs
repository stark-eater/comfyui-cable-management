// SWEEP CELL A -- plain reroute inserted on a passthrough link (core createReroute).
// Both anchor flavours side by side: WIDGET (hidden primitive H feeds B, host
// fallback in the ledger) and INPUT (provenance record on S2 only -- fragile).
// Steps: baseline anchors -> insert a reroute on each passthrough link ->
// mouse-drag each dot ~80px -> serialize+configure roundtrip. After EVERY step:
//   1 ANCHOR    draw start stays on the pin (<=1.5px of baseline), never within
//               30px of the true-origin slot; no route minted from a true origin.
//   2 NO ORPHAN no reroute with empty linkIds+floatingLinkIds; no comb record
//               below 2 lanes (no combs in this cell -- must stay that way).
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
const dist = (a, b) => (a && b) ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity

// Scene at grid multiples, everything clear of the minimap corner (x>1560 && y>780).
const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 60, 80)
  const B = mk('CheckpointLoaderSimple', 1100, 60)
  const A2 = mk('CheckpointLoaderSimple', 60, 420)
  const S1 = mk('CheckpointSave', 520, 420)
  const S2 = mk('CheckpointSave', 1100, 560)
  A2.connect(0, S1, 0) // hand link: MODEL -> S1; a pin grows on S1's input 0
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1800))
  return {
    A: String(A.id), B: String(B.id), A2: String(A2.id), S1: String(S1.id), S2: String(S2.id),
    bIdx: B.inputs.findIndex(s => s.widget?.name === 'ckpt_name')
  }
})
await page.waitForTimeout(1500) // input-pin sync pass after the hand connect

const widgetPin = () => page.evaluate((i) => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget'
  )
  const r = el?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, ids)
const inputPin = () => page.evaluate((i) => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === i.S1 && x.dataset.cablemanagementIndex === '0'
  )
  const r = el?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, ids)
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

// Build both passthroughs by real pin drags.
const wp = await widgetPin()
ok('scene: widget pin present on A', !!wp, JSON.stringify(wp))
if (!wp) { console.log('FAIL'); await b.close(); process.exit(1) }
await drag(wp, await slotPt(`${ids.B}-in-${ids.bIdx}`))
await page.waitForTimeout(1200)
const ip = await inputPin()
ok('scene: input pin present on S1', !!ip, JSON.stringify(ip))
if (!ip) { console.log('FAIL'); await b.close(); process.exit(1) }
await drag(ip, await slotPt(`${ids.S2}-in-0`))

// One state read = burn 6 capture frames, then everything the invariants need.
// Re-finds pins/nodes/links every call (configure() remounts the DOM).
const snap = (tag) => page.evaluate(async (arg) => {
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 150)) }
  const TITLE = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30
  const byId = (id) => g.getNodeById(id) ?? g.getNodeById(Number(id))
  const anchorOf = (el, n) => (el && n)
    ? [n.pos[0] + el.offsetLeft + el.offsetWidth * 0.5, n.pos[1] - TITLE + el.offsetTop + el.offsetHeight * 0.5]
    : null
  const pins = [...document.querySelectorAll('.cablemanagement-pin')]
  const pinW = pins.find(x => x.dataset.cablemanagementNode === arg.A && x.dataset.cablemanagementKind === 'widget')
  const pinI = pins.find(x => x.dataset.cablemanagementNode === arg.S1 && x.dataset.cablemanagementIndex === '0')
  const A = byId(arg.A), S1 = byId(arg.S1), A2 = byId(arg.A2), S2 = byId(arg.S2)
  const H = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  const links = [...g._links.values()]
  const lW = links.find(l => String(l.target_id) === String(arg.B))       // H -> B (widget flavour)
  const lI = links.find(l => String(l.target_id) === String(arg.S2))      // A2 -> S2 (input flavour)
  const lHand = links.find(l => String(l.target_id) === String(arg.S1))   // A2 -> S1 (honest)
  const draw = window.__cablemanagementDraw
  const trueW = H ? H.getConnectionPos(false, 0) : null
  const trueI = A2 ? A2.getConnectionPos(false, 0) : null
  const routes = window.__cablemanagementPathing.routes()
  // A route may not start at ANY true-origin slot -- except the honest hand
  // link, which legitimately leaves A2's model output.
  const badRoutes = routes.filter(r => {
    if (lHand && String(r.key).startsWith(lHand.id + '|')) return false
    const p = r.pts?.[0]
    if (!p) return false
    return (trueW && Math.hypot(p[0] - trueW[0], p[1] - trueW[1]) < 30) ||
           (trueI && Math.hypot(p[0] - trueI[0], p[1] - trueI[1]) < 30)
  }).map(r => r.key)
  const orphanRr = [...(g.reroutes?.values() ?? [])]
    .filter(r => (r.linkIds?.size ?? 0) === 0 && (r.floatingLinkIds?.size ?? 0) === 0)
    .map(r => r.id)
  const combs = g.extra?.cablemanagement_combs ?? []
  const shape = (l) => l ? {
    id: l.id, parentId: l.parentId ?? null,
    draw: draw.get(l.id) ?? null
  } : null
  return {
    tag: arg.tag,
    anchorW: anchorOf(pinW, A), anchorI: anchorOf(pinI, S1),
    lW: shape(lW), lI: shape(lI), hand: lHand?.id ?? null,
    trueW, trueI, badRoutes, orphanRr,
    thinCombs: combs.filter(c => (c.lanes?.length ?? 0) < 2).map(c => c.id),
    prov: S2?.properties?.['cablemanagement.from']?.['0'] ?? null,
    ledger: window.__cablemanagement.ledger().size,
    reroutes: [...(g.reroutes?.values() ?? [])].map(r => ({
      id: r.id, pos: r.pos.slice(),
      links: r.linkIds?.size ?? 0, floats: r.floatingLinkIds?.size ?? 0
    }))
  }
}, { ...ids, tag })

let base = null
const invariants = (st) => {
  const t = st.tag
  const sW = st.lW?.draw ? [st.lW.draw[0], st.lW.draw[1]] : null
  const sI = st.lI?.draw ? [st.lI.draw[0], st.lI.draw[1]] : null
  ok(`[${t}] scene: both passthrough links captured`, !!sW && !!sI,
    JSON.stringify({ lW: st.lW, lI: st.lI }))
  ok(`[${t}] 1 ANCHOR widget: draws from the pin`, dist(sW, st.anchorW) <= 1.5,
    JSON.stringify({ draw: sW, pin: st.anchorW }))
  ok(`[${t}] 1 ANCHOR widget: never from true origin`, dist(sW, st.trueW) >= 30,
    JSON.stringify({ draw: sW, trueOrigin: st.trueW }))
  ok(`[${t}] 1 ANCHOR input: draws from the pin`, dist(sI, st.anchorI) <= 1.5,
    JSON.stringify({ draw: sI, pin: st.anchorI, prov: st.prov }))
  ok(`[${t}] 1 ANCHOR input: never from true origin`, dist(sI, st.trueI) >= 30,
    JSON.stringify({ draw: sI, trueOrigin: st.trueI }))
  if (base) {
    // Nodes never move in this cell, so the pin anchors are fixed points.
    ok(`[${t}] 1 ANCHOR: pins where the baseline put them`,
      dist(st.anchorW, base.anchorW) <= 1.5 && dist(st.anchorI, base.anchorI) <= 1.5,
      JSON.stringify({ w: [base.anchorW, st.anchorW], i: [base.anchorI, st.anchorI] }))
  }
  ok(`[${t}] 1 ANCHOR: no route minted from a true origin`, st.badRoutes.length === 0,
    JSON.stringify(st.badRoutes))
  ok(`[${t}] 2 NO ORPHANS: every reroute carries a link`, st.orphanRr.length === 0,
    JSON.stringify(st.reroutes))
  ok(`[${t}] 2 NO ORPHANS: no thin comb records`, st.thinCombs.length === 0,
    JSON.stringify(st.thinCombs))
}

base = await snap('base')
invariants(base)

// --- Insert a plain reroute on each passthrough link, mid-wire, grid multiples.
const ins = await page.evaluate((arg) => {
  const g = window.app.graph
  const grid = (v) => Math.round(v / 10) * 10
  const mid = (d) => [grid((d[0] + d[2]) / 2), grid((d[1] + d[3]) / 2)]
  const lW = [...g._links.values()].find(l => String(l.target_id) === String(arg.ids.B))
  const lI = [...g._links.values()].find(l => String(l.target_id) === String(arg.ids.S2))
  const rW = g.createReroute(mid(arg.dW), lW)
  const rI = g.createReroute(mid(arg.dI), lI)
  g.setDirtyCanvas(true, true)
  return { rW: rW.id, rI: rI.id, pW: rW.pos.slice(), pI: rI.pos.slice() }
}, { ids, dW: base.lW.draw, dI: base.lI.draw })
await page.waitForTimeout(800)
const afterIns = await snap('reroute-inserted')
ok('[reroute-inserted] links now ride their reroutes',
  afterIns.lW?.parentId === ins.rW && afterIns.lI?.parentId === ins.rI,
  JSON.stringify({ ins, lW: afterIns.lW, lI: afterIns.lI }))
invariants(afterIns)

// --- Mouse-drag each dot ~80px (plain drag moves the dot; SHIFT would pull the link).
const rrPos = (rid) => page.evaluate((rid) => {
  const r = window.app.graph.reroutes.get(rid)
  return r ? r.pos.slice() : null
}, rid)
const dragDot = async (rid) => {
  const p = await rrPos(rid)
  const from = await screenOfGraph(p[0], p[1])
  await drag(from, [from[0] + 60, from[1] + 60])
  const q = await rrPos(rid)
  return { before: p, after: q, moved: q ? Math.hypot(q[0] - p[0], q[1] - p[1]) : 0 }
}

const mvW = await dragDot(ins.rW)
ok('[dot-drag widget] dot actually moved', mvW.moved >= 40, JSON.stringify(mvW))
invariants(await snap('dot-drag widget'))

const mvI = await dragDot(ins.rI)
ok('[dot-drag input] dot actually moved', mvI.moved >= 40, JSON.stringify(mvI))
invariants(await snap('dot-drag input'))

// --- Serialize + configure roundtrip (client-side only; nothing touches the server).
const rt = await page.evaluate(() => {
  const g = window.app.graph
  const s = g.serialize()
  g.configure(s)
  return { nodes: g.nodes.length, links: g._links.size, reroutes: g.reroutes?.size ?? 0 }
})
await page.waitForTimeout(1500)
const afterRt = await snap('configured')
ok('[configured] graph shape survives the roundtrip',
  rt.links >= 3 && rt.reroutes === 2 &&
  afterRt.lW?.parentId === ins.rW && afterRt.lI?.parentId === ins.rI,
  JSON.stringify({ rt, lW: afterRt.lW, lI: afterRt.lI }))
// Provenance records the PIN host (S1, where the dragged pin lives), not the
// link's true origin A2 -- the anchor must resolve to S1's pin element.
ok('[configured] input provenance survived (id-matched)',
  Array.isArray(afterRt.prov) && String(afterRt.prov[0]) === ids.S1 && afterRt.prov[2] === afterRt.lI?.id,
  JSON.stringify({ prov: afterRt.prov, lI: afterRt.lI }))
invariants(afterRt)

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
