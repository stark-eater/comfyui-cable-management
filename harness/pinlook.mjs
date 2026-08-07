import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1500, height: 800 }, deviceScaleFactor: 2 })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  g.clear()
  const ck = L.createNode('CheckpointLoaderSimple'); ck.pos=[60,80]; g.add(ck)
  const te = L.createNode('CLIPTextEncode'); te.pos=[470,80]; g.add(te)
  const ks = L.createNode('KSampler'); ks.pos=[900,80]; g.add(ks)
  ck.connect(1, te, 0); te.connect(0, ks, ks.inputs.findIndex(i=>i.name==='positive'))
  ck.connect(0, ks, ks.inputs.findIndex(i=>i.name==='model'))
  g.setDirtyCanvas(true,true); await new Promise(r=>setTimeout(r,1800))
})
const cmp = await page.evaluate(() => {
  const pin = document.querySelector('.cablemanagement-pin')
  const real = document.querySelector('[data-slot-key$="-in-0"]')
  const node = pin?.closest('.lg-node')
  const box = e => { const r=e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)} }
  const cs = e => { const s=getComputedStyle(e); return {bg:s.backgroundColor, border:s.border, radius:s.borderRadius} }
  const nr = node?.getBoundingClientRect()
  const pr = pin?.getBoundingClientRect()
  return {
    pin: pin ? { ...box(pin), ...cs(pin), type: pin.dataset.cablemanagementType, kind: pin.dataset.cablemanagementKind, colorVar: pin.style.getPropertyValue('--cablemanagement-slot-color') } : null,
    realSlotDot: real ? { ...box(real), ...cs(real) } : null,
    nodeRight: nr ? Math.round(nr.right) : null,
    pinCentreX: pr ? Math.round(pr.x + pr.width/2) : null,
    straddles: nr && pr ? Math.abs((pr.x + pr.width/2) - nr.right) <= 2 : null,
    pinColors: [...document.querySelectorAll('.cablemanagement-pin')].map(p => [p.dataset.cablemanagementType, getComputedStyle(p).backgroundColor]),
  }
})
console.log(JSON.stringify(cmp, null, 2))
await page.screenshot({ path: 'pinlook.png' })
await b.close()
