// Modifier gestures on ribbon OUT pins (2g round 3, Barney: "same interaction
// on ribbon outputs"). The out-pin's wires are the lane's riders.
//   s1 shift+drag  -- lifts exactly the lane's riders as core's moving bundle
//                     (fixed end at the lane's in-tooth); drop on H re-sources
//                     them through the lane; sibling lane, host feed, hand
//                     wire untouched; records + the lane's source illusion end
//   s2 ctrl+alt    -- cuts the riders at the press, no drag; lane parks as a
//                     float; the lane's apparent-source stamps SURVIVE (the
//                     cut touches only the consumer side)
//   s3 shift on a dangling out-tooth -- no riders: plain resume, core parity
// PCB render mode throughout (Barney's live environment).
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2560, height: 1300 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}

await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(2600)

async function drag(from, to, mods = []) {
  for (const m of mods) await page.keyboard.down(m)
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
  for (const m of mods) await page.keyboard.up(m)
}
const pinPos = (id, idx) => page.evaluate(({ id, idx }) => {
  const p = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${idx}"]`)
  const r = p?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })
const dotPos = (id, idx, out) => page.evaluate(({ id, idx, out }) => {
  const d = document.querySelector(`[data-slot-key="${id}-${out ? 'out' : 'in'}-${idx}"]`)
  const r = d?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx, out })
const gp = (x, y) => page.evaluate(({ x, y }) => {
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return [view.left + (x + ds.offset[0]) * ds.scale, view.top + (y + ds.offset[1]) * ds.scale]
}, { x, y })
const rrPt = (rid) => page.evaluate(({ rid }) => {
  const r = window.app.graph.reroutes.get(rid)
  if (!r) return null
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return { pos: [...r.pos], pt: [view.left + (r.pos[0] + ds.offset[0]) * ds.scale, view.top + (r.pos[1] + ds.offset[1]) * ds.scale] }
}, { rid })
const feed = (id, idx) => page.evaluate(({ id, idx }) => {
  const g = window.app.graph
  const n = g.getNodeById(Number(id))
  const lid = n.inputs?.[idx]?.link
  const link = lid != null ? g.getLink(lid) : null
  return {
    lid: lid ?? null, origin: link ? String(link.origin_id) : null, parent: link?.parentId ?? null,
    rec: n.properties?.['cablemanagement.from']?.[String(idx)] ?? null,
  }
}, { id, idx })
const stamps = (laneIn, laneOut) => page.evaluate(({ laneIn, laneOut }) => {
  const b = (window.app.graph.extra ?? {}).cablemanagement_routes
  const res = (kind, id) => { const r = b?.claims?.[kind]?.[String(id)]; return r === undefined ? null : b.routes[r]?.src ?? null }
  const pick = (kind) => ({ in: res(kind, laneIn), out: res(kind, laneOut) })
  return { rf: pick('reroutes'), ff: pick('floats') }
}, { laneIn, laneOut })
let neutral = null
const cleanup = async () => {
  if (await page.evaluate(() => document.querySelectorAll('.litecontextmenu').length)) {
    await page.mouse.click(...neutral); await page.waitForTimeout(500)
  }
  await page.evaluate(() => {
    document.querySelectorAll('.litecontextmenu').forEach((e) => e.remove())
    const lc = window.app.canvas.linkConnector
    if (lc?.isConnecting) lc.reset?.(true)
  })
  await page.waitForTimeout(300)
}

const buildScene = () => page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
  { const L = window.LiteGraph, taken = [L.STRAIGHT_LINK, L.LINEAR_LINK, L.SPLINE_LINK, L.HIDDEN_LINK]; let v = 64; while (taken.includes(v)) v++; window.app.canvas.links_render_mode = v } // PCB sentinel (active() gates on it), canvas prop only
  const A = L.createNode('EmptyLatentImage'); A.pos = [150, 120]; A.title = 'A'; g.add(A)
  const H = L.createNode('EmptyLatentImage'); H.pos = [150, 760]; H.title = 'H'; g.add(H)
  const mk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const B = mk('B', 560, 100), C = mk('C', 1450, 80), D = mk('D', 1450, 500), D2 = mk('D2', 1750, 240), E = mk('E', 1450, 920)
  const idx = B.inputs.findIndex((s) => s.name === 'latent_image')
  A.connect(0, B, idx)
  A.connect(0, E, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  const o = { idx }
  for (const n of [A, H, B, C, D, D2, E]) o[n.title] = String(n.id)
  return o
}, null)

