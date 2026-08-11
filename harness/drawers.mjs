// Drawer state persistence: collapse survives serialize -> reload -> loadGraphData,
// and expanding removes the property so untouched nodes serialise clean. The collapsible
// row is LatentCompositeMasked's optional mask (only unlinked OPTIONAL inputs hide).
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1400, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const E = L.createNode('EmptyLatentImage'); E.pos = [80, 120]; g.add(E)
  const LCM = L.createNode('LatentCompositeMasked'); LCM.pos = [560, 120]; g.add(LCM)
  E.connect(0, LCM, LCM.inputs.findIndex(s => s.name === 'destination'))
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { E: String(E.id), LCM: String(LCM.id) }
})
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.LCM}"] .cablemanagement-collapse[data-which="inputs"]`)?.click(), ids)
await page.waitForTimeout(700)
const saved = await page.evaluate(i => {
  const s = window.app.graph.serialize()
  const n = s.nodes.find(x => String(x.id) === i.LCM)
  return { snapshot: s, prop: n?.properties?.['cablemanagement.drawers'] ?? null }
}, ids)
console.log('serialized prop:', JSON.stringify(saved.prop))

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)
const after = await page.evaluate(async ({ snapshot, ids }) => {
  await window.app.loadGraphData(snapshot)
  await new Promise(r => setTimeout(r, 2000))
  const el = document.querySelector(`.lg-node[data-node-id="${ids.LCM}"]`)
  const rows = [...el.querySelectorAll('.lg-slot--input')]
  return {
    state: el.dataset.cablemanagementInputs,
    hidden: rows.filter(r => r.getBoundingClientRect().height < 1).length,
    more: !!el.querySelector('.cablemanagement-more[data-which="inputs"]'),
    caret: el.querySelector('.cablemanagement-collapse[data-which="inputs"]')?.textContent,
  }
}, { snapshot: saved.snapshot, ids })
console.log('after reload:', JSON.stringify(after))
// Expand via the ellipsis; the property must vanish from the next serialize.
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.LCM}"] .cablemanagement-more[data-which="inputs"]`)?.click(), ids)
await page.waitForTimeout(700)
const clean = await page.evaluate(i => {
  const s = window.app.graph.serialize()
  const n = s.nodes.find(x => String(x.id) === i.LCM)
  return { prop: n?.properties?.['cablemanagement.drawers'] ?? null, state: document.querySelector(`.lg-node[data-node-id="${i.LCM}"]`).dataset.cablemanagementInputs }
}, ids)
console.log('after expand:', JSON.stringify(clean))
const pass = saved.prop?.inputs === true && after.state === 'collapsed' && after.hidden > 0 &&
  after.more && after.caret === '▴' && clean.prop === null && clean.state === 'open'
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
