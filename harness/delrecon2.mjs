// Barney's second delete report: A -> B -> A3, all InjectPromptToggleable
// (inputs [text(0,widget), #prompt(1,forceInput STRING), use(2,forceInput BOOLEAN)],
//  outputs [prompt(0,STRING), used(1,BOOLEAN)] -- input order does NOT mirror outputs,
//  so connectInputToOutput's index-to-index pass pairs text<->prompt and #prompt<->used).
//
// "deleting B reconnected prompt to text but not prompt to prompt."
// Matrix over plausible wirings; dump everything, find the reproducing one.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1700, height: 950 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const dragPin = async (sel, tgtKey) => {
  const pin = await page.evaluate(({ sel }) => {
    const p = document.querySelector(sel)
    if (!p) return null
    const r = p.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
  }, { sel })
  const tgt = await page.evaluate(({ tgtKey }) => {
    const d = document.querySelector(`[data-slot-key="${tgtKey}"]`)
    if (!d) return null
    const r = d.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
  }, { tgtKey })
  if (!pin || !tgt) { console.log('  drag failed:', sel, '->', tgtKey); return false }
  await page.mouse.move(...pin); await page.mouse.down()
  await page.mouse.move(tgt[0], tgt[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(1100)
  return true
}

const build = () => page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const mk = (t, x) => { const n = L.createNode('InjectPromptToggleable'); n.pos = [x, 100]; n.title = t; g.add(n); return n }
  const A = mk('A', 60), B = mk('B', 620), C = mk('A3', 1160)
  const wa = A.widgets.find(w => w.name === 'text')
  wa.value = 'A text'; wa.callback?.(wa.value)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1500))
  const idx = (n, name) => n.inputs.findIndex(s => s.name === name)
  return {
    A: String(A.id), B: String(B.id), C: String(C.id),
    tIdx: idx(A, 'text'), pIdx: idx(A, '#prompt'), uIdx: idx(A, 'use'),
    inputs: A.inputs.map((s, i) => `${i}:${s.name}:${s.type}${s.widget ? ':w' : ''}`),
    outputs: A.outputs.map((s, i) => `${i}:${s.name}:${s.type}`),
  }
})

const connectOut = (from, outIdx, to, inIdx) => page.evaluate(({ from, outIdx, to, inIdx }) => {
  const g = window.app.graph
  g.getNodeById(Number(from)).connect(outIdx, g.getNodeById(Number(to)), inIdx)
  g.setDirtyCanvas(true, true)
}, { from, outIdx, to, inIdx })

const stateOf = (ids) => page.evaluate(({ ids }) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(ids.C))
  const dump = C.inputs.map((s, i) => {
    if (s.link == null) return `${s.name}: -`
    const l = g.getLink(s.link)
    const o = g.getNodeById(l.origin_id)
    const prov = C.properties?.['cablemanagement.from']?.[String(i)]
    return `${s.name}: ${o?.title ?? l.origin_id}[${l.origin_slot}]${o?.properties?.['cablemanagement.owned'] ? '(prim)' : ''}` +
      (prov ? ` prov[${g.getNodeById(Number(prov[0]))?.title ?? prov[0]},${prov[1]}]` : '')
  })
  const prims = g.nodes.filter(n => n.properties?.['cablemanagement.owned']).length
  return { C: dump, prims }
}, { ids })

const del = (id) => page.evaluate(async ({ id }) => {
  const g = window.app.graph, canvas = window.app.canvas
  canvas.selectItems([g.getNodeById(Number(id))])
  canvas.deleteSelected()
  g.setDirtyCanvas(true, true)
}, { id })

// Each variant: [name, async setup(ids) wiring A->B and B->A3]
const pinSel = (id, which, ids) => which === 'widget'
  ? `.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-kind="widget"]`
  : `.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${which}"]`

