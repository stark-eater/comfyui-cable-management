// Bug 1: does dragging an UNCONNECTED widget pin draw a core wire, and does abandoning it
// leave the graph untouched?
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs=[]; page.on('pageerror',e=>errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil:'domcontentloaded', timeout:90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout:120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g=window.app.graph,L=window.LiteGraph
  g.clear()
  const A=L.createNode('CLIPTextEncode'); A.pos=[140,140]; A.title='A'; g.add(A)
  const B=L.createNode('CLIPTextEncode'); B.pos=[760,140]; B.title='B'; g.add(B)
  g.setDirtyCanvas(true,true); await new Promise(r=>setTimeout(r,1700))
  return { A:String(A.id), B:String(B.id) }
})
const nodes0 = await page.evaluate(()=>window.app.graph.nodes.length)
const pin = await page.evaluate(i=>{const p=[...document.querySelectorAll('.cablemanagement-pin')].find(x=>x.dataset.cablemanagementNode===i.A&&x.dataset.cablemanagementKind==='widget');const r=p.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]},ids)

// --- 1. abandon the drag on empty canvas: graph must be untouched
await page.mouse.move(...pin); await page.mouse.down(); await page.mouse.move(pin[0]+120, pin[1]+240, {steps:8})
const during = await page.evaluate(()=>({ coreLinks: window.app.canvas?.linkConnector?.renderLinks?.length ?? 0, connecting: !!window.app.canvas?.linkConnector?.isConnecting }))
await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(1200)
const afterAbort = await page.evaluate(()=>({ nodes: window.app.graph.nodes.length, prims: window.app.graph.nodes.filter(n=>n.type==='PrimitiveNode').length }))

// --- 2. real drop onto B's text widget input
const tgt = await page.evaluate(i=>{const g=window.app.graph,B=g.getNodeById(Number(i.B));const k=B.inputs.findIndex(s=>s.widget?.name==='text');const d=document.querySelector(`[data-slot-key="${i.B}-in-${k}"]`);const r=d.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]},ids)
const pin2 = await page.evaluate(i=>{const p=[...document.querySelectorAll('.cablemanagement-pin')].find(x=>x.dataset.cablemanagementNode===i.A&&x.dataset.cablemanagementKind==='widget');if(!p)return null;const r=p.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]},ids)
await page.mouse.move(...pin2); await page.mouse.down(); await page.mouse.move(tgt[0],tgt[1],{steps:12}); await page.mouse.up()
await page.waitForTimeout(1200)
const afterDrop = await page.evaluate(async i=>{
  const g=window.app.graph, prim=g.nodes.find(n=>n.type==='PrimitiveNode'), B=g.getNodeById(Number(i.B))
  const p=await window.app.graphToPrompt()
  return { prims: g.nodes.filter(n=>n.type==='PrimitiveNode').length, owned: prim?.properties?.['cablemanagement.owned']===true,
    primLinks:(prim?.outputs?.[0]?.links??[]).length, provenance:B.properties?.['cablemanagement.from']??null,
    ledger:{size:window.__cablemanagement?.ledger()?.size, applied:window.__cablemanagement?.ledger()?.applied} }
},ids)
console.log('nodes at start      :', nodes0)
console.log('during widget drag  :', JSON.stringify(during))
console.log('after ABORT         :', JSON.stringify(afterAbort))
console.log('after DROP          :', JSON.stringify(afterDrop))
console.log('page errors:', errs.length); errs.slice(0,4).forEach(e=>console.log('  '+e.slice(0,140)))
await b.close()
