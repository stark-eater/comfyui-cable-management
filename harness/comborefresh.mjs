// COMBO pass-through x Refresh Node Definitions. Core's PrimitiveNode.refreshComboInNode
// dereferences outputs[0].widget[GET_CONFIG]() unguarded; GET_CONFIG is a Symbol (not
// importable, never serialized), so a bare { name } ref on an owned primitive turned
// every press of Refresh Node Definitions into a graph-wide abort -- fresh AND after
// reload. Fix: carry the host input ref's symbols onto the primitive's ref (materialise
// + every sync via mirrorFromHost).
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

// Real widget-pin drag: A.ckpt_name pin onto B's ckpt_name input row.
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const A = L.createNode('CheckpointLoaderSimple'); A.pos = [80, 100]; g.add(A)
  const B = L.createNode('CheckpointLoaderSimple'); B.pos = [700, 100]; g.add(B)
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

const dump = () => page.evaluate(i => {
  const g = window.app.graph
  const prim = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  const B = g.getNodeById(Number(i.B))
  const ref = prim?.outputs?.[0]?.widget
  return {
    prim: !!prim,
    linked: B?.inputs?.[i.bIdx]?.link != null,
    symbols: ref ? Object.getOwnPropertySymbols(ref).length : -1,
    comboValues: prim?.widgets?.[0]?.options?.values?.length ?? 0,
  }
}, ids)
const refresh = () => page.evaluate(async () => {
  try { await window.app.refreshComboInNodes(); return { ok: true } }
  catch (e) { return { ok: false, err: String(e).slice(0, 160) } }
})

const s1 = await dump()
ok('combo pin drop creates linked primitive', s1.prim && s1.linked, JSON.stringify(s1))
ok('primitive ref carries the host symbols', s1.symbols >= 1, `symbols=${s1.symbols}`)
const r1 = await refresh()
ok('Refresh Node Definitions completes', r1.ok, r1.err ?? '')
const s2 = await dump()
ok('link and combo options survive the refresh', s2.linked && s2.comboValues >= 1, JSON.stringify(s2))

// Reload: serialization strips symbols; the sync pass must re-carry them before the
// next refresh press.
const snapshot = await page.evaluate(() => window.app.graph.serialize())
await page.evaluate(async (snap) => {
  await window.app.loadGraphData(snap)
  await new Promise(r => setTimeout(r, 2000))
}, snapshot)
const s3 = await dump()
ok('reloaded primitive ref re-carries symbols', s3.prim && s3.symbols >= 1, JSON.stringify(s3))
const r2 = await refresh()
ok('refresh after reload completes', r2.ok, r2.err ?? '')

console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
