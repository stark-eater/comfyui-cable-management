// Modifier gestures, round 2 -- Barney's live QA failed 2/3/4/6 while pinmods
// passed: his wires rode the RIBBON (kept from QA step 1) and his canvas runs
// PCB mode, and the bundle preview collapsed onto the pin (anchorPreview bug,
// now removed). This suite replicates his exact conditions and asserts the
// preview's underlying state, not just the graph:
//   scene 1 (PCB + comb):  shift+drag -- previews anchor at the lanes' teeth,
//                          never at the pin; release on H re-sources through
//                          the lanes; comb survives
//   scene 2 (PCB + comb):  ctrl+alt -- wires cut, lanes park as floats
//   scene 3 (splines, widget): shift+drag two seed wires -- previews at the
//                          consumers, host row intact; empty release cuts both
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

const buildScene = (pcb) => page.evaluate(async ({ pcb }) => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
  if (pcb) { const L = window.LiteGraph, taken = [L.STRAIGHT_LINK, L.LINEAR_LINK, L.SPLINE_LINK, L.HIDDEN_LINK]; let v = 64; while (taken.includes(v)) v++; window.app.canvas.links_render_mode = v } else { window.app.canvas.links_render_mode = 2 } // PCB sentinel / spline; canvas prop only
  const A = L.createNode('EmptyLatentImage'); A.pos = [150, 120]; A.title = 'A'; g.add(A)
  const H = L.createNode('EmptyLatentImage'); H.pos = [150, 760]; H.title = 'H'; g.add(H)
  const mk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const B = mk('B', 560, 100), C = mk('C', 1450, 80), D = mk('D', 1450, 500), E = mk('E', 1450, 920)
  const idx = B.inputs.findIndex((s) => s.name === 'latent_image')
  const sIdx = B.inputs.findIndex((s) => s.name === 'seed')
  A.connect(0, B, idx)
  A.connect(0, E, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  const o = { idx, sIdx }
  for (const n of [A, H, B, C, D, E]) o[n.title] = String(n.id)
  return o
}, { pcb })

const comb = (ids) => page.evaluate(async ({ ids }) => {
  const g = window.app.graph
  const l1 = g.getNodeById(Number(ids.C)).inputs[ids.idx].link
  const l2 = g.getNodeById(Number(ids.D)).inputs[ids.idx].link
  const id = window.__cablemanagementCombs.create(l1, l2, 1000, 300)
  await new Promise((x) => setTimeout(x, 900))
  const rec = g.extra.cablemanagement_combs.find((c) => c.id === id)
  return { lanes: rec.lanes.map((l) => ({ ...l })) }
}, { ids })

// The bundle's visual truth, mid-drag: where each preview line is anchored,
// and which committed links are hidden.
const midDump = (ids) => page.evaluate(({ ids }) => {
  const g = window.app.graph, lc = window.app.canvas.linkConnector
  const pinEl = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${ids.B}"][data-cablemanagement-index="${ids.idx}"]`)
  const host = g.getNodeById(Number(ids.B))
  const pr = pinEl?.getBoundingClientRect()
  const L = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30
  const pinAnchor = pinEl ? [
    host.pos[0] + pinEl.offsetLeft + pinEl.offsetWidth * 0.5,
    host.pos[1] - L + pinEl.offsetTop + pinEl.offsetHeight * 0.5,
  ] : null
  const froms = (lc.renderLinks ?? []).map((rl) => [Math.round(rl.fromPos?.[0] ?? -1), Math.round(rl.fromPos?.[1] ?? -1)])
  const nearPin = pinAnchor
    ? froms.filter((f) => Math.hypot(f[0] - pinAnchor[0], f[1] - pinAnchor[1]) < 6).length
    : -1
  const hid = (id) => { const l = g.getLink(g.getNodeById(Number(id)).inputs[ids.idx].link); return !!l?._dragging }
  return {
    isConnecting: lc.isConnecting, to: lc.state?.connectingTo ?? null,
    renderLinks: lc.renderLinks?.length ?? 0, froms, nearPin,
    hostHidden: hid(ids.B), handHidden: hid(ids.E),
  }
}, { ids })

