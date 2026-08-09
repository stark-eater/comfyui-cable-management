import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2100, height: 1100 } })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement, null, { timeout: 120_000 })
await page.waitForTimeout(2600)
async function drag(from, to) {
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(900)
}
const pinPos = (id, idx) => page.evaluate(({ id, idx }) => {
  const p = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${idx}"]`)
  const r = p?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })
const dotPos = (id, idx) => page.evaluate(({ id, idx }) => {
  const d = document.querySelector(`[data-slot-key="${id}-in-${idx}"]`)
  const r = d?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const A = L.createNode('EmptyLatentImage'); A.pos = [150, 150]; A.title = 'A'; g.add(A)
  const mk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const B = mk('B', 700, 100), C = mk('C', 700, 500), D = mk('D', 1350, 300)
  const idx = B.inputs.findIndex((s) => s.name === 'latent_image')
  A.connect(0, B, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { B: String(B.id), C: String(C.id), D: String(D.id), idx }
})
await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.C, ids.idx))
await drag(await pinPos(ids.C, ids.idx), await dotPos(ids.D, ids.idx))
await page.evaluate(() => {
  const t = window.app.extensionManager?.workflow?.activeWorkflow?.changeTracker
  t?.captureCanvasState?.()
})
await page.waitForTimeout(400)
const info = () => page.evaluate(({ B, C, D, idx }) => {
  const g = window.app.graph
  const t = window.app.extensionManager?.workflow?.activeWorkflow?.changeTracker
  const o = (id) => { const l = g.getNodeById(Number(id))?.inputs?.[idx]?.link; return l != null ? String(g.getLink(l)?.origin_id) : null }
  return { B: o(B), C: o(C), D: o(D), undo: t?.undoQueue?.length, redo: t?.redoQueue?.length, focus: document.activeElement?.tagName + '.' + (document.activeElement?.className?.slice?.(0, 30) ?? '') }
}, ids)
console.log('before cut:', JSON.stringify(await info()))
await page.evaluate(({ B, idx }) => {
  window.app.graph.getNodeById(Number(B)).disconnectInput(idx, false)
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
}, ids)
await page.waitForTimeout(900)
console.log('after cut: ', JSON.stringify(await info()))
await page.mouse.click(400, 980)   // focus the graph surface, away from nodes and minimap
await page.waitForTimeout(300)
await page.keyboard.press('Control+z')
await page.waitForTimeout(1200)
console.log('after undo:', JSON.stringify(await info()))
await b.close()
