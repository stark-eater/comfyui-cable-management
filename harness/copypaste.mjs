// Copy/paste survival of pass-through links (paste.js fixup).
//
//   C1  {A(host), B} plain paste          -> fresh prim owned by A2, P2->B2, prov [A2,widx]
//   C2  {A, B, P} paste (marquee case)    -> pasted prim re-homed to A2, link adopted
//   C3  {B} shift-paste                   -> B2 daisy-chains off ORIGINAL prim, prov [A]
//   C4  {X, Y, Z} plain paste (input)     -> X2->Z2 re-anchored to Y2's pin
//   C5  {Y, Z} shift-paste (input)        -> X->Z2 kept, re-anchored to Y2's pin
//   C6  undo of a paste                   -> pasted set gone, original A/B/P intact
// Every scenario deletes what it pasted; C2/C3 account prims via the added set only.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1700, height: 950 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
await page.evaluate(() => { window.__cablemanagementCapture = true })
const results = {}

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

// Copy `ids`, paste at `pos`, return the nodes that appeared (by title) + owned prims.
const copyPaste = (ids, pos, connectInputs) => page.evaluate(async ({ ids, pos, connectInputs }) => {
  const g = window.app.graph, canvas = window.app.canvas
  const pre = new Set(g.nodes.map(n => String(n.id)))
  canvas.selectItems(ids.map(id => g.getNodeById(Number(id))).filter(Boolean))
  canvas.copyToClipboard()
  canvas.pasteFromClipboard({ position: pos, connectInputs })
  await new Promise(r => setTimeout(r, 1500))
  const added = g.nodes.filter(n => !pre.has(String(n.id)))
  const byTitle = {}
  for (const n of added) byTitle[n.title] = String(n.id)
  return {
    added: added.map(n => String(n.id)),
    byTitle,
    prims: g.nodes.filter(n => n.properties?.['cablemanagement.owned'])
      .map(n => ({ id: String(n.id), host: String(n.properties['cablemanagement.host']), value: n.widgets?.[0]?.value })),
  }
}, { ids, pos, connectInputs })

const provOf = (nodeId, idx) => page.evaluate(({ nodeId, idx }) => {
  const n = window.app.graph.getNodeById(Number(nodeId))
  const e = n?.properties?.['cablemanagement.from']?.[String(idx)]
  return e ? [String(e[0]), Number(e[1]), e[2]] : null
}, { nodeId, idx })

// ---- setup: A(host) ==widget pin==> B(ShowText) --------------------------------------
const s = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const show = Object.keys(L.registered_node_types).find(k => /ShowText/i.test(k))
  if (!show) return { err: 'no ShowText type registered' }
  const A = L.createNode('CLIPTextEncode'); A.pos = [120, 100]; A.title = 'A'; g.add(A)
  const B = L.createNode(show); B.pos = [760, 100]; B.title = 'B'; g.add(B)
  const wa = A.widgets.find(w => w.name === 'text')
  wa.value = 'from A'; wa.callback?.(wa.value)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return {
    A: String(A.id), B: String(B.id),
    aWidx: A.inputs.findIndex(x => x.widget?.name === 'text'),
    shiftFlag: !!L.ctrl_shift_v_paste_connect_unselected_outputs,
  }
})
if (s.err) { console.log('SKIP:', s.err); process.exit(1) }
console.log('setup:', JSON.stringify(s))
await dragPin(`.cablemanagement-pin[data-cablemanagement-node="${s.A}"][data-cablemanagement-kind="widget"]`, `${s.B}-in-0`)
const origPrim = await page.evaluate(() => {
  const p = window.app.graph.nodes.find(n => n.properties?.['cablemanagement.owned'])
  return p ? String(p.id) : null
})
console.log('orig prim:', origPrim)

// ---- C1: plain paste of {A, B} -------------------------------------------------------
const c1 = await copyPaste([s.A, s.B], [120, 500], false)
const A2 = c1.byTitle['A'], B2 = c1.byTitle['B']
const c1prim = c1.prims.find(p => p.id !== origPrim)
const c1prov = A2 && B2 ? await provOf(B2, 0) : null
const c1draw = B2 ? await drawnVsPin(B2, 0, `.cablemanagement-pin[data-cablemanagement-node="${A2}"][data-cablemanagement-kind="widget"]`) : { linkId: null }
const c1prompt = B2 ? await page.evaluate(async ({ B2 }) => {
  const p = await window.app.graphToPrompt()
  return p.output[B2]?.inputs?.text ?? null
}, { B2 }) : null
console.log('C1 pasted:', JSON.stringify({ A2, B2, prims: c1.prims }))
console.log('C1 prov:', JSON.stringify(c1prov), 'draw:', JSON.stringify(c1draw), 'prompt text:', JSON.stringify(c1prompt))
results.C1 = !!(A2 && B2 && c1prim && c1prim.host === A2 && c1prim.value === 'from A' &&
  c1draw.origin === c1prim.id && c1prov && c1prov[0] === A2 && c1prov[1] === s.aWidx &&
  c1prov[2] === c1draw.linkId && c1draw.gap != null && c1draw.gap <= 4 && c1prompt === 'from A')
