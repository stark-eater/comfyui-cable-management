// QA bug (post-polish): repositioning a combed passthrough link by its INPUT end
// drew the chain's entry segment from the hidden primitive while in hand -- the
// ledger dropped the WHOLE entry for a genuinely dragged link, though only the
// loose end follows the pointer. Now the anchored end keeps its substitution:
// mid-drag the entry segment still leaves from the passthrough pin, the sibling
// lane is untouched, and no route is minted from the true origin.
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

const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 80, 100)
  const B1 = mk('CheckpointLoaderSimple', 1200, 60)
  const B2 = mk('CheckpointLoaderSimple', 1200, 420)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1800))
  return {
    A: String(A.id), B1: String(B1.id), B2: String(B2.id),
    i1: B1.inputs.findIndex(s => s.widget?.name === 'ckpt_name'),
    i2: B2.inputs.findIndex(s => s.widget?.name === 'ckpt_name')
  }
})
const pinPt = () => page.evaluate(i => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget'
  )
  const r = el?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, ids)
const slotPt = (key) => page.evaluate(k => {
  const r = document.querySelector(`[data-slot-key="${k}"]`)?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, key)
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
}
await drag(await pinPt(), await slotPt(`${ids.B1}-in-${ids.i1}`))
await drag(await pinPt(), await slotPt(`${ids.B2}-in-${ids.i2}`))
await page.evaluate(() => {
  const g = window.app.graph
  const links = [...g._links.values()].map(l => l.id)
  const id = window.__cablemanagementCombs.create(links[0], links[1], 700, 260)
  window.__cablemanagementCombs.move(id, 'out', 1000, 260)
})
const fresh = () => page.evaluate(async () => {
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  const g = window.app.graph
  for (let i = 0; i < 5; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})
await fresh()
const base = await page.evaluate((ids) => {
  const g = window.app.graph
  const draw = window.__cablemanagementDraw
  const l1 = [...g._links.values()].find(l => String(l.target_id) === String(ids.B1))
  const l2 = [...g._links.values()].find(l => String(l.target_id) === String(ids.B2))
  return { l1: l1.id, l2: l2.id, d1: draw.get(l1.id), d2: draw.get(l2.id) }
}, ids)
const pin = [base.d1[0], base.d1[1]]
ok('both lanes draw from the pin at rest', base.d2 && Math.hypot(base.d2[0] - pin[0], base.d2[1] - pin[1]) < 1, JSON.stringify(base))

// Grab B1's ckpt input dot (core moveInputLink) and HOLD over empty canvas.
const dot = await slotPt(`${ids.B1}-in-${ids.i1}`)
await page.mouse.move(dot[0], dot[1])
await page.mouse.down()
await page.mouse.move(dot[0] + 200, dot[1] + 260, { steps: 15 })
await page.waitForTimeout(300)
await fresh()
const mid = await page.evaluate((arg) => {
  const lc = window.app.canvas.linkConnector
  const g = window.app.graph
  const H = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  const hOut = H.getConnectionPos(false, 0)
  const routes = window.__cablemanagementPathing.routes()
  const nearH = routes.filter(r => Math.hypot(r.pts[0][0] - hOut[0], r.pts[0][1] - hOut[1]) < 30).map(r => r.key)
  return {
    connecting: lc.isConnecting, member: lc.inputLinks?.map(l => l.id) ?? [],
    d1: window.__cablemanagementDraw.get(arg.l1) ?? null,
    d2: window.__cablemanagementDraw.get(arg.l2) ?? null,
    nearH
  }
}, base)
ok('input end is genuinely in hand', mid.connecting && mid.member.includes(base.l1), JSON.stringify({ c: mid.connecting, m: mid.member }))
ok('moved link still draws from the pin mid-drag', mid.d1 && Math.hypot(mid.d1[0] - pin[0], mid.d1[1] - pin[1]) < 1, JSON.stringify(mid.d1))
ok('sibling lane untouched mid-drag', mid.d2 && Math.hypot(mid.d2[0] - pin[0], mid.d2[1] - pin[1]) < 1, JSON.stringify(mid.d2))
ok('no route minted from the true origin', mid.nearH.length === 0, JSON.stringify(mid.nearH))

// Drop back on the same input: reconnected and pin-anchored again.
await page.mouse.move(dot[0], dot[1], { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(900)
await fresh()
const after = await page.evaluate((ids) => {
  const g = window.app.graph
  const l1 = [...g._links.values()].find(l => String(l.target_id) === String(ids.B1))
  return { linked: !!l1, draw: l1 ? window.__cablemanagementDraw.get(l1.id) ?? null : null }
}, ids)
ok('drop reconnects, pin anchor restored', after.linked && after.draw && Math.hypot(after.draw[0] - pin[0], after.draw[1] - pin[1]) < 1, JSON.stringify(after))

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
