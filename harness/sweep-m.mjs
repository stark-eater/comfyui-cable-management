// SWEEP cell M -- delete the ORIGIN / HOST / CONSUMER of a combed passthrough link.
// Three fresh sub-scenes:
//   (1) INPUT flavour combed (A->S2 x2, provenance via S1 pins): g.remove(A) kills the
//       true origin -> lanes must not survive wireless (invariant 2), S2 provenance
//       pruned (reanchor.js prune: link dead -> forgetProvenance).
//   (2) WIDGET flavour combed (H->B1, H->B2): g.remove(HOST A) -> reapIfUnused sees a
//       dead host and reaps the owned primitive H -> links + lanes + records cleaned.
//   (3) WIDGET flavour: g.remove(B1) (consumer) -> its link dies -> dead lane must not
//       linger (invariant 2), survivor B2 stays pin-anchored (invariant 1), comb
//       auto-decomposes below 2 lanes (combPass).
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
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
}
const slotPt = (key) => page.evaluate((k) => {
  const r = document.querySelector(`[data-slot-key="${k}"]`)?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, key)
// Reset capture map + burn redraw frames (ghost-route trap) before every read.
const fresh = () => page.evaluate(async () => {
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})

// INVARIANT 2 -- no comb lane with both teeth alive but zero wires (links + floats),
// no reroute with empty linkIds + empty floatingLinkIds, no comb record below 2 lanes
// after a settle. A wire id only counts if it RESOLVES: core's createReroute(pos, link)
// seeds the new reroute's floatingLinkIds with the real link's id (phantom -- there is
// no such floating link), so raw set sizes lie. Raw sets ride along as evidence.
const inv2 = () => page.evaluate(() => {
  const g = window.app.graph
  const combs = g.extra?.cablemanagement_combs ?? []
  const wires = (r) => {
    let n = 0
    for (const id of r?.linkIds ?? []) if (g._links.has(id)) n++
    for (const id of r?.floatingLinkIds ?? []) if (g.floatingLinks?.has?.(id)) n++
    return n
  }
  const raw = (r) => ({ id: r.id, links: [...(r.linkIds ?? [])], floats: [...(r.floatingLinkIds ?? [])] })
  const wirelessLanes = []
  for (const c of combs) {
    for (const l of c.lanes) {
      const ti = g.reroutes?.get?.(l.in), to = g.reroutes?.get?.(l.out)
      if (ti && to && wires(ti) + wires(to) === 0) {
        wirelessLanes.push({ comb: c.id, in: raw(ti), out: raw(to) })
      }
    }
  }
  const orphanReroutes = [...(g.reroutes?.values?.() ?? [])]
    .filter((r) => wires(r) === 0).map(raw)
  const underLanes = combs.filter((c) => c.lanes.length < 2).map((c) => c.id)
  return { wirelessLanes, orphanReroutes, underLanes }
})
const assertInv2 = async (tag) => {
  const v = await inv2()
  ok(`[${tag}] inv2: no wireless lane`, v.wirelessLanes.length === 0, JSON.stringify(v.wirelessLanes))
  ok(`[${tag}] inv2: no orphan reroute`, v.orphanReroutes.length === 0, JSON.stringify(v.orphanReroutes))
  ok(`[${tag}] inv2: no comb record below 2 lanes`, v.underLanes.length === 0, JSON.stringify(v.underLanes))
}

// INVARIANT 1 -- each surviving watched link draws from its baseline pin anchor
// (<1.5px) and never from within 30px of the true-origin slot; no route for a WATCHED
// link starts near its true origin either (route keys are `${linkId}|...`; the scan
// must be per-link -- in the INPUT flavour the true origin A is a visible node whose
// own hand-wired links legitimately route from those slots). With `hiddenOrigin`
// (widget flavour: the origin is invisible machinery) NO route at all may start there.
// `watch` = [{linkId, base:[x,y], origin:[x,y]}].
const assertInv1 = async (tag, watch, hiddenOrigin = false) => {
  await fresh()
  const r = await page.evaluate(([watch, hiddenOrigin]) => {
    const draw = window.__cablemanagementDraw
    const routes = window.__cablemanagementPathing.routes()
    return watch.map((w) => {
      const d = draw.get(w.linkId) ?? null
      const nearOrigin = routes
        .filter((rt) => hiddenOrigin || rt.key.split('|')[0] === String(w.linkId))
        .filter((rt) => Math.hypot(rt.pts[0][0] - w.origin[0], rt.pts[0][1] - w.origin[1]) < 30)
        .map((rt) => rt.key)
      return {
        linkId: w.linkId,
        draw: d,
        offBase: d ? Math.hypot(d[0] - w.base[0], d[1] - w.base[1]) : null,
        originGap: d ? Math.hypot(d[0] - w.origin[0], d[1] - w.origin[1]) : null,
        nearOrigin
      }
    })
  }, [watch, hiddenOrigin])
  for (const x of r) {
    ok(`[${tag}] inv1: link ${x.linkId} draws from its pin anchor`, x.draw && x.offBase < 1.5, JSON.stringify(x))
    ok(`[${tag}] inv1: link ${x.linkId} not from true origin`, x.draw && x.originGap >= 30, JSON.stringify({ gap: x.originGap }))
    ok(`[${tag}] inv1: no route starts at link ${x.linkId}'s true origin`, x.nearOrigin.length === 0, JSON.stringify(x.nearOrigin))
  }
  return r
}

const dump = (tag) => page.evaluate((tag) => {
  const g = window.app.graph
  return {
    tag,
    links: [...g._links.values()].map((l) => ({ id: l.id, o: String(l.origin_id), t: String(l.target_id), slot: l.target_slot })),
    floats: [...(g.floatingLinks?.values?.() ?? [])].map((f) => ({ id: f.id, o: String(f.origin_id), t: String(f.target_id), parentId: f.parentId ?? null })),
    reroutes: [...(g.reroutes?.values?.() ?? [])].map((r) => ({ id: r.id, links: [...(r.linkIds ?? [])], floats: [...(r.floatingLinkIds ?? [])] })),
    combs: (g.extra?.cablemanagement_combs ?? []).map((c) => ({ id: c.id, lanes: c.lanes.map((l) => ({ ...l })) })),
    floatfrom: g.extra?.cablemanagement_floatfrom ?? null,
    owned: g.nodes.filter((n) => n.properties?.['cablemanagement.owned']).map((n) => String(n.id)),
    ledger: window.__cablemanagement.ledger().size
  }
}, tag)

// ======================================================================== scene 1
// INPUT flavour: A(loader) hand-wired to S1(save); S1's connected-input pins dragged
// to S2 mint A->S2 links carrying provenance {slot:[S1id, idx, linkId]}. Comb the two
// A->S2 links, then remove A (the true origin).
console.log('---- scene 1: INPUT flavour, delete true origin A')
const s1 = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 80, 100)
  const S1 = mk('CheckpointSave', 620, 80)
  const S2 = mk('CheckpointSave', 1400, 420)
  A.connect(0, S1, 0) // MODEL
  A.connect(1, S1, 1) // CLIP
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1800))
  return { A: String(A.id), S1: String(S1.id), S2: String(S2.id) }
})
const s1pin = (idx) => page.evaluate(([nid, idx]) => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === nid && x.dataset.cablemanagementIndex === String(idx)
  )
  const r = el?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, [s1.S1, idx])
{
  const p0 = await s1pin(0)
  const p1v = await (async () => { await drag(p0, await slotPt(`${s1.S2}-in-0`)); return s1pin(1) })()
  await drag(p1v, await slotPt(`${s1.S2}-in-1`))
}
const s1base = await page.evaluate(async (s1) => {
  const g = window.app.graph
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
  const A = g.getNodeById(Number(s1.A))
  const links = [...g._links.values()].filter((l) => String(l.target_id) === s1.S2)
  const S2 = g.getNodeById(Number(s1.S2))
  return {
    links: links.map((l) => ({
      linkId: l.id,
      base: window.__cablemanagementDraw.get(l.id) ?? null,
      origin: A.getConnectionPos(false, l.origin_slot)
    })),
    prov: S2.properties?.['cablemanagement.from'] ?? null
  }
}, s1)
ok('[s1] two passthrough links minted with provenance',
  s1base.links.length === 2 && s1base.links.every((l) => l.base) && s1base.prov && s1base.prov['0'] && s1base.prov['1'],
  JSON.stringify(s1base))
