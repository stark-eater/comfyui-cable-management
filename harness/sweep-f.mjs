// SWEEP cell F: serialize + configure() reload with combed INPUT-flavour links.
//
// Scene: A (CheckpointLoaderSimple) hand-wired to S1 (CheckpointSave) model+clip;
// S1's input pins dragged onto S2 (CheckpointSave) -> two provenance-only
// passthrough links A->S2 (cablemanagement.from on S2, NO owned primitive to fall back
// on); both links enrolled in a comb. Then g.serialize() + g.configure(s):
// every node/link/reroute object is minted anew and the provenance records ride
// properties while the comb record rides graph.extra -- cell F asks whether the
// reload keeps (a) the pin anchors (invariant 1), (b) zero orphan teeth/reroutes
// (invariant 2), (c) the comb record with lanes riding the SAME links, and
// (d) provenance entries matching the (possibly renumbered) link ids.
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
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

// ---- scene ----------------------------------------------------------------------
const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 80, 100)
  const S1 = mk('CheckpointSave', 620, 80)
  const S2 = mk('CheckpointSave', 1400, 420)
  A.connect(0, S1, 0) // model
  A.connect(1, S1, 1) // clip
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1800))
  return { A: String(A.id), S1: String(S1.id), S2: String(S2.id) }
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
const p0 = await pinPt(0)
const p1 = await pinPt(1)
ok('input pins materialised on S1', !!p0 && !!p1, JSON.stringify({ p0, p1 }))
await drag(p0, await slotPt(`${ids.S2}-in-0`))
await drag(await pinPt(1), await slotPt(`${ids.S2}-in-1`))
await page.waitForTimeout(1200)

// comb the two passthrough links (both target S2)
const combId = await page.evaluate((ids) => {
  const g = window.app.graph
  const links = [...g._links.values()]
    .filter(l => String(l.target_id) === String(ids.S2))
    .map(l => l.id)
  if (links.length !== 2) return null
  const id = window.__cablemanagementCombs.create(links[0], links[1], 900, 260)
  window.__cablemanagementCombs.move(id, 'out', 1150, 260)
  return id
}, ids)
ok('comb created over both passthrough links', combId != null, `combId=${combId}`)

// ---- truth reader ---------------------------------------------------------------
const fresh = () => page.evaluate(async () => {
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})
const snap = (tag) => page.evaluate((arg) => {
  const g = window.app.graph
  const TITLE = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30
  const A = g.getNodeById(Number(arg.A))
  const S2 = g.getNodeById(Number(arg.S2))
  const draw = window.__cablemanagementDraw ?? new Map()
  // graph-space centre of one of our pins, the ledger's own anchor formula
  const pinAnchor = (nid, idx) => {
    const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
      x => x.dataset.cablemanagementNode === String(nid) && x.dataset.cablemanagementIndex === String(idx)
    )
    const n = g.getNodeById(Number(nid))
    if (!el || !n) return null
    return [
      n.pos[0] + el.offsetLeft + el.offsetWidth * 0.5,
      n.pos[1] - TITLE + el.offsetTop + el.offsetHeight * 0.5
    ]
  }
  const links = [0, 1].map(slot => {
    const lid = S2?.inputs?.[slot]?.link
    const l = lid != null ? g._links.get(lid) : null
    if (!l) return null
    const chain = []
    let rid = l.parentId
    let guard = 0
    while (rid != null && guard++ < 20) { chain.push(rid); rid = g.getReroute(rid)?.parentId }
    chain.reverse()
    return { slot, id: l.id, origin: String(l.origin_id), oslot: l.origin_slot, draw: draw.get(l.id) ?? null, chain }
  })
  const trueOrigins = A ? [A.getConnectionPos(false, 0), A.getConnectionPos(false, 1)] : null
  // Scope to the PASSTHROUGH routes: A stays a visible node whose hand-drawn
  // A->S1 wires legitimately start at its output slots.
  const passIds = new Set(links.filter(Boolean).map(l => String(l.id)))
  const routes = window.__cablemanagementPathing.routes()
  const nearOrigin = trueOrigins
    ? routes.filter(r => passIds.has(r.key.split('|')[0]) && trueOrigins.some(o =>
        Math.hypot(r.pts[0][0] - o[0], r.pts[0][1] - o[1]) < 30)).map(r => r.key)
    : []
  const reroutes = [...(g.reroutes?.values() ?? [])].map(r => ({
    id: r.id,
    links: [...(r.linkIds ?? [])].length,
    floats: [...(r.floatingLinkIds ?? [])].length
  }))
  const combs = (g.extra?.cablemanagement_combs ?? []).map(c => ({ id: c.id, lanes: c.lanes.map(l => ({ ...l })) }))
  return {
    tag: arg.tag,
    anchors: [pinAnchor(arg.S1, 0), pinAnchor(arg.S1, 1)],
    links, trueOrigins, nearOrigin, reroutes, combs,
    prov: S2?.properties?.['cablemanagement.from'] ?? null,
    ledger: window.__cablemanagement.ledger().size
  }
}, { ...ids, tag })

