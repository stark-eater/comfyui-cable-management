// Fix round: (1) anti-braid lane order -- same-order parallel links must not cross;
// (2) reroute entered from the left, exited to the right; (3) routes reappear after a
// drag DROP, without unselecting.
import { chromium } from 'playwright'

const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

const crossings = (routes) => {
  const H = [], V = []
  routes.forEach((r, ri) => {
    for (let k = 0; k < r.pts.length - 1; k++) {
      const a = r.pts[k], c = r.pts[k + 1]
      if (Math.abs(a[0] - c[0]) < 0.1) V.push({ ri, x: a[0], lo: Math.min(a[1], c[1]), hi: Math.max(a[1], c[1]) })
      else H.push({ ri, y: a[1], lo: Math.min(a[0], c[0]), hi: Math.max(a[0], c[0]) })
    }
  })
  let n = 0
  for (const h of H) for (const v of V) {
    if (h.ri === v.ri) continue
    if (v.x > h.lo + 1 && v.x < h.hi - 1 && h.y > v.lo + 1 && h.y < v.hi - 1) n++
  }
  return n
}

// (1) braid: loader MODEL/CLIP/VAE -> CheckpointSave model/clip/vae, same order,
// target lower-right so all three share the corridor travelling down.
const braid = await page.evaluate(async () => {
  const app = window.app
  const g = app.graph
  const L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const A = L.createNode('CheckpointLoaderSimple'); A.pos = [150, 120]; g.add(A)
  const B = L.createNode('CheckpointSave'); B.pos = [640, 380]; g.add(B)
  A.connect(0, B, 0); A.connect(1, B, 1); A.connect(2, B, 2)
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 700))
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 700))
  return { routes: window.__cablemanagementPathing.routes() }
})
console.log('braid: routes =', braid.routes.length, ' crossings =', crossings(braid.routes))
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/pathing-braid.png' })

// (2) reroute on the CLIP link
const rr = await page.evaluate(async () => {
  const app = window.app
  const g = app.graph
  const link = [...g._links.values()].find((l) => l.origin_slot === 1)
  const reroute = g.createReroute([460, 250], link)
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 700))
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 700))
  const routes = window.__cablemanagementPathing.routes()
  const near = (p, q) => Math.abs(p[0] - q[0]) < 30 && Math.abs(p[1] - q[1]) < 30
  const into = routes.find((r) => near(r.pts[r.pts.length - 1], [460, 250]))
  const outof = routes.find((r) => near(r.pts[0], [460, 250]))
  return {
    routeCount: routes.length,
    intoFromLeft: into ? into.pts[into.pts.length - 2][0] < into.pts[into.pts.length - 1][0] : null,
    outToRight: outof ? outof.pts[1][0] > outof.pts[0][0] : null
  }
})
console.log('reroute:', JSON.stringify(rr))
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/pathing-reroute.png' })

// (3) drag the loader with the mouse, release, do NOT unselect -- traces must return.
const drop = await page.evaluate(() => {
  const app = window.app
  const A = app.graph._nodes.find((n) => n.type === 'CheckpointLoaderSimple')
  const { ds } = app.canvas
  return { sx: (A.pos[0] + 80 + ds.offset[0]) * ds.scale, sy: (A.pos[1] - 12 + ds.offset[1]) * ds.scale }
})
await page.mouse.move(drop.sx, drop.sy)
await page.mouse.down()
await page.mouse.move(drop.sx + 40, drop.sy + 90, { steps: 10 })
await page.waitForTimeout(200)
const during = await page.evaluate(() => window.__cablemanagementPathing.routes().length)
await page.mouse.up()
await page.waitForTimeout(700)
const after = await page.evaluate(() => {
  const app = window.app
  const A = app.graph._nodes.find((n) => n.type === 'CheckpointLoaderSimple')
  const routes = window.__cablemanagementPathing.routes()
  // at least one live route must START at the node's NEW output area (proves the
  // after-drop routes are fresh geometry, not stale cache)
  const nearNode = routes.some((r) =>
    Math.abs(r.pts[0][0] - (A.pos[0] + A.size[0])) < 40 &&
    r.pts[0][1] > A.pos[1] - 40 && r.pts[0][1] < A.pos[1] + A.size[1] + 40)
  return {
    routes: routes.length,
    freshGeometry: nearNode,
    stillSelected: app.canvas.selectedItems?.size ?? 'n/a'
  }
})
console.log('drop: routes during drag =', during, ' after drop =', after.routes, ' fresh geometry =', after.freshGeometry, ' still selected =', after.stillSelected)
console.log('page errors:', errs.length ? errs : 'none')
await b.close()
