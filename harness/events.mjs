import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  g.clear()
  const ck=L.createNode('CheckpointLoaderSimple'); ck.pos=[80,120]; g.add(ck)
  const B=L.createNode('CLIPTextEncode'); B.pos=[520,120]; g.add(B)
  const C=L.createNode('CLIPTextEncode'); C.pos=[980,120]; g.add(C)
  ck.connect(1,B,0); g.setDirtyCanvas(true,true); await new Promise(r=>setTimeout(r,1700))
  // instrument every linkConnector event
  window.__ev = []
  const lc = window.app.canvas?.linkConnector
  window.__lcInfo = { hasLC: !!lc, hasEvents: !!lc?.events, addEL: typeof lc?.events?.addEventListener }
  for (const n of ['link-created','input-moved','output-moved','before-drop-links','after-drop-links','dropped-on-canvas','dropped-on-node','reset']) {
    lc?.events?.addEventListener?.(n, (e) => window.__ev.push([n, !!e?.detail]))
  }
  return { ck:String(ck.id), B:String(B.id), C:String(C.id) }
})
console.log('linkConnector:', JSON.stringify(await page.evaluate(() => window.__lcInfo)))
const from = await page.evaluate(i => { const p=document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${i.B}"][data-cablemanagement-index="0"]`); const r=p.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2] }, ids)
const to = await page.evaluate(i => { const d=document.querySelector(`[data-slot-key="${i.C}-in-0"]`); const r=d.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2] }, ids)
await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(to[0],to[1],{steps:10}); await page.mouse.up()
await page.waitForTimeout(1000)
console.log('events fired:', JSON.stringify(await page.evaluate(() => window.__ev)))
await b.close()
