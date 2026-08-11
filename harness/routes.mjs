// Route reconciliation (2e increment 1) -- the design round's rulings as behavior,
// running AUTOMATICALLY (event + sync-pass driven; the suite never calls the pass
// by hand, it just edits the graph and waits like a user would).
//
// INPUT flavour (A feeds B, pins daisy B->C->D; physically all fed by A):
//   cut A->B   => C,D severed FOR REAL (honest disconnect), fragment kept as
//                 memory, drawn as ghost strokes
//   re-feed B  => fragment re-materializes, chain restored
//   cut B->C   => A-B untouched; C-D fragment; C itself must NOT revive later
//   hand-feed C=> D revives off C's pin; C's leftover memory is dropped
//   swap C's feed to A2 => D re-sources to A2 live
// WIDGET flavour (A' literal v1, pins daisy A'->B->C->D; physically fed by A's
// hidden primitive):
//   cut A'->B  => B's OWN literal takes over: C,D re-source to B's primitive
//                 (A keeps v1, B-C-D carry B's value) -- nothing severed
//   drop A'->C => C,D re-source back to A's primitive; B keeps its literal and
//                 its now-consumerless primitive is reaped
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
// Let the automatic machinery notice a programmatic edit and settle.
const settle = async () => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cablemanagement:resync')))
  await page.waitForTimeout(800)
}
// Origin of each titled node's input at `idx`: real node title, 'prim(HostTitle)'
// for an owned primitive, or null when empty. Plus the raw record.
const state = (idx) => page.evaluate((idx) => {
  const g = window.app.graph
  const out = {}
  for (const n of g.nodes) {
    if (!/^[A-Z]\d?$/.test(n.title ?? '')) continue
    const lid = n.inputs?.[idx]?.link
    const link = lid != null ? g.getLink(lid) : null
    const o = link ? g.getNodeById(Number(link.origin_id)) ?? g._nodes?.find?.((x) => String(x.id) === String(link.origin_id)) : null
    let origin = null
    if (o) {
      const host = o.properties?.['cablemanagement.owned'] ? g.getNodeById(Number(o.properties['cablemanagement.host'])) : null
      origin = host ? `prim(${host.title})` : o.title
    }
    out[n.title] = { origin, rec: n.properties?.['cablemanagement.from']?.[String(idx)] ?? null }
  }
  return out
}, idx)
const ghosts = () => page.evaluate(async () => {
  window.__cablemanagementGhostDraws = 0
  window.app.canvas.draw(true, true)
  return window.__cablemanagementGhostDraws
})

// ================= INPUT flavour =================
const li = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const A = L.createNode('EmptyLatentImage'); A.pos = [150, 150]; A.title = 'A'; g.add(A)
  const A2 = L.createNode('EmptyLatentImage'); A2.pos = [150, 700]; A2.title = 'A2'; g.add(A2)
  const mk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const B = mk('B', 700, 100), C = mk('C', 700, 500), D = mk('D', 1350, 300)
  const idx = B.inputs.findIndex((s) => s.name === 'latent_image')
  A.connect(0, B, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), A2: String(A2.id), B: String(B.id), C: String(C.id), D: String(D.id), idx }
})
await drag(await pinPos(li.B, null, li.idx), await dotPos(li.C, li.idx))
await drag(await pinPos(li.C, null, li.idx), await dotPos(li.D, li.idx))
await settle()

const s0 = await state(li.idx)
ok('I-base: B,C,D physically fed by A; records C<-B, D<-C',
  s0.B.origin === 'A' && s0.C.origin === 'A' && s0.D.origin === 'A' &&
  s0.C.rec?.[0] === li.B && s0.D.rec?.[0] === li.C, JSON.stringify(s0))

// cut A->B: honest sever cascades, fragment remembered + ghost-drawn
await page.evaluate((i) => { window.app.graph.getNodeById(Number(i.B)).disconnectInput(i.idx, false) }, li)
await settle()
const s1 = await state(li.idx)
ok('I-cut-head: C,D really disconnected (no data in the system)',
  s1.B.origin === null && s1.C.origin === null && s1.D.origin === null, JSON.stringify(s1))
ok('I-cut-head: fragment remembered (null-id records C<-B, D<-C)',
  s1.C.rec?.[2] === null && s1.C.rec?.[0] === li.B && s1.D.rec?.[2] === null && s1.D.rec?.[0] === li.C,
  JSON.stringify(s1))
ok('I-cut-head: fragment drawn as ghost strokes', (await ghosts()) >= 2)

