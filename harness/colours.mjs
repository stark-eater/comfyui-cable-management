// After the appearance.js fix (debug log threw on circular changeTracker): do Barney's
// pack colours reach the nodes again? Load a real workflow, report node.color/bgcolor and
// whether the Vue node DOM reflects them.
import { chromium } from 'playwright'
import fs from 'node:fs'
const WF = process.argv[2] || 'E:/Projects/ComfyUI-5/user/default/workflows/CU5-v1-ft.json'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1800, height: 1000 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
const appearanceLogs = []
page.on('console', m => { const t = m.text(); if (/node colors|appearance/i.test(t)) appearanceLogs.push(t.slice(0, 120)) })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'))
await page.evaluate(async d => await window.app.loadGraphData(d), wf)
await page.waitForTimeout(3000)
const report = await page.evaluate(() => {
  const g = window.app.graph
  return g.nodes.map(n => {
    const el = document.querySelector(`.lg-node[data-node-id="${n.id}"]`)
    const header = el?.querySelector('[class*="header" i], header') ?? el
    const bg = header ? getComputedStyle(header).backgroundColor : null
    return { type: n.type, color: n.color ?? null, bgcolor: n.bgcolor ?? null, domBg: bg }
  })
})
const coloured = report.filter(r => r.color || r.bgcolor)
console.log(`nodes: ${report.length}, with colour set: ${coloured.length}`)
for (const r of coloured.slice(0, 12)) console.log(`  ${String(r.type).slice(0, 30).padEnd(30)} color=${r.color} bg=${r.bgcolor} domBg=${r.domBg}`)
if (!coloured.length) for (const r of report.slice(0, 8)) console.log(`  ${String(r.type).slice(0, 30).padEnd(30)} color=${r.color} domBg=${r.domBg}`)
appearanceLogs.slice(0, 3).forEach(l => console.log('  console: ' + l))
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
