// Strand 2A: does dragging a pass-through pin hand over to CORE's drag?
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []; page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  g.clear()
  const ck = L.createNode('CheckpointLoaderSimple'); ck.pos=[80,120]; g.add(ck)
  const B = L.createNode('CLIPTextEncode'); B.pos=[520,120]; B.title='B'; g.add(B)
  const C = L.createNode('CLIPTextEncode'); C.pos=[980,120]; C.title='C'; g.add(C)
  ck.connect(1, B, 0); g.setDirtyCanvas(true,true)
  await new Promise(r=>setTimeout(r,1700))
  return { ck:String(ck.id), B:String(B.id), C:String(C.id) }
})
const from = await page.evaluate(i => { const p=document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${i.B}"][data-cablemanagement-index="0"]`); const r=p.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2] }, ids)
const to = await page.evaluate(i => { const d=document.querySelector(`[data-slot-key="${i.C}-in-0"]`); const r=d.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2] }, ids)

await page.mouse.move(...from)
await page.mouse.down()
await page.mouse.move(from[0]+60, from[1]+40, { steps: 6 })
const mid = await page.evaluate(() => ({
  coreRenderLinks: window.app.canvas?.linkConnector?.renderLinks?.length ?? 0,
  coreIsConnecting: !!window.app.canvas?.linkConnector?.isConnecting,
  ourSvgExists: document.querySelectorAll('.cablemanagement-overlay').length,
  pinsPointerNone: getComputedStyle(document.querySelector('.cablemanagement-pin')).pointerEvents,
  bodyDragging: document.body.classList.contains('cablemanagement-dragging'),
}))
await page.mouse.move(to[0], to[1], { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(1000)

const after = await page.evaluate(async (i) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(i.C))
  const link = C.inputs[0].link != null ? g.getLink(C.inputs[0].link) : null
  const p = await window.app.graphToPrompt()
  return {
    connected: !!link,
    logicalOrigin: link ? String(link.origin_id) : null,
    expected: i.ck,
    provenance: C.properties?.['cablemanagement.from'] ?? null,
    promptClip: p.output[i.C]?.inputs?.clip ?? null,
    ledger: window.__cablemanagement?.ledger(),
  }
}, ids)

console.log('mid-drag :', JSON.stringify(mid))
console.log('after    :', JSON.stringify({ ...after, ledger: { size: after.ledger?.size, applied: after.ledger?.applied } }, null, 2))
const ok = mid.coreRenderLinks > 0 && mid.ourSvgExists === 0 && mid.pinsPointerNone === 'none' &&
           after.connected && after.logicalOrigin === after.expected && after.provenance && after.ledger?.size > 0
console.log('\n' + (ok ? 'NATIVE DRAG HANDOVER WORKS' : 'NOT working'))
console.log('page errors:', errs.length); errs.slice(0,5).forEach(e=>console.log('  '+e.slice(0,140)))
await b.close()
