// Link endpoint alignment through drawer changes on a node whose SIZE never changes
// (explicitly oversized): collapse, implied-connect into a hidden slot, reopen -- after
// each, core's getConnectionPos must match the DOM dot. Also: hidden slots must stack on
// the ellipsis centre so the snap indicator announces at the right place.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1700, height: 950 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [40, 60]; g.add(CK)
  const A = L.createNode('CLIPTextEncode'); A.pos = [40, 430]; A.title = 'A'; g.add(A)
  const K = L.createNode('KSampler'); K.pos = [620, 60]; g.add(K)
  const V = L.createNode('VAEDecode'); V.pos = [1150, 120]; g.add(V)
  CK.connect(0, K, K.inputs.findIndex(s => s.type === 'MODEL'))
  CK.connect(1, A, A.inputs.findIndex(s => s.type === 'CLIP'))
  K.connect(0, V, V.inputs.findIndex(s => s.type === 'LATENT'))
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1500))
  // Oversize K so drawer changes never alter its outer size.
  K.setSize([K.size[0], K.size[1] + 70])
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1200))
  return {
    A: String(A.id), K: String(K.id),
    posIdx: K.inputs.findIndex(s => s.name === 'positive'),
    latIdx: K.outputs.findIndex(s => s.type === 'LATENT'),
    kH: Math.round(K.size[1]),
  }
})
// Where the link is ACTUALLY drawn (captured from the render wrapper) vs the DOM dot.
await page.evaluate(() => { window.__cablemanagementCapture = true })
const gap = (nodeId, idx, isInput) => page.evaluate(async ({ nodeId, idx, isInput }) => {
  const app = window.app, g = app.graph, ds = app.canvas.ds
  const n = g.getNodeById(Number(nodeId))
  const slot = isInput ? n.inputs[idx] : n.outputs[idx]
  const linkId = isInput ? slot.link : slot.links?.[0]
  if (linkId == null) return null
  g.setDirtyCanvas(true, true)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const drawn = window.__cablemanagementDraw?.get(linkId)
  if (!drawn) return null
  const pt = isInput ? [drawn[2], drawn[3]] : [drawn[0], drawn[1]]
  const d = document.querySelector(`[data-slot-key="${nodeId}-${isInput ? 'in' : 'out'}-${idx}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect()
  const cr = app.canvas.canvas.getBoundingClientRect()
  const dom = [
    (r.x + r.width / 2 - cr.left) / ds.scale - ds.offset[0],
    (r.y + r.height / 2 - cr.top) / ds.scale - ds.offset[1],
  ]
  return { drawn: pt.map(v => Math.round(v)), dom: dom.map(v => Math.round(v)), dy: Math.round(pt[1] - dom[1]) }
}, { nodeId, idx, isInput })

const base = await gap(ids.K, ids.latIdx, false)
console.log('baseline LATENT:', JSON.stringify(base))

// Collapse inputs; size must not change; LATENT endpoint must still match its dot.
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.K}"] .cablemanagement-collapse[data-which="inputs"]`)?.click(), ids)
await page.waitForTimeout(1000)
const collapsed = await gap(ids.K, ids.latIdx, false)
const sizeNow = await page.evaluate(i => Math.round(window.app.graph.getNodeById(Number(i.K)).size[1]), ids)
console.log('collapsed LATENT:', JSON.stringify(collapsed), 'nodeH:', sizeNow, '(was', ids.kH + ')')

// Hidden positive slot: its stacked position must sit on the ellipsis centre.
const snap = await page.evaluate(i => {
  const el = document.querySelector(`.lg-node[data-node-id="${i.K}"]`)
  const more = el.querySelector('.cablemanagement-more[data-which="inputs"]')
  const dot = document.querySelector(`[data-slot-key="${i.K}-in-${i.posIdx}"]`)
  if (!more || !dot) return null
  const mr = more.getBoundingClientRect(), dr = dot.getBoundingClientRect()
  return { dy: Math.round((dr.y + dr.height / 2) - (mr.y + mr.height / 2)) }
}, ids)
console.log('hidden positive vs ellipsis dy:', JSON.stringify(snap))

// Implied connection: A CONDITIONING -> K body. positive unfolds; endpoint must align.
const from = await page.evaluate(i => {
  const d = document.querySelector(`[data-slot-key="${i.A}-out-0"]`)
  const r = d.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
const to = await page.evaluate(i => {
  const r = document.querySelector(`.lg-node[data-node-id="${i.K}"]`).getBoundingClientRect()
  return [r.x + r.width / 2, r.y + 12]
}, ids)
await page.mouse.move(...from); await page.mouse.down()
await page.mouse.move(to[0], to[1], { steps: 14 }); await page.waitForTimeout(400)
await page.mouse.up(); await page.waitForTimeout(1200)
const posAfter = await gap(ids.K, ids.posIdx, true)
const latAfter = await gap(ids.K, ids.latIdx, false)
console.log('after implied  positive:', JSON.stringify(posAfter), 'LATENT:', JSON.stringify(latAfter))

// Reopen the drawer; everything must realign again.
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.K}"] .cablemanagement-more[data-which="inputs"]`)?.click(), ids)
await page.waitForTimeout(1000)
const reopened = await gap(ids.K, ids.latIdx, false)
console.log('reopened LATENT:', JSON.stringify(reopened))

const ok = (r) => r && Math.abs(r.dy) <= 3
const pass = ok(base) && ok(collapsed) && sizeNow === ids.kH && snap && Math.abs(snap.dy) <= 4 &&
  ok(posAfter) && ok(latAfter) && ok(reopened)
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
