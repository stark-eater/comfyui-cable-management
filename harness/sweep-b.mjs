// SWEEP CELL B -- INPUT-flavour combed links, reposition the input end.
// Scene: A(CheckpointLoaderSimple) hand-wired to S1(CheckpointSave); S1's input
// pins dragged to S2 (model -> S2-in-0, clip -> S2-in-1) = two provenance-only
// passthrough links A->S2. Comb the two links. Then move the model link's input
// end by mouse: (a) drop BACK on the same input, (b) drop on a third consumer S3.
// Reconnect mints a NEW link id; suspect: provenanceOf self-invalidates before
// drag.js re-records (onMoveInput adopts `pending` only if provenanceOf still
// matches at pickup) -> anchor reverts to the true origin (reanchor.js).
// Invariants after every step: 1 ANCHOR (draw start on the pin, never within
// 30px of the true origin; no route from the true origin), 2 NO ORPHANS.
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
const hyp = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1])

// -- scene (grid multiples; everything clear of the bottom-right minimap corner)
const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 80, 100)
  const S1 = mk('CheckpointSave', 620, 80)
  const S2 = mk('CheckpointSave', 1400, 420)
  const S3 = mk('CheckpointSave', 700, 640)
  A.connect(0, S1, 0) // model
  A.connect(1, S1, 1) // clip
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1800))
  return { A: String(A.id), S1: String(S1.id), S2: String(S2.id), S3: String(S3.id) }
})
const pinPt = (idx) => page.evaluate(([nid, idx]) => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === nid && x.dataset.cablemanagementIndex === String(idx)
  )
  const r = el?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, [ids.S1, idx])
const slotPt = (key) => page.evaluate(k => {
  const r = document.querySelector(`[data-slot-key="${k}"]`)?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, key)
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
}

// -- input passthroughs: S1's pins dragged onto S2
await drag(await pinPt(0), await slotPt(`${ids.S2}-in-0`))
await page.waitForTimeout(400)
await drag(await pinPt(1), await slotPt(`${ids.S2}-in-1`))
await page.waitForTimeout(400)

const fresh = () => page.evaluate(async () => {
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})

// Full graph truth for one step. Lanes identified by TARGET (model = S2-in-0 or
// S3-in-0 after the move, clip = S2-in-1) since reconnects mint new link ids.
const snap = (tag) => page.evaluate((arg) => {
  const g = window.app.graph
  const byId = (id) => g.getNodeById(id) ?? g.getNodeById(Number(id))
  const A = byId(arg.A), S1 = byId(arg.S1), S2 = byId(arg.S2), S3 = byId(arg.S3)
  const draw = window.__cablemanagementDraw ?? new Map()
  const routes = window.__cablemanagementPathing.routes()
  const info = (node, idx) => {
    const lid = node?.inputs?.[idx]?.link
    if (lid == null) return null
    const link = g.getLink ? g.getLink(lid) : g._links.get(lid)
    return {
      id: lid,
      parentId: link?.parentId ?? null,
      draw: draw.get(lid) ?? null,
      routeStarts: routes.filter(r => String(r.key).split('|')[0] === String(lid)).map(r => r.pts[0])
    }
  }
  const pinAnchor = (idx) => {
    const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
      x => x.dataset.cablemanagementNode === arg.S1 && x.dataset.cablemanagementIndex === String(idx)
    )
    if (!el) return null
    const r = el.getBoundingClientRect()
    const { ds } = window.app.canvas
    return [(r.x + r.width / 2) / ds.scale - ds.offset[0], (r.y + r.height / 2) / ds.scale - ds.offset[1]]
  }
  return {
    tag: arg.tag,
    aOut: [A.getConnectionPos(false, 0), A.getConnectionPos(false, 1)],
    pins: [pinAnchor(0), pinAnchor(1)],
    s2in0: info(S2, 0), s2in1: info(S2, 1), s3in0: info(S3, 0),
    provS2: S2?.properties?.['cablemanagement.from'] ?? null,
    provS3: S3?.properties?.['cablemanagement.from'] ?? null,
    ledger: window.__cablemanagement.ledger().size,
    reroutes: [...(g.reroutes?.values?.() ?? [])].map(r => ({
      id: r.id, links: [...(r.linkIds ?? [])].length, floats: [...(r.floatingLinkIds ?? [])].length
    })),
    combs: (g.extra?.cablemanagement_combs ?? []).map(c => ({ id: c.id, lanes: c.lanes.map(l => ({ in: l.in, out: l.out })) }))
  }
}, { ...ids, tag })

