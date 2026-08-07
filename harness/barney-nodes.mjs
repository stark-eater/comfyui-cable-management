// Core nodes never lose their textarea. Barney's do. Load one of his real workflows and
// find every node whose widget-backed input renders NO control, then report what
// distinguishes those nodes -- node type, input spec, and how the input is serialised.
// Prime suspect: legacy "convert widget to input", where the widget is replaced by an input
// slot in the saved file and therefore never rendered at all.

import { chromium } from 'playwright'
import fs from 'node:fs'

const WF = process.argv[2] || 'E:/Projects/ComfyUI-5/user/default/workflows/CU5-v1-ft.json'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

const wf = JSON.parse(fs.readFileSync(WF, 'utf8'))
await page.evaluate(async (d) => await window.app.loadGraphData(d), wf)
await page.waitForTimeout(3000)

const report = await page.evaluate(() => {
  const app = window.app, g = app.graph
  const rows = []
  for (const node of g.nodes) {
    const nodeEl = document.querySelector(`.lg-node[data-node-id="${node.id}"]`)
    for (let i = 0; i < (node.inputs?.length ?? 0); i++) {
      const slot = node.inputs[i]
      if (!slot.widget) continue // only widget-backed inputs are interesting
      const widgetObj = node.widgets?.find((w) => w.name === slot.widget.name)
      const dot = document.querySelector(`[data-slot-key="${node.id}-in-${i}"]`)
      const row = dot?.closest('.lg-node-widget')
      const ctl = row?.querySelector('input, textarea, select, [contenteditable]')
      rows.push({
        nodeType: node.type,
        title: node.title,
        input: slot.name,
        widgetName: slot.widget.name,
        widgetType: widgetObj?.type ?? null,
        widgetObjectExists: !!widgetObj,
        linked: slot.link != null,
        rowRendered: !!row,
        controlTag: ctl ? ctl.tagName.toLowerCase() : null,
        nodeElFound: !!nodeEl,
        textareasOnNode: nodeEl ? nodeEl.querySelectorAll('textarea').length : null,
      })
    }
  }
  // Also: multiline widgets that exist on the node object but render no textarea
  const missing = []
  for (const node of g.nodes) {
    const multiline = (node.widgets ?? []).filter((w) => w.type === 'customtext' || w.type === 'textarea')
    if (!multiline.length) continue
    const nodeEl = document.querySelector(`.lg-node[data-node-id="${node.id}"]`)
    const tas = nodeEl ? nodeEl.querySelectorAll('textarea').length : 0
    if (tas < multiline.length) {
      missing.push({
        nodeType: node.type, title: node.title, id: String(node.id),
        multilineWidgets: multiline.map((w) => w.name),
        textareasRendered: tas,
        linkedInputs: (node.inputs ?? []).filter((s) => s.widget && s.link != null).map((s) => s.widget.name),
      })
    }
  }
  return { widgetBackedInputs: rows, multilineMissingTextarea: missing, totalNodes: g.nodes.length }
})

console.log(`workflow: ${WF.split('/').pop()}  nodes: ${report.totalNodes}`)
console.log(`\n--- widget-backed inputs (${report.widgetBackedInputs.length}) ---`)
for (const r of report.widgetBackedInputs.slice(0, 25)) {
  console.log(
    `  ${String(r.nodeType).slice(0, 26).padEnd(26)} ${String(r.widgetName).padEnd(16)} ` +
    `type=${String(r.widgetType).padEnd(11)} obj=${String(r.widgetObjectExists).padEnd(5)} ` +
    `linked=${String(r.linked).padEnd(5)} ctl=${String(r.controlTag).padEnd(9)} row=${r.rowRendered}`
  )
}

console.log(`\n--- multiline widgets rendering NO textarea (${report.multilineMissingTextarea.length}) ---`)
for (const m of report.multilineMissingTextarea) {
  console.log(`  ${m.nodeType} "${m.title}" id=${m.id}: widgets=[${m.multilineWidgets}] rendered=${m.textareasRendered} linkedWidgetInputs=[${m.linkedInputs}]`)
}

console.log('\npage errors:', errs.length)
fs.writeFileSync('barney-nodes.json', JSON.stringify(report, null, 2))
await browser.close()