await page.evaluate(({ ids }) => {
  const g = window.app.graph, canvas = window.app.canvas
  canvas.selectItems(ids.map(id => g.getNodeById(Number(id))).filter(Boolean))
  canvas.deleteSelected()
}, { ids: c1.added })
await page.waitForTimeout(900)

// ---- C2: paste including the primitive (marquee case) --------------------------------
const c2 = await copyPaste([s.A, s.B, origPrim], [120, 500], false)
const A3 = c2.byTitle['A'], B3 = c2.byTitle['B']
const c2newPrims = c2.prims.filter(p => c2.added.includes(p.id))
const c2prim = c2newPrims[0]
const c2prov = B3 ? await provOf(B3, 0) : null
const c2draw = B3 ? await drawnVsPin(B3, 0, `.cablemanagement-pin[data-cablemanagement-node="${A3}"][data-cablemanagement-kind="widget"]`) : { linkId: null }
console.log('C2 pasted:', JSON.stringify({ A3, B3, newPrims: c2newPrims }))
console.log('C2 prov:', JSON.stringify(c2prov), 'draw:', JSON.stringify(c2draw))
results.C2 = !!(A3 && B3 && c2newPrims.length === 1 && c2prim.host === A3 &&
  c2draw.origin === c2prim.id && c2prov && c2prov[0] === A3 && c2prov[1] === s.aWidx &&
  c2draw.gap != null && c2draw.gap <= 4)
// drop the C2 clones to keep later state readable
await page.evaluate(({ ids }) => {
  const g = window.app.graph, canvas = window.app.canvas
  canvas.selectItems(ids.map(id => g.getNodeById(Number(id))).filter(Boolean))
  canvas.deleteSelected()
}, { ids: c2.added })
await page.waitForTimeout(900)

// ---- C3: shift-paste of {B} alone: daisy-chain off the ORIGINAL prim ------------------
if (s.shiftFlag) {
  const c3 = await copyPaste([s.B], [760, 500], true)
  const B4 = c3.byTitle['B']
  const c3prov = B4 ? await provOf(B4, 0) : null
  const c3draw = B4 ? await drawnVsPin(B4, 0, `.cablemanagement-pin[data-cablemanagement-node="${s.A}"][data-cablemanagement-kind="widget"]`) : { linkId: null }
  const c3newPrims = c3.prims.filter(p => c3.added.includes(p.id))
  console.log('C3 pasted:', JSON.stringify({ B4, newPrims: c3newPrims }))
  console.log('C3 prov:', JSON.stringify(c3prov), 'draw:', JSON.stringify(c3draw))
  results.C3 = !!(B4 && c3newPrims.length === 0 && c3draw.origin === origPrim &&
    c3prov && c3prov[0] === s.A && c3prov[1] === s.aWidx &&
    c3draw.gap != null && c3draw.gap <= 4)
  await page.evaluate(({ ids }) => {
    const g = window.app.graph, canvas = window.app.canvas
    canvas.selectItems(ids.map(id => g.getNodeById(Number(id))).filter(Boolean))
    canvas.deleteSelected()
  }, { ids: c3.added })
  await page.waitForTimeout(900)
} else {
  console.log('C3 skipped: ctrl_shift_v flag off; verifying plain-paste drop instead')
  const c3 = await copyPaste([s.B], [760, 500], false)
  const B4 = c3.byTitle['B']
  const c3prov = B4 ? await provOf(B4, 0) : null
  const linked = B4 ? await page.evaluate(({ B4 }) => window.app.graph.getNodeById(Number(B4)).inputs[0].link != null, { B4 }) : true
  results.C3 = !!(B4 && !linked && !c3prov)
}

