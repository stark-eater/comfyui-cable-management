// Delete-reconnect reconciliation. deleteSelected() bridges a removed node's input origin
// to its consumers (connectInputToOutput) with plain connect() calls -- no LinkConnector,
// so no provenance is recorded by the drag pipeline.
//
//   S1  A(widget) ==pin==> B(ShowText) --> C. Delete B. Bridge creates prim->C.
//       Want: C provenance [A, widx], wire drawn from A's widget pin, prim parked on A.
//   S2  X --> Y(pin) ==pin==> Z --> W (all LATENT idx0). Delete Z. Bridge creates X->W.
//       Want: W provenance [Y, 0], wire drawn from Y's pass-through pin.
//   S3  (continues S1 state) Delete host A. Want: owned prim reaped, C input unconnected.
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
  if (!pin || !tgt) { console.log('drag failed: pin/tgt missing', sel, tgtKey); return false }
  await page.mouse.move(...pin); await page.mouse.down()
  await page.mouse.move(tgt[0], tgt[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(1200)
  return true
}

// Graph-space start of the link feeding (node,input) vs the DOM centre of a cablemanagement pin.
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
    start: drawn ? [Math.round(drawn[0]), Math.round(drawn[1])] : null,
    pin: pinPt ? pinPt.map(v => Math.round(v)) : null,
    gap: drawn && pinPt ? Math.round(Math.hypot(drawn[0] - pinPt[0], drawn[1] - pinPt[1])) : null,
  }
}, { nodeId, inputIdx, pinSel })

// ---- S1: widget pass-through feeds the deleted node ----------------------------------
const s1 = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const show = Object.keys(L.registered_node_types).find(k => /ShowText/i.test(k))
  if (!show) return { err: 'no ShowText type registered' }
  const A = L.createNode('CLIPTextEncode'); A.pos = [120, 120]; A.title = 'A'; g.add(A)
  const B = L.createNode(show); B.pos = [700, 120]; B.title = 'B'; g.add(B)
  const C = L.createNode('CLIPTextEncode'); C.pos = [1180, 120]; C.title = 'C'; g.add(C)
  const wa = A.widgets.find(w => w.name === 'text')
  wa.value = 'from A'; wa.callback?.(wa.value)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return {
    A: String(A.id), B: String(B.id), C: String(C.id),
    aWidx: A.inputs.findIndex(s => s.widget?.name === 'text'),
    cIdx: C.inputs.findIndex(s => s.widget?.name === 'text'),
    proto: typeof (L.LGraphNode?.prototype?.connectInputToOutput),
  }
})
if (s1.err) { console.log('SKIP S1:', s1.err); process.exit(1) }
console.log('S1 ids:', JSON.stringify(s1))
const aPinSel = `.cablemanagement-pin[data-cablemanagement-node="${s1.A}"][data-cablemanagement-kind="widget"]`
await dragPin(aPinSel, `${s1.B}-in-0`)
const s1pre = await page.evaluate(i => {
  const g = window.app.graph, B = g.getNodeById(Number(i.B))
  const prim = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  return {
    bLinked: B.inputs[0].link != null,
    prim: prim ? { id: String(prim.id), pos: prim.pos.map(Math.round) } : null,
    bProv: g.getNodeById(Number(i.B)).properties?.['cablemanagement.from'] ?? null,
  }
}, s1)
console.log('S1 after drag:', JSON.stringify(s1pre))
await page.evaluate(async i => {
  const g = window.app.graph
  const B = g.getNodeById(Number(i.B)), C = g.getNodeById(Number(i.C))
  B.connect(0, C, i.cIdx)
  // Move the host AFTER the primitive was parked: exposes the stale-position "empty spot".
  const A = g.getNodeById(Number(i.A))
  A.setPos ? A.setPos(120, 560) : (A.pos = [120, 560])
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 900))
}, s1)
await page.evaluate(async i => {
  const canvas = window.app.canvas, g = window.app.graph
  const B = g.getNodeById(Number(i.B))
  canvas.selectItems([B])
  canvas.deleteSelected()
  g.setDirtyCanvas(true, true)
}, s1)
await page.waitForTimeout(1200)
const s1post = await drawnVsPin(s1.C, s1.cIdx, aPinSel)
const s1state = await page.evaluate(i => {
  const g = window.app.graph
  const prim = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  const C = g.getNodeById(Number(i.C))
  return {
    prim: prim ? { id: String(prim.id), pos: prim.pos.map(Math.round) } : null,
    aPos: g.getNodeById(Number(i.A))?.pos.map(Math.round),
    cProv: C.properties?.['cablemanagement.from'] ?? null,
    ledgerHasLink: C.inputs[i.cIdx].link != null && (window.__cablemanagement?.ledger()?.keys ?? []).includes(C.inputs[i.cIdx].link),
  }
}, s1)
console.log('S1 after delete:', JSON.stringify(s1post))
console.log('S1 state       :', JSON.stringify(s1state))
const s1prov = s1state.cProv?.[String(s1.cIdx)]
const s1pass = s1post.linkId != null && s1state.prim && s1post.origin === s1state.prim.id &&
  s1prov && String(s1prov[0]) === s1.A && Number(s1prov[1]) === s1.aWidx &&
  s1post.gap != null && s1post.gap <= 4