// invariant 1 for one lane: draw start pinned within 1.5px of its baseline
// anchor, never within 30px of the true-origin slot, no route from the origin
const inv1 = (tag, lane, entry, anchor, aOut) => {
  ok(`[1] ${tag}: ${lane} link exists + drawn`, !!entry?.draw, JSON.stringify(entry))
  if (!entry?.draw) return
  const start = [entry.draw[0], entry.draw[1]]
  ok(`[1] ${tag}: ${lane} draws from pin`, hyp(start, anchor) <= 1.5,
    JSON.stringify({ start, anchor, d: +hyp(start, anchor).toFixed(1) }))
  ok(`[1] ${tag}: ${lane} start clear of true origin`, hyp(start, aOut) > 30,
    JSON.stringify({ start, aOut, d: +hyp(start, aOut).toFixed(1) }))
  ok(`[1] ${tag}: ${lane} no route from true origin`,
    entry.routeStarts.every(p => hyp(p, aOut) > 30),
    JSON.stringify(entry.routeStarts))
}
// invariant 2: no wireless teeth / reroutes, no degenerate comb record
const inv2 = (tag, s) => {
  const rr = new Map(s.reroutes.map(r => [r.id, r]))
  const orphanRr = s.reroutes.filter(r => r.links + r.floats === 0)
  ok(`[2] ${tag}: no orphan reroutes`, orphanRr.length === 0, JSON.stringify(orphanRr))
  const orphanLanes = s.combs.flatMap(c => c.lanes.filter(l => {
    const i = rr.get(l.in), o = rr.get(l.out)
    return i && o && i.links + i.floats === 0 && o.links + o.floats === 0
  }))
  ok(`[2] ${tag}: no wireless comb lanes`, orphanLanes.length === 0, JSON.stringify(orphanLanes))
  ok(`[2] ${tag}: no degenerate comb record`, s.combs.every(c => c.lanes.length >= 2),
    JSON.stringify(s.combs))
}

// ---- baseline (pre-comb): both passthroughs anchored on S1's pins
await fresh()
const base = await snap('base')
ok('base: both passthrough links landed', !!base.s2in0 && !!base.s2in1,
  JSON.stringify({ s2in0: base.s2in0?.id ?? null, s2in1: base.s2in1?.id ?? null }))
if (!base.s2in0 || !base.s2in1) { console.log('scene build failed, aborting'); console.log('FAIL'); await b.close(); process.exit(1) }
// baseline anchors = the pin element centres (nodes never move in this cell);
// sanity: the at-rest draw start agrees with them
const anchor0 = base.pins[0], anchor1 = base.pins[1]
ok('base: model draw start agrees with pin element', hyp([base.s2in0.draw[0], base.s2in0.draw[1]], anchor0) <= 5,
  JSON.stringify({ draw: base.s2in0.draw, anchor0 }))
inv1('base', 'model', base.s2in0, anchor0, base.aOut[0])
inv1('base', 'clip', base.s2in1, anchor1, base.aOut[1])
inv2('base', base)
ok('base: provenance on S2 (both slots)',
  base.provS2?.['0']?.[2] === base.s2in0.id && base.provS2?.['1']?.[2] === base.s2in1.id,
  JSON.stringify(base.provS2))