// ---- C6: undo returns to pre-paste state (the paste auto-checkpoints itself) ----------
const preC6 = await page.evaluate(() => window.app.graph.nodes.map(n => String(n.id)))
await copyPaste([s.A, s.B], [120, 500], false)
await page.mouse.click(60, 880) // focus the canvas, away from any node
let c6 = null
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Control+KeyZ')
  await page.waitForTimeout(1200)
  c6 = await page.evaluate(({ s, origPrim, preC6 }) => {
    const g = window.app.graph
    const ids = new Set(g.nodes.map(n => String(n.id)))
    const prims = g.nodes.filter(n => n.properties?.['cablemanagement.owned']).map(n => String(n.id))
    const B = g.getNodeById(Number(s.B))
    return {
      count: g.nodes.length,
      hasOriginals: preC6.every(id => ids.has(id)),
      prims,
      bLinked: B?.inputs?.[0]?.link != null,
    }
  }, { s, origPrim, preC6 })
  if (c6.count === preC6.length) break
}
console.log('C6 after undo:', JSON.stringify(c6), 'expected count:', preC6.length)
results.C6 = !!(c6 && c6.hasOriginals && c6.count === preC6.length && c6.prims.length === 1 && c6.bLinked)

// ---- C4: input pass-through, whole chain pasted --------------------------------------
const s4 = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const X = L.createNode('EmptyLatentImage'); X.pos = [60, 100]; X.title = 'X'; g.add(X)
  const Y = L.createNode('LatentUpscale'); Y.pos = [520, 100]; Y.title = 'Y'; g.add(Y)
  const Z = L.createNode('LatentUpscale'); Z.pos = [1000, 100]; Z.title = 'Z'; g.add(Z)
  X.connect(0, Y, 0)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1500))
  return { X: String(X.id), Y: String(Y.id), Z: String(Z.id) }
})
await dragPin(`.cablemanagement-pin[data-cablemanagement-node="${s4.Y}"][data-cablemanagement-index="0"]`, `${s4.Z}-in-0`)
const c4 = await copyPaste([s4.X, s4.Y, s4.Z], [60, 500], false)
const X2 = c4.byTitle['X'], Y2 = c4.byTitle['Y'], Z2 = c4.byTitle['Z']
const c4prov = Z2 ? await provOf(Z2, 0) : null
const c4draw = Z2 ? await drawnVsPin(Z2, 0, `.cablemanagement-pin[data-cablemanagement-node="${Y2}"][data-cablemanagement-index="0"]`) : { linkId: null }
console.log('C4 pasted:', JSON.stringify({ X2, Y2, Z2 }))
console.log('C4 prov:', JSON.stringify(c4prov), 'draw:', JSON.stringify(c4draw))
results.C4 = !!(X2 && Y2 && Z2 && c4draw.origin === X2 &&
  c4prov && c4prov[0] === Y2 && c4prov[1] === 0 &&
  c4draw.gap != null && c4draw.gap <= 4)
await page.evaluate(({ ids }) => {
  const g = window.app.graph, canvas = window.app.canvas
  canvas.selectItems(ids.map(id => g.getNodeById(Number(id))).filter(Boolean))
  canvas.deleteSelected()
}, { ids: c4.added })
await page.waitForTimeout(900)

// ---- C5: input pass-through, origin left behind (shift-paste) -------------------------
if (s.shiftFlag) {
  const c5 = await copyPaste([s4.Y, s4.Z], [520, 500], true)
  const Y3 = c5.byTitle['Y'], Z3 = c5.byTitle['Z']
  const c5prov = Z3 ? await provOf(Z3, 0) : null
  const c5draw = Z3 ? await drawnVsPin(Z3, 0, `.cablemanagement-pin[data-cablemanagement-node="${Y3}"][data-cablemanagement-index="0"]`) : { linkId: null }
  console.log('C5 pasted:', JSON.stringify({ Y3, Z3 }))
  console.log('C5 prov:', JSON.stringify(c5prov), 'draw:', JSON.stringify(c5draw))
  results.C5 = !!(Y3 && Z3 && c5draw.origin === s4.X &&
    c5prov && c5prov[0] === Y3 && c5prov[1] === 0 &&
    c5draw.gap != null && c5draw.gap <= 4)
} else {
  const c5 = await copyPaste([s4.Y, s4.Z], [520, 500], false)
  const Z3 = c5.byTitle['Z']
  const c5prov = Z3 ? await provOf(Z3, 0) : null
  const linked = Z3 ? await page.evaluate(({ Z3 }) => window.app.graph.getNodeById(Number(Z3)).inputs[0].link != null, { Z3 }) : true
  console.log('C5 (plain, flag off):', JSON.stringify({ Z3, linked, c5prov }))
  results.C5 = !!(Z3 && !linked && !c5prov)
}

for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v ? 'PASS' : 'FAIL'}`)
const pass = Object.values(results).every(Boolean)
console.log(pass ? 'ALL PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
