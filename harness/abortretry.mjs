// Abort a widget-pin drag (link-release CONTEXT MENU dismissed without choosing),
// then retry and drop on B. The retry must work and the graph must end with exactly
// one primitive, linked. Comfy.LinkRelease.Action is context menu BY DECREE
// (Barney, 2026-08-06: the pack's suggested-next-node hooks it); the suite pins
// the setting so a fresh install cannot regress it.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
await page.evaluate(async () => {
  await window.app.extensionManager?.setting?.set?.('Comfy.LinkRelease.Action', 'context menu')
})
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const A = L.createNode('CLIPTextEncode'); A.pos = [140, 140]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [760, 140]; B.title = 'B'; g.add(B)
  const wa = A.widgets.find(w => w.name === 'text'); wa.value = 'abort retry test'
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id) }
})
const getPin = () => page.evaluate(i => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget')
  if (!p) return null
  const r = p.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)

// Gesture 1: drag to empty, release menu opens, dismissed by clicking elsewhere
// (Escape does not resolve the menu; the canceled connector reset only re-fires
// when the menu closes).
const pin1 = await getPin()
await page.mouse.move(...pin1); await page.mouse.down()
await page.mouse.move(pin1[0] + 60, pin1[1] + 260, { steps: 10 }); await page.waitForTimeout(400)
await page.mouse.up()
let sawBox = true
try {
  await page.waitForSelector('.litecontextmenu', { timeout: 5000 })
} catch { sawBox = false }
await page.mouse.click(pin1[0] + 500, pin1[1] + 420)
await page.waitForTimeout(800)
const mid = await page.evaluate(() => ({
  prims: window.app.graph.nodes.filter(n => n.type === 'PrimitiveNode').length,
  dragging: document.body.classList.contains('cablemanagement-dragging'),
}))

// Gesture 2: same pin, drop on B's text input.
const pin2 = await getPin()
const tgt = await page.evaluate(i => {
  const g = window.app.graph, B = g.getNodeById(Number(i.B))
  const k = B.inputs.findIndex(s => s.widget?.name === 'text')
  const d = document.querySelector(`[data-slot-key="${i.B}-in-${k}"]`)
  const r = d.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
await page.mouse.move(...pin2); await page.mouse.down()
await page.mouse.move(tgt[0], tgt[1], { steps: 12 }); await page.waitForTimeout(300)
await page.mouse.up()
await page.waitForTimeout(1200)
const end = await page.evaluate(async i => {
  const g = window.app.graph, B = g.getNodeById(Number(i.B))
  const k = B.inputs.findIndex(s => s.widget?.name === 'text')
  const p = await window.app.graphToPrompt()
  return {
    prims: g.nodes.filter(n => n.type === 'PrimitiveNode').length,
    bLinked: B.inputs[k].link != null,
    provenance: B.properties?.['cablemanagement.from']?.[String(k)] ?? null,
    bText: p.output[i.B]?.inputs?.text,
    dragging: document.body.classList.contains('cablemanagement-dragging'),
  }
}, ids)
console.log('release menu appeared:', sawBox)
console.log('after abort :', JSON.stringify(mid))
console.log('after retry :', JSON.stringify(end))
const pass = sawBox && end.prims === 1 && end.bLinked && end.bText === 'abort retry test' && !end.dragging
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
