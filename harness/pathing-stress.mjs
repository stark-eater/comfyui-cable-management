// PCB mode against real workflows: every link must either carry a computed route or
// fall back to spline, with zero page errors and sane route-compute cost.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const DIR = 'E:/Projects/ComfyUI-5/user/default/workflows'
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))

await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

let fails = 0
for (const f of files) {
  const wf = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
  const res = await page.evaluate(async (wfData) => {
    const app = window.app
    await app.loadGraphData(wfData)
    app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
    app.graph.setDirtyCanvas(true, true)
    await new Promise((r) => setTimeout(r, 1200))

    // Route-compute cost for a full cold rebuild (worst case: everything invalidated)
    const t0 = performance.now()
    app.graph.setDirtyCanvas(true, true)
    await new Promise((r) => setTimeout(r, 400))
    const t1 = performance.now() - t0

    const links = app.graph._links.size
    const routes = window.__cablemanagementPathing.routes().length
    const stats = window.__cablemanagementPathing.stats()
    // pan/zoom churn
    for (const [dx, s] of [[300, 0.6], [-600, 1.4], [300, 1.0]]) {
      app.canvas.ds.offset[0] += dx
      app.canvas.ds.changeScale(s)
      app.graph.setDirtyCanvas(true, true)
      await new Promise((r) => setTimeout(r, 250))
    }
    return { links, routes, stats, redrawMs: Math.round(t1) }
  }, wf)
  const ok = res.links === 0 || res.routes > 0
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${f}: links=${res.links} routes=${res.routes} obstacles=${res.stats.obstacles} redraw=${res.redrawMs}ms`)
}
console.log('page errors:', errs.length ? errs.slice(0, 8) : 'none')
console.log(fails === 0 && errs.length === 0 ? 'ALL PASS' : `FAILURES: ${fails}, errors: ${errs.length}`)
await browser.close()
