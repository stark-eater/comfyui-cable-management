// Debug view: the truth under the illusion. With the view OFF nothing extra
// draws and machinery stays invisible; ON, every ledger-altered link paints its
// real wire (counted via __cablemanagementDebugDraws) and hidden primitives
// ghost at 0.35 opacity, still untouchable; OFF again restores full stealth.
// Toggled through the runtime hook (no settings write); the settings checkbox
// is asserted to exist but never flipped -- suites must not persist state.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2100, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement, null, { timeout: 120_000 })
await page.evaluate(() => window.__cablemanagement?.debugView?.(false)) // operator may test with debug view on; assert against stealth
await page.waitForTimeout(2600)

async function drag(from, to) {
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(900)
}
const pinPos = (id, kind) => page.evaluate(({ id, kind }) => {
  const p = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-kind="${kind}"]`)
  if (!p) return null
  const r = p.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, kind })
const dotPos = (id, idx) => page.evaluate(({ id, idx }) => {
  const d = document.querySelector(`[data-slot-key="${id}-in-${idx}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })

// Scene: widget pass-through (hidden primitive H feeds B) -- one re-anchored link.
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const A = L.createNode('CLIPTextEncode'); A.pos = [300, 120]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [1000, 120]; B.title = 'B'; g.add(B)
  A.widgets.find((w) => w.name === 'text').value = 'v'
  const idx = A.inputs.findIndex((s) => s.widget?.name === 'text')
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id), idx }
})
await drag(await pinPos(ids.A, 'widget'), await dotPos(ids.B, ids.idx))

const state = () => page.evaluate(async () => {
  window.__cablemanagementDebugDraws = 0
  window.app.graph.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 500))
  const g = window.app.graph
  const prim = g.nodes.find((n) => n.type === 'PrimitiveNode' && n.properties?.['cablemanagement.owned'])
  const el = prim ? document.querySelector(`.lg-node[data-node-id="${prim.id}"]`) : null
  return {
    draws: window.__cablemanagementDebugDraws,
    ghost: el ? { visibility: el.style.visibility, opacity: el.style.opacity, pe: el.style.pointerEvents } : null,
    setting: !!window.app.ui?.settings?.settingsLookup?.['cablemanagement.debug'],
  }
})

const off1 = await state()
ok('setting checkbox registered', off1.setting)
ok('off: no debug draws', off1.draws === 0, `draws=${off1.draws}`)
ok('off: primitive fully hidden', off1.ghost?.visibility === 'hidden' && off1.ghost?.pe === 'none', JSON.stringify(off1.ghost))

await page.evaluate(async () => {
  window.__cablemanagement.debugView(true)
  await new Promise((r) => setTimeout(r, 700))
})
const on = await state()
ok('on: true wires drawn', on.draws > 0, `draws=${on.draws}`)
ok('on: primitive ghosts at 0.35, still untouchable',
  on.ghost?.visibility === '' && on.ghost?.opacity === '0.35' && on.ghost?.pe === 'none', JSON.stringify(on.ghost))

await page.evaluate(async () => {
  window.__cablemanagement.debugView(false)
  await new Promise((r) => setTimeout(r, 700))
})
const off2 = await state()
ok('off again: draws stop', off2.draws === 0, `draws=${off2.draws}`)
ok('off again: stealth restored', off2.ghost?.visibility === 'hidden' && off2.ghost?.opacity === '', JSON.stringify(off2.ghost))

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