if (s1base.links.length === 2 && s1base.links.every((l) => l.base)) {
  const watch1 = s1base.links.map((l) => ({ linkId: l.linkId, base: [l.base[0], l.base[1]], origin: l.origin }))
  await assertInv1('s1 rest', watch1)
  await page.evaluate((ids) => {
    const g = window.app.graph
    const links = [...g._links.values()].filter((l) => String(l.target_id) === ids.S2).map((l) => l.id)
    const id = window.__cablemanagementCombs.create(links[0], links[1], 900, 260)
    window.__cablemanagementCombs.move(id, 'out', 1150, 260)
  }, s1)
  await fresh()
  await assertInv1('s1 combed', watch1)
  await assertInv2('s1 combed')
  // The mutation under test: the true origin dies.
  await page.evaluate((ids) => {
    const g = window.app.graph
    g.remove(g.getNodeById(Number(ids.A)))
  }, s1)
  await page.waitForTimeout(1500)
  await fresh()
  const d1 = await dump('s1 post-delete')
  console.log('    state:', JSON.stringify(d1))
  ok('[s1] origin links died with A', d1.links.filter((l) => l.o === s1.A).length === 0, JSON.stringify(d1.links))
  await assertInv2('s1 post-delete')
  const prov1 = await page.evaluate((ids) => window.app.graph.getNodeById(Number(ids.S2))?.properties?.['cablemanagement.from'] ?? null, s1)
  ok('[s1] S2 provenance pruned', !prov1 || Object.keys(prov1).length === 0, JSON.stringify(prov1))
}

