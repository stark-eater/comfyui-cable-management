// Master-toggle lifecycle + undo liveness (the everything-else batch):
// (1) OFF is stock everywhere -- hidden primitive becomes visible, pins leave, the
//     ledger pass goes honest (no re-anchoring, no SUPPRESS), sync passes stop;
// (2) ON restores all of it;
// (3) drawer buttons stay live across undo -- handlers resolve the node at click
//     time (undo replaces LGraphNode instances while Vue reuses the DOM).
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

// Widget passthrough via a real pin drag (A.ckpt_name -> B.ckpt_name).
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const A = L.createNode('CheckpointLoaderSimple'); A.pos = [80, 100]; g.add(A)
  const B = L.createNode('CheckpointLoaderSimple'); B.pos = [700, 100]; g.add(B)
  const E = L.createNode('EmptyLatentImage'); E.pos = [80, 500]; g.add(E)
  const LCM = L.createNode('LatentCompositeMasked'); LCM.pos = [700, 460]; g.add(LCM)
  E.connect(0, LCM, LCM.inputs.findIndex(s => s.name === 'destination'))
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1800))
  return { A: String(A.id), B: String(B.id), LCM: String(LCM.id), bIdx: B.inputs.findIndex(s => s.widget?.name === 'ckpt_name') }
})
const pin = await page.evaluate(i => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget'
  )
  const r = el?.getBoundingClientRect()
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
}, ids)
const tgt = await page.evaluate(i => {
  const r = document.querySelector(`[data-slot-key="${i.B}-in-${i.bIdx}"]`).getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}, ids)
await page.mouse.move(pin.x, pin.y); await page.mouse.down()
await page.mouse.move(tgt.x, tgt.y, { steps: 12 }); await page.waitForTimeout(300)
await page.mouse.up(); await page.waitForTimeout(1200)

const state = (label) => page.evaluate(() => {
  const g = window.app.graph
  const prim = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  const el = prim && document.querySelector(`.lg-node[data-node-id="${prim.id}"]`)
  return {
    prim: !!prim,
    hidden: el ? el.style.visibility === 'hidden' : null,
    pins: document.querySelectorAll('.cablemanagement-pin').length,
    ledger: window.__cablemanagement.ledger().size,
    syncs: window.__cablemanagement.syncs(),
  }
})
const on1 = await state()
ok('ON: primitive hidden, pins live, ledger active', on1.prim && on1.hidden === true && on1.pins > 0 && on1.ledger > 0, JSON.stringify(on1))

// (1) toggle OFF
await page.evaluate(async () => {
  await window.app.extensionManager.setting.set('cablemanagement.enabled', false)
})
await page.waitForTimeout(800)
const off = await state()
await page.evaluate(() => { window.app.graph.setDirtyCanvas(true, true) })
await page.waitForTimeout(400)
const off2 = await state()
ok('OFF: primitive visible, pins gone, ledger empty', off.prim && off.hidden === false && off.pins === 0 && off.ledger === 0, JSON.stringify(off))
ok('OFF: sync passes stop', off2.syncs === off.syncs, `${off.syncs} -> ${off2.syncs}`)

// (2) toggle ON
await page.evaluate(async () => {
  await window.app.extensionManager.setting.set('cablemanagement.enabled', true)
})
await page.waitForTimeout(1000)
const on2 = await state()
ok('ON again: machinery hides, pins and ledger return', on2.hidden === true && on2.pins > 0 && on2.ledger > 0, JSON.stringify(on2))

// (3) drawer caret stays live across undo. The tracker still holds whatever graph a
// PREVIOUS session captured -- checkpoint the built scene first or Ctrl+Z restores that.
await page.evaluate(() => {
  const t = window.app.extensionManager?.workflow?.activeWorkflow?.changeTracker
  ;(t?.captureCanvasState ?? t?.checkState)?.call(t)
})
await page.waitForTimeout(400)
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.LCM}"] .cablemanagement-collapse[data-which="inputs"]`)?.click(), ids)
await page.waitForTimeout(700)
const c1 = await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.LCM}"]`)?.dataset.cablemanagementInputs, ids)
ok('drawer collapses', c1 === 'collapsed', c1)
await page.keyboard.press('Control+z')
await page.waitForTimeout(1500)
const c2 = await page.evaluate(i => ({
  state: document.querySelector(`.lg-node[data-node-id="${i.LCM}"]`)?.dataset.cablemanagementInputs ?? null,
  el: !!document.querySelector(`.lg-node[data-node-id="${i.LCM}"]`),
  nodes: window.app.graph.nodes.length,
  els: document.querySelectorAll('.lg-node').length,
  prop: window.app.graph.getNodeById(Number(i.LCM))?.properties?.['cablemanagement.drawers'] ?? null,
}), ids)
ok('undo reopens the drawer', c2.state === 'open' && c2.prop === null, JSON.stringify(c2))
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.LCM}"] .cablemanagement-collapse[data-which="inputs"]`)?.click(), ids)
await page.waitForTimeout(700)
const c3 = await page.evaluate(i => ({
  state: document.querySelector(`.lg-node[data-node-id="${i.LCM}"]`)?.dataset.cablemanagementInputs,
  prop: window.app.graph.getNodeById(Number(i.LCM))?.properties?.['cablemanagement.drawers']?.inputs ?? null,
}), ids)
ok('caret still LIVE after undo (resolves node at click time)', c3.state === 'collapsed' && c3.prop === true, JSON.stringify(c3))

console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
