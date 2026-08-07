// Barney's report (screenshot, 2026-08-04): A ==widget pin==> C ==C's INPUT pin==> D.
// Both real links come from A's hidden primitive; D's provenance names C (daisy chain).
//
//   T1  paste {A, C, D}  -> BOTH links replicate: one new prim under A2 feeding C2 and D2,
//       prov C2:[A2,widx] D2:[C2,0], wires drawn from A2's widget pin and C2's input pin.
//       (Regression: flavour detection required prim.host === provenance host, so D's
//       entry misclassified and the C->D link vanished on paste.)
//   T2  delete C         -> P->D survives; D's dead-host provenance is RETARGETED to
//       [A, widx] so the wire draws from A's widget pin, not the parked primitive.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1700, height: 950 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
await page.evaluate(() => { window.__cablemanagementCapture = true })

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
  if (!pin || !tgt) { console.log('drag failed:', sel, tgtKey); return false }
  await page.mouse.move(...pin); await page.mouse.down()
  await page.mouse.move(tgt[0], tgt[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(1200)
  return true
}

const drawnVsPin = (nodeId, inputIdx, pinSel) => page.evaluate(async ({ nodeId, inputIdx, pinSel }) => {
  const app = window.app, g = app.graph, ds = app.canvas.ds
  const n = g.getNodeById(Number(nodeId))
  const linkId = n?.inputs?.[inputIdx]?.link
  if (linkId == null) return { linkId: null }
  g.setDirtyCanvas(true, true)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const drawn = window.__cablemanagementDraw?.get(linkId)
  const pin = pinSel ? document.querySelector(pinSel) : null
  let pinPt = null
  if (pin) {
    const r = pin.getBoundingClientRect()
    const cr = app.canvas.canvas.getBoundingClientRect()
    pinPt = [
      (r.x + r.width / 2 - cr.left) / ds.scale - ds.offset[0],
      (r.y + r.height / 2 - cr.top) / ds.scale - ds.offset[1],
    ]
  }
  const link = g.getLink ? g.getLink(linkId) : g._links?.get?.(linkId)
  return {
    linkId,
    origin: link ? String(link.origin_id) : null,
    gap: drawn && pinPt ? Math.round(Math.hypot(drawn[0] - pinPt[0], drawn[1] - pinPt[1])) : null,
  }
}, { nodeId, inputIdx, pinSel })

const provOf = (nodeId, idx) => page.evaluate(({ nodeId, idx }) => {
  const n = window.app.graph.getNodeById(Number(nodeId))
  const e = n?.properties?.['cablemanagement.from']?.[String(idx)]
  return e ? [String(e[0]), Number(e[1]), e[2]] : null
}, { nodeId, idx })

// ---- build the chain -----------------------------------------------------------------
const s = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const show = Object.keys(L.registered_node_types).find(k => /ShowText/i.test(k))
  if (!show) return { err: 'no ShowText type registered' }
  const A = L.createNode('CLIPTextEncode'); A.pos = [80, 100]; A.title = 'A'; g.add(A)
  const C = L.createNode(show); C.pos = [640, 100]; C.title = 'C'; g.add(C)
  const D = L.createNode(show); D.pos = [1150, 100]; D.title = 'D'; g.add(D)
  const wa = A.widgets.find(w => w.name === 'text')
  wa.value = 'chain value'; wa.callback?.(wa.value)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { A: String(A.id), C: String(C.id), D: String(D.id), aWidx: A.inputs.findIndex(x => x.widget?.name === 'text') }
})
if (s.err) { console.log('SKIP:', s.err); process.exit(1) }
await dragPin(`.cablemanagement-pin[data-cablemanagement-node="${s.A}"][data-cablemanagement-kind="widget"]`, `${s.C}-in-0`)
await dragPin(`.cablemanagement-pin[data-cablemanagement-node="${s.C}"][data-cablemanagement-index="0"]`, `${s.D}-in-0`)
const base = await page.evaluate(({ s }) => {
  const g = window.app.graph
  const prim = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  const C = g.getNodeById(Number(s.C)), D = g.getNodeById(Number(s.D))
  const org = (n) => n.inputs[0].link != null ? String(g.getLink(n.inputs[0].link).origin_id) : null
  return {
    prim: prim ? String(prim.id) : null,
    cOrigin: org(C), dOrigin: org(D),
    cProv: C.properties?.['cablemanagement.from']?.['0'] ?? null,
    dProv: D.properties?.['cablemanagement.from']?.['0'] ?? null,
  }
}, { s })
console.log('baseline:', JSON.stringify(base))
const baseOk = base.prim && base.cOrigin === base.prim && base.dOrigin === base.prim &&
  base.cProv && String(base.cProv[0]) === s.A && base.dProv && String(base.dProv[0]) === s.C