// re-feed B: fragment re-materializes
await page.evaluate((i) => {
  const g = window.app.graph
  g.getNodeById(Number(i.A)).connect(0, g.getNodeById(Number(i.B)), i.idx)
}, li)
await settle()
const s2 = await state(li.idx)
ok('I-refeed: chain re-materializes from the head, records live',
  s2.B.origin === 'A' && s2.C.origin === 'A' && s2.D.origin === 'A' &&
  s2.C.rec?.[2] != null && s2.D.rec?.[2] != null, JSON.stringify(s2))
ok('I-refeed: ghosts gone', (await ghosts()) === 0)

// cut apparent B->C: A-B untouched, C-D fragment; C itself must not revive
await page.evaluate((i) => { window.app.graph.getNodeById(Number(i.C)).disconnectInput(i.idx, false) }, li)
await settle()
const s3 = await state(li.idx)
ok('I-cut-mid: A-B real and untouched; C empty; D severed with memory',
  s3.B.origin === 'A' && s3.C.origin === null && s3.D.origin === null && s3.D.rec?.[2] === null,
  JSON.stringify(s3))
ok('I-cut-mid: one ghost (C->D only, nothing into C)', (await ghosts()) === 1)
// prove C's leftover cannot revive: re-cut B's feed then re-feed it -- C must stay empty
await page.evaluate((i) => { window.app.graph.getNodeById(Number(i.B)).disconnectInput(i.idx, false) }, li)
await settle()
await page.evaluate((i) => {
  const g = window.app.graph
  g.getNodeById(Number(i.A)).connect(0, g.getNodeById(Number(i.B)), i.idx)
}, li)
await settle()
const s4 = await state(li.idx)
ok('I-no-zombie: user-cut C stays cut through a B re-feed cycle',
  s4.B.origin === 'A' && s4.C.origin === null && s4.D.origin === null, JSON.stringify(s4))

// hand-feed C: D revives off C's pin; C's own leftover record is dropped
await page.evaluate((i) => {
  const g = window.app.graph
  g.getNodeById(Number(i.A)).connect(0, g.getNodeById(Number(i.C)), i.idx)
}, li)
await settle()
const s5 = await state(li.idx)
ok('I-hand-feed: D re-materializes off C\'s pin; C record gone (their wire wins)',
  s5.C.origin === 'A' && s5.C.rec === null && s5.D.origin === 'A' && s5.D.rec?.[2] != null,
  JSON.stringify(s5))

// swap C's feed: D follows live
await page.evaluate((i) => {
  const g = window.app.graph
  g.getNodeById(Number(i.A2)).connect(0, g.getNodeById(Number(i.C)), i.idx)
}, li)
await settle()
const s6 = await state(li.idx)
ok('I-swap: D re-sources to A2 (route delivers whatever its head is fed)',
  s6.C.origin === 'A2' && s6.D.origin === 'A2' && s6.B.origin === 'A', JSON.stringify(s6))

// ================= WIDGET flavour =================
const w = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const mk = (t, x, y) => { const n = L.createNode('CLIPTextEncode'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const A = mk('A', 200, 80), B = mk('B', 850, 80), C = mk('C', 850, 500), D = mk('D', 850, 880)
  A.widgets.find((x) => x.name === 'text').value = 'v1'
  B.widgets.find((x) => x.name === 'text').value = 'v2'
  const idx = A.inputs.findIndex((s) => s.widget?.name === 'text')
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id), C: String(C.id), D: String(D.id), idx }
})
await drag(await pinPos(w.A, 'widget', null), await dotPos(w.B, w.idx))
await drag(await pinPos(w.B, null, w.idx), await dotPos(w.C, w.idx))
await drag(await pinPos(w.C, null, w.idx), await dotPos(w.D, w.idx))
await settle()
const t0 = await state(w.idx)
ok('W-base: B,C,D fed by A\'s primitive; records C<-B, D<-C',
  t0.B.origin === 'prim(A)' && t0.C.origin === 'prim(A)' && t0.D.origin === 'prim(A)' &&
  t0.C.rec?.[0] === w.B && t0.D.rec?.[0] === w.C, JSON.stringify(t0))

// cut A'->B: B's literal takes over -- C,D re-source to B's primitive, no severing
await page.evaluate((i) => { window.app.graph.getNodeById(Number(i.B)).disconnectInput(i.idx, false) }, w)
await settle()
const t1 = await state(w.idx)
ok('W-cut-head: B re-roots the chain -- C,D now fed by B\'s OWN primitive (v2 flows)',
  t1.B.origin === null && t1.C.origin === 'prim(B)' && t1.D.origin === 'prim(B)', JSON.stringify(t1))
