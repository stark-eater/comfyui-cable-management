// Bug A hunt on a REAL workflow: try pass-through pin -> regular input drops across the
// graph and tally which succeed. Usage: node regin3.mjs [workflow.json] [maxTries]
import { chromium } from 'playwright'
import fs from 'node:fs'
const WF = process.argv[2] || 'E:/Projects/ComfyUI-5/user/default/workflows/CU5-v1-ft.json'
const MAX = Number(process.argv[3] || 6)
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'))
await page.evaluate(async d => await window.app.loadGraphData(d), wf)
await page.waitForTimeout(2500)

// Enumerate candidate pairs: link-kind pin whose type matches a REGULAR (non-widget) input
// on a different node, both with visible geometry on screen.
const pairs = await page.evaluate(() => {
  const g = window.app.canvas?.graph ?? window.app.graph
  const out = []
  const pins = [...document.querySelectorAll('.cablemanagement-pin[data-cablemanagement-kind="link"]')]
  for (const p of pins) {
    const hostId = p.dataset.cablemanagementNode, type = p.dataset.cablemanagementType
    const pr = p.getBoundingClientRect()
    if (!pr.width || pr.x < 0 || pr.y < 0 || pr.x > 1900 || pr.y > 1000) continue
    for (const n of g.nodes) {
      if (String(n.id) === hostId) continue
      for (let i = 0; i < (n.inputs?.length ?? 0); i++) {
        const s = n.inputs[i]
        if (s.widget) continue // regular inputs only
        if (String(s.type) !== String(type)) continue
        const d = document.querySelector(`[data-slot-key="${n.id}-in-${i}"]`)
        const r = d?.getBoundingClientRect()
        if (!r?.width || r.x < 0 || r.y < 0 || r.x > 1900 || r.y > 1000) continue
        out.push({
          pin: [pr.x + pr.width / 2, pr.y + pr.height / 2], hostId, hostIdx: Number(p.dataset.cablemanagementIndex),
          tgt: [r.x + r.width / 2, r.y + r.height / 2], tgtId: String(n.id), tgtIdx: i,
          type, tgtType: String(n.type).slice(0, 24), wasLinked: s.link != null,
        })
      }
    }
  }
  return out
})
console.log(`candidate pairs: ${pairs.length}`)
let ok = 0, bad = 0
for (const c of pairs.slice(0, MAX)) {
  // expected origin = what truly feeds the pin's input right now
  const want = await page.evaluate(({ hostId, hostIdx }) => {
    const g = window.app.canvas?.graph ?? window.app.graph
    const h = g.getNodeById(Number(hostId))
    const l = h?.inputs?.[hostIdx]?.link != null ? g.getLink(h.inputs[hostIdx].link) : null
    return l ? { origin: String(l.origin_id), slot: l.origin_slot } : null
  }, c)
  if (!want) { console.log(`  SKIP ${c.hostId}:${c.hostIdx} (no origin)`); continue }
  await page.mouse.move(...c.pin); await page.mouse.down()
  await page.mouse.move(c.tgt[0], c.tgt[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
  const got = await page.evaluate(({ tgtId, tgtIdx }) => {
    const g = window.app.canvas?.graph ?? window.app.graph
    const n = g.getNodeById(Number(tgtId))
    const l = n?.inputs?.[tgtIdx]?.link != null ? g.getLink(n.inputs[tgtIdx].link) : null
    return l ? String(l.origin_id) : null
  }, c)
  const pass = got === want.origin
  pass ? ok++ : bad++
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${c.type.padEnd(12)} pin ${c.hostId}:${c.hostIdx} -> ${c.tgtType} ${c.tgtId}:${c.tgtIdx} (wasLinked=${c.wasLinked}) got origin=${got} want=${want.origin}`)
}
console.log(`result: ${ok} ok, ${bad} fail`)
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(bad ? 1 : 0)
