import { chromium } from 'playwright'
const b=await chromium.launch({headless:true}); const page=await b.newPage({viewport:{width:1600,height:900}})
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187',{waitUntil:'domcontentloaded',timeout:90_000})
await page.waitForFunction(()=>window.app&&window.app.graph,null,{timeout:120_000}); await page.waitForTimeout(3000)
console.log(JSON.stringify(await page.evaluate(async()=>{
  const g=window.app.graph,L=window.LiteGraph; g.clear()
  const A=L.createNode('CLIPTextEncode');A.pos=[140,140];g.add(A)
  A.widgets.find(w=>w.name==='text').value='seed'
  await new Promise(r=>setTimeout(r,1400))
  const idx=A.inputs.findIndex(s=>s.widget?.name==='text'), slot=A.inputs[idx]
  const w=A.widgets.find(x=>x.name===slot.widget?.name)
  const prim=L.createNode('PrimitiveNode'); prim.pos=[A.pos[0]+10,A.pos[1]+10]; g.add(prim)
  prim.properties['cablemanagement.owned']=true; prim.properties['cablemanagement.host']=A.id; prim.properties['cablemanagement.hostSlot']=idx
  prim.outputs[0].type=slot.type; prim.outputs[0].widget={name:w.name}
  const added = prim.addWidget?.(w.type,w.name,'seed',()=>{},{...(w.options??{})})
  g.setDirtyCanvas(true,true)
  await new Promise(r=>setTimeout(r,1500))
  return {
    stillInGraph: !!g.getNodeById(prim.id),
    widgetAdded: !!added, widgets:(prim.widgets??[]).map(x=>x.name),
    outType: prim.outputs?.[0]?.type,
    nodeEl: !!document.querySelector(`.lg-node[data-node-id="${prim.id}"]`),
    dot: !!document.querySelector(`[data-slot-key="${prim.id}-out-0"]`),
    dotW: (()=>{const d=document.querySelector(`[data-slot-key="${prim.id}-out-0"]`);return d?Math.round(d.getBoundingClientRect().width):0})(),
  }
}),null,1))
await b.close()
