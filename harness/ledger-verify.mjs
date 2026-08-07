import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1700, height: 950 } })
const errs = []; page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  g.clear()
  const ck = L.createNode('CheckpointLoaderSimple'); ck.pos = [80, 500]; g.add(ck)   // far below
  const B = L.createNode('CLIPTextEncode'); B.pos = [560, 100]; B.title='B'; g.add(B)
  const C = L.createNode('CLIPTextEncode'); C.pos = [1050, 100]; C.title='C'; g.add(C)
  ck.connect(1, B, 0); g.setDirtyCanvas(true, true)
  await new Promise(r => setTimeout(r, 1600))
  return { ck: String(ck.id), B: String(B.id), C: String(C.id) }
})
const from = await page.evaluate(i => { const p=document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${i.B}"][data-cablemanagement-index="0"]`); const r=p.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2] }, ids)
const to = await page.evaluate(i => { const d=document.querySelector(`[data-slot-key="${i.C}-in-0"]`); const r=d.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2] }, ids)
await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(to[0], to[1], {steps:12}); await page.mouse.up()
await page.mouse.move(900, 800)   // park the cursor so no tooltip
await page.waitForTimeout(1500)

console.log(JSON.stringify(await page.evaluate((i) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(i.C)), B = g.getNodeById(Number(i.B)), ck = g.getNodeById(Number(i.ck))
  const link = g.getLink(C.inputs[0].link)
  // _pos is the midpoint litegraph writes from the path it actually stroked -- it is also
  // what hit-testing and the midpoint dot use. If re-anchoring worked it tracks the DRAWN
  // line (B -> C), not the logical one (checkpoint -> C).
  const mid = link?._pos ? [Math.round(link._pos[0]), Math.round(link._pos[1])] : null
  const midOfLogical = [Math.round((ck.pos[0] + C.pos[0]) / 2), Math.round((ck.pos[1] + C.pos[1]) / 2)]
  const midOfDrawn   = [Math.round((B.pos[0] + C.pos[0]) / 2), Math.round((B.pos[1] + C.pos[1]) / 2)]
  const d = (a, b2) => a && b2 ? Math.round(Math.hypot(a[0]-b2[0], a[1]-b2[1])) : null
  return {
    logicalOrigin: String(link.origin_id), expectedLogical: i.ck,
    linkMidpoint: mid,
    ifDrawnFromCheckpoint: midOfLogical, distToThat: d(mid, midOfLogical),
    ifDrawnFromB: midOfDrawn, distToThat: d(mid, midOfDrawn),
    verdict: d(mid, midOfDrawn) < d(mid, midOfLogical) ? 'RE-ANCHORED to B' : 'still drawn from checkpoint',
  }
}, ids), null, 2))
console.log('LEDGER:', JSON.stringify(await page.evaluate(() => window.__cablemanagement?.ledger()), null, 2))
await page.screenshot({ path: 'ledger-caseA2.png' })
console.log('page errors:', errs.length)
await b.close()
