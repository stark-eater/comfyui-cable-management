// #4 ribbon polish: (s1) peel-abort -- dragging an in-tooth and dropping it back
// on its own in-gate no-ops (lane stays enrolled, tooth snaps home); (s2)
// same-source reroute enrolled on a gate JOINS the existing lane (fork at the
// ribbon output pin, no twin lane, dot gone); (s3) an existing link picked up
// by its input end and dropped on the gate body joins the matching lane too.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2560, height: 1300 } })
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
const screen = (gx, gy) => page.evaluate(([gx, gy]) => {
  const { ds } = window.app.canvas
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
}, [gx, gy])
const drag = async (fx, fy, tx, ty) => {
  const [sx, sy] = await screen(fx, fy)
  const [ex, ey] = await screen(tx, ty)
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(ex, ey, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  await settle()
}
// centre of the "+" lane-creation square below a gate (GATE_W 24, PAD 12,
// PIN_PITCH 20, 4px gap -- mirrors plusRect)
const plusPt = (which = 'in') => page.evaluate((which) => {
  const comb = window.app.graph.extra.cablemanagement_combs[0]
  const [x, y] = comb[which].pos
  const h = 24 + Math.max(2, comb.lanes.length - 1) * 20
  return [x + 12, y + h + 4 + 12]
}, which)
const combState = () => page.evaluate(() => {
  const g = window.app.graph
  const combs = (g.extra?.cablemanagement_combs ?? []).map((c) => ({
    id: c.id, lanes: c.lanes.length,
    inPos: c.in.pos, outPos: c.out.pos, lanesRaw: c.lanes.map((l) => [l.in, l.out])
  }))
  return { combs, reroutes: [...(g.reroutes?.keys?.() ?? [])], links: g._links.size }
})

// Scene: two sources feed two sinks through free reroutes -> comb; a third
// consumer C fed from source1 via its own reroute (s2's join candidate); a
// fourth consumer D fed from source1 by a plain link (s3's carried join).
const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  const ds = app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const src = (t, x, y) => { const n = L.createNode('EmptyLatentImage'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const snk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const s1 = src('S1', 60, 100)
  const s2 = src('S2', 60, 420)
  const s3 = src('S3', 60, 740)
  const s4 = src('S4', 60, 1060)
  const gCon = snk('G', 1950, 900) // stays unconnected: polarity-no-op probe
  const t1 = snk('T1', 1450, 60)
  const t2 = snk('T2', 1450, 380)
  const t3 = snk('T3', 1950, 380)
  const c = snk('C', 1450, 700)
  const d = snk('D', 1450, 1000)
  const idx = t1.inputs.findIndex((s) => s.name === 'latent_image')
  s1.connect(0, t1, idx)
  s2.connect(0, t2, idx)
  s3.connect(0, t3, idx)
  s1.connect(0, c, idx)
  s1.connect(0, d, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1500))
  const byTarget = (n) => [...g._links.values()].find((l) => String(l.target_id) === String(n.id))
  g.createReroute([700, 150], byTarget(t1))
  g.createReroute([700, 450], byTarget(t2))
  g.createReroute([700, 860], byTarget(t3))
  g.createReroute([700, 700], byTarget(c))
  return {
    s1: s1.id, c: c.id, d: d.id, s4: s4.id, g: gCon.id, idx,
    dLink: byTarget(d).id,
    rr: [...g.reroutes.keys()]
  }
})
await settle()

// Build the comb: reroute2 dropped on reroute1, then t3's reroute enrolled --
// three lanes so the control peel doesn't auto-decompose the comb.
await drag(700, 450, 700, 150)
let st = await combState()
ok('comb born with 2 lanes', st.combs.length === 1 && st.combs[0].lanes === 2, JSON.stringify(st.combs))
await drag(700, 860, ...(await plusPt('in')))
st = await combState()
ok('third lane enrolled via +', st.combs[0]?.lanes === 3, JSON.stringify(st.combs))
const cRid = ids.rr[3] // C's reroute: the s2 join candidate, still free

