// Barney's exact braid example (user/default/workflows/braids.json) in PCB mode:
// count crossings among routed traces and screenshot for eyeballing.
import { chromium } from 'playwright'
import fs from 'node:fs'
const wf = JSON.parse(fs.readFileSync('E:/Projects/ComfyUI-5/user/default/workflows/braids.json', 'utf8'))

const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1800, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const out = await page.evaluate(async (wfData) => {
  const app = window.app
  await app.loadGraphData(wfData)
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  app.graph.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 900))
  app.graph.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 900))
  return {
    links: app.graph._links.size,
    routes: window.__cablemanagementPathing.routes(),
    stats: window.__cablemanagementPathing.stats()
  }
}, wf)

const H = [], V = []
out.routes.forEach((r, ri) => {
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
console.log(`links=${out.links} routed=${out.routes.length} crossings=${n}`)
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/pathing-braids.png', fullPage: false })
console.log('page errors:', errs.length ? errs : 'none')
await b.close()
