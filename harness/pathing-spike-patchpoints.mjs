// S1: the six patch-point methods exist unmangled on the live bundle and sit on the live
//     render path (counters via no-op wraps).
// S3: Link Render Mode setting accepts an injected 4th option and a sentinel value that
//     round-trips to canvas.links_render_mode without hiding links or erroring.
import { chromium } from 'playwright'

const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

// ---- S1a: presence ----
const presence = await page.evaluate(() => {
  const c = window.app.canvas
  const canvasProto = c.constructor.prototype
  const lr = c.linkRenderer
  const lrProto = lr ? Object.getPrototypeOf(lr) : null
  const pr = lr?.pathRenderer
  const prProto = pr ? Object.getPrototypeOf(pr) : null
  return {
    drawConnections: typeof canvasProto.drawConnections,
    _renderAllLinkSegments: typeof canvasProto._renderAllLinkSegments,
    renderLink: typeof canvasProto.renderLink,
    linkRenderer: !!lr,
    renderLinkDirect: typeof lrProto?.renderLinkDirect,
    calculateLinkBounds: typeof lrProto?.calculateLinkBounds,
    pathRenderer: !!pr,
    drawLink: typeof prProto?.drawLink,
    drawLinkPath: typeof prProto?.drawLinkPath,
    calculateCenterPoint: typeof prProto?.calculateCenterPoint,
    computeConnectionPoint: typeof prProto?.computeConnectionPoint,
    renderedPathsIsSet: c.renderedPaths instanceof Set,
    linkRenderModes: window.LiteGraph.LINK_RENDER_MODES,
    enums: {
      STRAIGHT: window.LiteGraph.STRAIGHT_LINK,
      LINEAR: window.LiteGraph.LINEAR_LINK,
      SPLINE: window.LiteGraph.SPLINE_LINK,
      HIDDEN: window.LiteGraph.HIDDEN_LINK
    },
    currentMode: c.links_render_mode
  }
})
console.log('S1a presence:', JSON.stringify(presence, null, 1))

// ---- S1b: live counters — build a linked graph, wrap, redraw, count ----
const counters = await page.evaluate(async () => {
  const app = window.app
  const g = app.graph
  const L = window.LiteGraph
  g.clear()
  const A = L.createNode('CheckpointLoaderSimple'); A.pos = [150, 200]; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [650, 220]; g.add(B)
  const clipIn = B.inputs.findIndex((s) => s.name === 'clip')
  A.connect(1, B, clipIn) // CLIP output -> clip input
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 1500))

  const c = app.canvas
  const canvasProto = c.constructor.prototype
  const lrProto = Object.getPrototypeOf(c.linkRenderer)
  const prProto = Object.getPrototypeOf(c.linkRenderer.pathRenderer)
  const n = { drawConnections: 0, renderLinkDirect: 0, calculateLinkBounds: 0, drawLink: 0, drawLinkPath: 0, calculateCenterPoint: 0, computeConnectionPoint: 0 }
  const saved = []
  const wrap = (proto, name) => {
    const orig = proto[name]
    saved.push([proto, name, orig])
    proto[name] = function (...a) { n[name]++; return orig.apply(this, a) }
  }
  wrap(canvasProto, 'drawConnections')
  wrap(lrProto, 'renderLinkDirect')
  wrap(lrProto, 'calculateLinkBounds')
  wrap(prProto, 'drawLink')
  wrap(prProto, 'drawLinkPath')
  wrap(prProto, 'calculateCenterPoint')
  wrap(prProto, 'computeConnectionPoint')

  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 800))
  for (const [proto, name, orig] of saved) proto[name] = orig
  return n
})
console.log('S1b live counters:', JSON.stringify(counters))

// ---- S3: inject 4th option + sentinel round-trip ----
const s3 = await page.evaluate(async () => {
  const app = window.app
  const out = { defFound: false, storeName: null, optionsBefore: null, setOk: false, canvasMode: null, drawn: null, restored: null, settingApi: null }

  // Locate the runtime setting definition (has .options) via pinia stores
  const vueApp = document.querySelector('#vue-app')?.__vue_app__ ?? document.querySelector('#app')?.__vue_app__
  const pinia = vueApp?.config?.globalProperties?.$pinia
  let def = null
  if (pinia?._s) {
    for (const [name, store] of pinia._s) {
      const bag = store.settingsById ?? store.settings
      const cand = bag?.['Comfy.LinkRenderMode'] ?? bag?.get?.('Comfy.LinkRenderMode')
      if (cand && Array.isArray(cand.options)) { def = cand; out.storeName = name; break }
    }
  }
  if (def) {
    out.defFound = true
    out.optionsBefore = def.options.map((o) => `${o.value}:${o.text}`)
  }

  // Setting API
  const st = app.extensionManager?.setting
  out.settingApi = !!st
  if (!st) return out
  const prev = st.get('Comfy.LinkRenderMode')

  // Pick a sentinel clear of every existing enum value
  const L = window.LiteGraph
  const taken = [L.STRAIGHT_LINK, L.LINEAR_LINK, L.SPLINE_LINK, L.HIDDEN_LINK]
  const PCB = Math.max(...taken) + 1
  out.sentinel = PCB

  if (def) def.options.push({ value: PCB, text: 'PCB' })

  try {
    await st.set('Comfy.LinkRenderMode', PCB)
    out.setOk = true
  } catch (e) {
    out.setErr = String(e).split('\n')[0]
  }
  await new Promise((r) => setTimeout(r, 600))
  out.canvasMode = app.canvas.links_render_mode

  // Links must still draw (spline fallback): count drawLinkPath calls in one redraw
  const prProto = Object.getPrototypeOf(app.canvas.linkRenderer.pathRenderer)
  const orig = prProto.drawLinkPath
  let calls = 0
  prProto.drawLinkPath = function (...a) { calls++; return orig.apply(this, a) }
  app.graph.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 600))
  prProto.drawLinkPath = orig
  out.drawn = calls

  // Restore user's real value + remove injected option
  await st.set('Comfy.LinkRenderMode', prev)
  if (def) def.options = def.options.filter((o) => o.value !== PCB)
  out.restored = st.get('Comfy.LinkRenderMode')
  return out
})
console.log('S3 dropdown/sentinel:', JSON.stringify(s3, null, 1))
console.log('page errors:', errs.length ? errs : 'none')
await b.close()