console.log('S1:', s1pass ? 'PASS' : 'FAIL')

// ---- S3 setup happens after S2 (S3 continues S1's graph) -- do S3 now while state is live
await page.evaluate(async i => {
  const canvas = window.app.canvas, g = window.app.graph
  const A = g.getNodeById(Number(i.A))
  canvas.selectItems([A])
  canvas.deleteSelected()
  g.setDirtyCanvas(true, true)
}, s1)
await page.waitForTimeout(1500)
const s3 = await page.evaluate(i => {
  const g = window.app.graph
  const prim = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  const C = g.getNodeById(Number(i.C))
  return { primAlive: !!prim, cLink: C.inputs[i.cIdx].link, cProv: C.properties?.['cablemanagement.from'] ?? null }
}, s1)
console.log('S3 after host delete:', JSON.stringify(s3))
const s3pass = !s3.primAlive && s3.cLink == null && !s3.cProv
console.log('S3:', s3pass ? 'PASS' : 'FAIL')

// ---- S2: input pass-through feeds the deleted node -----------------------------------
const s2 = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const X = L.createNode('EmptyLatentImage'); X.pos = [60, 120]; X.title = 'X'; g.add(X)
  const Y = L.createNode('LatentUpscale'); Y.pos = [480, 120]; Y.title = 'Y'; g.add(Y)
  const Z = L.createNode('LatentUpscale'); Z.pos = [900, 120]; Z.title = 'Z'; g.add(Z)
  const W = L.createNode('LatentUpscale'); W.pos = [1320, 120]; W.title = 'W'; g.add(W)
  X.connect(0, Y, 0)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { X: String(X.id), Y: String(Y.id), Z: String(Z.id), W: String(W.id) }
})
console.log('S2 ids:', JSON.stringify(s2))
const yPinSel = `.cablemanagement-pin[data-cablemanagement-node="${s2.Y}"][data-cablemanagement-index="0"]`
await dragPin(yPinSel, `${s2.Z}-in-0`)
const s2pre = await page.evaluate(i => {
  const g = window.app.graph, Z = g.getNodeById(Number(i.Z))
  const l = Z.inputs[0].link != null ? (g.getLink ? g.getLink(Z.inputs[0].link) : null) : null
  return { zOrigin: l ? String(l.origin_id) : null, zProv: Z.properties?.['cablemanagement.from'] ?? null }
}, s2)
console.log('S2 after drag:', JSON.stringify(s2pre))
await page.evaluate(async i => {
  const g = window.app.graph
  g.getNodeById(Number(i.Z)).connect(0, g.getNodeById(Number(i.W)), 0)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 700))
}, s2)
await page.evaluate(async i => {
  const canvas = window.app.canvas, g = window.app.graph
  canvas.selectItems([g.getNodeById(Number(i.Z))])
  canvas.deleteSelected()
  g.setDirtyCanvas(true, true)
}, s2)
await page.waitForTimeout(1200)
const s2post = await drawnVsPin(s2.W, 0, yPinSel)
const s2state = await page.evaluate(i => {
  const W = window.app.graph.getNodeById(Number(i.W))
  return { wProv: W.properties?.['cablemanagement.from'] ?? null }
}, s2)
console.log('S2 after delete:', JSON.stringify(s2post), JSON.stringify(s2state))
const s2prov = s2state.wProv?.['0']
const s2pass = s2post.linkId != null && s2post.origin === s2.X &&
  s2prov && String(s2prov[0]) === s2.Y && Number(s2prov[1]) === 0 &&
  s2post.gap != null && s2post.gap <= 4
console.log('S2:', s2pass ? 'PASS' : 'FAIL')

const pass = s1pass && s2pass && s3pass
console.log(pass ? 'ALL PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