// invariant battery, run against a snapshot (tagged so pre/post lines read apart)
const check = (st, tag) => {
  console.log(`== ${tag}`, JSON.stringify(st))
  for (const l of st.links ?? []) {
    const label = `[${tag}] S2 slot ${l?.slot}`
    ok(`${label}: link present with draw capture`, !!l && !!l.draw, JSON.stringify(l))
    if (!l || !l.draw) continue
    const anchor = st.anchors[l.slot]
    ok(`${label}: inv1 draw start on the S1 pin (<=1.5px)`,
      !!anchor && dist([l.draw[0], l.draw[1]], anchor) <= 1.5,
      JSON.stringify({ draw: l.draw.slice(0, 2), anchor }))
    const origin = st.trueOrigins?.[l.oslot]
    ok(`${label}: inv1 draw start >=30px from true origin`,
      !!origin && dist([l.draw[0], l.draw[1]], origin) >= 30,
      JSON.stringify({ draw: l.draw.slice(0, 2), origin }))
    ok(`${label}: lane rides this link (chain == a lane's teeth)`,
      l.chain.length === 2 &&
        (st.combs[0]?.lanes ?? []).some(x => x.in === l.chain[0] && x.out === l.chain[1]),
      JSON.stringify({ chain: l.chain, lanes: st.combs[0]?.lanes }))
    const p = st.prov?.[String(l.slot)]
    ok(`${label}: provenance intact and matching link id`,
      Array.isArray(p) && p[2] === l.id,
      JSON.stringify({ prov: p, linkId: l.id }))
  }
  ok(`[${tag}] both links present`, (st.links ?? []).filter(Boolean).length === 2)
  ok(`[${tag}] inv1 no route starts near the true origin`, st.nearOrigin.length === 0, JSON.stringify(st.nearOrigin))
  ok(`[${tag}] inv2 no orphan reroutes (0 links + 0 floats)`,
    st.reroutes.every(r => r.links > 0 || r.floats > 0), JSON.stringify(st.reroutes))
  ok(`[${tag}] comb record intact (1 comb, 2 lanes, teeth alive)`,
    st.combs.length === 1 && st.combs[0].lanes.length === 2 &&
      st.combs[0].lanes.every(l =>
        st.reroutes.some(r => r.id === l.in) && st.reroutes.some(r => r.id === l.out)),
    JSON.stringify(st.combs))
  ok(`[${tag}] ledger holds both passthrough entries`, st.ledger >= 2, `ledger=${st.ledger}`)
}

// ---- baseline -------------------------------------------------------------------
await fresh()
const base = await snap('base')
check(base, 'base')

// ---- serialize + configure ------------------------------------------------------
await page.evaluate(async () => {
  const app = window.app, g = app.graph
  const s = g.serialize()
  g.configure(s)
  // configure resets render mode with the rest of canvas state; PCB is part of the scene
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
})
await page.waitForTimeout(1500) // let the extension's sync pass rebuild pins on the NEW nodes
await fresh()
const post = await snap('reload')
check(post, 'reload')

// lanes must ride the SAME links across the cycle (ids may renumber; the wire is
// identified by its endpoints)
for (const slot of [0, 1]) {
  const a = base.links[slot], c = post.links[slot]
  ok(`[reload] slot ${slot} wire survived with same endpoints`,
    !!a && !!c && a.origin === c.origin && a.oslot === c.oslot,
    JSON.stringify({ base: a && [a.origin, a.oslot], post: c && [c.origin, c.oslot] }))
}

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
