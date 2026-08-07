// Does the ledger actually hide the machinery?
//  Case A: A->B exists; drag B' to C. Expect A->C re-anchored to B' (drawn from B's pin).
//  Case B: drag A' (widget) to B. Expect H->A suppressed, H->B re-anchored to A's pin.
import { chromium } from 'playwright'
import fs from 'node:fs'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1700, height: 950 } })
const errs = []; page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const installed = await page.evaluate(() => typeof window.app.canvas.constructor.prototype._renderAllLinkSegments === 'function')
console.log('patch point present:', installed)

// ---- Case A -------------------------------------------------------------------------
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  g.clear()
  const ck = L.createNode('CheckpointLoaderSimple'); ck.pos = [80, 120]; g.add(ck)
  const B = L.createNode('CLIPTextEncode'); B.pos = [520, 120]; B.title = 'B'; g.add(B)
  const C = L.createNode('CLIPTextEncode'); C.pos = [980, 120]; C.title = 'C'; g.add(C)
  ck.connect(1, B, 0)
  g.setDirtyCanvas(true, true)
  await new Promise(r => setTimeout(r, 1500))
  return { ck: String(ck.id), B: String(B.id), C: String(C.id) }
})
const pinA = await page.evaluate((ids) => {
  const p = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${ids.B}"][data-cablemanagement-index="0"]`)
  if (!p) return null; const r = p.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]
}, ids)
const tgt = await page.evaluate((ids) => {
  const d = document.querySelector(`[data-slot-key="${ids.C}-in-0"]`)
  const r = d.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]
}, ids)
await page.mouse.move(...pinA); await page.mouse.down(); await page.mouse.move(tgt[0], tgt[1], { steps: 12 }); await page.mouse.up()
await page.waitForTimeout(1200)

const caseA = await page.evaluate((ids) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(ids.C)), B = g.getNodeById(Number(ids.B))
  const link = C.inputs[0].link != null ? g.getLink(C.inputs[0].link) : null
  return {
    logicalOrigin: link ? String(link.origin_id) : null,
    expectedLogical: ids.ck,
    provenance: C.properties?.['cablemanagement.from'] ?? null,
    ledgerHasEntry: !!(window.__cablemanagementLedgerSize?.() ?? true),
  }
}, ids)
console.log('\nCASE A:', JSON.stringify(caseA, null, 2))
await page.screenshot({ path: 'ledger-caseA.png' })

// ---- Case B -------------------------------------------------------------------------
const ids2 = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  g.clear()
  const A = L.createNode('CLIPTextEncode'); A.pos = [140, 140]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [760, 140]; B.title = 'B'; g.add(B)
  g.setDirtyCanvas(true, true)
  await new Promise(r => setTimeout(r, 1500))
  return { A: String(A.id), B: String(B.id) }
})
const wpin = await page.evaluate((ids) => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(x => x.dataset.cablemanagementNode === ids.A && x.dataset.cablemanagementKind === 'widget')
  if (!p) return null; const r = p.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]
}, ids2)
const wtgt = await page.evaluate((ids) => {
  const g = window.app.graph, B = g.getNodeById(Number(ids.B))
  const i = B.inputs.findIndex(s => s.widget?.name === 'text')
  const d = document.querySelector(`[data-slot-key="${ids.B}-in-${i}"]`)
  const r = d.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]
}, ids2)
await page.mouse.move(...wpin); await page.mouse.down(); await page.mouse.move(wtgt[0], wtgt[1], { steps: 12 }); await page.mouse.up()
await page.waitForTimeout(1400)

const caseB = await page.evaluate((ids) => {
  const g = window.app.graph
  const prim = g.nodes.find(n => n.type === 'PrimitiveNode')
  const B = g.getNodeById(Number(ids.B))
  const i = B.inputs.findIndex(s => s.widget?.name === 'text')
  return {
    primitiveOwned: prim?.properties?.['cablemanagement.owned'] === true,
    primitiveLinks: (prim?.outputs?.[0]?.links ?? []).length,
    provenanceOnB: B.properties?.['cablemanagement.from'] ?? null,
    primHidden: (() => { const el = document.querySelector(`.lg-node[data-node-id="${prim?.id}"]`); return el ? getComputedStyle(el).visibility === 'hidden' : null })(),
  }
}, ids2)
console.log('\nCASE B:', JSON.stringify(caseB, null, 2))
await page.screenshot({ path: 'ledger-caseB.png' })
console.log('\npage errors:', errs.length); errs.slice(0,6).forEach(e => console.log('  ' + e.slice(0,150)))
console.log('LEDGER:', JSON.stringify(await page.evaluate(() => window.__cablemanagement?.ledger()), null, 2))
await b.close()