// scene builder: pin wires to C and D, comb them, branch lane C's out-tooth to
// D2 so that lane carries TWO riders; returns the comb record + lane handles
const wireAndComb = async (ids) => {
  await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.C, ids.idx))
  await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.D, ids.idx))
  const cb = await page.evaluate(async ({ ids }) => {
    const g = window.app.graph
    const l1 = g.getNodeById(Number(ids.C)).inputs[ids.idx].link
    const l2 = g.getNodeById(Number(ids.D)).inputs[ids.idx].link
    const id = window.__cablemanagementCombs.create(l1, l2, 1000, 300)
    await new Promise((x) => setTimeout(x, 900))
    const rec = g.extra.cablemanagement_combs.find((c) => c.id === id)
    const laneC = rec.lanes.findIndex((l) => g.reroutes.get(l.out)?.linkIds?.has?.(Number(l1)))
    return { laneC, lanes: rec.lanes.map((l) => ({ ...l })) }
  }, { ids })
  const laneC = cb.lanes[cb.laneC]
  const laneD = cb.lanes[1 - cb.laneC]
  await drag((await rrPt(laneC.out)).pt, await dotPos(ids.D2, ids.idx)) // branch: lane C rides C + D2
  await page.waitForTimeout(600)
  return { laneC, laneD }
}

