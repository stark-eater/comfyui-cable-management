// COMBO pass-through: drag ckpt_name from loader A onto loader B's ckpt_name input.
// The primitive must carry a combo widget and both loaders must resolve to the same file.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const A = L.createNode('CheckpointLoaderSimple'); A.pos = [140, 140]; A.title = 'A'; g.add(A)
  const B = L.createNode('CheckpointLoaderSimple'); B.pos = [760, 140]; B.title = 'B'; g.add(B)
  const wa = A.widgets.find(w => w.name === 'ckpt_name')
  const values = typeof wa.options?.values === 'function' ? wa.options.values() : (wa.options?.values ?? [])
  const chosen = values[values.length - 1] ?? null
  if (chosen != null) { wa.value = chosen; wa.callback?.(chosen) }
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id), chosen, nValues: values.length }
})
console.log('combo values:', ids.nValues, '| chosen:', JSON.stringify(ids.chosen))
const pin = await page.evaluate(i => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget' && x.title.startsWith('ckpt_name'))
  if (!p) return null
  const r = p.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
if (!pin) { console.log('FAIL: no ckpt_name widget pin'); await b.close(); process.exit(1) }
const tgt = await page.evaluate(i => {
  const g = window.app.graph, B = g.getNodeById(Number(i.B))
  const k = B.inputs.findIndex(s => s.widget?.name === 'ckpt_name')
  const d = document.querySelector(`[data-slot-key="${i.B}-in-${k}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
if (!tgt) { console.log('FAIL: no target slot dot'); await b.close(); process.exit(1) }
await page.mouse.move(...pin); await page.mouse.down()
await page.mouse.move(tgt[0], tgt[1], { steps: 12 }); await page.waitForTimeout(300)
await page.mouse.up(); await page.waitForTimeout(1200)
const after = await page.evaluate(async i => {
  const g = window.app.graph
  const prim = g.nodes.find(n => n.type === 'PrimitiveNode')
  const B = g.getNodeById(Number(i.B))
  const k = B.inputs.findIndex(s => s.widget?.name === 'ckpt_name')
  const p = await window.app.graphToPrompt()
  return {
    prims: g.nodes.filter(n => n.type === 'PrimitiveNode').length,
    primWidgetType: prim?.widgets?.[0]?.type ?? null,
    primValue: prim?.widgets?.[0]?.value ?? null,
    bLinked: B.inputs[k].link != null,
    provenance: B.properties?.['cablemanagement.from']?.[String(k)] ?? null,
    aCkpt: p.output[i.A]?.inputs?.ckpt_name,
    bCkpt: p.output[i.B]?.inputs?.ckpt_name,
  }
}, ids)
console.log('after:', JSON.stringify(after, null, 1))
const pass = after.prims === 1 && after.bLinked && after.primWidgetType === 'combo' &&
  (ids.chosen == null || (after.aCkpt === ids.chosen && after.bCkpt === ids.chosen))
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
