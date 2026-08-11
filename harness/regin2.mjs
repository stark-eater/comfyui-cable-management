// Bug A variant: drop a pass-through pin onto an ALREADY-CONNECTED regular input.
// In a real workflow every regular input is wired, so this is the case the user actually hits.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [40, 80]; g.add(CK)
  const CK2 = L.createNode('CheckpointLoaderSimple'); CK2.pos = [40, 420]; CK2.title = 'CK2'; g.add(CK2)
  const A = L.createNode('CLIPTextEncode'); A.pos = [430, 100]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [430, 520]; B.title = 'B'; g.add(B)
  const kA = A.inputs.findIndex(s => s.type === 'CLIP'), kB = B.inputs.findIndex(s => s.type === 'CLIP')
  CK.connect(1, A, kA)
  CK2.connect(1, B, kB) // B.clip PRE-CONNECTED from a different loader
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { CK: String(CK.id), CK2: String(CK2.id), A: String(A.id), B: String(B.id), kB }
})
const pin = await page.evaluate(i => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'link')
  const r = p.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
const tgt = await page.evaluate(i => {
  const d = document.querySelector(`[data-slot-key="${i.B}-in-${i.kB}"]`)
  const r = d.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
await page.mouse.move(...pin); await page.mouse.down()
await page.mouse.move(tgt[0], tgt[1], { steps: 14 }); await page.waitForTimeout(300)
await page.mouse.up(); await page.waitForTimeout(1000)
const after = await page.evaluate(i => {
  const g = window.app.graph, B = g.getNodeById(Number(i.B))
  const link = B.inputs[i.kB].link != null ? g.getLink(B.inputs[i.kB].link) : null
  return {
    linked: !!link, origin: link ? String(link.origin_id) : null,
    provenance: B.properties?.['cablemanagement.from']?.[String(i.kB)] ?? null,
  }
}, ids)
console.log('after:', JSON.stringify(after), '(want origin', ids.CK, '- was', ids.CK2 + ')')
const pass = after.linked && after.origin === ids.CK
console.log(pass ? 'PASS (replace works)' : 'FAIL (bug reproduced)')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
