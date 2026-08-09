// LEGACY-MODE parity lane (ruling 2026-08-09: 'routing and ribbons must work
// without gap between legacy and nodes 2.0; node functionality is Nodes 2.0
// only'). Vue nodes are forced OFF for this page only by intercepting the
// settings response client-side -- the server-stored settings are never
// written (standing constraint).
//   s1 env: Vue nodes off, no .lg-node DOM, canvas-drawn nodes
//   s2 ribbons: comb create + tooth layout on the legacy canvas
//   s3 ribbon.input drop: source drag re-sources the lane (v1 claims follow)
//   s4 ribbon.output drop: consumer drag branches from the lane
//   s5 polarity no-op on the legacy pipeline
//   s6 claims survive serialize in legacy mode
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

// Client-side only: rewrite the settings payload the frontend boots from.
await page.route('**/settings', async (route) => {
  const resp = await route.fetch()
  let body
  try { body = await resp.json() } catch { return route.fulfill({ response: resp }) }
  body['Comfy.VueNodes.Enabled'] = false
  return route.fulfill({ response: resp, json: body })
})

await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(2600)

// ---- s1: environment ----
{
  const r = await page.evaluate(() => ({
    vue: window.app.extensionManager ? undefined : undefined,
    lgNodes: document.querySelectorAll('.lg-node').length,
  }))
  ok('s1: legacy canvas (no Vue node DOM)', r.lgNodes === 0, JSON.stringify(r))
}

// ---- scene: A->Y1, X2->Y2 combed; F free source; G free consumer ----
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
  { const taken = [L.STRAIGHT_LINK, L.LINEAR_LINK, L.SPLINE_LINK, L.HIDDEN_LINK]; let v = 64; while (taken.includes(v)) v++; window.app.canvas.links_render_mode = v } // PCB sentinel
  const src = (t, x, y) => { const n = L.createNode('EmptyLatentImage'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const snk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const X1 = src('X1', 150, 100), X2 = src('X2', 150, 460), F = src('F', 150, 820)
  const Y1 = snk('Y1', 1450, 80), Y2 = snk('Y2', 1450, 470), G = snk('G', 1450, 880)
  const idx = Y1.inputs.findIndex((s) => s.name === 'latent_image')
  X1.connect(0, Y1, idx); X2.connect(0, Y2, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1200))
  const combId = window.__cablemanagementCombs.create(Y1.inputs[idx].link, Y2.inputs[idx].link, 1000, 280)
  await new Promise((r) => setTimeout(r, 900))
  const rec = g.extra.cablemanagement_combs.find((c) => c.id === combId)
  const l2 = Y2.inputs[idx].link
  const i2 = rec.lanes.findIndex((l) => g.reroutes.get(l.out)?.linkIds?.has?.(Number(l2)))
  const o = { idx, lanes: rec.lanes.length, laneX2: { ...rec.lanes[i2] }, teethAlive: rec.lanes.every((l) => g.reroutes.get(l.in) && g.reroutes.get(l.out)) }
  for (const n of [X1, X2, F, Y1, Y2, G]) o[n.title] = String(n.id)
  return o
})
ok('s2: comb built on the legacy canvas, teeth alive', ids.lanes === 2 && ids.teethAlive, JSON.stringify({ lanes: ids.lanes, teethAlive: ids.teethAlive }))

const gp = (x, y) => page.evaluate(({ x, y }) => {
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return [view.left + (x + ds.offset[0]) * ds.scale, view.top + (y + ds.offset[1]) * ds.scale]
}, { x, y })
const slotPt = (id, idx, out) => page.evaluate(({ id, idx, out }) => {
  const n = window.app.graph.getNodeById(Number(id))
  const p = n.getConnectionPos(!out, idx)
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return [view.left + (p[0] + ds.offset[0]) * ds.scale, view.top + (p[1] + ds.offset[1]) * ds.scale]
}, { id, idx, out })
const rrPt = (rid) => page.evaluate(({ rid }) => {
  const r = window.app.graph.reroutes.get(rid)
  if (!r) return null
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return [view.left + (r.pos[0] + ds.offset[0]) * ds.scale, view.top + (r.pos[1] + ds.offset[1]) * ds.scale]
}, { rid })
const drag = async (from, to) => {
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(900)
}
const feed = (id, idx) => page.evaluate(({ id, idx }) => {
  const g = window.app.graph
  const n = g.getNodeById(Number(id))
  const lid = n.inputs?.[idx]?.link
  const link = lid != null ? g.getLink(lid) : null
  return { lid: lid ?? null, origin: link ? String(link.origin_id) : null, parent: link?.parentId ?? null }
}, { id, idx })

// ---- s3: source drag from F.output onto ribbon.input (lane X2) ----
await drag(await slotPt(ids.F, 0, true), await rrPt(ids.laneX2.in))
{
  const y2 = await feed(ids.Y2, ids.idx)
  const claims = await page.evaluate(() => {
    const bag = window.__cablemanagement.routes(window.app.graph)
    return bag ? Object.keys(bag.claims.reroutes).length + Object.keys(bag.claims.floats).length : 0
  })
  ok('s3: legacy in-pin drop re-sources the lane to F', y2.origin === ids.F && y2.parent === ids.laneX2.out, JSON.stringify(y2))
  ok('s3: no stale claims left on the swapped lane', claims === 0, String(claims))
}

// ---- s4: consumer drag from G.input onto ribbon.output (lane X2) ----
await drag(await slotPt(ids.G, ids.idx, false), await rrPt(ids.laneX2.out))
{
  const gf = await feed(ids.G, ids.idx)
  ok('s4: legacy out-pin drop branches G from the lane', gf.origin === ids.F && gf.parent === ids.laneX2.out, JSON.stringify(gf))
}

// ---- s5: polarity no-op -- consumer drag onto ribbon.input ----
{
  const before = await page.evaluate(() => window.app.graph.state?.lastLinkId ?? null)
  await page.evaluate(({ ids }) => { const g = window.app.graph; g.getNodeById(Number(ids.G)).disconnectInput(ids.idx) }, { ids })
  await page.waitForTimeout(400)
  await drag(await slotPt(ids.G, ids.idx, false), await rrPt(ids.laneX2.in))
  const gf = await feed(ids.G, ids.idx)
  const after = await page.evaluate(() => ({
    last: window.app.graph.state?.lastLinkId ?? null,
    menu: document.querySelectorAll('.litecontextmenu').length,
    lanes: window.app.graph.extra.cablemanagement_combs?.[0]?.lanes?.length ?? 0,
  }))
  ok('s5: legacy polarity no-op (input-to-input), comb intact, no menu',
    gf.lid === null && after.lanes === 2 && after.menu === 0, JSON.stringify({ gf, after, before }))
}

// ---- s6: claims survive serialize in legacy mode ----
{
  const r = await page.evaluate(() => {
    const g = window.app.graph
    const bag = window.__cablemanagement.routes(g)
    const saved = g.serialize()
    return {
      liveV1: !!bag,
      savedV1: !!saved.extra?.cablemanagement_routes,
      savedLegacy: ['cablemanagement_routefrom', 'cablemanagement_floatfrom', 'cablemanagement_gatefrom'].filter((k) => saved.extra?.[k]),
    }
  })
  ok('s6: v1 store serializes in legacy mode, no legacy keys', (!r.liveV1 || r.savedV1 === r.liveV1) && r.savedLegacy.length === 0, JSON.stringify(r))
}

console.log('page errors:', errs.length ? errs.slice(0, 8) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
