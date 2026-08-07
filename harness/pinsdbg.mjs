import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs=[]; page.on('pageerror',e=>errs.push(String(e)))
const cons=[]; page.on('console',m=>{if(m.type()==='error')cons.push(m.text().slice(0,200))})
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil:'domcontentloaded', timeout:90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout:120_000 })
await page.waitForTimeout(3000)
await page.evaluate(async () => {
  const g=window.app.graph,L=window.LiteGraph; g.clear()
  const A=L.createNode('CLIPTextEncode'); A.pos=[140,140]; g.add(A)
  g.setDirtyCanvas(true,true); await new Promise(r=>setTimeout(r,1800))
})
console.log('pins:', JSON.stringify(await page.evaluate(() =>
  [...document.querySelectorAll('.cablemanagement-pin')].map(p=>({n:p.dataset.cablemanagementNode,i:p.dataset.cablemanagementIndex,k:p.dataset.cablemanagementKind}))
)))
console.log('page errors:', errs.length); errs.slice(0,3).forEach(e=>console.log('  '+e.split('\n')[0].slice(0,180)))
console.log('ALL console errors:'); cons.slice(0,8).forEach(c=>console.log('  '+c))
await b.close()
