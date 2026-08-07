// Screenshot: collapsed node with a pass-through wire off its title point.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1200, height: 700 } })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const A = L.createNode('CLIPTextEncode'); A.pos = [120, 200]; A.title = 'A (will collapse)'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [700, 380]; B.title = 'B'; g.add(B)
  const wa = A.widgets.find(w => w.name === 'text'); wa.value = 'collapse test'
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id) }
})
const pin = await page.evaluate(i => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget')
  const r = p.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
const tgt = await page.evaluate(i => {
  const g = window.app.graph, B = g.getNodeById(Number(i.B))
  const k = B.inputs.findIndex(s => s.widget?.name === 'text')
  const d = document.querySelector(`[data-slot-key="${i.B}-in-${k}"]`)
  const r = d.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
await page.mouse.move(...pin); await page.mouse.down()
await page.mouse.move(tgt[0], tgt[1], { steps: 12 }); await page.waitForTimeout(300)
await page.mouse.up(); await page.waitForTimeout(1200)
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/collapse-1-expanded.png' })
await page.evaluate(async i => {
  window.app.graph.getNodeById(Number(i.A)).collapse()
  window.app.graph.setDirtyCanvas(true, true)
  await new Promise(r => setTimeout(r, 1200))
}, ids)
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/collapse-2-collapsed.png' })
console.log('shots written')
await b.close()
