import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  g.clear()
  const A = L.createNode('CLIPTextEncode'); A.pos=[140,140]; A.title='A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos=[760,140]; B.title='B'; g.add(B)
  g.setDirtyCanvas(true,true); await new Promise(r=>setTimeout(r,1600))
  return { A:String(A.id), B:String(B.id) }
})
const wpin = await page.evaluate(i => { const p=[...document.querySelectorAll('.cablemanagement-pin')].find(x=>x.dataset.cablemanagementNode===i.A&&x.dataset.cablemanagementKind==='widget'); const r=p.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2] }, ids)
const wtgt = await page.evaluate(i => { const g=window.app.graph,B=g.getNodeById(Number(i.B)); const k=B.inputs.findIndex(s=>s.widget?.name==='text'); const d=document.querySelector(`[data-slot-key="${i.B}-in-${k}"]`); const r=d.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2] }, ids)
await page.mouse.move(...wpin); await page.mouse.down(); await page.mouse.move(wtgt[0],wtgt[1],{steps:12}); await page.mouse.up()
await page.mouse.move(900,820); await page.waitForTimeout(1600)

// Programmatic write to B's stand-in: does the rendered textarea follow?
const r = await page.evaluate(async (i) => {
  const g = window.app.graph
  const B = g.getNodeById(Number(i.B))
  const S = Symbol.for('cablemanagement.standin')
  const w = B.widgets?.find(x => x[S] !== undefined)
  const dom = () => { const el = document.querySelector(`.lg-node[data-node-id="${i.B}"]`); const t=[...el.querySelectorAll('textarea')].find(x=>!x.disabled); return t?.value }
  const before = dom()
  w.value = 'PROGRAMMATIC'
  await new Promise(r => setTimeout(r, 600))
  const afterPlain = dom()
  // does going through the store help?
  let afterStore = null
  try {
    const mod = w.constructor
    w._state && (w._state.value = 'VIA_STATE')
    await new Promise(r => setTimeout(r, 600))
    afterStore = dom()
  } catch (e) { afterStore = 'ERR ' + e }
  return { widgetValue: w.value, before, afterPlain, afterStore, hasState: !!w._state, widgetId: w.widgetId ?? null }
}, ids)
console.log(JSON.stringify(r, null, 2))
await b.close()
