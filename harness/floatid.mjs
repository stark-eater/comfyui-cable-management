// Float/link ID COLLISION (Barney's floating_input workflow, 2026-08-09).
// Core's floating links have their OWN id counter, so a parked float can share
// its id with a REAL link. The ledger's render hook keyed substitutions by
// bare id and core runs floats through the same path -- a float colliding
// with a pin-recorded link inherited that link's substitution and drew from a
// stranger's pin ('a link between a random node and the ribbon'). The fix is
// identity (graph.getLink(id) === link), plus f-prefixed capture keys.
//   s1: force the collision (float id === pin link id via _lastFloatingLinkId)
//       -> the float draws honestly from its true origin; the real pin link
//       keeps its pin substitution. Both under one id, told apart.
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

async function drag(from, to) {
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
}
const pinPos = (id, idx) => page.evaluate(({ id, idx }) => {
  const p = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${idx}"]`)
  const r = p?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })
const dotPos = (id, idx) => page.evaluate(({ id, idx }) => {
  const d = document.querySelector(`[data-slot-key="${id}-in-${idx}"]`)
  const r = d?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })
const rrPt = (rid) => page.evaluate(({ rid }) => {
  const r = window.app.graph.reroutes.get(rid)
  if (!r) return null
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return [view.left + (r.pos[0] + ds.offset[0]) * ds.scale, view.top + (r.pos[1] + ds.offset[1]) * ds.scale]
}, { rid })

// Scene: A->B (host feed), pin-drag B's pin to C (pin-recorded link -- the
// ledger entry the float must NOT inherit); ribbon X->Y / X2->Y2.
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
  { const taken = [L.STRAIGHT_LINK, L.LINEAR_LINK, L.SPLINE_LINK, L.HIDDEN_LINK]; let v = 64; while (taken.includes(v)) v++; window.app.canvas.links_render_mode = v } // PCB sentinel
  const src = (t, x, y) => { const n = L.createNode('EmptyLatentImage'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const snk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const A = src('A', 150, 100), X = src('X', 150, 700), X2 = src('X2', 150, 1020)
  const B = snk('B', 560, 80), C = snk('C', 1450, 80), Y = snk('Y', 1450, 700), Y2 = snk('Y2', 1450, 1020)
  const idx = B.inputs.findIndex((s) => s.name === 'latent_image')
  A.connect(0, B, idx)
  X.connect(0, Y, idx); X2.connect(0, Y2, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1500))
  const o = { idx }
  for (const n of [A, X, X2, B, C, Y, Y2]) o[n.title] = String(n.id)
  return o
})
await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.C, ids.idx)) // the pin link
const setup = await page.evaluate(async ({ ids }) => {
  const g = window.app.graph
  const pinLink = g.getNodeById(Number(ids.C)).inputs[ids.idx].link
  const rec = g.getNodeById(Number(ids.C)).properties?.['cablemanagement.from']?.[String(ids.idx)] ?? null
  const combId = window.__cablemanagementCombs.create(
    g.getNodeById(Number(ids.Y)).inputs[ids.idx].link,
    g.getNodeById(Number(ids.Y2)).inputs[ids.idx].link, 1000, 850)
  await new Promise((r) => setTimeout(r, 900))
  const cRec = g.extra.cablemanagement_combs.find((c) => c.id === combId)
  const lY = g.getNodeById(Number(ids.Y)).inputs[ids.idx].link
  const i = cRec.lanes.findIndex((l) => g.reroutes.get(l.out)?.linkIds?.has?.(Number(lY)))
  // Force the NEXT float to mint with the pin link's id.
  g._lastFloatingLinkId = pinLink - 1
  return { pinLink, rec, laneY: { ...cRec.lanes[i] } }
}, { ids })
ok('setup: pin link recorded on C', setup.rec?.[0] === ids.B && setup.rec?.[2] === setup.pinLink, JSON.stringify(setup))

// ctrl+alt on lane Y's out-pin: riders cut, lane parks as an origin float --
// whose id now COLLIDES with the pin link's.
const toothPt = await rrPt(setup.laneY.out)
await page.keyboard.down('Control'); await page.keyboard.down('Alt')
await page.mouse.move(toothPt[0], toothPt[1]); await page.mouse.down()
await page.waitForTimeout(300)
await page.mouse.up(); await page.waitForTimeout(800)
await page.keyboard.up('Alt'); await page.keyboard.up('Control')

const res = await page.evaluate(async ({ ids, setup }) => {
  const g = window.app.graph
  window.__cablemanagementDraw = new Map(); window.__cablemanagementCapture = true
  for (let k = 0; k < 4; k++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
  const floats = [...(g.floatingLinks?.values?.() ?? [])]
  const f = floats[0] ?? null
  const linkDraw = window.__cablemanagementDraw.get(setup.pinLink) ?? null
  const floatDraw = f ? window.__cablemanagementDraw.get('f' + f.id) ?? null : null
  // DOM truth for both expectation anchors -- getConnectionPos lies in Vue
  // mode (the reason the capture map exists at all).
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  const domAt = (el) => {
    const r = el?.getBoundingClientRect()
    return r?.width ? [(r.x + r.width / 2 - view.left) / ds.scale - ds.offset[0], (r.y + r.height / 2 - view.top) / ds.scale - ds.offset[1]] : null
  }
  const xOut = domAt(document.querySelector(`[data-slot-key="${ids.X}-out-0"]`))
  const pinAt = domAt(document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${ids.B}"][data-cablemanagement-index="${ids.idx}"]`))
  return {
    floats: floats.map((x) => ({ id: x.id, origin: String(x.origin_id) })),
    collides: f ? f.id === setup.pinLink : false,
    yLink: g.getNodeById(Number(ids.Y)).inputs[ids.idx].link ?? null,
    linkDraw, floatDraw, xOut: [xOut[0], xOut[1]], pinAt,
  }
}, { ids, setup })
const near = (a, b, tol = 40) => !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol
ok('s1: cut parked ONE float whose id collides with the pin link', res.floats.length === 1 && res.collides && res.yLink === null, JSON.stringify(res.floats) + ' pinLink=' + setup.pinLink)
ok('s1: float draws honestly from X (not from the pin)',
  near([res.floatDraw?.[0], res.floatDraw?.[1]], res.xOut) && !near([res.floatDraw?.[0], res.floatDraw?.[1]], res.pinAt),
  JSON.stringify({ floatDraw: res.floatDraw, xOut: res.xOut, pinAt: res.pinAt }))
ok('s1: the real pin link keeps its pin substitution',
  near([res.linkDraw?.[0], res.linkDraw?.[1]], res.pinAt), JSON.stringify({ linkDraw: res.linkDraw, pinAt: res.pinAt }))

console.log('page errors:', errs.length ? errs.slice(0, 8) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
