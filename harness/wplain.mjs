// Bug C: widget pass-through pin -> PLAIN (non-widget) inputs.
// ShowText|pysssss.text is STRING forceInput (the _isValidConnection gate);
// PreviewAny.source is "*" (the ComfyWidgets-key gate). Second drop reuses the primitive.
// Both must connect AND deliver the literal in the built prompt.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2100, height: 1000 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const A = L.createNode('CLIPTextEncode'); A.pos = [140, 120]; A.title = 'A'; g.add(A)
  const S = L.createNode('ShowText|pysssss')
  const P = L.createNode('PreviewAny')
  if (S) { S.pos = [820, 120]; g.add(S) }
  if (P) { P.pos = [820, 420]; g.add(P) }
  const wa = A.widgets.find(w => w.name === 'text'); wa.value = 'plain delivery'
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return {
    A: String(A.id), S: S ? String(S.id) : null, P: P ? String(P.id) : null,
    sIdx: S ? S.inputs.findIndex(s => s.name === 'text') : -1,
    pIdx: P ? P.inputs.findIndex(s => s.name === 'source' || s.type === '*') : -1,
    sWidget: S ? !!S.inputs.find(s => s.name === 'text')?.widget : null,
    pWidget: P ? !!P.inputs[0]?.widget : null,
  }
})
console.log('nodes:', JSON.stringify(ids))
const pinPos = () => page.evaluate(i => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind !== undefined && x.dataset.cablemanagementIndex === String(1))
    ?? [...document.querySelectorAll('.cablemanagement-pin')].find(x => x.dataset.cablemanagementNode === i.A)
  if (!p) return null
  const r = p.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, ids)
const dotPos = (id, idx) => page.evaluate(({ id, idx }) => {
  const d = document.querySelector(`[data-slot-key="${id}-in-${idx}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })
async function drop(tgt) {
  const pin = await pinPos()
  if (!pin || !tgt) return false
  await page.mouse.move(...pin); await page.mouse.down()
  await page.mouse.move(tgt[0], tgt[1], { steps: 12 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
  return true
}
if (ids.S) await drop(await dotPos(ids.S, ids.sIdx))
if (ids.P) await drop(await dotPos(ids.P, ids.pIdx))
const after = await page.evaluate(async i => {
  const g = window.app.graph
  const S = i.S && g.getNodeById(Number(i.S)), P = i.P && g.getNodeById(Number(i.P))
  const p = await window.app.graphToPrompt()
  return {
    prims: g.nodes.filter(n => n.type === 'PrimitiveNode').length,
    sLinked: S ? S.inputs[i.sIdx].link != null : null,
    pLinked: P ? P.inputs[i.pIdx].link != null : null,
    sPrompt: S ? p.output[i.S]?.inputs?.text : null,
    pPrompt: P ? p.output[i.P]?.inputs?.source : null,
    sProv: S ? S.properties?.['cablemanagement.from']?.[String(i.sIdx)]?.slice(0, 2) : null,
    ledger: window.__cablemanagement?.ledger()?.size ?? 0,
  }
}, ids)
console.log('after:', JSON.stringify(after))
const sPass = !ids.S || (after.sLinked && after.sPrompt === 'plain delivery')
const pPass = !ids.P || (after.pLinked && after.pPrompt === 'plain delivery')
console.log('ShowText:', ids.S ? (sPass ? 'PASS' : 'FAIL') : 'absent', '| PreviewAny:', ids.P ? (pPass ? 'PASS' : 'FAIL') : 'absent')
console.log(sPass && pPass && after.prims === 1 ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(sPass && pPass && after.prims === 1 ? 0 : 1)
