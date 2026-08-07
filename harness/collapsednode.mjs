// Collapsed nodes: pass-through pins must collapse to a single point beside the title bar,
// ledger wires must anchor there, and both must follow the node while it is dragged.
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
  const wa = A.widgets.find(w => w.name === 'text'); wa.value = 'collapse test'
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id) }
})
// Wire A.text pass-through onto B.text so a ledger-anchored wire exists.
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

// Collapse A via its litegraph flag (same thing the header button toggles).
const collapsed = await page.evaluate(async i => {
  const g = window.app.graph, A = g.getNodeById(Number(i.A))
  A.collapse()
  g.setDirtyCanvas(true, true)
  await new Promise(r => setTimeout(r, 1200))
  const el = document.querySelector(`.lg-node[data-node-id="${i.A}"]`)
  const pins = [...document.querySelectorAll(`.cablemanagement-pin[data-cablemanagement-node="${i.A}"]`)]
  const nr = el.getBoundingClientRect()
  const anchor = window.__cablemanagement.ledger().values?.[0]
  return {
    domCollapsed: el.dataset.collapsed === 'true',
    nodeRect: { w: Math.round(nr.width), h: Math.round(nr.height) },
    pins: pins.map(p => {
      const r = p.getBoundingClientRect()
      return { collapsed: p.dataset.cablemanagementCollapsed === '1', x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }),
    ledgerSize: window.__cablemanagement.ledger().size,
  }
}, ids)
console.log('collapsed:', JSON.stringify(collapsed))

// Drag the collapsed node and confirm the pin (= wire anchor) follows.
const before = collapsed.pins[0]
const head = await page.evaluate(i => {
  const el = document.querySelector(`.lg-node[data-node-id="${i.A}"]`)
  const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
await page.mouse.move(...head); await page.mouse.down()
await page.mouse.move(head[0] + 120, head[1] + 90, { steps: 8 }); await page.mouse.up()
await page.waitForTimeout(900)
const after = await page.evaluate(i => {
  const p = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${i.A}"]`)
  const r = p?.getBoundingClientRect()
  const g = window.app.graph, B = g.getNodeById(Number(i.B))
  const k = B.inputs.findIndex(s => s.widget?.name === 'text')
  return {
    pin: r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null,
    bLinked: B.inputs[k].link != null,
    ledgerSize: window.__cablemanagement.ledger().size,
  }
}, ids)
console.log('after drag:', JSON.stringify(after))
const moved = after.pin && (after.pin.x - before.x) > 80 && (after.pin.y - before.y) > 60
const pass = collapsed.domCollapsed && collapsed.pins.length === 1 && collapsed.pins[0].collapsed &&
  collapsed.ledgerSize === 1 && moved && after.bLinked && after.ledgerSize === 1
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
