// 2e hello-world: prove the SUBSTRATE for first-class routes before writing routes.js.
// No product code is exercised -- the probe hand-writes the v1 store shape and answers
// the two questions the design hinges on:
//   (1) does a `graph.extra.cablemanagement_routes` tree survive serialize -> configure
//       byte-identical, and undo/redo without tripping ChangeTracker drift (sweep bug 2:
//       any serialize/configure non-idempotency wipes the redo queue)?
//   (2) can we draw a GHOST stroke for a link that does not physically exist (headless
//       fragment rendering: B->C->D drawn floating-style with no real links), verified
//       by pixel readback at the choke point's layer?
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement, null, { timeout: 120_000 })
await page.waitForTimeout(2600)

// Scene: A (EmptyLatentImage) -> B (KSampler).latent_image, one real link -- plus a
// hand-written v1 route tree describing an IMAGINED chain A -> B -> C-that-died, so the
// store holds refs both to live entities and to remembered-but-severed consumers.
const built = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  g.clear()
  const A = L.createNode('EmptyLatentImage'); A.pos = [200, 200]; g.add(A)
  const B = L.createNode('KSampler'); B.pos = [700, 200]; g.add(B)
  const idx = B.inputs.findIndex((s) => s.name === 'latent_image')
  A.connect(0, B, idx)
  const linkId = B.inputs[idx].link
  ;(g.extra ??= {}).cablemanagement_routes = {
    v: 1,
    next: 2,
    byId: {
      r1: {
        origin: { kind: 'output', node: String(A.id), slot: 0 },
        hops: { 'pin:B:0': { kind: 'pin', node: String(B.id), input: idx, parent: null } },
        consumers: [
          { node: String(B.id), input: idx, link: linkId, parent: null },
          { node: '999', input: 0, link: null, parent: 'pin:B:0' }, // severed memory
        ],
      },
    },
  }
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 900))
  return { A: String(A.id), B: String(B.id), idx, nodes: g.nodes.length }
})
ok('scene built (A->B + route store written)', built.nodes === 2, JSON.stringify(built))

// (1a) serialize -> configure -> serialize must be byte-identical WITH the store present.
// Sweep bug 2 taught that any drift here silently wipes the redo queue on every undo.
const idem = await page.evaluate(() => {
  const g = window.app.graph
  // Top-level graph id re-mints on every configure -- STOCK behavior, fingerprinted and
  // skipped by sweep-e long before routes existed. Normalize it; everything else must hold.
  const ser = () => JSON.stringify({ ...g.serialize(), id: '<graph-id>' })
  const s1 = ser()
  g.configure(JSON.parse(JSON.stringify(g.serialize())))
  const s2 = ser()
  const routes = g.extra?.cablemanagement_routes
  return { same: s1 === s2, kept: routes?.v === 1 && !!routes.byId?.r1, drift: s1 === s2 ? '' : diffAt(s1, s2) }
  function diffAt(a, b) {
    let i = 0
    while (i < a.length && a[i] === b[i]) i++
    return `@${i}: ...${a.slice(Math.max(0, i - 40), i + 40)}... vs ...${b.slice(Math.max(0, i - 40), i + 40)}...`
  }
})
ok('serialize/configure idempotent with route store', idem.same, idem.drift)
ok('store survives configure', idem.kept)

// (1b) undo/redo liveness. Checkpoint the scene, mutate (add node + touch the store the
// way cure would), checkpoint again, then undo and redo -- both directions must restore,
// store included. A wiped redo (sweep-bug-2 symptom) fails the third assert.
await page.evaluate(() => {
  const t = window.app.extensionManager?.workflow?.activeWorkflow?.changeTracker
  ;(t?.captureCanvasState ?? t?.checkState)?.call(t)
})
await page.waitForTimeout(300)
await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  const C = L.createNode('EmptyLatentImage'); C.pos = [200, 500]; g.add(C)
  const store = g.extra.cablemanagement_routes
  store.next = 3
  store.byId.r2 = { origin: { kind: 'output', node: String(C.id), slot: 0 }, hops: {}, consumers: [] }
  g.setDirtyCanvas(true, true)
  const t = window.app.extensionManager?.workflow?.activeWorkflow?.changeTracker
  ;(t?.captureCanvasState ?? t?.checkState)?.call(t)
  await new Promise((r) => setTimeout(r, 400))
})
const counts = () => page.evaluate(() => ({
  nodes: window.app.graph.nodes.length,
  routes: Object.keys(window.app.graph.extra?.cablemanagement_routes?.byId ?? {}).length,
}))
const afterAdd = await counts()
ok('mutation landed (3 nodes, 2 routes)', afterAdd.nodes === 3 && afterAdd.routes === 2, JSON.stringify(afterAdd))
await page.keyboard.press('Control+z')
await page.waitForTimeout(1200)
const afterUndo = await counts()
ok('undo restores pre-mutation store (2 nodes, 1 route)', afterUndo.nodes === 2 && afterUndo.routes === 1, JSON.stringify(afterUndo))
await page.keyboard.press('Control+y')
await page.waitForTimeout(1200)
const afterRedo = await counts()
ok('redo NOT wiped, store returns (3 nodes, 2 routes)', afterRedo.nodes === 3 && afterRedo.routes === 2, JSON.stringify(afterRedo))

// (2) Ghost stroke: draw a link that does not exist. Wrap drawConnections (the ledger's
// own layer -- under nodes in legacy, under everything DOM in Vue), stroke a fat magenta
// dash across empty graph space, force a synchronous draw, and read the pixel back.
const ghost = await page.evaluate(() => {
  const canvas = window.app.canvas
  const proto = canvas.constructor.prototype
  const orig = proto.drawConnections
  const gA = [300, 700], gB = [900, 700] // empty band well below the nodes
  proto.drawConnections = function (ctx) {
    const r = orig.call(this, ctx)
    ctx.save()
    ctx.strokeStyle = '#ff00ff'
    ctx.lineWidth = 14
    ctx.setLineDash([10, 6])
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.moveTo(gA[0], gA[1])
    ctx.lineTo(gB[0], gB[1])
    ctx.stroke()
    ctx.restore()
    return r
  }
  canvas.setDirty(true, true)
  canvas.draw(true, true) // synchronous: nothing repaints between draw and readback
  const ds = canvas.ds
  const mid = [((gA[0] + gB[0]) / 2 + ds.offset[0]) * ds.scale, (gA[1] + ds.offset[1]) * ds.scale]
  const el = canvas.canvas
  const dpr = el.width / el.clientWidth // backing store may be DPR-scaled
  const ctx2 = el.getContext('2d')
  let best = null
  for (let dx = -20; dx <= 20; dx += 4) { // dashed: sample along the line, keep the most magenta
    const p = ctx2.getImageData(Math.round((mid[0] + dx) * dpr), Math.round(mid[1] * dpr), 1, 1).data
    if (!best || (p[0] + p[2] - p[1]) > (best[0] + best[2] - best[1])) best = [...p]
  }
  proto.drawConnections = orig // leave the prototype as found
  canvas.setDirty(true, true)
  return { px: best, mid, dpr, scale: ds.scale }
})
ok('ghost stroke lands on the canvas (magenta at midpoint)',
  ghost.px && ghost.px[0] > 180 && ghost.px[2] > 180 && ghost.px[1] < 90, JSON.stringify(ghost))

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
