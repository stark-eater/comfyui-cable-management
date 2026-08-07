import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs=[]; page.on('pageerror',e=>errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187',{waitUntil:'domcontentloaded',timeout:90_000})
await page.waitForFunction(()=>window.app&&window.app.graph,null,{timeout:120_000})
await page.waitForTimeout(3000)
const ids = await page.evaluate(async()=>{
  const g=window.app.graph,L=window.LiteGraph; g.clear()
  const A=L.createNode('CLIPTextEncode');A.pos=[140,140];A.title='A';g.add(A)
  const B=L.createNode('CLIPTextEncode');B.pos=[760,140];B.title='B';g.add(B)
  g.setDirtyCanvas(true,true); await new Promise(r=>setTimeout(r,1700))
  window.__ev=[]
  const lc=window.app.canvas?.linkConnector
  for(const n of ['link-created','dropped-on-node','dropped-on-canvas','before-drop-links','after-drop-links','reset'])
    lc?.events?.addEventListener?.(n,e=>window.__ev.push(n))
  return {A:String(A.id),B:String(B.id)}
})
const pin=await page.evaluate(i=>{const p=[...document.querySelectorAll('.cablemanagement-pin')].find(x=>x.dataset.cablemanagementNode===i.A&&x.dataset.cablemanagementKind==='widget');const r=p.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]},ids)
const tgt=await page.evaluate(i=>{const g=window.app.graph,B=g.getNodeById(Number(i.B));const k=B.inputs.findIndex(s=>s.widget?.name==='text');const d=document.querySelector(`[data-slot-key="${i.B}-in-${k}"]`);const r=d.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]},ids)
await page.mouse.move(...pin); await page.mouse.down()
await page.mouse.move(pin[0]+80,pin[1]+30,{steps:5})
await page.waitForTimeout(300)
const during=await page.evaluate(()=>({coreLinks:window.app.canvas?.linkConnector?.renderLinks?.length??0,prims:window.app.graph.nodes.filter(n=>n.type==='PrimitiveNode').length}))
await page.mouse.move(tgt[0],tgt[1],{steps:12}); await page.waitForTimeout(200); await page.mouse.up()
await page.waitForTimeout(1500)
const after=await page.evaluate(async i=>{
  const g=window.app.graph,prim=g.nodes.find(n=>n.type==='PrimitiveNode'),B=g.getNodeById(Number(i.B))
  const k=B.inputs.findIndex(s=>s.widget?.name==='text')
  const p=await window.app.graphToPrompt()
  return {events:window.__ev,prims:g.nodes.filter(n=>n.type==='PrimitiveNode').length,
    bLinked:B.inputs[k].link!=null, provenance:B.properties?.['cablemanagement.from']??null,
    aText:p.output[i.A]?.inputs?.text, bText:p.output[i.B]?.inputs?.text,
    ledger:window.__cablemanagement?.ledger()}
},ids)
console.log('during:',JSON.stringify(during))
console.log('after :',JSON.stringify({...after,ledger:{size:after.ledger?.size,vals:after.ledger?.values}},null,2))
console.log('page errors:',errs.length); errs.slice(0,4).forEach(e=>console.log('  '+e.slice(0,140)))
await b.close()