// ======================================================================== scene 2
// WIDGET flavour: A's ckpt_name widget pin dragged onto B1 and B2 -> hidden owned
// primitive H feeds both. Comb H->B1 and H->B2, then remove the HOST A: reapIfUnused
// must reap H (dead host) and every lane/record with it.
console.log('---- scene 2: WIDGET flavour, delete host A')
const buildWidgetScene = async () => {
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
  // Comb the two primitive-fed links.
  const combed = await page.evaluate((ids) => {
    const g = window.app.graph
    const H = g.nodes.find((n) => n.properties?.['cablemanagement.owned'])
    if (!H) return null
    const links = [...g._links.values()].filter((l) => String(l.origin_id) === String(H.id))
    if (links.length !== 2) return { H: String(H.id), links: links.map((l) => l.id) }
    const id = window.__cablemanagementCombs.create(links[0].id, links[1].id, 700, 260)
    window.__cablemanagementCombs.move(id, 'out', 1000, 260)
    return { H: String(H.id), links: links.map((l) => l.id), combId: id }
  }, ids)
  await fresh()
  const base = await page.evaluate((arg) => {
    const g = window.app.graph
    const H = g.getNodeById(Number(arg.H))
    const draw = window.__cablemanagementDraw
    return arg.links.map((id) => {
      const l = g._links.get(id)
      return { linkId: id, base: draw.get(id) ?? null, origin: H.getConnectionPos(false, 0), target: String(l?.target_id) }
    })
  }, combed)
  return { ids, combed, base }
}

const s2 = await buildWidgetScene()
ok('[s2] widget scene: primitive H feeds B1+B2, combed',
  s2.combed?.combId != null && s2.base.length === 2 && s2.base.every((l) => l.base),
  JSON.stringify(s2.combed))
