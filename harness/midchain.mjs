// Mid-chain disconnect under the 2e rulings (honest disconnect; the old
// fall-back-to-last-anchor mend is RETRACTED) + rewire base case (2c).
// (W) widget chain A' -> B -> C -> D: disconnect C's input -- C's own literal
//     takes over as provider, so D re-sources to C's hidden primitive and KEEPS
//     drawing from C's pin (nothing severed; widget chains re-root, never
//     float). Survives a serialize -> configure roundtrip. Re-establishing
//     B' -> C puts the whole tail back on A's value.
// (L) link chain CK -> A, A' -> B, B' -> C: disconnect B -- B has nothing to
//     provide, so C is severed FOR REAL (no data in the system), remembered as
//     a ghost-drawn fragment; re-feeding B re-materializes C off B's pin.
// (R) rewire regression lock: with A feeding B and C (fan-out from one pin),
//     dragging B' onto C's occupied input re-records provenance from B's pin
//     (works on current build -- this cell keeps it that way).
// (RR/RC) reroute/ribbon variants of the widget cut: the severed wire's chain
//     parks as a dangling float (user can re-grab it), while the consumer
//     re-sources to the cut node's own literal and stays on its pin.
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
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement, null, { timeout: 120_000 })
await page.waitForTimeout(2600)

async function drag(from, to) {
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(900)
}
const pinPos = (id, kind, idx) => page.evaluate(({ id, kind, idx }) => {
  const sel = idx != null
    ? `.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${idx}"]`
    : `.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-kind="${kind}"]`
  const p = document.querySelector(sel)
  if (!p) return null
  const r = p.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, kind, idx })
const dotPos = (id, idx) => page.evaluate(({ id, idx }) => {
  const d = document.querySelector(`[data-slot-key="${id}-in-${idx}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })
// Where does `consumer`'s input link actually DRAW from -- which node's pin?
const drawnFrom = (consumerId, idx, candidates) => page.evaluate(async ({ consumerId, idx, candidates }) => {
  const g = window.app.graph, L = window.LiteGraph
  window.__cablemanagementDraw = new Map(); window.__cablemanagementCapture = true
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 600))
  window.__cablemanagementCapture = false
  const consumer = g.getNodeById(Number(consumerId))
  const lid = consumer?.inputs?.[idx]?.link
  if (lid == null) return 'no-link'
  const drawn = window.__cablemanagementDraw.get(lid)
  if (!drawn) return 'not-drawn'
  const TITLE = L?.NODE_TITLE_HEIGHT ?? 30
  for (const [name, id, pidx] of candidates) {
    const el = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${pidx}"]`)
    const n = g.getNodeById(Number(id))
    if (!el || !n) continue
    const a = [n.pos[0] + el.offsetLeft + el.offsetWidth / 2, n.pos[1] - TITLE + el.offsetTop + el.offsetHeight / 2]
    if (Math.hypot(drawn[0] - a[0], drawn[1] - a[1]) < 4) return name
  }
  const link = g.getLink(lid)
  return `elsewhere(${Math.round(drawn[0])},${Math.round(drawn[1])} origin=${link.origin_id})`
}, { consumerId, idx, candidates })

// ---- (W) widget chain, 3 hops ----
const w = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const mk = (t, x, y) => { const n = L.createNode('CLIPTextEncode'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const A = mk('A', 200, 80), B = mk('B', 800, 80), C = mk('C', 800, 480), D = mk('D', 800, 860)
  A.widgets.find((w) => w.name === 'text').value = 'v'
  const idx = A.inputs.findIndex((s) => s.widget?.name === 'text')
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id), C: String(C.id), D: String(D.id), idx }
})
await drag(await pinPos(w.A, 'widget', null), await dotPos(w.B, w.idx))
await drag(await pinPos(w.B, null, w.idx), await dotPos(w.C, w.idx))
await drag(await pinPos(w.C, null, w.idx), await dotPos(w.D, w.idx))
const wCands = [['A', w.A, w.idx], ['B', w.B, w.idx], ['C', w.C, w.idx]]
ok('W: chain built, D draws from C pin', await drawnFrom(w.D, w.idx, wCands) === 'C')

await page.evaluate(({ w }) => {
  window.app.graph.getNodeById(Number(w.C)).disconnectInput(w.idx)
  // A programmatic disconnect mutates no DOM the observer watches and ends in
  // no pointerup -- nudge the sync the way a real gesture's release would.
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  window.app.graph.setDirtyCanvas(true, true)
}, { w })
await page.waitForTimeout(900)
// Who REALLY feeds this input: a node title, 'prim(HostTitle)', or null.
const originOf = (nodeId, idx) => page.evaluate(({ nodeId, idx }) => {
  const g = window.app.graph
  const lid = g.getNodeById(Number(nodeId))?.inputs?.[idx]?.link
  const link = lid != null ? g.getLink(lid) : null
  const o = link ? g.getNodeById(Number(link.origin_id)) : null
  if (!o) return null
  const host = o.properties?.['cablemanagement.owned'] ? g.getNodeById(Number(o.properties['cablemanagement.host'])) : null
  return host ? `prim(${host.title})` : o.title
}, { nodeId, idx })
ok('W: cut C re-roots -- D stays on C pin, fed by C\'s OWN literal',
  await drawnFrom(w.D, w.idx, wCands) === 'C' && await originOf(w.D, w.idx) === 'prim(C)',
  `drawn=${await drawnFrom(w.D, w.idx, wCands)} origin=${await originOf(w.D, w.idx)}`)

