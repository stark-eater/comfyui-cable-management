// Nudge pass (R2) + fan-out (R5): one CLIP output feeding four stacked encoders forces
// four routes down the same corridor; they must spread into distinct lanes. Then the
// loader is collapsed: all four depart one point and must still fan out.
import { chromium } from 'playwright'

const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

const overlapCount = (routes) => {
  // interior segments of different links: same orientation, lanes closer than 6px,
  // intervals overlapping by more than 8px
  const segs = []
  routes.forEach((r, ri) => {
    for (let k = 1; k < r.pts.length - 2; k++) {
      const a = r.pts[k], c = r.pts[k + 1]
      const vert = Math.abs(a[0] - c[0]) < 0.1
      segs.push({ ri, vert, coord: vert ? a[0] : a[1], lo: Math.min(vert ? a[1] : a[0], vert ? c[1] : c[0]), hi: Math.max(vert ? a[1] : a[0], vert ? c[1] : c[0]) })
    }
  })
  let n = 0
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], t = segs[j]
    if (s.ri === t.ri || s.vert !== t.vert) continue
    if (Math.abs(s.coord - t.coord) < 6 && Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > 8) n++
  }
  return n
}

const out = await page.evaluate(async () => {
  const app = window.app
  const g = app.graph
  const L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const ck = L.createNode('CheckpointLoaderSimple'); ck.pos = [150, 300]; g.add(ck)
  const enc = []
  for (let i = 0; i < 4; i++) {
    const n = L.createNode('CLIPTextEncode'); n.pos = [750, 60 + i * 230]; n.title = `E${i}`; g.add(n)
    ck.connect(1, n, n.inputs.findIndex((s) => s.name === 'clip'))
    enc.push(n)
  }
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 800))
  g.setDirtyCanvas(true, true) // second frame so the nudge settles
  await new Promise((r) => setTimeout(r, 800))
  const routes = window.__cablemanagementPathing.routes()
  return { routes, count: routes.length }
})
console.log('expanded: routes =', out.count, ' overlaps =', overlapCount(out.routes))
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/pathing-nudge.png' })

const out2 = await page.evaluate(async () => {
  const app = window.app
  const g = app.graph
  const ck = g._nodes.find((n) => n.type === 'CheckpointLoaderSimple')
  ck.collapse()
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 800))
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 800))
  const routes = window.__cablemanagementPathing.routes()
  // fan-out: distinct first-turn lane coords among routes leaving the collapsed node
  const firstTurns = routes.map((r) => Math.round(r.pts[1][0]))
  return { count: routes.length, firstTurns, uniqueTurns: new Set(firstTurns).size }
})
console.log('collapsed: routes =', out2.count, ' first-turn xs =', JSON.stringify(out2.firstTurns), ' unique =', out2.uniqueTurns)
const routes2 = await page.evaluate(() => window.__cablemanagementPathing.routes())
console.log('collapsed overlaps =', overlapCount(routes2))
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/pathing-fan.png' })
console.log('page errors:', errs.length ? errs : 'none')
await b.close()
