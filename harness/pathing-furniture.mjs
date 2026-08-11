// S4 furniture: centre button opens the link menu at its on-trace position; arrows and
// flow dots (computeConnectionPoint) land on trace segments; hover hit-test works.
import { chromium } from 'playwright'

const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

const prep = await page.evaluate(async () => {
  const app = window.app
  const g = app.graph
  const L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const A = L.createNode('CheckpointLoaderSimple'); A.pos = [700, 150]; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [200, 180]; B.title = 'B'; g.add(B)
  A.connect(1, B, B.inputs.findIndex((s) => s.name === 'clip'))
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  app.canvas.render_connection_arrows = true
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 800))
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 800))

  const link = [...g._links.values()][0]
  const route = window.__cablemanagementPathing.routes()[0]
  const { ds } = app.canvas
  const toScreen = (gx, gy) => [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]

  // centre must sit on some trace segment
  const onTrace = (x, y) => {
    for (let k = 1; k < route.pts.length; k++) {
      const a = route.pts[k - 1], c = route.pts[k]
      const vert = Math.abs(a[0] - c[0]) < 0.1
      if (vert && Math.abs(x - a[0]) < 12 && y > Math.min(a[1], c[1]) - 12 && y < Math.max(a[1], c[1]) + 12) return true
      if (!vert && Math.abs(y - a[1]) < 12 && x > Math.min(a[0], c[0]) - 12 && x < Math.max(a[0], c[0]) + 12) return true
    }
    return false
  }
  return {
    centre: link._pos ? [link._pos[0], link._pos[1]] : null,
    centreOnTrace: link._pos ? onTrace(link._pos[0], link._pos[1]) : false,
    centreScreen: link._pos ? toScreen(link._pos[0], link._pos[1]) : null,
    routePts: route.pts.length
  }
})
console.log('centre:', JSON.stringify(prep))

// arrows/flow points on trace (computeConnectionPoint at t = .25/.5/.75)
const pointsOn = await page.evaluate(() => {
  const app = window.app
  const g = app.graph
  const link = [...g._links.values()][0]
  const route = window.__cablemanagementPathing.routes()[0]
  const pr = app.canvas.linkRenderer.pathRenderer
  const proto = Object.getPrototypeOf(pr)
  const linkData = {
    id: String(link.id),
    startPoint: { x: route.pts[0][0], y: route.pts[0][1] },
    endPoint: { x: route.pts.at(-1)[0], y: route.pts.at(-1)[1] },
    startDirection: 'right', endDirection: 'left',
    __route: { pts: route.pts, m: (() => { let t = 0; const seg = []; for (let k = 1; k < route.pts.length; k++) { const d = Math.hypot(route.pts[k][0] - route.pts[k - 1][0], route.pts[k][1] - route.pts[k - 1][1]); seg.push(d); t += d } return { seg, total: t } })() }
  }
  const onTrace = (p) => {
    for (let k = 1; k < route.pts.length; k++) {
      const a = route.pts[k - 1], c = route.pts[k]
      const vert = Math.abs(a[0] - c[0]) < 0.1
      if (vert && Math.abs(p.x - a[0]) < 2 && p.y > Math.min(a[1], c[1]) - 2 && p.y < Math.max(a[1], c[1]) + 2) return true
      if (!vert && Math.abs(p.y - a[1]) < 2 && p.x > Math.min(a[0], c[0]) - 2 && p.x < Math.max(a[0], c[0]) + 2) return true
    }
    return false
  }
  return [0.25, 0.5, 0.75].map((t) => onTrace(proto.computeConnectionPoint.call(pr, linkData, t, {})))
})
console.log('points at t .25/.5/.75 on trace:', JSON.stringify(pointsOn))

// centre click opens the link menu
if (prep.centreScreen) {
  await page.mouse.click(prep.centreScreen[0], prep.centreScreen[1])
  await page.waitForTimeout(800)
  const menu = await page.evaluate(() =>
    !!document.querySelector('.litecontextmenu, .litegraph.litecontextmenu, [class*="context-menu"], [class*="contextMenu"]'))
  console.log('link menu opened on centre click:', menu)
}
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/pathing-furniture.png' })
console.log('page errors:', errs.length ? errs : 'none')
await b.close()
