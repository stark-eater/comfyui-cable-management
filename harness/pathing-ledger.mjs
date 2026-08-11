// Ledger composition: a widget pass-through link (hidden owned primitive H -> B,
// re-anchored by the ledger to A's pin) must ROUTE from the pin position, not from H.
// H parks inside A's footprint at primitive width (~210px); the pin sits at A's right
// edge (~400px wide node), so the two are distinguishable by x.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const A = L.createNode('CLIPTextEncode'); A.pos = [140, 140]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [820, 480]; B.title = 'B'; g.add(B)
  A.widgets.find((w) => w.name === 'text').value = 'ledger + pathing'
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id) }
})
const pin = await page.evaluate((i) => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find((x) => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget')
  const r = p.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
const tgt = await page.evaluate((i) => {
  const B = window.app.graph.getNodeById(Number(i.B))
  const k = B.inputs.findIndex((s) => s.widget?.name === 'text')
  const d = document.querySelector(`[data-slot-key="${i.B}-in-${k}"]`)
  const r = d.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
await page.mouse.move(...pin); await page.mouse.down()
await page.mouse.move(tgt[0], tgt[1], { steps: 12 }); await page.waitForTimeout(300)
await page.mouse.up(); await page.waitForTimeout(1200)

const out = await page.evaluate(async (i) => {
  const app = window.app
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  app.graph.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 700))
  app.graph.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 700))
  const A = app.graph.getNodeById(Number(i.A))
  const routes = window.__cablemanagementPathing.routes()
  const rightEdge = A.pos[0] + A.size[0]
  const visible = routes.filter((r) => r.pts[0][0] > rightEdge - 40 && r.pts[0][0] < rightEdge + 60)
  return {
    routes: routes.length,
    fromPin: visible.length >= 1,
    startX: routes.map((r) => Math.round(r.pts[0][0])),
    rightEdge: Math.round(rightEdge)
  }
}, ids)
console.log(JSON.stringify(out), '| page errors:', errs.length)
console.log(out.fromPin && errs.length === 0 ? 'PASS' : 'FAIL')
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/pathing-ledger.png' })
await b.close()
