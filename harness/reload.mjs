// Save/reload roundtrip. A widget pass-through must survive serialization: the owned
// primitive reloads (with its consumer link), stays hidden, the ledger re-anchors from
// provenance, and prompt values still flow host -> primitive -> consumer.
// Then disable the extension: the primitive must become an ordinary visible node.
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
  const A = L.createNode('CLIPTextEncode'); A.pos = [140, 140]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [760, 140]; B.title = 'B'; g.add(B)
  const wa = A.widgets.find(w => w.name === 'text'); wa.value = 'roundtrip'
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

const saved = await page.evaluate(() => window.app.graph.serialize())
console.log('saved nodes:', saved.nodes.map(n => `${n.id}:${n.type}`).join(', '))

// Fresh page, load the saved workflow.
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)
const after = await page.evaluate(async ({ saved, ids }) => {
  await window.app.loadGraphData(saved)
  await new Promise(r => setTimeout(r, 2000))
  const g = window.app.graph
  const prim = g.nodes.find(n => n.type === 'PrimitiveNode')
  const B = g.getNodeById(Number(ids.B))
  const k = B.inputs.findIndex(s => s.widget?.name === 'text')
  const primEl = prim && document.querySelector(`.lg-node[data-node-id="${prim.id}"]`)
  const p = await window.app.graphToPrompt()
  // Edit A, prompt again immediately (prompt-time mirror must cover it).
  const A = g.getNodeById(Number(ids.A))
  A.widgets.find(w => w.name === 'text').value = 'post-reload edit'
  const p2 = await window.app.graphToPrompt()
  return {
    prims: g.nodes.filter(n => n.type === 'PrimitiveNode').length,
    owned: prim?.properties?.['cablemanagement.owned'] === true,
    primWidget: prim?.widgets?.[0]?.value,
    primHidden: primEl ? primEl.style.visibility === 'hidden' : null,
    bLinked: B.inputs[k].link != null,
    provenance: B.properties?.['cablemanagement.from']?.[String(k)] ?? null,
    ledger: window.__cablemanagement?.ledger()?.size ?? 0,
    bText: p.output[ids.B]?.inputs?.text,
    bText2: p2.output[ids.B]?.inputs?.text,
  }
}, { saved, ids })
console.log('after reload:', JSON.stringify(after, null, 1))

// Disable the extension: the primitive must show up as a normal node.
const disabled = await page.evaluate(async () => {
  await window.app.extensionManager.setting.set('cablemanagement.enabled', false)
  await new Promise(r => setTimeout(r, 800))
  const prim = window.app.graph.nodes.find(n => n.type === 'PrimitiveNode')
  const el = prim && document.querySelector(`.lg-node[data-node-id="${prim.id}"]`)
  return {
    visible: el ? el.style.visibility !== 'hidden' : null,
    pins: document.querySelectorAll('.cablemanagement-pin').length,
  }
})
// Restore for later tests.
await page.evaluate(() => window.app.extensionManager.setting.set('cablemanagement.enabled', true))
console.log('disabled     :', JSON.stringify(disabled))

const pass = after.prims === 1 && after.owned && after.primHidden === true && after.bLinked &&
  after.bText === 'roundtrip' && after.bText2 === 'post-reload edit' &&
  after.ledger >= 1 && disabled.visible === true && disabled.pins === 0
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
