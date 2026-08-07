// Carets sized to their strips: inputs caret = header height - 4, outputs caret = badges
// row height - 4 (fallback 14 where a node has no badges row).
import { chromium } from 'playwright'
import fs from 'node:fs'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const wf = JSON.parse(fs.readFileSync('E:/Projects/ComfyUI-5/user/default/workflows/CU5-v1-ft.json', 'utf8'))
await page.evaluate(async d => await window.app.loadGraphData(d), wf)
await page.waitForTimeout(2500)
const scale = await page.evaluate(() => window.app.canvas?.ds?.scale ?? 1)
const report = await page.evaluate(() => {
  const out = []
  for (const nodeEl of document.querySelectorAll('.lg-node[data-node-id]')) {
    const nr = nodeEl.getBoundingClientRect()
    const body = nodeEl.querySelector('[data-testid^="node-body-"]')
    const badge = nodeEl.querySelector('[data-testid^="node-body-"] > .mt-auto')
    const inCaret = nodeEl.querySelector('.cablemanagement-collapse[data-which="inputs"]')
    const outCaret = nodeEl.querySelector('.cablemanagement-collapse[data-which="outputs"]')
    if (!inCaret && !outCaret) continue
    const headerH = body ? Math.round(body.getBoundingClientRect().top - nr.top) : null
    const badgeH = badge?.getBoundingClientRect().height ? Math.round(badge.getBoundingClientRect().height) : null
    out.push({
      id: nodeEl.dataset.nodeId,
      headerH, badgeH,
      inH: inCaret ? Math.round(inCaret.getBoundingClientRect().height) : null,
      outH: outCaret ? Math.round(outCaret.getBoundingClientRect().height) : null,
    })
  }
  return out
})
let ok = 0, bad = 0
for (const r of report.slice(0, 10)) {
  // Both carets: header height minus 4px inset, all in screen px (scale-adjusted).
  const want = r.headerH != null ? r.headerH - 4 * scale : null
  const inOk = r.inH == null || want == null || Math.abs(r.inH - want) <= 2
  const outOk = r.outH == null || want == null || Math.abs(r.outH - want) <= 2
  inOk && outOk ? ok++ : bad++
  console.log(`  node ${String(r.id).padEnd(4)} headerH=${r.headerH} want=${want?.toFixed(1)} inCaret=${r.inH} outCaret=${r.outH} ${inOk && outOk ? 'ok' : 'MISMATCH'}`)
}
console.log(`${ok} ok, ${bad} mismatched`)
console.log(bad === 0 && ok > 0 ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length)
await b.close()
process.exit(bad === 0 && ok > 0 ? 0 : 1)
