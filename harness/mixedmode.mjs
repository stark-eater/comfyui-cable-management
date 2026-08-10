// Mixed link modes: ribbons always on, in every link render mode.
//   s1 SPLINE mode: comb crossing segments route (orthogonal trace), plain links do NOT
//   s2 SPLINE mode: gestures live -- collapse glyph click round-trips
//   s3 SPLINE mode: "+" square enrolls a dragged link as a floating lane
//   s4 switch to PCB: plain link routes appear; back to SPLINE: they vanish, comb stays
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

await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
  window.app.canvas.links_render_mode = L.SPLINE_LINK
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('EmptyLatentImage', 60, 100)
  const s2 = mk('CheckpointLoaderSimple', 60, 400)
  const y1 = mk('KSampler', 1200, 80)
  const y2 = mk('CheckpointSave', 1200, 500)
  const idx = y1.inputs.findIndex((s) => s.name === 'latent_image')
  s1.connect(0, y1, idx); s2.connect(0, y2, 0); s2.connect(1, y2, 1)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1500))
  window.__cablemanagementCombs.create(y1.inputs[idx].link, y2.inputs[0].link, 500, 280)
  await new Promise((r) => setTimeout(r, 900))
})

// ---- s1: only comb crossings route in spline mode ----
const r1 = await page.evaluate(() => window.__cablemanagementPathing.routes().map((r) => r.key))
ok('s1: crossing segments routed, plain links native', r1.length === 2 && r1.every((k) => k.includes('|X')), JSON.stringify(r1))

// ---- s2: collapse glyph works in spline mode ----
const slotPt = (slot) => page.evaluate((slot) => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const ds = window.app.canvas.ds
  const h = c.collapsed ? 24 : 24 + Math.max(2, c.lanes.length - 1) * 20
  const cy = c.out.pos[1] + h / 2 + (c.collapsed ? 0 : (slot - 1.5) * 14)
  return [(c.out.pos[0] + 12 + ds.offset[0]) * ds.scale, (cy + ds.offset[1]) * ds.scale]
}, slot)
const hoverThenClick = async (pt) => {
  await page.mouse.move(pt[0], pt[1] - 30)
  await page.waitForTimeout(400)
  await page.mouse.move(...pt)
  await page.waitForTimeout(400)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(900)
}
await hoverThenClick(await slotPt(3))
const col = await page.evaluate(() => !!window.app.graph.extra.cablemanagement_combs[0].collapsed)
await hoverThenClick(await slotPt(0))
const exp = await page.evaluate(() => !!window.app.graph.extra.cablemanagement_combs[0].collapsed)
ok('s2: collapse/expand gestures live in spline mode', col && !exp, JSON.stringify({ col, exp }))

// ---- s3: "+" square enrolls a floating lane in spline mode ----
const drag = await page.evaluate(() => {
  const g = window.app.graph
  const y2 = g._nodes.find((n) => n.type === 'CheckpointSave')
  const el = document.querySelector(`.lg-node[data-node-id="${y2.id}"] [data-slot-key="${y2.id}-in-1"]`)
  const r = el.getBoundingClientRect()
  const c = g.extra.cablemanagement_combs[0]
  const ds = window.app.canvas.ds
  const h = 24 + Math.max(2, c.lanes.length - 1) * 20
  return {
    from: [r.x + r.width / 2, r.y + r.height / 2],
    plus: [(c.in.pos[0] + 12 + ds.offset[0]) * ds.scale, (c.in.pos[1] + h + 4 + 12 + ds.offset[1]) * ds.scale]
  }
})
await page.mouse.move(...drag.from)
await page.mouse.down()
await page.mouse.move(drag.plus[0], drag.plus[1], { steps: 12 })
await page.waitForTimeout(300)
await page.mouse.up()
await page.waitForTimeout(1000)
const enrolled = await page.evaluate(() => ({
  lanes: window.app.graph.extra.cablemanagement_combs[0].lanes.length,
  floating: window.app.graph.floatingLinks?.size ?? 0
}))
ok('s3: "+" enroll works in spline mode', enrolled.lanes === 3 && enrolled.floating >= 1, JSON.stringify(enrolled))

// ---- s4: mode switch round-trip ----
const counts = await page.evaluate(async () => {
  // Ghost liveness retires stale entries over a few DRAWN frames -- pump them.
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      window.app.graph.setDirtyCanvas(false, true)
      await new Promise((r) => setTimeout(r, 120))
    }
  }
  const out = {}
  window.app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  await settle()
  const pcb = window.__cablemanagementPathing.routes().map((r) => r.key)
  out.pcbPlain = pcb.filter((k) => !k.includes('|X')).length
  out.pcbComb = pcb.filter((k) => k.includes('|X')).length
  window.app.canvas.links_render_mode = window.LiteGraph.SPLINE_LINK
  await settle()
  const spl = window.__cablemanagementPathing.routes().map((r) => r.key)
  out.splPlain = spl.filter((k) => !k.includes('|X')).length
  out.splComb = spl.filter((k) => k.includes('|X')).length
  return out
})
ok('s4: PCB adds plain routes, spline sheds them, comb persists',
  counts.pcbPlain >= 1 && counts.pcbComb >= 2 && counts.splPlain === 0 && counts.splComb === counts.pcbComb,
  JSON.stringify(counts))

ok('no page errors', errs.length === 0, errs.join(' | '))
await b.close()
if (!pass) process.exit(1)
console.log('PASS')