ok('W-cut-head: nothing severed, no ghosts (widget chains re-root, never float)',
  t1.C.rec?.[2] != null && t1.D.rec?.[2] != null && (await ghosts()) === 0, JSON.stringify(t1))

// drop A'->C (real gesture): C,D re-source to A's primitive; B keeps its literal alone
await drag(await pinPos(w.A, 'widget', null), await dotPos(w.C, w.idx))
await settle()
const t2 = await state(w.idx)
const bPrimGone = await page.evaluate((i) => {
  const g = window.app.graph
  return !g.nodes.some((n) => n.properties?.['cablemanagement.owned'] && String(n.properties?.['cablemanagement.host']) === String(i.B))
}, w)
ok('W-swap: A-C-D carry v1 again; B alone keeps v2',
  t2.C.origin === 'prim(A)' && t2.D.origin === 'prim(A)' && t2.B.origin === null, JSON.stringify(t2))
ok('W-swap: B\'s consumerless primitive reaped', bPrimGone)

// ================= REROUTE CHAIN =================
// The apparent wire B->C threads a reroute. Cutting B's feed severs C for real
// but PARKS the reroute chain as a dangling float (typed, grabbable); the
// record remembers the chain's tail. Re-feeding B re-threads a real link
// through the same chain; swapping B's feed keeps the chain too.
const rr = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const A = L.createNode('EmptyLatentImage'); A.pos = [150, 150]; A.title = 'A'; g.add(A)
  const A2 = L.createNode('EmptyLatentImage'); A2.pos = [150, 700]; A2.title = 'A2'; g.add(A2)
  const mk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const B = mk('B', 700, 100), C = mk('C', 1350, 450)
  const idx = B.inputs.findIndex((s) => s.name === 'latent_image')
  A.connect(0, B, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), A2: String(A2.id), B: String(B.id), C: String(C.id), idx }
})
await drag(await pinPos(rr.B, null, rr.idx), await dotPos(rr.C, rr.idx))
const rrR = await page.evaluate(async ({ rr }) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(rr.C))
  const link = g.getLink(C.inputs[rr.idx].link)
  const r = g.createReroute([1050, 320], link)
  g.setDirtyCanvas(true, true); await new Promise((x) => setTimeout(x, 600))
  return { rid: r.id, parent: g.getLink(C.inputs[rr.idx].link).parentId }
}, { rr })
await settle()
ok('R-base: C\'s wire threads the reroute', rrR.parent === rrR.rid, JSON.stringify(rrR))

await page.evaluate(({ rr }) => { window.app.graph.getNodeById(Number(rr.B)).disconnectInput(rr.idx, false) }, { rr })
await settle()
const rrCut = await page.evaluate(({ rr, rid }) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(rr.C))
  return {
    cLink: C.inputs[rr.idx].link,
    rec: C.properties?.['cablemanagement.from']?.[String(rr.idx)] ?? null,
    floats: [...(g.floatingLinks?.values?.() ?? [])].length,
    rerouteAlive: !!g.getReroute?.(rid),
  }
}, { rr, rid: rrR.rid })
ok('R-cut: C severed for real; chain parked as a dangling float; tail remembered',
  rrCut.cLink == null && rrCut.rec?.[2] === null && rrCut.rec?.[3] === rrR.rid &&
  rrCut.floats >= 1 && rrCut.rerouteAlive, JSON.stringify(rrCut))
ok('R-cut: ghost bridges tail reroute to C', (await ghosts()) >= 1)

await page.evaluate(({ rr }) => {
  const g = window.app.graph
  g.getNodeById(Number(rr.A)).connect(0, g.getNodeById(Number(rr.B)), rr.idx)
}, { rr })
await settle()
const rrFeed = await page.evaluate(({ rr, rid }) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(rr.C))
  const link = C.inputs[rr.idx].link != null ? g.getLink(C.inputs[rr.idx].link) : null
  return {
    origin: link ? String(link.origin_id) : null,
    parent: link?.parentId ?? null,
    floats: [...(g.floatingLinks?.values?.() ?? [])].length,
    rec: C.properties?.['cablemanagement.from']?.[String(rr.idx)] ?? null,
  }
}, { rr, rid: rrR.rid })
ok('R-refeed: C re-materializes THROUGH the same reroute; parked float removed',
  rrFeed.origin === rr.A && rrFeed.parent === rrR.rid && rrFeed.floats === 0 && rrFeed.rec?.[2] != null,
  JSON.stringify(rrFeed))

