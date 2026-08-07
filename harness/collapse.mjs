import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1500, height: 800 }, deviceScaleFactor: 2 })
const errs = []; page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  g.clear()
  const ck=L.createNode('CheckpointLoaderSimple'); ck.pos=[80,110]; g.add(ck)
  const te=L.createNode('CLIPTextEncode'); te.pos=[480,110]; g.add(te)
  const ks=L.createNode('KSampler'); ks.pos=[900,110]; g.add(ks)
  ck.connect(1,te,0); te.connect(0,ks,ks.inputs.findIndex(i=>i.name==='positive')); ck.connect(0,ks,ks.inputs.findIndex(i=>i.name==='model'))
  g.setDirtyCanvas(true,true); await new Promise(r=>setTimeout(r,1800))
  return { ks:String(ks.id) }
})
const before = await page.evaluate(i => {
  const el=document.querySelector(`.lg-node[data-node-id="${i.ks}"]`)
  const vis=s=>[...el.querySelectorAll(s)].filter(x=>x.getBoundingClientRect().height>0).length
  return { h: Math.round(el.getBoundingClientRect().height), inputsVisible: vis('.lg-slot--input'), handles: el.querySelectorAll('.cablemanagement-collapse').length }
}, ids)
await page.screenshot({ path: 'collapse-open.png' })
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.ks}"] .cablemanagement-collapse[data-which="inputs"]`)?.click(), ids)
await page.waitForTimeout(900)
const after = await page.evaluate(i => {
  const el=document.querySelector(`.lg-node[data-node-id="${i.ks}"]`)
  const vis=s=>[...el.querySelectorAll(s)].filter(x=>x.getBoundingClientRect().height>0).length
  const g=window.app.graph, ks=g.getNodeById(Number(i.ks))
  return {
    h: Math.round(el.getBoundingClientRect().height),
    inputsVisible: vis('.lg-slot--input'),
    connectedInputs: ks.inputs.filter(s=>s.link!=null && !s.widget).length,
    linksIntact: ks.inputs.filter(s=>s.link!=null).length,
  }
}, ids)
await page.screenshot({ path: 'collapse-closed.png' })
console.log('open  :', JSON.stringify(before))
console.log('closed:', JSON.stringify(after))
console.log('page errors:', errs.length); errs.slice(0,4).forEach(e=>console.log('  '+e.slice(0,140)))
await b.close()
