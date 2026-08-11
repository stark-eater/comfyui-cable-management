// Value propagation: A's widget -> hidden primitive -> B's prompt input.
// Includes the adversarial case: edit A AFTER the link exists, with no DOM mutation to
// wake the sync loop, then build the prompt immediately.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const A = L.createNode('CLIPTextEncode'); A.pos = [140, 140]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [760, 140]; B.title = 'B'; g.add(B)
  const wa = A.widgets.find(w => w.name === 'text')
  wa.value = 'hello from A'; wa.callback?.(wa.value)
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
await page.mouse.move(tgt[0], tgt[1], { steps: 12 }); await page.waitForTimeout(200); await page.mouse.up()
await page.waitForTimeout(1200)
const first = await page.evaluate(async i => {
  const p = await window.app.graphToPrompt()
  return { aText: p.output[i.A]?.inputs?.text, bText: p.output[i.B]?.inputs?.text }
}, ids)
// Now the stale-mirror case: change A's value and build the prompt in the SAME evaluate,
// no waits, no DOM churn -- the sync loop cannot have run in between.
const second = await page.evaluate(async i => {
  const g = window.app.graph, A = g.getNodeById(Number(i.A))
  const wa = A.widgets.find(w => w.name === 'text')
  wa.value = 'edited later'
  const p = await window.app.graphToPrompt()
  const prim = g.nodes.find(n => n.type === 'PrimitiveNode')
  return {
    aText: p.output[i.A]?.inputs?.text, bText: p.output[i.B]?.inputs?.text,
    primValue: prim?.widgets?.[0]?.value, hooked: !!prim?.__cablemanagementApply,
  }
}, ids)
console.log('first :', JSON.stringify(first))
console.log('second:', JSON.stringify(second))
const pass = first.bText === 'hello from A' && second.bText === 'edited later'
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
