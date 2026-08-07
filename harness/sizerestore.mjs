// A drawer-collapsed node resized below its expanded minimum must come back at the SAVED
// height after load -- core clamps it to the expanded content before collapse styling
// applies, and the extension re-applies the saved size once the rows are hidden.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1400, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [120, 120]; g.add(CK)
  const K = L.createNode('KSampler'); K.pos = [640, 120]; g.add(K)
  CK.connect(0, K, K.inputs.findIndex(s => s.type === 'MODEL'))
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { K: String(K.id), expandedH: Math.round(g.getNodeById(K.id).size[1]) }
})
console.log('expanded height:', ids.expandedH)
// Collapse inputs, then resize below the expanded minimum.
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.K}"] .cablemanagement-collapse[data-which="inputs"]`)?.click(), ids)
await page.waitForTimeout(800)
const shrunk = await page.evaluate(async i => {
  const g = window.app.graph, K = g.getNodeById(Number(i.K))
  const target = Math.round(i.expandedH - 100)
  if (typeof K.setSize === 'function') K.setSize([K.size[0], target])
  else K.size[1] = target
  g.setDirtyCanvas(true, true)
  await new Promise(r => setTimeout(r, 900))
  const el = document.querySelector(`.lg-node[data-node-id="${i.K}"]`)
  return { target, size: Math.round(K.size[1]), domH: Math.round(el.getBoundingClientRect().height) }
}, ids)
console.log('after shrink:', JSON.stringify(shrunk))
const saved = await page.evaluate(() => window.app.graph.serialize())
const savedH = Math.round(saved.nodes.find(n => String(n.id) === ids.K).size[1])
console.log('serialized height:', savedH)

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)
const after = await page.evaluate(async ({ saved, ids }) => {
  await window.app.loadGraphData(saved)
  await new Promise(r => setTimeout(r, 2500))
  const g = window.app.graph, K = g.getNodeById(Number(ids.K))
  const el = document.querySelector(`.lg-node[data-node-id="${ids.K}"]`)
  return {
    size: Math.round(K.size[1]),
    domH: Math.round(el.getBoundingClientRect().height),
    state: el.dataset.cablemanagementInputs,
  }
}, { saved, ids })
console.log('after reload:', JSON.stringify(after))
// The node can only shrink to its COLLAPSED content minimum; what matters is that the
// saved height sits below the EXPANDED minimum and survives the load un-clamped.
const pass = savedH < ids.expandedH - 20 && after.state === 'collapsed' &&
  after.size <= savedH + 6 && after.domH <= savedH + 10
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
