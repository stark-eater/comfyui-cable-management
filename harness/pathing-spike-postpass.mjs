// S2: a link whose endpoints are culled off-screen can be post-pass rendered by a
// drawConnections wrapper at on-screen coordinates, becomes hit-testable via
// renderedPaths + isPointInStroke, and leaves pixels on the background canvas.
import { chromium } from 'playwright'

const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const out = await page.evaluate(async () => {
  const app = window.app
  const g = app.graph
  const L = window.LiteGraph
  const c = app.canvas
  const r = {}

  // Far off-screen in graph space: convert screen (-4000, y) region
  g.clear()
  const A = L.createNode('CheckpointLoaderSimple'); g.add(A)
  const B = L.createNode('CLIPTextEncode'); g.add(B)
  const { ds } = c
  const toGraph = (sx, sy) => [sx / ds.scale - ds.offset[0], sy / ds.scale - ds.offset[1]]
  const offA = toGraph(-5000, 200); const offB = toGraph(-3800, 300)
  A.pos = offA; B.pos = offB
  const clipIn = B.inputs.findIndex((s) => s.name === 'clip')
  A.connect(1, B, clipIn)
  g.setDirtyCanvas(true, true)
  await new Promise((res) => setTimeout(res, 1200))

  const link = [...g._links.values()][0]
  r.linkId = link?.id

  // (a) cull confirmed: link not in renderedPaths after a plain redraw
  r.culledBefore = !c.renderedPaths.has(link)

  // Baseline pixels in the region where we'll draw
  const bg = c.bgcanvas
  const bctx = bg.getContext('2d')
  const cssW = bg.clientWidth || c.canvas.clientWidth || bg.width
  const cssH = bg.clientHeight || c.canvas.clientHeight || bg.height
  const px = (sx, sy, w, h) => {
    const kx = (bg.width / cssW) || 1, ky = (bg.height / cssH) || 1
    const d = bctx.getImageData(sx * kx, sy * ky, Math.max(1, w * kx), Math.max(1, h * ky)).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
    return sum
  }
  const region = [420, 320, 260, 200] // screen-space box the route will cross
  r.pixelsBefore = px(...region)

  // Post-pass wrapper on the prototype
  const start = toGraph(450, 350), end = toGraph(650, 480)
  r.renderCoords = { start, end }
  const proto = c.constructor.prototype
  const orig = proto.drawConnections
  let postPassRan = 0
  proto.drawConnections = function (ctx) {
    orig.call(this, ctx)
    if (this !== c) return
    if (this.links_render_mode === L.HIDDEN_LINK) return
    if (!this.renderedPaths.has(link) && this.graph?._links.has(link.id)) {
      const alpha = ctx.globalAlpha
      ctx.globalAlpha = this.editor_alpha
      this.renderLink(ctx, start, end, link, false, 0, null, 0, 0)
      ctx.globalAlpha = alpha
      this.renderedPaths.add(link)
      postPassRan++
    }
  }
  g.setDirtyCanvas(true, true)
  await new Promise((res) => setTimeout(res, 800))

  r.postPassRan = postPassRan
  r.inRenderedPaths = c.renderedPaths.has(link)
  r.pixelsAfter = px(...region)
  r.pixelDelta = r.pixelsAfter - r.pixelsBefore
  r.hasPath = !!link.path
  r.centrePos = link._pos ? [Math.round(link._pos[0]), Math.round(link._pos[1])] : null

  // (d) hit test exactly like the pointer path does: lineWidth + dpi + isPointInStroke
  if (link.path) {
    const { lineWidth } = c.ctx
    c.ctx.lineWidth = c.connections_width + 7
    const dpi = Math.max(window.devicePixelRatio ?? 1, 1)
    // midpoint of the drawn curve should sit on the stroke
    const mid = link._pos ?? [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    r.hitAtCentre = c.ctx.isPointInStroke(link.path, mid[0] * dpi, mid[1] * dpi)
    c.ctx.lineWidth = lineWidth
  }

  proto.drawConnections = orig
  g.setDirtyCanvas(true, true)
  await new Promise((res) => setTimeout(res, 400))
  r.culledAfterRestore = !c.renderedPaths.has(link)
  return r
})
console.log('S2 post-pass:', JSON.stringify(out, null, 1))
console.log('page errors:', errs.length ? errs : 'none')
await b.close()