// ---- scene 1: PCB + comb, shift+drag the bundle onto H ----
{
  const ids = await buildScene(true)
  neutral = await gp(950, 700)
  await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.C, ids.idx))
  await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.D, ids.idx))
  const cb = await comb(ids)
  ok('s1 setup: comb over the two pin wires', cb.lanes.length === 2, JSON.stringify(cb))
  const teeth = await page.evaluate(({ cb }) => {
    const g = window.app.graph
    return cb.lanes.map((l) => ({ in: [...g.reroutes.get(l.in).pos], out: [...g.reroutes.get(l.out).pos] }))
  }, { cb })

  await page.keyboard.down('Shift')
  await page.mouse.move(...await pinPos(ids.B, ids.idx)); await page.mouse.down()
  await page.mouse.move(...await gp(900, 950), { steps: 10 }); await page.waitForTimeout(600)
  const mid = await midDump(ids)
  await page.mouse.move(...await dotPos(ids.H, 0, true), { steps: 8 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
  await page.keyboard.up('Shift')
  ok('s1 mid: two moving previews, none anchored at the pin',
    mid.renderLinks === 2 && mid.nearPin === 0, JSON.stringify(mid))
  const anchoredAtTeeth = mid.froms.every((f) =>
    teeth.some((t) => Math.hypot(f[0] - t.in[0], f[1] - t.in[1]) < 6))
  ok('s1 mid: previews anchor at the lanes\' in-teeth (core\'s fixed end)', anchoredAtTeeth,
    JSON.stringify({ froms: mid.froms, teeth }))
  ok('s1 mid: host feed and hand wire stay visible', !mid.hostHidden && !mid.handHidden, JSON.stringify(mid))
  const after = {
    c: await feed(ids.C, ids.idx), d: await feed(ids.D, ids.idx),
    b: await feed(ids.B, ids.idx), e: await feed(ids.E, ids.idx),
    lanes: await page.evaluate(() => window.app.graph.extra.cablemanagement_combs[0]?.lanes?.length ?? 0),
  }
  ok('s1 drop on H: both wires re-sourced to H', after.c.origin === ids.H && after.d.origin === ids.H,
    JSON.stringify({ c: after.c, d: after.d }))
  ok('s1 drop on H: still threaded through their lanes, comb intact',
    after.c.parent != null && after.d.parent != null && after.lanes === 2, JSON.stringify(after))
  ok('s1 drop on H: host feed, hand wire, records all settled',
    after.b.origin === ids.A && after.e.origin === ids.A && after.c.rec == null && after.d.rec == null,
    JSON.stringify({ b: after.b, e: after.e }))
  await cleanup()
}

// ---- scene 2: PCB + comb, ctrl+alt cuts the wires; lanes park as floats ----
{
  const ids = await buildScene(true)
  neutral = await gp(950, 700)
  await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.C, ids.idx))
  await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.D, ids.idx))
  const cb = await comb(ids)
  await page.keyboard.down('Control'); await page.keyboard.down('Alt')
  await page.mouse.move(...await pinPos(ids.B, ids.idx)); await page.mouse.down()
  await page.waitForTimeout(300)
  const mid = await page.evaluate(() => {
    const lc = window.app.canvas.linkConnector
    return { isConnecting: lc.isConnecting, renderLinks: lc.renderLinks?.length ?? 0 }
  })
  await page.mouse.up(); await page.waitForTimeout(800)
  await page.keyboard.up('Alt'); await page.keyboard.up('Control')
  const after = await page.evaluate(({ ids, cb }) => {
    const g = window.app.graph
    const f = (id) => { const l = g.getNodeById(Number(id)).inputs[ids.idx].link; return l ?? null }
    const floats = [...(g.floatingLinks?.values?.() ?? [])].map((x) => ({ o: String(x.origin_id), t: String(x.target_id), p: x.parentId }))
    const laneFloats = floats.filter((x) => cb.lanes.some((l) => x.p === l.in || x.p === l.out)).length
    return {
      c: f(ids.C), d: f(ids.D), b: f(ids.B), e: f(ids.E), floats, laneFloats,
      lanes: g.extra.cablemanagement_combs[0]?.lanes?.length ?? 0,
    }
  }, { ids, cb })
  ok('s2 ctrl+alt: no drag, wires cut', !mid.isConnecting && after.c == null && after.d == null,
    JSON.stringify({ mid, c: after.c, d: after.d }))
  ok('s2 ctrl+alt: host feed and hand wire untouched', after.b != null && after.e != null,
    JSON.stringify({ b: after.b, e: after.e }))
  ok('s2 ctrl+alt: lanes park as floats, comb intact', after.laneFloats === 2 && after.lanes === 2,
    JSON.stringify({ laneFloats: after.laneFloats, lanes: after.lanes, floats: after.floats }))
  await cleanup()
}

