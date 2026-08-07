import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const errs=[]; page.on('pageerror',e=>errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187',{waitUntil:'domcontentloaded',timeout:90_000})
await page.waitForFunction(()=>window.app&&window.app.graph,null,{timeout:120_000})
await page.waitForTimeout(3000)
const ids=await page.evaluate(async()=>{
  const g=window.app.graph,L=window.LiteGraph; g.clear()
  const A=L.createNode('CLIPTextEncode');A.pos=[140,140];A.title='A';g.add(A)
  const B=L.createNode('CLIPTextEncode');B.pos=[760,140];B.title='B';g.add(B)
  A.widgets.find(w=>w.name==='text').value='hello from A'
  g.setDirtyCanvas(true,true); await new Promise(r=>setTimeout(r,1700))
  return {A:String(A.id),B:String(B.id)}
})
const layoutBefore = await page.evaluate(i=>{
  const el=document.querySelector(`.lg-node[data-node-id="${i.A}"]`)
  return { h:Math.round(el.getBoundingClientRect().height), rows:el.querySelectorAll('.lg-node-widget').length,
           tas:[...el.querySelectorAll('textarea')].map(t=>({dis:t.disabled,v:t.value,vis:t.getBoundingClientRect().height>0})) }
},ids)
const pin=await page.evaluate(i=>{const p=[...document.querySelectorAll('.cablemanagement-pin')].find(x=>x.dataset.cablemanagementNode===i.A&&x.dataset.cablemanagementKind==='widget');const r=p.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]},ids)
const tgt=await page.evaluate(i=>{const g=window.app.graph,B=g.getNodeById(Number(i.B));const k=B.inputs.findIndex(s=>s.widget?.name==='text');const d=document.querySelector(`[data-slot-key="${i.B}-in-${k}"]`);const r=d.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]},ids)
await page.mouse.move(...pin); await page.mouse.down(); await page.mouse.move(tgt[0],tgt[1],{steps:12}); await page.mouse.up()
await page.mouse.move(900,800); await page.waitForTimeout(1500)
const after=await page.evaluate(async i=>{
  const g=window.app.graph,prim=g.nodes.find(n=>n.type==='PrimitiveNode'),A=g.getNodeById(Number(i.A)),B=g.getNodeById(Number(i.B))
  const el=document.querySelector(`.lg-node[data-node-id="${i.A}"]`)
  const k=B.inputs.findIndex(s=>s.widget?.name==='text')
  let prompt=null,err=null
  try{ prompt=(await window.app.graphToPrompt()).output }catch(e){err=String(e).split('\n')[0]}
  return {
    hostLayout:{h:Math.round(el.getBoundingClientRect().height),rows:el.querySelectorAll('.lg-node-widget').length,
      tas:[...el.querySelectorAll('textarea')].map(t=>({dis:t.disabled,v:t.value,vis:t.getBoundingClientRect().height>0}))},
    hostWidgetInputLinked:A.inputs[A.inputs.findIndex(s=>s.widget?.name==='text')].link!=null,
    primExists:!!prim, primLinks:(prim?.outputs?.[0]?.links??[]).length, primValue:prim?.widgets?.[0]?.value,
    bLinked:B.inputs[k].link!=null, provenance:B.properties?.['cablemanagement.from']??null,
    aText:prompt?.[i.A]?.inputs?.text, bText:prompt?.[i.B]?.inputs?.text, promptErr:err,
    standins:document.querySelectorAll('[data-cablemanagement-standin]').length, dead:document.querySelectorAll('[data-cablemanagement-dead]').length,
  }
},ids)
console.log('host layout BEFORE:',JSON.stringify(layoutBefore))
console.log('host layout AFTER :',JSON.stringify(after.hostLayout))
console.log('rest:',JSON.stringify({...after,hostLayout:undefined},null,1))
console.log('page errors:',errs.length); errs.slice(0,4).forEach(e=>console.log('  '+e.slice(0,150)))
await page.screenshot({path:'wdrop2.png'})
await b.close()