// ---- comb the two links
await page.evaluate((ids) => {
  const g = window.app.graph
  const l1 = [...g._links.values()].find(l => String(l.target_id) === String(ids.S2) && l.target_slot === 0)
  const l2 = [...g._links.values()].find(l => String(l.target_id) === String(ids.S2) && l.target_slot === 1)
  const id = window.__cablemanagementCombs.create(l1.id, l2.id, 900, 260)
  window.__cablemanagementCombs.move(id, 'out', 1150, 260)
}, ids)
await page.waitForTimeout(600)
await fresh()
const combed = await snap('combed')
ok('combed: comb exists with 2 lanes', combed.combs.length === 1 && combed.combs[0]?.lanes.length === 2,
  JSON.stringify(combed.combs))
inv1('combed', 'model', combed.s2in0, anchor0, combed.aOut[0])
inv1('combed', 'clip', combed.s2in1, anchor1, combed.aOut[1])
inv2('combed', combed)

// ---- step 1: grab S2-in-0's dot, wander 200px, drop BACK on the same input
// (release a little INSIDE the node body next to the dot, not dead on it)
const dot = await slotPt(`${ids.S2}-in-0`)
await page.mouse.move(dot[0], dot[1])
await page.mouse.down()
await page.mouse.move(dot[0] + 180, dot[1] + 150, { steps: 12 })
await page.waitForTimeout(250)
// honesty check: the input end must genuinely be in hand, else the whole step is a no-op
const mid = await page.evaluate((lid) => {
  const lc = window.app.canvas.linkConnector
  return { connecting: lc.isConnecting, member: lc.inputLinks?.map(l => l.id) ?? [] }
}, combed.s2in0.id)
ok('dropback: input end genuinely in hand mid-drag',
  mid.connecting && mid.member.includes(combed.s2in0.id), JSON.stringify(mid))
await page.mouse.move(dot[0] + 14, dot[1] + 2, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(900)
await fresh()
const back = await snap('dropback')
ok('dropback: S2-in-0 reconnected', !!back.s2in0, JSON.stringify({ s2in0: back.s2in0 }))
if (back.s2in0) {
  console.log(`     (link id ${base.s2in0.id} -> ${back.s2in0.id}${back.s2in0.id === base.s2in0.id ? ', unchanged' : ', REMINTED'})`)
  inv1('dropback', 'model', back.s2in0, anchor0, back.aOut[0])
  ok('dropback: provenance follows CURRENT link id',
    back.provS2?.['0']?.[0] === ids.S1 && back.provS2?.['0']?.[2] === back.s2in0.id,
    JSON.stringify({ prov: back.provS2?.['0'] ?? null, slotLink: back.s2in0.id }))
}
inv1('dropback', 'clip', back.s2in1, anchor1, back.aOut[1])
inv2('dropback', back)

// ---- step 2: grab it again, drop on the THIRD consumer S3-in-0
const dot2 = await slotPt(`${ids.S2}-in-0`)
const dot3 = await slotPt(`${ids.S3}-in-0`)
if (dot2) {
  await page.mouse.move(dot2[0], dot2[1])
  await page.mouse.down()
  await page.mouse.move(dot3[0] + 14, dot3[1] + 2, { steps: 12 })
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(900)
} else {
  console.log('FAIL step 2 skipped: S2-in-0 has no dot to grab (dropback lost the link)')
  pass = false
}
await fresh()
const third = await snap('third')
ok('third: link landed on S3-in-0', !!third.s3in0, JSON.stringify({ s3in0: third.s3in0 }))
if (third.s3in0) {
  inv1('third', 'model->S3', third.s3in0, anchor0, third.aOut[0])
  ok('third: provenance recorded on S3 for CURRENT link id',
    third.provS3?.['0']?.[0] === ids.S1 && third.provS3?.['0']?.[2] === third.s3in0.id,
    JSON.stringify({ prov: third.provS3?.['0'] ?? null, slotLink: third.s3in0.id }))
}
inv1('third', 'clip', third.s2in1, anchor1, third.aOut[1])
inv2('third', third)
console.log('     (S2 residual prov after move-away:', JSON.stringify(third.provS2), ')')

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
