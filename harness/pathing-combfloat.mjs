// Comb floating lanes -- the limbo states (PATHING.md section 9):
// (1) output-drag dropped on a gate body parks as a dangling lane (floating link,
//     no search box); (2) pulling that lane's out-pin resumes it onto a real input
//     (float retires, real link rides the teeth); (3) pulling the SAME out-pin
//     again branches a second link through the same teeth (manifold); (4) an
//     input-drag dropped on a gate floats at the IN side; (5) dropping an
//     output-drag onto that lane's in-PIN completes it natively; (6) pulling the
//     in-PIN of a source-dangling lane does NOT detach the lane -- it resumes the
//     float as an output-seeking drag (polish round: "should not rip out the
//     thread of the ribbon").
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
const settle = () => page.evaluate(async () => {
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 200)) }
})
const screenOfGraph = (gx, gy) => page.evaluate(([gx, gy]) => {
  const { ds } = window.app.canvas
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
}, [gx, gy])
const screenOfSlot = (key) => page.evaluate((key) => {
  const d = document.querySelector(`[data-slot-key="${key}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, key)
const dragScreen = async (from, to) => {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  await settle()
}

// Scene: two combed links + loader3/save3/save4 for the floating flows.
const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('CheckpointLoaderSimple', 60, 60)
  const t1 = mk('CheckpointSave', 1500, 80)
  const s2 = mk('CheckpointLoaderSimple', 60, 300)
  const t2 = mk('CheckpointSave', 1500, 320)
  const s3 = mk('CheckpointLoaderSimple', 60, 620)
  const t3 = mk('CheckpointSave', 1500, 560)
  // NOT bottom-right: stock 1.48.6 draws the MINIMAP over the bottom-right corner
  // (~340x220px, z-1000) and slots under it are unreachable by mouse -- a drag from
  // t4 at [1500, 800] silently never started.
  const t4 = mk('CheckpointSave', 1080, 800)
  s1.connect(0, t1, 0); s2.connect(0, t2, 0)
  const [l1, l2] = [...g._links.values()].map((l) => l.id)
  const combId = window.__cablemanagementCombs.create(l1, l2, 700, 300)
  window.__cablemanagementCombs.move(combId, 'out', 1100, 300)
  return { s3: s3.id, t3: t3.id, t4: t4.id, combId }
})
await settle()

// Aim at the pin-OPPOSITE side of the body: drops within reroute radius of the pin
// column snap to a tooth first (correct native behavior: connect through the lane).
const gatePoint = (which) => page.evaluate((which) => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const h = 24 + (c.lanes.length - 1) * 20
  const x = c[which].pins === 'left' ? c[which].pos[0] + 18 : c[which].pos[0] + 6
  return [x, c[which].pos[1] + h / 2]
}, which)

// (1) output-drag onto the in-gate -> dangling lane
const outPin = await screenOfSlot(`${ids.s3}-out-0`)
const gIn = await gatePoint('in')
await dragScreen(outPin, await screenOfGraph(gIn[0], gIn[1]))
const c1 = await page.evaluate(() => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  const routes = window.__cablemanagementPathing.routes().filter((r) => r.key.includes('|X'))
  return {
    lanes: rec.lanes.length,
    floating: g.floatingLinks.size,
    crossings: routes.length,
    connecting: window.app.canvas.linkConnector.renderLinks.length
  }
})
ok('gate drop parks a dangling lane', c1.lanes === 3 && c1.floating === 1, JSON.stringify(c1))
ok('dangling lane rides the ribbon', c1.crossings === 3, `crossings=${c1.crossings}`)
ok('connector reset, no leftover drag', c1.connecting === 0)

// (2) resume: pull the dangling lane's out-pin onto save3's model input
const outTooth = await page.evaluate(() => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  return g.reroutes.get(rec.lanes[2].out).pos.slice()
})
const inPin3 = await screenOfSlot(`${ids.t3}-in-0`)
await dragScreen(await screenOfGraph(outTooth[0], outTooth[1]), inPin3)
const c2 = await page.evaluate((ids) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  const link = [...g._links.values()].find((l) => l.origin_id === ids.s3 && l.target_id === ids.t3)
  const chain = []
  let rid = link?.parentId
  while (rid != null) { chain.push(rid); rid = g.getReroute(rid)?.parentId }
  chain.reverse()
  return {
    floating: g.floatingLinks.size,
    linked: !!link,
    chainMatches: JSON.stringify(chain) === JSON.stringify([rec.lanes[2].in, rec.lanes[2].out])
  }
}, ids)
ok('out-pin pull resumes the float', c2.linked && c2.floating === 0, JSON.stringify(c2))
ok('real link rides the lane teeth', c2.chainMatches)

// (3) branch: same out-pin again onto save4's model input (manifold)
const inPin4 = await screenOfSlot(`${ids.t4}-in-0`)
await dragScreen(await screenOfGraph(outTooth[0], outTooth[1]), inPin4)
const c3 = await page.evaluate((ids) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  const tooth = g.reroutes.get(rec.lanes[2].out)
  const branch = [...g._links.values()].find((l) => l.origin_id === ids.s3 && l.target_id === ids.t4)
  return {
    lanes: rec.lanes.length,
    branch: !!branch,
    shared: branch ? tooth.linkIds.has(branch.id) : false,
    toothLinks: tooth.linkIds.size
  }
}, ids)
ok('out-pin pull branches through the lane', c3.branch && c3.shared, JSON.stringify(c3))
ok('manifold: one tooth, two links, no new lane', c3.lanes === 3 && c3.toothLinks === 2)

// (4) input-drag onto the out-gate -> lane dangling at the IN side
const vaeIn4 = await screenOfSlot(`${ids.t4}-in-2`)
const gOut = await gatePoint('out')
await dragScreen(vaeIn4, await screenOfGraph(gOut[0], gOut[1]))
const c4 = await page.evaluate(() => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  return { lanes: rec.lanes.length, floating: g.floatingLinks.size }
})
ok('input-drag parks dangling at in side', c4.lanes === 4 && c4.floating === 1, JSON.stringify(c4))

// (5) complete it: loader3 VAE output dropped on that lane's in-PIN
const inTooth = await page.evaluate(() => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  return g.reroutes.get(rec.lanes[3].in).pos.slice()
})
const vaeOut = await screenOfSlot(`${ids.s3}-out-2`)
await dragScreen(vaeOut, await screenOfGraph(inTooth[0], inTooth[1]))
const c5 = await page.evaluate((ids) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  const link = [...g._links.values()].find((l) => l.origin_id === ids.s3 && l.origin_slot === 2)
  const chain = []
  let rid = link?.parentId
  while (rid != null) { chain.push(rid); rid = g.getReroute(rid)?.parentId }
  chain.reverse()
  return {
    floating: g.floatingLinks.size,
    linked: !!link && link.target_id === ids.t4,
    chainMatches: JSON.stringify(chain) === JSON.stringify([rec.lanes[3].in, rec.lanes[3].out])
  }
}, ids)
ok('drop on in-pin completes the lane', c5.linked && c5.floating === 0, JSON.stringify(c5))
ok('completed link rides the lane teeth', c5.chainMatches)

// (6) in-pin pull on a source-dangling lane resumes, never detaches: park t3's
// clip input on the out-gate, then pull the dangling in-PIN onto s3's clip output.
const clipIn3 = await screenOfSlot(`${ids.t3}-in-1`)
await dragScreen(clipIn3, await screenOfGraph(...await gatePoint('out')))
const c6a = await page.evaluate(() => {
  const g = window.app.graph
  return { lanes: g.extra.cablemanagement_combs[0].lanes.length, floating: g.floatingLinks.size }
})
ok('input-drag parks a second dangling lane', c6a.lanes === 5 && c6a.floating === 1, JSON.stringify(c6a))
const inTip = await page.evaluate(() => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  return g.reroutes.get(rec.lanes[4].in).pos.slice()
})
const clipOut = await screenOfSlot(`${ids.s3}-out-1`)
await dragScreen(await screenOfGraph(inTip[0], inTip[1]), clipOut)
const c6 = await page.evaluate((ids) => {
  const g = window.app.graph
  const rec = g.extra.cablemanagement_combs[0]
  const link = [...g._links.values()].find((l) => l.origin_id === ids.s3 && l.origin_slot === 1)
  const chain = []
  let rid = link?.parentId
  while (rid != null) { chain.push(rid); rid = g.getReroute(rid)?.parentId }
  chain.reverse()
  return {
    lanes: rec.lanes.length,
    floating: g.floatingLinks.size,
    linked: !!link && link.target_id === ids.t3 && link.target_slot === 1,
    chainMatches: JSON.stringify(chain) === JSON.stringify([rec.lanes[4].in, rec.lanes[4].out])
  }
}, ids)
ok('in-pin pull resumes the float onto an output', c6.linked && c6.floating === 0, JSON.stringify(c6))
ok('lane survives the pull (no detach)', c6.lanes === 5 && c6.chainMatches)

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