await page.evaluate(({ rr }) => {
  const g = window.app.graph
  g.getNodeById(Number(rr.A2)).connect(0, g.getNodeById(Number(rr.B)), rr.idx)
}, { rr })
await settle()
const rrSwap = await page.evaluate(({ rr }) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(rr.C))
  const link = C.inputs[rr.idx].link != null ? g.getLink(C.inputs[rr.idx].link) : null
  return { origin: link ? String(link.origin_id) : null, parent: link?.parentId ?? null }
}, { rr })
ok('R-swap: C re-sources to A2, wire still threads the reroute',
  rrSwap.origin === rr.A2 && rrSwap.parent === rrR.rid, JSON.stringify(rrSwap))

// ================= RIBBON LANE =================
// Same contract with a comb: cut B's feed -> both riders sever, lanes park as
// dangling floats on their teeth; re-feed -> real links re-thread the lanes.
const cb = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const A = L.createNode('EmptyLatentImage'); A.pos = [150, 150]; A.title = 'A'; g.add(A)
  const mk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const B = mk('B', 640, 100), C = mk('C', 1400, 120), C2 = mk('C2', 1400, 560)
  const idx = B.inputs.findIndex((s) => s.name === 'latent_image')
  A.connect(0, B, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id), C: String(C.id), C2: String(C2.id), idx }
})
await drag(await pinPos(cb.B, null, cb.idx), await dotPos(cb.C, cb.idx))
await drag(await pinPos(cb.B, null, cb.idx), await dotPos(cb.C2, cb.idx))
const cbComb = await page.evaluate(async ({ cb }) => {
  const g = window.app.graph
  const l1 = g.getNodeById(Number(cb.C)).inputs[cb.idx].link
  const l2 = g.getNodeById(Number(cb.C2)).inputs[cb.idx].link
  const combId = window.__cablemanagementCombs.create(l1, l2, 1050, 330)
  await new Promise((x) => setTimeout(x, 900))
  return { combId, lanes: g.extra.cablemanagement_combs.find((c) => c.id === combId)?.lanes?.length ?? 0 }
}, { cb })
await settle()
ok('B-base: two riders combed into a ribbon', cbComb.lanes === 2, JSON.stringify(cbComb))

await page.evaluate(({ cb }) => { window.app.graph.getNodeById(Number(cb.B)).disconnectInput(cb.idx, false) }, { cb })
await settle()
const cbCut = await page.evaluate(({ cb }) => {
  const g = window.app.graph
  const rec = (id) => g.getNodeById(Number(id)).properties?.['cablemanagement.from']?.[String(cb.idx)] ?? null
  const linked = (id) => g.getNodeById(Number(id)).inputs[cb.idx].link != null
  return {
    c: { linked: linked(cb.C), rec: rec(cb.C) }, c2: { linked: linked(cb.C2), rec: rec(cb.C2) },
    floats: [...(g.floatingLinks?.values?.() ?? [])].length,
    lanes: g.extra.cablemanagement_combs?.[0]?.lanes?.length ?? 0,
  }
}, { cb })
ok('B-cut: both riders severed; lanes parked as dangling floats',
  !cbCut.c.linked && !cbCut.c2.linked && cbCut.c.rec?.[2] === null && cbCut.c2.rec?.[2] === null &&
  cbCut.floats >= 2 && cbCut.lanes === 2, JSON.stringify(cbCut))

await page.evaluate(({ cb }) => {
  const g = window.app.graph
  g.getNodeById(Number(cb.A)).connect(0, g.getNodeById(Number(cb.B)), cb.idx)
}, { cb })
await settle()
const cbFeed = await page.evaluate(({ cb }) => {
  const g = window.app.graph
  const info = (id) => {
    const l = g.getNodeById(Number(id)).inputs[cb.idx].link
    const link = l != null ? g.getLink(l) : null
    return { origin: link ? String(link.origin_id) : null, threaded: link?.parentId != null }
  }
  return { c: info(cb.C), c2: info(cb.C2), floats: [...(g.floatingLinks?.values?.() ?? [])].length }
}, { cb })
ok('B-refeed: both riders re-materialize through their lanes',
  cbFeed.c.origin === cb.A && cbFeed.c2.origin === cb.A && cbFeed.c.threaded && cbFeed.c2.threaded && cbFeed.floats === 0,
  JSON.stringify(cbFeed))

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