const variants = {
  // direct prompt->prompt both hops; text fed via A's widget pin then B's text pin
  W1: async (ids) => {
    await connectOut(ids.A, 0, ids.B, ids.pIdx)
    await dragPin(pinSel(ids.A, 'widget', ids), `${ids.B}-in-${ids.tIdx}`)
    await connectOut(ids.B, 0, ids.C, ids.pIdx)
    await dragPin(pinSel(ids.B, ids.tIdx, ids), `${ids.C}-in-${ids.tIdx}`)
  },
  // both B->A3 wires are B's INPUT pins (pure pass-through hop)
  W2: async (ids) => {
    await connectOut(ids.A, 0, ids.B, ids.pIdx)
    await dragPin(pinSel(ids.A, 'widget', ids), `${ids.B}-in-${ids.tIdx}`)
    await dragPin(pinSel(ids.B, ids.pIdx, ids), `${ids.C}-in-${ids.pIdx}`)
    await dragPin(pinSel(ids.B, ids.tIdx, ids), `${ids.C}-in-${ids.tIdx}`)
  },
  // B's prompt OUT feeds A3's TEXT (cascading prompt into template); prompt hop via pin
  W3: async (ids) => {
    await connectOut(ids.A, 0, ids.B, ids.pIdx)
    await dragPin(pinSel(ids.A, 'widget', ids), `${ids.B}-in-${ids.tIdx}`)
    await connectOut(ids.B, 0, ids.C, ids.tIdx)
    await dragPin(pinSel(ids.B, ids.pIdx, ids), `${ids.C}-in-${ids.pIdx}`)
  },
  // no text feed at all; prompt+use chains, direct out->in both hops
  W4: async (ids) => {
    await connectOut(ids.A, 0, ids.B, ids.pIdx)
    await connectOut(ids.A, 1, ids.B, ids.uIdx)
    await connectOut(ids.B, 0, ids.C, ids.pIdx)
    await connectOut(ids.B, 1, ids.C, ids.uIdx)
  },
  // B.text fed DIRECTLY from A's prompt out (no prim); B out feeds both A3 inputs
  W5: async (ids) => {
    await connectOut(ids.A, 0, ids.B, ids.pIdx)
    await connectOut(ids.A, 0, ids.B, ids.tIdx)
    await connectOut(ids.B, 0, ids.C, ids.pIdx)
    await connectOut(ids.B, 0, ids.C, ids.tIdx)
  },
  // crossed: A's TEXT pin feeds B.#prompt, A's prompt OUT feeds B.text; B pins onward
  W6: async (ids) => {
    await dragPin(pinSel(ids.A, 'widget', ids), `${ids.B}-in-${ids.pIdx}`)
    await connectOut(ids.A, 0, ids.B, ids.tIdx)
    await dragPin(pinSel(ids.B, ids.pIdx, ids), `${ids.C}-in-${ids.pIdx}`)
    await dragPin(pinSel(ids.B, ids.tIdx, ids), `${ids.C}-in-${ids.tIdx}`)
  },
}

let first = true
for (const [name, wire] of Object.entries(variants)) {
  const ids = await build()
  if (first) { console.log('slots:', JSON.stringify({ inputs: ids.inputs, outputs: ids.outputs })); first = false }
  await wire(ids)
  await page.waitForTimeout(700)
  const before = await stateOf(ids)
  await del(ids.B)
  await page.waitForTimeout(1400)
  const after = await stateOf(ids)
  console.log(`${name} before: ${JSON.stringify(before)}`)
  console.log(`${name} after : ${JSON.stringify(after)}`)

  // Same wiring, but delete the PASTED copy's B -- his top row was itself a paste.
  const ids2 = await build()
  await wire(ids2)
  await page.waitForTimeout(700)
  const pasted = await page.evaluate(async ({ ids2 }) => {
    const g = window.app.graph, canvas = window.app.canvas
    const pre = new Set(g.nodes.map(n => String(n.id)))
    canvas.selectItems([ids2.A, ids2.B, ids2.C].map(id => g.getNodeById(Number(id))))
    canvas.copyToClipboard()
    canvas.pasteFromClipboard({ position: [60, 520] })
    await new Promise(r => setTimeout(r, 1500))
    const byTitle = {}
    for (const n of g.nodes.filter(n => !pre.has(String(n.id)))) byTitle[n.title] = String(n.id)
    return byTitle
  }, { ids2 })
  const pids = { ...ids2, A: pasted['A'], B: pasted['B'], C: pasted['A3'] }
  const pBefore = await stateOf(pids)
  await del(pids.B)
  await page.waitForTimeout(1400)
  const pAfter = await stateOf(pids)
  console.log(`${name}P before: ${JSON.stringify(pBefore)}`)
  console.log(`${name}P after : ${JSON.stringify(pAfter)}`)
}
console.log('page errors:', errs.length); errs.slice(0, 6).forEach(e => console.log('  ' + e.slice(0, 160)))
await b.close()
