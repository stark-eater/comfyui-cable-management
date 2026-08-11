// QA bug (post-polish): dragging ANY line while a passthrough-anchored floating
// link is on screen snapped the float back to its TRUE origin for the duration of
// the drag. Cause: core stamps `_dragging` on every output-attached floating link
// as a permanent style flag, so the ledger's "is this link being dragged" guard
// (which only added a global isConnecting check) matched every float during every
// drag. The guard must require membership in the connector's dragged-link sets.
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
await page.waitForTimeout(2500)

// Widget passthrough via a real pin drag (A.ckpt_name -> B.ckpt_name) -- the
// hidden primitive H then drives both, and everything from H draws at A's pin.
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const A = L.createNode('CheckpointLoaderSimple'); A.pos = [80, 100]; g.add(A)
  const B = L.createNode('CheckpointLoaderSimple'); B.pos = [700, 100]; g.add(B)
  const E = L.createNode('EmptyLatentImage'); E.pos = [80, 500]; g.add(E)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1800))
  return { A: String(A.id), B: String(B.id), E: E.id, bIdx: B.inputs.findIndex(s => s.widget?.name === 'ckpt_name') }
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
await page.mouse.move(pin.x, pin.y); await page.mouse.down()
await page.mouse.move(tgt.x, tgt.y, { steps: 12 }); await page.waitForTimeout(300)
await page.mouse.up(); await page.waitForTimeout(1200)

// Float H's output to a reroute parked on empty canvas, then capture where the
// float actually DRAWS from (effective, post-ledger endpoints).
const setup = await page.evaluate(async () => {
  const g = window.app.graph
  const H = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  if (!H) return null
  const r = H.connectFloatingReroute([500, 640], H.outputs[0])
  const fid = [...g.floatingLinks.keys()].pop()
  window.__cablemanagementCapture = true
  for (let i = 0; i < 4; i++) { g.setDirtyCanvas(true, true); await new Promise(res => setTimeout(res, 150)) }
  const d = window.__cablemanagementDraw?.get('f' + fid)
  const hPos = H.getConnectionPos(false, 0)
  return { fid, reroute: r?.id ?? null, start: d ? [d[0], d[1]] : null, hPos: [hPos[0], hPos[1]] }
})
ok('float exists and draws', !!setup?.start, JSON.stringify(setup))
const anchored = setup?.start && Math.hypot(setup.start[0] - setup.hPos[0], setup.start[1] - setup.hPos[1]) > 20
ok('float draws from the pin, not the hidden primitive', anchored, JSON.stringify(setup))

// Start an UNRELATED drag (E's output) and hold: the float must stay pin-anchored.
const mid = await page.evaluate(async i => {
  const g = window.app.graph
  const lc = window.app.canvas.linkConnector
  const E = g.getNodeById(i.E)
  if (typeof lc.dragNewFromOutput === 'function') lc.dragNewFromOutput(g, E, E.outputs[0])
  else lc.dragFromSlot?.(g, E, E.outputs[0])
  for (let k = 0; k < 4; k++) { g.setDirtyCanvas(true, true); await new Promise(res => setTimeout(res, 150)) }
  const d = window.__cablemanagementDraw?.get('f' + i.fid)
  return { connecting: lc.isConnecting, start: d ? [d[0], d[1]] : null }
}, { ...ids, fid: setup?.fid })
ok('unrelated drag is live', mid.connecting === true)
const held = mid.start && setup?.start &&
  Math.hypot(mid.start[0] - setup.start[0], mid.start[1] - setup.start[1]) < 2
ok('float stays pin-anchored during the drag', held, JSON.stringify({ before: setup?.start, during: mid.start }))

const after = await page.evaluate(async i => {
  const g = window.app.graph
  window.app.canvas.linkConnector.reset?.(true)
  for (let k = 0; k < 3; k++) { g.setDirtyCanvas(true, true); await new Promise(res => setTimeout(res, 150)) }
  const d = window.__cablemanagementDraw?.get('f' + i.fid)
  return d ? [d[0], d[1]] : null
}, { fid: setup?.fid })
ok('float pin-anchored after reset', after && setup?.start && Math.hypot(after[0] - setup.start[0], after[1] - setup.start[1]) < 2, JSON.stringify(after))

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