if (!baseOk) { console.log('baseline FAIL'); process.exit(1) }

// ---- T1: paste the whole chain --------------------------------------------------------
const t1 = await page.evaluate(async ({ s }) => {
  const g = window.app.graph, canvas = window.app.canvas
  const pre = new Set(g.nodes.map(n => String(n.id)))
  canvas.selectItems([s.A, s.C, s.D].map(id => g.getNodeById(Number(id))))
  canvas.copyToClipboard()
  canvas.pasteFromClipboard({ position: [80, 520] })
  await new Promise(r => setTimeout(r, 1500))
  const added = g.nodes.filter(n => !pre.has(String(n.id)))
  const byTitle = {}
  for (const n of added) byTitle[n.title] = String(n.id)
  const newPrims = added.filter(n => n.properties?.['cablemanagement.owned'])
    .map(n => ({ id: String(n.id), host: String(n.properties['cablemanagement.host']), value: n.widgets?.[0]?.value }))
  return { added: added.map(n => String(n.id)), byTitle, newPrims }
}, { s })
const A2 = t1.byTitle['A'], C2 = t1.byTitle['C'], D2 = t1.byTitle['D']
const p2 = t1.newPrims[0]
const c2prov = C2 ? await provOf(C2, 0) : null
const d2prov = D2 ? await provOf(D2, 0) : null
const c2draw = C2 ? await drawnVsPin(C2, 0, `.cablemanagement-pin[data-cablemanagement-node="${A2}"][data-cablemanagement-kind="widget"]`) : { linkId: null }
const d2draw = D2 ? await drawnVsPin(D2, 0, `.cablemanagement-pin[data-cablemanagement-node="${C2}"][data-cablemanagement-index="0"]`) : { linkId: null }
const d2text = D2 ? await page.evaluate(async ({ D2 }) => {
  const p = await window.app.graphToPrompt()
  return p.output[D2]?.inputs?.text ?? null
}, { D2 }) : null
console.log('T1 pasted:', JSON.stringify({ A2, C2, D2, newPrims: t1.newPrims }))
console.log('T1 C2 prov:', JSON.stringify(c2prov), 'draw:', JSON.stringify(c2draw))
console.log('T1 D2 prov:', JSON.stringify(d2prov), 'draw:', JSON.stringify(d2draw), 'prompt text:', JSON.stringify(d2text))
const t1pass = !!(A2 && C2 && D2 && t1.newPrims.length === 1 && p2.host === A2 && p2.value === 'chain value' &&
  c2draw.origin === p2.id && d2draw.origin === p2.id &&
  c2prov && c2prov[0] === A2 && c2prov[1] === s.aWidx &&
  d2prov && d2prov[0] === C2 && d2prov[1] === 0 &&
  c2draw.gap != null && c2draw.gap <= 4 && d2draw.gap != null && d2draw.gap <= 4 &&
  d2text === 'chain value')
console.log('T1:', t1pass ? 'PASS' : 'FAIL')
await page.evaluate(({ ids }) => {
  const g = window.app.graph, canvas = window.app.canvas
  canvas.selectItems(ids.map(id => g.getNodeById(Number(id))).filter(Boolean))
  canvas.deleteSelected()
}, { ids: t1.added })
await page.waitForTimeout(1000)

// ---- T2: delete C out of the original chain -------------------------------------------
await page.evaluate(({ s }) => {
  const g = window.app.graph, canvas = window.app.canvas
  canvas.selectItems([g.getNodeById(Number(s.C))])
  canvas.deleteSelected()
  g.setDirtyCanvas(true, true)
}, { s })
await page.waitForTimeout(1500)
const t2draw = await drawnVsPin(s.D, 0, `.cablemanagement-pin[data-cablemanagement-node="${s.A}"][data-cablemanagement-kind="widget"]`)
const t2prov = await provOf(s.D, 0)
console.log('T2 D prov:', JSON.stringify(t2prov), 'draw:', JSON.stringify(t2draw))
const t2pass = !!(t2draw.linkId != null && t2draw.origin === base.prim &&
  t2prov && t2prov[0] === s.A && t2prov[1] === s.aWidx && t2prov[2] === t2draw.linkId &&
  t2draw.gap != null && t2draw.gap <= 4)
console.log('T2:', t2pass ? 'PASS' : 'FAIL')

const pass = t1pass && t2pass
console.log(pass ? 'ALL PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
