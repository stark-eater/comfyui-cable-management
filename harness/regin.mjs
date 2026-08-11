// Bug A repro: drag a pass-through pin onto a REGULAR (non-widget) input slot.
// Case 1: link-kind pin (A.clip, fed by checkpoint) -> B.clip (plain CLIP input).
// Reports the drop outcome plus what element sat under the drop point mid-drag.
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
  const A = L.createNode('CLIPTextEncode'); A.pos = [430, 100]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [430, 520]; B.title = 'B'; g.add(B)
  CK.connect(1, A, A.inputs.findIndex(s => s.type === 'CLIP'))
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { CK: String(CK.id), A: String(A.id), B: String(B.id), clipIdx: A.inputs.findIndex(s => s.type === 'CLIP') }
})
const pin = await page.evaluate(i => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'link')
  if (!p) return null
  const r = p.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
if (!pin) { console.log('NO LINK PIN on A'); await b.close(); process.exit(1) }
const tgt = await page.evaluate(i => {
  const d = document.querySelector(`[data-slot-key="${i.B}-in-${i.clipIdx}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
if (!tgt) { console.log('NO TARGET DOT on B.clip'); await b.close(); process.exit(1) }
console.log('pin:', pin.map(Math.round), 'tgt:', tgt.map(Math.round))
await page.mouse.move(...pin); await page.mouse.down()
await page.mouse.move(tgt[0], tgt[1], { steps: 14 })
await page.waitForTimeout(300)
const mid = await page.evaluate(({ tgt }) => {
  const el = document.elementFromPoint(tgt[0], tgt[1])
  return {
    renderLinks: window.app.canvas?.linkConnector?.renderLinks?.length ?? 0,
    under: el ? `${el.tagName}.${String(el.className).slice(0, 50)}` : 'NOTHING',
    underSlotKey: el?.closest?.('[data-slot-key]')?.dataset?.slotKey ?? null,
  }
}, { tgt })
await page.mouse.up()
await page.waitForTimeout(1000)
const after = await page.evaluate(i => {
  const g = window.app.graph, B = g.getNodeById(Number(i.B))
  const k = i.clipIdx
  const link = B.inputs[k].link != null ? g.getLink(B.inputs[k].link) : null
  return {
    bClipLinked: !!link, origin: link ? String(link.origin_id) : null,
    provenance: B.properties?.['cablemanagement.from']?.[String(k)] ?? null,
  }
}, ids)
console.log('mid-drag:', JSON.stringify(mid))
console.log('after   :', JSON.stringify(after))
const pass = after.bClipLinked && after.origin === ids.CK
console.log(pass ? 'PASS (no repro)' : 'FAIL (bug reproduced)')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
