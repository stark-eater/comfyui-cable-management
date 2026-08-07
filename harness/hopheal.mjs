// Uninstall reversibility: a consumer reached only through a boundary hop (virtual
// Reroute / subgraph gate) used to get its value ONLY in the API payload at queue time
// -- its live widget, which is what serialises and what a receiver WITHOUT the
// extension executes, kept the stale value silently. injectLiterals now also does
// core's widget write for hop-consumers, so queueing heals the file toward the truth.
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
await page.waitForFunction(() => window.app?.graph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

// A.ckpt_name widget pin -> B.ckpt_name input (direct, hops 0), then a core virtual
// Reroute NODE is spliced into the middle: prim -> Reroute -> B (hops 1).
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const A = L.createNode('CheckpointLoaderSimple'); A.pos = [80, 100]; g.add(A)
  const B = L.createNode('CheckpointLoaderSimple'); B.pos = [900, 100]; g.add(B)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1800))
  return { A: String(A.id), B: String(B.id), bIdx: B.inputs.findIndex(s => s.widget?.name === 'ckpt_name') }
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
await page.mouse.move(pin.x, pin.y)
await page.mouse.down()
await page.mouse.move(tgt.x, tgt.y, { steps: 12 })
await page.waitForTimeout(300)
await page.mouse.up()
await page.waitForTimeout(1200)

const spliced = await page.evaluate(async (i) => {
  const g = window.app.graph, L = window.LiteGraph
  const prim = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  if (!prim) return { prim: false }
  const R = L.createNode('Reroute'); R.pos = [700, 300]; g.add(R)
  const B = g.getNodeById(Number(i.B))
  prim.connect(0, R, 0)
  R.connect(0, B, i.bIdx)
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  g.setDirtyCanvas(true, true)
  await new Promise(r => setTimeout(r, 800))
  const link = B.inputs[i.bIdx].link != null ? g.getLink(B.inputs[i.bIdx].link) : null
  return {
    prim: true, primId: String(prim.id),
    viaReroute: link && String(link.origin_id) === String(R.id),
    virtual: !!R.isVirtualNode,
  }
}, ids)
ok('prim -> virtual Reroute -> consumer spliced', spliced.prim && spliced.viaReroute && spliced.virtual, JSON.stringify(spliced))

// Poison the consumer's widget with a stale value, then queue. The hop-heal must
// overwrite it with the primitive's literal both in the payload AND on the widget.
const healed = await page.evaluate(async (i) => {
  const g = window.app.graph
  const prim = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  const B = g.getNodeById(Number(i.B))
  const bw = B.widgets.find(w => w.name === 'ckpt_name')
  const truth = prim.widgets[0].value
  bw.value = '__stale__'
  const p = await window.app.graphToPrompt()
  const payload = p.output[i.B]?.inputs?.ckpt_name
  const serialized = g.serialize()
  const bSer = serialized.nodes.find(n => String(n.id) === i.B)
  const wIdx = B.widgets.indexOf(bw)
  return { truth, widget: bw.value, payload, serializedVal: bSer.widgets_values?.[wIdx] }
}, ids)
ok('payload carries the literal through the hop', healed.payload === healed.truth,
  `payload=${healed.payload}`)
ok('consumer LIVE widget healed at queue time', healed.widget === healed.truth,
  `widget=${healed.widget}`)
ok('serialized file carries the truth', healed.serializedVal === healed.truth,
  `serialized=${healed.serializedVal}`)

// Direct (hops 0) control: core's own applyToGraph path must still deliver.
const direct = await page.evaluate(async (i) => {
  const g = window.app.graph
  const prim = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  const R = g.nodes.find(n => n.isVirtualNode && n.type === 'Reroute' && !n.properties?.['cablemanagement.stitch'])
  const B = g.getNodeById(Number(i.B))
  g.remove(R)
  prim.connect(0, B, i.bIdx)
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  await new Promise(r => setTimeout(r, 800))
  const bw = B.widgets.find(w => w.name === 'ckpt_name')
  bw.value = '__stale2__'
  const p = await window.app.graphToPrompt()
  return { widget: bw.value, payload: p.output[i.B]?.inputs?.ckpt_name, truth: prim.widgets[0].value }
}, ids)
ok('direct consumer still delivered by core', direct.widget === direct.truth && direct.payload === direct.truth,
  JSON.stringify(direct))

console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