// ---- s1: shift+drag the out-tooth bundle onto H ----
{
  const ids = await buildScene()
  neutral = await gp(950, 700)
  const { laneC, laneD } = await wireAndComb(ids)
  const pre = { d2: await feed(ids.D2, ids.idx), stamps: await stamps(laneC.in, laneC.out) }
  ok('s1 setup: lane C rides C and D2', pre.d2.origin === ids.A && pre.d2.parent === laneC.out, JSON.stringify(pre.d2))
  ok('s1 setup: lane C is stamped with the pin as apparent source',
    pre.stamps.rf.in != null || pre.stamps.rf.out != null || pre.stamps.ff.in != null, JSON.stringify(pre.stamps))

  const toothPt = (await rrPt(laneC.out)).pt
  await page.keyboard.down('Shift')
  await page.mouse.move(toothPt[0], toothPt[1]); await page.mouse.down()
  await page.mouse.move(...await gp(900, 950), { steps: 10 }); await page.waitForTimeout(600)
  const mid = await page.evaluate(({ ids, laneC }) => {
    const g = window.app.graph, lc = window.app.canvas.linkConnector
    const froms = (lc.renderLinks ?? []).map((rl) => [Math.round(rl.fromPos?.[0] ?? -1), Math.round(rl.fromPos?.[1] ?? -1)])
    const inBox = (f, id) => {
      const n = g.getNodeById(Number(id))
      return f[0] >= n.pos[0] - 20 && f[0] <= n.pos[0] + n.size[0] + 20 &&
             f[1] >= n.pos[1] - 40 && f[1] <= n.pos[1] + n.size[1] + 40
    }
    const hid = (id) => { const l = g.getLink(g.getNodeById(Number(id)).inputs[ids.idx].link); return !!l?._dragging }
    const floats = [...(g.floatingLinks?.values?.() ?? [])].map((x) => ({ o: String(x.origin_id), t: String(x.target_id), p: x.parentId }))
    return {
      isConnecting: lc.isConnecting, to: lc.state?.connectingTo ?? null,
      renderLinks: lc.renderLinks?.length ?? 0, froms,
      atConsumers: froms.length === 2 && froms.every((f) => inBox(f, ids.C) || inBox(f, ids.D2)),
      laneFloat: floats.some((x) => (x.p === laneC.in || x.p === laneC.out) && x.o === ids.A && x.t === '-1'),
      hostHidden: hid(ids.B), handHidden: hid(ids.E), laneDHidden: hid(ids.D),
    }
  }, { ids, laneC })
  await page.mouse.move(...await dotPos(ids.H, 0, true), { steps: 8 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
  await page.keyboard.up('Shift')
  ok('s1 mid: bundle is exactly the lane\'s two wires, seeking an output',
    mid.isConnecting && mid.to === 'output' && mid.renderLinks === 2, JSON.stringify(mid))
  ok('s1 mid: previews anchored at the CONSUMERS; the lane already floats with its source',
    mid.atConsumers && mid.laneFloat && !mid.hostHidden && !mid.handHidden && !mid.laneDHidden,
    JSON.stringify(mid))
  const after = {
    c: await feed(ids.C, ids.idx), d2: await feed(ids.D2, ids.idx),
    d: await feed(ids.D, ids.idx), b: await feed(ids.B, ids.idx), e: await feed(ids.E, ids.idx),
    lanes: await page.evaluate(() => window.app.graph.extra.cablemanagement_combs[0]?.lanes?.length ?? 0),
    laneFloat: await page.evaluate(({ laneC, A }) => {
      const g = window.app.graph
      return [...(g.floatingLinks?.values?.() ?? [])].some((x) =>
        (x.parentId === laneC.in || x.parentId === laneC.out) && String(x.origin_id) === A && String(x.target_id) === '-1')
    }, { laneC, A: ids.A }),
    stamps: await stamps(laneC.in, laneC.out),
  }
  ok('s1 drop on H: both wires leave the ribbon and feed DIRECTLY from H',
    after.c.origin === ids.H && after.d2.origin === ids.H &&
    after.c.parent == null && after.d2.parent == null, JSON.stringify({ c: after.c, d2: after.d2 }))
  ok('s1 drop on H: the lane survives as a floating lane still fed by A, comb intact',
    after.laneFloat && after.lanes === 2, JSON.stringify({ laneFloat: after.laneFloat, lanes: after.lanes }))
  ok('s1 drop on H: sibling lane, host feed, hand wire untouched',
    after.d.origin === ids.A && after.b.origin === ids.A && after.e.origin === ids.A,
    JSON.stringify({ d: after.d, b: after.b, e: after.e }))
  ok('s1 drop on H: records gone; the lane\'s source-side stamps SURVIVE (cut is consumer-side only)',
    after.c.rec == null && after.d2.rec == null &&
    (after.stamps.rf.in != null || after.stamps.rf.out != null),
    JSON.stringify({ c: after.c.rec, d2: after.d2.rec, stamps: after.stamps }))
  await cleanup()
}

// ---- s2: ctrl+alt on the out-tooth: riders cut, lane parks, stamps survive ----
{
  const ids = await buildScene()
  neutral = await gp(950, 700)
  const { laneC, laneD } = await wireAndComb(ids)
  const pre = await stamps(laneC.in, laneC.out)
  const toothPt = (await rrPt(laneC.out)).pt
  await page.keyboard.down('Control'); await page.keyboard.down('Alt')
  await page.mouse.move(toothPt[0], toothPt[1]); await page.mouse.down()
  await page.waitForTimeout(300)
  const mid = await page.evaluate(() => {
    const lc = window.app.canvas.linkConnector
    return { isConnecting: lc.isConnecting, renderLinks: lc.renderLinks?.length ?? 0 }
  })
  await page.mouse.up(); await page.waitForTimeout(800)
  await page.keyboard.up('Alt'); await page.keyboard.up('Control')
  const after = await page.evaluate(({ ids, laneC }) => {
    const g = window.app.graph
    const f = (id) => g.getNodeById(Number(id)).inputs[ids.idx].link ?? null
    const floats = [...(g.floatingLinks?.values?.() ?? [])].map((x) => ({ o: String(x.origin_id), t: String(x.target_id), p: x.parentId }))
    return {
      c: f(ids.C), d2: f(ids.D2), d: f(ids.D), b: f(ids.B), e: f(ids.E),
      laneFloat: floats.some((x) => x.p === laneC.in || x.p === laneC.out),
      lanes: g.extra.cablemanagement_combs[0]?.lanes?.length ?? 0,
      recC: g.getNodeById(Number(ids.C)).properties?.['cablemanagement.from']?.[String(ids.idx)] ?? null,
    }
  }, { ids, laneC })
  const post = await stamps(laneC.in, laneC.out)
  ok('s2 ctrl+alt: no drag, both riders cut', !mid.isConnecting && after.c == null && after.d2 == null,
    JSON.stringify({ mid, c: after.c, d2: after.d2 }))
  ok('s2 ctrl+alt: lane parks as a float, comb intact, sibling/host/hand untouched',
    after.laneFloat && after.lanes === 2 && after.d != null && after.b != null && after.e != null,
    JSON.stringify(after))
  ok('s2 ctrl+alt: records gone, route stamps survive, and the parked float INHERITS the pin as its draw source',
    after.recC == null &&
    JSON.stringify(post.rf) === JSON.stringify(pre.rf) &&
    JSON.stringify(post.ff.in) === JSON.stringify(pre.rf.in) &&
    JSON.stringify(post.ff.out) === JSON.stringify(pre.rf.out),
    JSON.stringify({ pre, post }))

  // ---- s3: shift on the now-dangling out-tooth: no riders, plain resume ----
  await page.keyboard.down('Shift')
  await page.mouse.move(toothPt[0], toothPt[1]); await page.mouse.down()
  await page.mouse.move(...await gp(1200, 700), { steps: 10 }); await page.waitForTimeout(500)
  const mid3 = await page.evaluate(() => {
    const lc = window.app.canvas.linkConnector
    return { isConnecting: lc.isConnecting, to: lc.state?.connectingTo ?? null }
  })
  await page.mouse.move(...await dotPos(ids.D2, ids.idx), { steps: 8 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
  await page.keyboard.up('Shift')
  const d2b = await feed(ids.D2, ids.idx)
  ok('s3 shift on a dangling out-tooth: plain resume, connects through the lane',
    mid3.isConnecting && d2b.origin === ids.A && d2b.parent != null, JSON.stringify({ mid3, d2b }))
  await cleanup()

  // ---- s4: shift+CLICK (zero motion) on the out-tooth: pure no-op ----
  {
    const tp2 = (await rrPt(laneC.out)).pt
    const preFloats = await page.evaluate(() => window.app.graph.floatingLinks?.size ?? 0)
    await page.keyboard.down('Shift')
    await page.mouse.move(tp2[0], tp2[1]); await page.mouse.down()
    await page.waitForTimeout(200)
    await page.mouse.up(); await page.waitForTimeout(600)
    await page.keyboard.up('Shift')
    const s4 = await page.evaluate(({ ids, pre }) => {
      const g = window.app.graph, lc = window.app.canvas.linkConnector
      return {
        d2: g.getNodeById(Number(ids.D2)).inputs[ids.idx].link ?? null,
        floats: (g.floatingLinks?.size ?? 0) - pre,
        menu: document.querySelectorAll('.litecontextmenu').length,
        idle: !lc.isConnecting,
      }
    }, { ids, pre: preFloats })
    ok('s4 shift+click: nothing cut, nothing armed, no menu',
      s4.d2 != null && s4.floats === 0 && s4.menu === 0 && s4.idle, JSON.stringify(s4))
  }

  // ---- s5: plain CLICK on the out-tooth: no release menu, lane intact ----
  {
    const tp2 = (await rrPt(laneC.out)).pt
    await page.mouse.move(tp2[0], tp2[1]); await page.mouse.down()
    await page.waitForTimeout(200)
    await page.mouse.up(); await page.waitForTimeout(600)
    const s5 = await page.evaluate(({ ids }) => {
      const g = window.app.graph, lc = window.app.canvas.linkConnector
      return {
        d2: g.getNodeById(Number(ids.D2)).inputs[ids.idx].link ?? null,
        menu: document.querySelectorAll('.litecontextmenu').length,
        idle: !lc.isConnecting,
      }
    }, { ids })
    ok('s5 plain click on out-tooth: no menu, connector idle, lane intact',
      s5.d2 != null && s5.menu === 0 && s5.idle, JSON.stringify(s5))
  }
}

// ---- s6: ctrl+alt on the IN pin: source cut, riders park, fresh drag seeks a source ----
{
  const ids = await buildScene()
  neutral = await gp(950, 700)
  const { laneC, laneD } = await wireAndComb(ids)
  const preStamps = await stamps(laneC.in, laneC.out)
  const inPt = (await rrPt(laneC.in)).pt
  await page.keyboard.down('Control'); await page.keyboard.down('Alt')
  await page.mouse.move(inPt[0], inPt[1]); await page.mouse.down()
  await page.waitForTimeout(300)
  const mid = await page.evaluate(({ ids, laneC }) => {
    const g = window.app.graph, lc = window.app.canvas.linkConnector
    const f = (id) => g.getNodeById(Number(id)).inputs[ids.idx].link ?? null
    const floats = [...(g.floatingLinks?.values?.() ?? [])].map((x) => ({ o: String(x.origin_id), t: String(x.target_id), p: x.parentId }))
    return {
      isConnecting: lc.isConnecting, to: lc.state?.connectingTo ?? null,
      c: f(ids.C), d2: f(ids.D2), d: f(ids.D),
      parked: floats.filter((x) => x.o === '-1' && (x.p === laneC.in || x.p === laneC.out)).map((x) => x.t).sort(),
      teeth: !!(g.reroutes.get(laneC.in) && g.reroutes.get(laneC.out)),
      // core's floating marker on the terminus reroute -- the thing that
      // makes a parked wire actually render
      marker: g.reroutes.get(laneC.out)?.floating?.slotType ?? null,
    }
  }, { ids, laneC })
  await page.mouse.move(...await dotPos(ids.H, 0, true), { steps: 10 }); await page.waitForTimeout(400)
  await page.mouse.up(); await page.waitForTimeout(1000)
  await page.keyboard.up('Alt'); await page.keyboard.up('Control')
  const after = {
    c: await feed(ids.C, ids.idx), d2: await feed(ids.D2, ids.idx), d: await feed(ids.D, ids.idx),
    lanes: await page.evaluate(() => window.app.graph.extra.cablemanagement_combs[0]?.lanes?.length ?? 0),
    stamps: await stamps(laneC.in, laneC.out),
    floats: await page.evaluate(() => (window.app.graph.floatingLinks?.size ?? 0)),
  }
  ok('s6 mid: source cut at press -- riders parked as consumer floats, teeth alive, drag seeks a source',
    mid.c == null && mid.d2 == null && mid.parked.length === 2 && mid.teeth &&
    mid.isConnecting && mid.to === 'output' && mid.d != null,
    JSON.stringify({ mid, preStamps }))
  ok('s6 mid: the parked wires carry core\'s floating marker (they RENDER)',
    mid.marker === 'input', JSON.stringify({ marker: mid.marker }))
  ok('s6 release on H: riders re-fed from H through the lane, floats retired',
    after.c.origin === ids.H && after.d2.origin === ids.H &&
    after.c.parent != null && after.d2.parent != null && after.floats === 0 && after.lanes === 2,
    JSON.stringify(after))
  ok('s6: sibling lane untouched, old stamps gone (source-side cut ends the illusion)',
    after.d.origin === ids.A &&
    after.stamps.rf.in == null && after.stamps.rf.out == null,
    JSON.stringify({ d: after.d, stamps: after.stamps }))
  await cleanup()
}

// ---- s7: ctrl+alt on the PIN with ribbon-riding wires: A.passthrough parity ----
// Barney's contract: cutting at the pin leaves "A, ribbon(floating)->B" --
// the ribbon parks toward its consumers, NOT dangling from the true origin.
{
  const ids = await buildScene()
  neutral = await gp(950, 700)
  const { laneC, laneD } = await wireAndComb(ids)
  await page.keyboard.down('Control'); await page.keyboard.down('Alt')
  await page.mouse.move(...await pinPos(ids.B, ids.idx)); await page.mouse.down()
  await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(800)
  await page.keyboard.up('Alt'); await page.keyboard.up('Control')
  const s7 = await page.evaluate(({ ids, laneC, laneD }) => {
    const g = window.app.graph
    const f = (id) => g.getNodeById(Number(id)).inputs[ids.idx].link ?? null
    const floats = [...(g.floatingLinks?.values?.() ?? [])].map((x) => ({ o: String(x.origin_id), t: String(x.target_id), p: x.parentId }))
    const parkedOn = (lane) => floats.filter((x) => x.o === '-1' && (x.p === lane.in || x.p === lane.out)).map((x) => x.t).sort()
    return {
      c: f(ids.C), d: f(ids.D), d2: f(ids.D2), b: f(ids.B), e: f(ids.E),
      laneCparked: parkedOn(laneC), laneDparked: parkedOn(laneD),
      markerC: g.reroutes.get(laneC.out)?.floating?.slotType ?? null,
      markerD: g.reroutes.get(laneD.out)?.floating?.slotType ?? null,
      originFloats: floats.filter((x) => x.t === '-1').length,
      lanes: g.extra.cablemanagement_combs[0]?.lanes?.length ?? 0,
    }
  }, { ids, laneC, laneD })
  ok('s7 pin ctrl+alt: all pin wires cut; each lane parks toward its consumers',
    s7.c == null && s7.d == null && s7.d2 == null &&
    s7.laneCparked.length === 2 && s7.laneDparked.length === 1 && s7.lanes === 2,
    JSON.stringify(s7))
  ok('s7 pin ctrl+alt: floats carry the render marker; NO float dangles from the true origin',
    s7.markerC === 'input' && s7.markerD === 'input' && s7.originFloats === 0,
    JSON.stringify({ markerC: s7.markerC, markerD: s7.markerD, originFloats: s7.originFloats }))
  ok('s7 pin ctrl+alt: host feed and hand wire untouched', s7.b != null && s7.e != null,
    JSON.stringify({ b: s7.b, e: s7.e }))
  await cleanup()
}

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
