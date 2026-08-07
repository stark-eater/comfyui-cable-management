// Milestone test: backward link (target left of source) routes exit-right, around both
// nodes, enter-left. Plus the stacked-chain scenario from Barney's example two.
import { chromium } from 'playwright'

const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

const out = await page.evaluate(async () => {
  const app = window.app
  const g = app.graph
  const L = window.LiteGraph
  const r = { probe: window.__cablemanagementPathing.state }

  g.clear()
  // Backward pair: B sits LEFT of A, A.CLIP -> B.clip
  const A = L.createNode('CheckpointLoaderSimple'); A.pos = [700, 150]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [200, 180]; B.title = 'B'; g.add(B)
  A.connect(1, B, B.inputs.findIndex((s) => s.name === 'clip'))

  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  g.setDirtyCanvas(true, true)
  await new Promise((res) => setTimeout(res, 1500))

  const routes = window.__cablemanagementPathing.routes()
  r.routeCount = routes.length
  if (routes.length) {
    const { pts } = routes[0]
    r.pts = pts.map((p) => [Math.round(p[0]), Math.round(p[1])])
    // R3: exits right, enters from the left
    r.exitsRight = pts[1][0] > pts[0][0]
    r.entersFromLeft = pts[pts.length - 2][0] < pts[pts.length - 1][0]
    // R1: no interior segment crosses either node's rect
    const rects = [A, B].map((n) => {
      const br = n.boundingRect ?? [n.pos[0], n.pos[1], n.size[0], n.size[1]]
      return [br[0], br[1], br[0] + br[2], br[1] + br[3]]
    })
    const crosses = (a, c) => rects.some(([x0, y0, x1, y1]) => {
      // orthogonal segments only
      if (Math.abs(a[1] - c[1]) < 0.1) {
        const lo = Math.min(a[0], c[0]), hi = Math.max(a[0], c[0])
        return a[1] > y0 + 1 && a[1] < y1 - 1 && hi > x0 + 1 && lo < x1 - 1
      }
      const lo = Math.min(a[1], c[1]), hi = Math.max(a[1], c[1])
      return a[0] > x0 + 1 && a[0] < x1 - 1 && hi > y0 + 1 && lo < y1 - 1
    })
    r.crossings = 0
    for (let k = 1; k < pts.length - 2; k++) if (crosses(pts[k], pts[k + 1])) r.crossings++
  }
  const link = [...g._links.values()][0]
  r.hasPath = !!link?.path
  r.centre = link?._pos ? [Math.round(link._pos[0]), Math.round(link._pos[1])] : null
  r.stats = window.__cablemanagementPathing.stats()
  return r
})
console.log('backward:', JSON.stringify(out, null, 1))
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/pathing-backward.png' })

// Stacked chain: three prompt-ish nodes vertically, each output feeding the NEXT one's
// input (right-to-left feedback per row) — Barney's example two, layout A.
const out2 = await page.evaluate(async () => {
  const app = window.app
  const g = app.graph
  const L = window.LiteGraph
  g.clear()
  const mk = (t, x, y) => { const n = L.createNode('CLIPTextEncode'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const ck = L.createNode('CheckpointLoaderSimple'); ck.pos = [150, 100]; g.add(ck)
  const n1 = mk('S1', 600, 120)
  const n2 = mk('S2', 600, 360)
  const n3 = mk('S3', 600, 600)
  // clip feeds all three (forward links), and each CONDITIONING output loops back
  // to nothing chainable on CLIPTextEncode — so chain clip instead: ck -> n1, then
  // n1's output can't feed clip; use ck clip to each (forward), and make the
  // BACKWARD stack: n1.out -> (down-left) … use ConditioningCombine to chain.
  const c1 = L.createNode('ConditioningCombine'); c1.pos = [560, 300]; g.add(c1)
  const c2 = L.createNode('ConditioningCombine'); c2.pos = [560, 540]; g.add(c2)
  for (const n of [n1, n2, n3]) ck.connect(1, n, n.inputs.findIndex((s) => s.name === 'clip'))
  n1.connect(0, c1, 0)
  n2.connect(0, c1, 1)
  n2.connect(0, c2, 0)
  n3.connect(0, c2, 1)
  g.setDirtyCanvas(true, true)
  await new Promise((res) => setTimeout(res, 1500))
  return { routes: window.__cablemanagementPathing.routes().length, links: g._links.size, stats: window.__cablemanagementPathing.stats() }
})
console.log('stacked:', JSON.stringify(out2))
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/pathing-stacked.png' })
console.log('page errors:', errs.length ? errs : 'none')
await b.close()