// ---- s1: peel-abort ------------------------------------------------------------
// Pull lane 0's in-tooth a healthy distance but release ON the in-gate body.
const before = await combState()
const tooth = await page.evaluate(() => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  const r = g.reroutes.get(comb.lanes[0].in)
  return { pos: [r.pos[0], r.pos[1]], gate: comb.in.pos }
})
// drop point: inside the in-gate body (gate pos is its top-left-ish anchor)
await drag(tooth.pos[0], tooth.pos[1], tooth.gate[0] + 10, tooth.gate[1] + 30)
st = await combState()
ok('peel-abort keeps the lane', st.combs.length === 1 && st.combs[0].lanes === 3,
  JSON.stringify(st.combs))
ok('peel-abort keeps tooth count', st.reroutes.length === before.reroutes.length,
  `${before.reroutes.length} -> ${st.reroutes.length}`)

// control: the same pull released on empty canvas DOES detach
const t0 = await page.evaluate(() => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  const r = g.reroutes.get(comb.lanes[0].in)
  return [r.pos[0], r.pos[1]]
})
await drag(t0[0], t0[1], t0[0] - 260, t0[1] + 180)
st = await combState()
ok('control: real peel detaches', st.combs.length === 1 && st.combs[0].lanes === 2,
  JSON.stringify(st.combs))
// restore: re-enroll the freed dot (NOT C's reroute) for the next scenes
const freed = await page.evaluate((cRid) => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  const teeth = new Set(comb.lanes.flatMap((l) => [l.in, l.out]))
  for (const [id, r] of g.reroutes) if (!teeth.has(id) && id !== cRid) return [r.pos[0], r.pos[1], id]
  return null
}, cRid)
ok('freed dot survives', !!freed, JSON.stringify(freed))
await drag(freed[0], freed[1], ...(await plusPt('in')))
st = await combState()
ok('re-enrolled to 3 lanes via +', st.combs[0]?.lanes === 3, JSON.stringify(st.combs))

// ---- s2: same-source reroute joins --------------------------------------------
// C's wire comes from s1 output 0 -- the same source lane 0 carries. Dropping
// C's reroute on the gate must NOT mint lane 3: C reconnects through the lane.
const s2r = await page.evaluate((cRid) => {
  const r = window.app.graph.reroutes.get(cRid)
  return r ? [r.pos[0], r.pos[1], r.id] : null
}, cRid)
ok('s2: free reroute present', !!s2r, JSON.stringify(s2r))
st = await combState()
await drag(s2r[0], s2r[1], st.combs[0].inPos[0] + 10, st.combs[0].inPos[1] + 30)
st = await combState()
const joined = await page.evaluate(({ c, s1, idx }) => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  // the lane whose source is s1 -- the join target, wherever it sits now
  const s1Lane = comb.lanes.find((l) => {
    const t = g.reroutes.get(l.in)
    return t?.firstLink && String(t.firstLink.origin_id) === String(s1)
  })
  const cNode = g.getNodeById(c) ?? g.getNodeById(Number(c))
  const lid = cNode?.inputs?.[idx]?.link
  const l = lid != null ? g._links.get(lid) : null
  return {
    origin: l ? String(l.origin_id) : null,
    parent: l?.parentId ?? null,
    s1Lane
  }
}, ids)
ok('s2: no twin lane', st.combs.length === 1 && st.combs[0].lanes === 3, JSON.stringify(st.combs))
ok('s2: C rides the lane (fork at out pin)', !!joined.s1Lane && joined.parent === joined.s1Lane.out,
  JSON.stringify(joined))
ok('s2: joined dot is gone', st.reroutes.length === 6, JSON.stringify(st.reroutes))

