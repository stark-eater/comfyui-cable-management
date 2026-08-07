import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil:'domcontentloaded', timeout:90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout:120_000 })
await page.waitForTimeout(3000)
console.log(JSON.stringify(await page.evaluate(async () => {
  const g=window.app.graph,L=window.LiteGraph; g.clear()
  const A=L.createNode('CLIPTextEncode'); A.pos=[140,140]; g.add(A)
  await new Promise(r=>setTimeout(r,1500))
  const idx = A.inputs.findIndex(s=>s.widget?.name==='text')
  const prim = L.createNode('PrimitiveNode'); prim.pos=[A.pos[0]+10,A.pos[1]+10]; g.add(prim)
  prim.properties['cablemanagement.owned']=true; prim.properties['cablemanagement.host']=A.id
  prim.connect(0, A, idx)
  g.setDirtyCanvas(true,true)
  const probe = []
  for (const ms of [0, 50, 150, 400, 900, 1800]) {
    await new Promise(r=>setTimeout(r, ms))
    const d = document.querySelector(`[data-slot-key="${prim.id}-out-0"]`)
    const el = document.querySelector(`.lg-node[data-node-id="${prim.id}"]`)
    probe.push({ afterMs: ms, dot: !!d, dotW: d? Math.round(d.getBoundingClientRect().width):0,
                 nodeEl: !!el, vis: el? getComputedStyle(el).visibility : null })
  }
  return { primId: String(prim.id), probe }
}), null, 2))
await b.close()
