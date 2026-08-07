// Screenshots of the collapse polish: hover carets, collapsed drawer with ellipsis.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [80, 120]; g.add(CK)
  const K = L.createNode('KSampler'); K.pos = [560, 120]; g.add(K)
  CK.connect(0, K, K.inputs.findIndex(s => s.type === 'MODEL'))
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { CK: String(CK.id), K: String(K.id) }
})
const kRect = () => page.evaluate(i => {
  const r = document.querySelector(`.lg-node[data-node-id="${i.K}"]`).getBoundingClientRect()
  return { x: Math.max(0, r.x - 40), y: Math.max(0, r.y - 20), width: r.width + 80, height: r.height + 60 }
}, ids)
// hover the node so the carets show
let r = await kRect()
await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
await page.waitForTimeout(400)
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/polish-1-open-hover.png', clip: await kRect() })
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.K}"] .cablemanagement-collapse[data-which="inputs"]`)?.click(), ids)
await page.waitForTimeout(700)
r = await kRect()
await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
await page.waitForTimeout(300)
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/polish-2-collapsed.png', clip: await kRect() })
// away from the node: carets hide, ellipsis stays
await page.mouse.move(30, 800)
await page.waitForTimeout(400)
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/polish-3-collapsed-nohover.png', clip: await kRect() })
console.log('shots written')
await b.close()