// ---- s3: carried existing link joins ------------------------------------------
// Pick up D's link at its input end (core moved-link drag) and drop it on the
// IN-gate BODY: joins lane 0, no floating lane.
const dIn = await page.evaluate(({ d, idx }) => {
  const n = window.app.graph.getNodeById(d) ?? window.app.graph.getNodeById(Number(d))
  const el = document.querySelector(`[data-slot-key="${n.id}-in-${idx}"]`)
  const r = el?.getBoundingClientRect()
  return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, ids)
ok('s3: D input dot found', !!dIn, JSON.stringify(dIn))
st = await combState()
// the "+" square: carried same-source links JOIN there (body now means
// connect-to-first-matching-pin, tested below)
const [gx, gy] = await screen(...(await plusPt('in')))
await page.mouse.move(...dIn)
await page.mouse.down()
await page.mouse.move(gx, gy, { steps: 14 })
await page.waitForTimeout(300)
await page.mouse.up()
await page.waitForTimeout(400)
await settle()
st = await combState()
const dJoin = await page.evaluate(({ d, s1, idx }) => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  const s1Lane = comb.lanes.find((l) => {
    const t = g.reroutes.get(l.in)
    return t?.firstLink && String(t.firstLink.origin_id) === String(s1)
  })
  const n = g.getNodeById(d) ?? g.getNodeById(Number(d))
  const lid = n?.inputs?.[idx]?.link
  const l = lid != null ? g._links.get(lid) : null
  return { parent: l?.parentId ?? null, s1Lane, floats: g.floatingLinks?.size ?? 0 }
}, ids)
ok('s3: no new lane, no float', st.combs[0]?.lanes === 3 && dJoin.floats === 0,
  JSON.stringify({ lanes: st.combs[0]?.lanes, floats: dJoin.floats }))
ok('s3: D rides the lane', !!dJoin.s1Lane && dJoin.parent === dJoin.s1Lane.out, JSON.stringify(dJoin))

// ---- s4: fresh source drag onto IN gate BODY = connect to first matching pin
// (the lane re-sources through its teeth -- core in-pin contract, not a lane)
const s4out = await page.evaluate(({ s4 }) => {
  const el = document.querySelector(`[data-slot-key="${s4}-out-0"]`)
  const r = el?.getBoundingClientRect()
  return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, ids)
ok('s4: S4 output dot found', !!s4out, JSON.stringify(s4out))
st = await combState()
const bodyPt = await screen(st.combs[0].inPos[0] + 18, st.combs[0].inPos[1] + 30)
await page.mouse.move(...s4out)
await page.mouse.down()
await page.mouse.move(bodyPt[0], bodyPt[1], { steps: 14 })
await page.waitForTimeout(300)
await page.mouse.up()
await page.waitForTimeout(400)
await settle()
st = await combState()
const s4res = await page.evaluate(({ s4 }) => {
  const g = window.app.graph
  const comb = g.extra.cablemanagement_combs[0]
  const t = g.reroutes.get(comb.lanes[0].in)
  return { lane0Origin: t?.firstLink ? String(t.firstLink.origin_id) : null, floats: g.floatingLinks?.size ?? 0 }
}, ids)
ok('s4: body drop re-sources first matching lane, no new lane',
  st.combs[0]?.lanes === 3 && s4res.lane0Origin === String(ids.s4) && s4res.floats === 0,
  JSON.stringify({ lanes: st.combs[0]?.lanes, ...s4res }))

// ---- s5: consumer drag onto IN gate BODY = polarity no-op
const gIn = await page.evaluate(({ g: gid, idx }) => {
  const el = document.querySelector(`[data-slot-key="${gid}-in-${idx}"]`)
  const r = el?.getBoundingClientRect()
  return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, ids)
ok('s5: G input dot found', !!gIn, JSON.stringify(gIn))
const beforeS5 = await combState()
await page.mouse.move(...gIn)
await page.mouse.down()
await page.mouse.move(bodyPt[0], bodyPt[1], { steps: 14 })
await page.waitForTimeout(300)
await page.mouse.up()
await page.waitForTimeout(400)
await settle()
st = await combState()
const s5res = await page.evaluate(({ g: gid, idx }) => {
  const n = window.app.graph.getNodeById(gid) ?? window.app.graph.getNodeById(Number(gid))
  return { gLink: n?.inputs?.[idx]?.link ?? null, menu: document.querySelectorAll('.litegraph.litecontextmenu, .comfy-menu-popup').length }
}, ids)
ok('s5: consumer drag on IN body no-ops',
  st.combs[0]?.lanes === 3 && st.links === beforeS5.links && s5res.gLink === null,
  JSON.stringify({ lanes: st.combs[0]?.lanes, links: st.links, was: beforeS5.links, ...s5res }))

ok('no page errors', errs.length === 0, errs.join(' | '))
await b.close()
if (!pass) process.exit(1)
console.log('PASS')