// the re-rooted state survives a serialize -> configure roundtrip
await page.evaluate(async () => {
  const g = window.app.graph
  g.configure(JSON.parse(JSON.stringify(g.serialize())))
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1200))
})
ok('W: re-rooted chain survives roundtrip', await drawnFrom(w.D, w.idx, wCands) === 'C')

// re-establish the feed -- the whole tail returns to A's value, still via C's pin
await drag(await pinPos(w.B, null, w.idx), await dotPos(w.C, w.idx))
ok('W: re-established -- D on C pin, back on A\'s value',
  await drawnFrom(w.D, w.idx, wCands) === 'C' && await originOf(w.D, w.idx) === 'prim(A)',
  `drawn=${await drawnFrom(w.D, w.idx, wCands)} origin=${await originOf(w.D, w.idx)}`)

// ---- (L) link chain ----
const l = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [30, 60]; g.add(CK)
  const mk = (t, x, y) => { const n = L.createNode('CLIPTextEncode'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const A = mk('A', 500, 80), B = mk('B', 1050, 80), C = mk('C', 1050, 500)
  const idx = A.inputs.findIndex((s) => s.type === 'CLIP')
  CK.connect(1, A, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id), C: String(C.id), idx }
})
await drag(await pinPos(l.A, 'link', null), await dotPos(l.B, l.idx))
await drag(await pinPos(l.B, null, l.idx), await dotPos(l.C, l.idx))
const lCands = [['A', l.A, l.idx], ['B', l.B, l.idx]]
ok('L: chain built, C draws from B pin', await drawnFrom(l.C, l.idx, lCands) === 'B')
await page.evaluate(({ l }) => {
  window.app.graph.getNodeById(Number(l.B)).disconnectInput(l.idx)
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  window.app.graph.setDirtyCanvas(true, true)
}, { l })
await page.waitForTimeout(900)
const lState = await page.evaluate(({ l }) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(l.C))
  window.__cablemanagementGhostDraws = 0
  window.app.canvas.draw(true, true)
  return {
    cLink: C.inputs[l.idx].link,
    rec: C.properties?.['cablemanagement.from']?.[String(l.idx)] ?? null,
    ghosts: window.__cablemanagementGhostDraws,
  }
}, { l })
ok('L: mid-chain disconnect severs C for real, remembered as a ghost fragment',
  lState.cLink == null && lState.rec?.[2] === null && String(lState.rec?.[0]) === l.B && lState.ghosts >= 1,
  JSON.stringify(lState))
await drag(await pinPos(l.A, 'link', null), await dotPos(l.B, l.idx))
ok('L: re-fed B re-materializes C off B pin', await drawnFrom(l.C, l.idx, lCands) === 'B',
  `got=${await drawnFrom(l.C, l.idx, lCands)}`)

// ---- (R) rewire base case regression lock ----
const r = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const mk = (t, x, y) => { const n = L.createNode('CLIPTextEncode'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const A = mk('A', 200, 80), B = mk('B', 800, 80), C = mk('C', 800, 500)
  A.widgets.find((w) => w.name === 'text').value = 'v'
  const idx = A.inputs.findIndex((s) => s.widget?.name === 'text')
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id), C: String(C.id), idx }
})
await drag(await pinPos(r.A, 'widget', null), await dotPos(r.B, r.idx))
await drag(await pinPos(r.A, 'widget', null), await dotPos(r.C, r.idx))
ok('R: fan-out built, C draws from A pin', await drawnFrom(r.C, r.idx, [['A', r.A, r.idx], ['B', r.B, r.idx]]) === 'A')
await drag(await pinPos(r.B, null, r.idx), await dotPos(r.C, r.idx))
const rProv = await page.evaluate(({ r }) =>
  window.app.graph.getNodeById(Number(r.C)).properties?.['cablemanagement.from']?.[String(r.idx)] ?? null, { r })
ok('R: rewire onto occupied input re-records from B', Array.isArray(rProv) && String(rProv[0]) === r.B, JSON.stringify(rProv))
ok('R: C now draws from B pin', await drawnFrom(r.C, r.idx, [['A', r.A, r.idx], ['B', r.B, r.idx]]) === 'B')

