// Barney's screenshot repro: SuperEfficientLoader feeding RemoteController with a
// same-order 4-wire bundle (MODEL/CLIP/VAE/ckpt_name), three spatial arrangements:
// side-by-side tight, diagonal, above. Measures: routed-vs-fallback per link, crossing
// count, and lane/fillet cramping.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1800, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

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
  const detail = []
  for (const h of H) for (const v of V) {
    if (h.ri === v.ri) continue
    if (v.x > h.lo + 1 && v.x < h.hi - 1 && h.y > v.lo + 1 && h.y < v.hi - 1) {
      n++
      detail.push(`r${h.ri}xH r${v.ri}V at (${Math.round(v.x)},${Math.round(h.y)})`)
    }
  }
  return { n, detail }
}

const out = await page.evaluate(async () => {
  const app = window.app
  const g = app.graph
  const L = window.LiteGraph
  g.clear()
  const mkPair = (lx, ly, tx, ty) => {
    const A = L.createNode('SuperEfficientLoader'); A.pos = [lx, ly]; g.add(A)
    const B = L.createNode('RemoteController'); B.pos = [tx, ty]; g.add(B)
    const names = ['model', 'clip', 'vae', 'checkpoint_name']
    for (let s = 0; s < 4; s++) {
      const k = B.inputs.findIndex((i) => i.name === names[s])
      if (k >= 0) A.connect(s, B, k)
    }
    return [A, B]
  }
  // 1: side-by-side tight (his bottom-left), 2: diagonal (his middle), 3: above (his top-right)
  mkPair(100, 700, 420, 640)
  mkPair(560, 260, 900, 380)
  mkPair(1180, 120, 1420, 260)
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  // Ghost grace: ~6 forced draws or the dump holds default-position twins (README trap).
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 300)) }
  const routes = window.__cablemanagementPathing.routes()
  return {
    links: g._links.size,
    routed: routes.length,
    routes,
    stats: window.__cablemanagementPathing.stats(),
    mode: app.canvas.links_render_mode
  }
})
console.log(`links=${out.links} routed=${out.routed} mode=${out.mode} obstacles=${out.stats.obstacles}`)
const cx = crossings(out.routes)
console.log('crossings =', cx.n)
for (const d of cx.detail) console.log('  ', d)
for (const r of out.routes.slice(0, 12)) {
  const segs = []
  for (let k = 1; k < r.pts.length; k++) {
    const d = Math.round(Math.hypot(r.pts[k][0] - r.pts[k - 1][0], r.pts[k][1] - r.pts[k - 1][1]))
    segs.push(d)
  }
  console.log(` ${r.key.split('|')[0]}: pts=${r.pts.length} seglens=[${segs.join(',')}]`)
}
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/pathing-adjacent.png' })
console.log('page errors:', errs.length ? errs : 'none')
await b.close()
