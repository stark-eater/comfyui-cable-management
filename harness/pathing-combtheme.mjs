// Theme parity (audit "deviations" round): gate colours come from the LiteGraph
// palette constants Comfy's colour-palette setting writes -- no invented colours.
// Asserted by stamping sentinel values into the constants and sampling the overlay:
// the gate body must repaint in the sentinel bg, the caret in the sentinel title
// colour.
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
const settle = () => page.evaluate(async () => {
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})

await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('CheckpointLoaderSimple', 60, 60)
  const t1 = mk('CheckpointSave', 1500, 80)
  const s2 = mk('CheckpointLoaderSimple', 60, 300)
  const t2 = mk('CheckpointSave', 1500, 320)
  s1.connect(0, t1, 0); s2.connect(0, t2, 0)
  const [l1, l2] = [...g._links.values()].map((l) => l.id)
  const id = window.__cablemanagementCombs.create(l1, l2, 700, 300)
  window.__cablemanagementCombs.move(id, 'out', 1100, 300)
})
await settle()

// One pixel from the in-gate body (below the caret, off the pin column) and one
// from the caret apex, in graph coords mapped through the overlay transform.
const sample = () => page.evaluate(() => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const n = c.lanes.length
  const h = 24 + Math.max(2, n - 1) * 20
  const cx = c.in.pos[0] + 12, cy = c.in.pos[1] + h / 2
  const overlay = document.querySelector('.cablemanagement-gate-overlay')
  const { scale, offset } = window.app.canvas.ds
  const k = (window.devicePixelRatio || 1) * scale
  const px = (x, y) => {
    const d = overlay.getContext('2d').getImageData(Math.round(k * (x + offset[0])), Math.round(k * (y + offset[1])), 1, 1).data
    return [d[0], d[1], d[2], d[3]]
  }
  // Chrome-round caret: a FILLED rgba(0,0,0,0.45) triangle (information, not
  // interaction) -- sample its base side (solid) and take the darkest pixel.
  const ctx2 = overlay.getContext('2d')
  const a = ctx2.getImageData(Math.round(k * (cx - 2 + offset[0])) - 1, Math.round(k * (cy + offset[1])) - 1, 3, 3).data
  let apex = [255, 255, 255, 0]
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] > 0 && a[i] < apex[0]) apex = [a[i], a[i + 1], a[i + 2], a[i + 3]]
  }
  return { body: px(cx, cy + 8), apex }
})

const before = await sample()
ok('gate painted (body opaque)', before.body[3] > 200, JSON.stringify(before))

await page.evaluate(() => {
  const L = window.LiteGraph
  L.NODE_DEFAULT_BGCOLOR = '#204060' // sentinel body: rgb(32,64,96)
  L.NODE_TITLE_COLOR = '#ff4040' // sentinel chrome: red caret
})
await settle()
const after = await sample()
const near = (v, want) => Math.abs(v - want) <= 3
ok('body follows NODE_DEFAULT_BGCOLOR', near(after.body[0], 32) && near(after.body[1], 64) && near(after.body[2], 96), JSON.stringify(after.body))
// Ruling (chrome round): the caret is INFORMATION -- fixed semitransparent
// black over the body, deliberately NOT theme chrome. Dark over the sentinel.
ok('caret is the fixed dark overlay', after.apex[3] > 0 && after.apex[0] < after.body[0] - 6 && after.apex[1] < after.body[1] - 12, JSON.stringify({ apex: after.apex, body: after.body }))

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
