// Trace the widget-pin drag handover: what does tryForward see, frame by frame?
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
const logs = []
page.on('console', m => { const t = m.text(); if (t.includes('cablemanagement')) logs.push(t.slice(0, 160)) })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const A = L.createNode('CLIPTextEncode'); A.pos = [140, 140]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [760, 140]; B.title = 'B'; g.add(B)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id) }
})
const pin = await page.evaluate(i => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget')
  if (!p) return null
  const r = p.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
console.log('pin:', JSON.stringify(pin))
if (!pin) { console.log('NO WIDGET PIN'); await b.close(); process.exit(1) }
await page.mouse.move(...pin); await page.mouse.down()
await page.mouse.move(pin[0] + 80, pin[1] + 30, { steps: 5 })
await page.waitForTimeout(500)
const trace = await page.evaluate(() => window.__cablemanagementTrace ?? null)
console.log('trace:', JSON.stringify(trace, null, 1))
await page.mouse.up()
await page.waitForTimeout(500)
console.log('page errors:', errs.length); errs.slice(0, 5).forEach(e => console.log('  ' + e.slice(0, 160)))
logs.slice(0, 5).forEach(l => console.log('  console: ' + l))
await b.close()