// ---- scene 3: splines, WIDGET pin with two consumers ----
{
  const ids = await buildScene(false)
  neutral = await gp(950, 700)
  await drag(await pinPos(ids.B, ids.sIdx), await dotPos(ids.C, ids.sIdx))
  await drag(await pinPos(ids.B, ids.sIdx), await dotPos(ids.D, ids.sIdx))
  const w0 = { c: await feed(ids.C, ids.sIdx), d: await feed(ids.D, ids.sIdx) }
  ok('s3 setup: widget pin wires C and D', w0.c.lid != null && w0.d.lid != null, JSON.stringify(w0))
  const consumers = [await dotPos(ids.C, ids.sIdx, false), await dotPos(ids.D, ids.sIdx, false)]

  await page.keyboard.down('Shift')
  await page.mouse.move(...await pinPos(ids.B, ids.sIdx)); await page.mouse.down()
  await page.mouse.move(...await gp(900, 950), { steps: 10 }); await page.waitForTimeout(600)
  const mid = await page.evaluate(({ ids }) => {
    const g = window.app.graph, lc = window.app.canvas.linkConnector
    const froms = (lc.renderLinks ?? []).map((rl) => [Math.round(rl.fromPos?.[0] ?? -1), Math.round(rl.fromPos?.[1] ?? -1)])
    return { renderLinks: lc.renderLinks?.length ?? 0, to: lc.state?.connectingTo ?? null, froms }
  }, { ids })
  // widget rows and slot dots report slightly different anchor points; what
  // matters is: each preview is fixed INSIDE its consumer's box and nowhere
  // near the pin
  const midFromsOk = await page.evaluate(({ mid, ids }) => {
    const g = window.app.graph
    const inBox = (f, id) => {
      const n = g.getNodeById(Number(id))
      return f[0] >= n.pos[0] - 20 && f[0] <= n.pos[0] + n.size[0] + 20 &&
             f[1] >= n.pos[1] - 40 && f[1] <= n.pos[1] + n.size[1] + 40
    }
    const host = g.getNodeById(Number(ids.B))
    const farFromHost = (f) => Math.hypot(f[0] - (host.pos[0] + host.size[0]), f[1] - host.pos[1]) > 100
    return mid.froms.every((f) => (inBox(f, ids.C) || inBox(f, ids.D)) && farFromHost(f))
  }, { mid, ids })
  await page.mouse.move(...await gp(900, 1050), { steps: 6 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
  await page.keyboard.up('Shift')
  await cleanup() // dismiss the release action; core disconnects the moved bundle
  ok('s3 mid: two previews anchored at the CONSUMERS, not the pin',
    mid.renderLinks === 2 && midFromsOk, JSON.stringify(mid))
  const after = { c: await feed(ids.C, ids.sIdx), d: await feed(ids.D, ids.sIdx), host: await feed(ids.B, ids.idx) }
  ok('s3 empty release: widget bundle cut, records gone',
    after.c.lid == null && after.d.lid == null && after.c.rec == null && after.d.rec == null, JSON.stringify(after))
  ok('s3 empty release: host untouched', after.host.origin === ids.A, JSON.stringify(after.host))
}

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