// ---- (RR) reroute along the route: the cut wire's chain parks as a dangling
// float while the consumer re-sources to the cut node's own literal ----
const rr = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const mk = (t, x, y) => { const n = L.createNode('CLIPTextEncode'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const A = mk('A', 200, 80), B = mk('B', 900, 80), C = mk('C', 900, 520)
  A.widgets.find((w) => w.name === 'text').value = 'v'
  const idx = A.inputs.findIndex((s) => s.widget?.name === 'text')
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id), C: String(C.id), idx }
})
await drag(await pinPos(rr.A, 'widget', null), await dotPos(rr.B, rr.idx))
const rrMid = await page.evaluate(async ({ rr }) => {
  const g = window.app.graph
  const B = g.getNodeById(Number(rr.B))
  const link = g.getLink(B.inputs[rr.idx].link)
  const r = g.createReroute([560, 300], link)
  g.setDirtyCanvas(true, true); await new Promise((x) => setTimeout(x, 600))
  return { rid: r.id, rpos: [r.pos[0], r.pos[1]] }
}, { rr })
await drag(await pinPos(rr.B, null, rr.idx), await dotPos(rr.C, rr.idx))
const rrCut = await page.evaluate(async ({ rr }) => {
  const g = window.app.graph
  const B = g.getNodeById(Number(rr.B))
  B.disconnectInput(rr.idx, true) // keepReroutes: the chain parks as a dangling float
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  g.setDirtyCanvas(true, true); await new Promise((x) => setTimeout(x, 900))
  return { floats: [...(g.floatingLinks?.values?.() ?? [])].length, bLinked: B.inputs[rr.idx].link != null }
}, { rr })
ok('RR: disconnect kept the chain as a float', rrCut.floats === 1 && !rrCut.bLinked, JSON.stringify(rrCut))
const rrOrigin = await originOf(rr.C, rr.idx)
ok('RR: C re-sources to B\'s own literal, stays on B pin (chain parked for re-grab)',
  await drawnFrom(rr.C, rr.idx, [['B', rr.B, rr.idx]]) === 'B' && rrOrigin === 'prim(B)',
  `origin=${rrOrigin}`)

// ---- (RC) ribbon variant: the broken hop's lane survives dangling -- the
// consumer rejoins the ribbon's out-tooth ----
const rc = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const mk = (t, x, y) => { const n = L.createNode('CLIPTextEncode'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const A = mk('A', 200, 80), B = mk('B', 1100, 80), B2 = mk('B2', 1100, 420), C = mk('C', 1100, 800)
  A.widgets.find((w) => w.name === 'text').value = 'v'
  const idx = A.inputs.findIndex((s) => s.widget?.name === 'text')
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id), B2: String(B2.id), C: String(C.id), idx }
})
await drag(await pinPos(rc.A, 'widget', null), await dotPos(rc.B, rc.idx))
await drag(await pinPos(rc.A, 'widget', null), await dotPos(rc.B2, rc.idx))
const rcComb = await page.evaluate(async ({ rc }) => {
  const g = window.app.graph
  const B = g.getNodeById(Number(rc.B))
  const l1 = B.inputs[rc.idx].link
  const l2 = g.getNodeById(Number(rc.B2)).inputs[rc.idx].link
  const combId = window.__cablemanagementCombs.create(l1, l2, 620, 300)
  await new Promise((x) => setTimeout(x, 900))
  const comb = g.extra.cablemanagement_combs.find((c) => c.id === combId)
  const lane = comb.lanes.find((l) => g.reroutes.get(l.out)?.linkIds?.has?.(Number(l1)))
  const tooth = g.reroutes.get(lane.out)
  return { combId, toothPos: [tooth.pos[0], tooth.pos[1]] }
}, { rc })
await drag(await pinPos(rc.B, null, rc.idx), await dotPos(rc.C, rc.idx))
const rcCut = await page.evaluate(async ({ rc }) => {
  const g = window.app.graph
  const B = g.getNodeById(Number(rc.B))
  B.disconnectInput(rc.idx, true)
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  g.setDirtyCanvas(true, true); await new Promise((x) => setTimeout(x, 900))
  const comb = g.extra.cablemanagement_combs?.find((c) => c.id === rc.combId) ??
    g.extra.cablemanagement_combs?.[0] ?? null
  return {
    floats: [...(g.floatingLinks?.values?.() ?? [])].length,
    lanes: comb?.lanes?.length ?? 0,
  }
}, { rc: { ...rc, combId: rcComb.combId } })
ok('RC: lane survives as dangling float', rcCut.floats >= 1 && rcCut.lanes === 2, JSON.stringify(rcCut))
const rcOrigin = await originOf(rc.C, rc.idx)
ok('RC: C re-sources to B\'s own literal, stays on B pin (lane parked for re-grab)',
  await drawnFrom(rc.C, rc.idx, [['B', rc.B, rc.idx]]) === 'B' && rcOrigin === 'prim(B)',
  `origin=${rcOrigin}`)

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