if (s2.combed?.combId != null && s2.base.every((l) => l.base)) {
  const watch2 = s2.base.map((l) => ({ linkId: l.linkId, base: [l.base[0], l.base[1]], origin: l.origin }))
  await assertInv1('s2 combed', watch2, true)
  await assertInv2('s2 combed')
  await page.evaluate((ids) => {
    const g = window.app.graph
    g.remove(g.getNodeById(Number(ids.A)))
  }, s2.ids)
  await page.waitForTimeout(1500)
  await fresh()
  const d2 = await dump('s2 post-delete')
  console.log('    state:', JSON.stringify(d2))
  ok('[s2] owned primitive H reaped with its host', d2.owned.length === 0, JSON.stringify(d2.owned))
  ok('[s2] primitive links died with H', d2.links.filter((l) => l.o === s2.combed.H).length === 0, JSON.stringify(d2.links))
  await assertInv2('s2 post-delete')
  const prov2 = await page.evaluate((ids) => ({
    b1: window.app.graph.getNodeById(Number(ids.B1))?.properties?.['cablemanagement.from'] ?? null,
    b2: window.app.graph.getNodeById(Number(ids.B2))?.properties?.['cablemanagement.from'] ?? null
  }), s2.ids)
  ok('[s2] consumer provenance pruned',
    (!prov2.b1 || Object.keys(prov2.b1).length === 0) && (!prov2.b2 || Object.keys(prov2.b2).length === 0),
    JSON.stringify(prov2))
  ok('[s2] ledger empty', d2.ledger === 0, `size=${d2.ledger}`)
}

// ======================================================================== scene 3
// WIDGET flavour again, fresh: remove CONSUMER B1. Its link dies; the dead lane must
// not linger, the comb drops below 2 lanes and auto-decomposes, and the survivor
// H->B2 stays anchored on A's pin.
console.log('---- scene 3: WIDGET flavour, delete consumer B1')
const s3 = await buildWidgetScene()
ok('[s3] widget scene: primitive H feeds B1+B2, combed',
  s3.combed?.combId != null && s3.base.length === 2 && s3.base.every((l) => l.base),
  JSON.stringify(s3.combed))
if (s3.combed?.combId != null && s3.base.every((l) => l.base)) {
  const watch3all = s3.base.map((l) => ({ linkId: l.linkId, base: [l.base[0], l.base[1]], origin: l.origin, target: l.target }))
  await assertInv1('s3 combed', watch3all, true)
  await assertInv2('s3 combed')
  await page.evaluate((ids) => {
    const g = window.app.graph
    g.remove(g.getNodeById(Number(ids.B1)))
  }, s3.ids)
  await page.waitForTimeout(1500)
  await fresh()
  const d3 = await dump('s3 post-delete')
  console.log('    state:', JSON.stringify(d3))
  const deadLink = watch3all.find((w) => w.target === s3.ids.B1)
  const liveLink = watch3all.find((w) => w.target === s3.ids.B2)
  ok('[s3] B1 link died', !d3.links.some((l) => l.id === deadLink.linkId), JSON.stringify(d3.links))
  ok('[s3] survivor link to B2 intact', d3.links.some((l) => l.id === liveLink.linkId), JSON.stringify(d3.links))
  ok('[s3] H survives (B2 still consumes)', d3.owned.length === 1, JSON.stringify(d3.owned))
  await assertInv2('s3 post-delete')
  // Post-phantom-fix semantics: deleting the consumer disconnects its link, and
  // core's disconnect-to-float (un-vetoed by the scrub) parks the lane as a
  // GENUINE dangling float from H riding the teeth -- same legal end-state as
  // scenes 1/2. Either that, or the comb decomposed. What must NOT happen is a
  // wireless lane (assertInv2 above covers it).
  const s3legal = d3.combs.length === 0 ||
    d3.combs.every((c) => c.lanes.every((l) => {
      const tin = d3.reroutes.find((r) => r.id === l.in)
      return tin && (tin.links.some((id) => d3.links.some((x) => x.id === id)) ||
        tin.floats.some((id) => d3.floats.some((x) => x.id === id)))
    }))
  ok('[s3] lanes either decomposed or riding genuine floats', s3legal,
    JSON.stringify({ combs: d3.combs, floats: d3.floats }))
  await assertInv1('s3 survivor', [liveLink], true)
}

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
