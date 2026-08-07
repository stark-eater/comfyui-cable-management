// Barney's caveat: when a widget input is connected, number/combo widgets merely go
// disabled, but TEXTAREAS are hidden or removed. My earlier Q2 only tested `steps`.
// Measure each widget type properly -- the answer decides whether an owned primitive can be
// hidden for that widget or has to stay visible/re-surfaced.

import { chromium } from 'playwright'
import fs from 'node:fs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

const probe = async (nodeType, widgetName) =>
  page.evaluate(
    async ([nodeType, widgetName]) => {
      const app = window.app, LiteGraph = window.LiteGraph, g = app.graph
      g.clear()
      const host = LiteGraph.createNode(nodeType)
      host.pos = [600, 120]
      g.add(host)
      await new Promise((r) => setTimeout(r, 800))

      const idx = host.inputs.findIndex((i) => i.widget?.name === widgetName || i.name === widgetName)
      if (idx < 0) return { error: `no widget input ${widgetName} on ${nodeType}`, inputs: host.inputs.map((i) => i.name) }

      const snap = (label) => {
        const dot = document.querySelector(`[data-slot-key="${host.id}-in-${idx}"]`)
        const row = dot?.closest('.lg-node-widget')
        const ctl = row?.querySelector('input, select, textarea, [contenteditable]')
        const gridRows = document.querySelectorAll(`[data-widgets-grid-node-id="${host.id}"] .lg-node-widget`).length
        return {
          label,
          rowFound: !!row,
          gridRows,
          controlTag: ctl ? ctl.tagName.toLowerCase() : null,
          controlDisabled: ctl ? !!(ctl.disabled || ctl.getAttribute('aria-disabled') === 'true' || ctl.readOnly) : null,
          controlVisible: ctl ? (() => { const r = ctl.getBoundingClientRect(); const cs = getComputedStyle(ctl); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' })() : null,
          rowText: (row?.textContent || '').trim().slice(0, 30),
          widgetObjectPresent: !!host.widgets?.find((w) => w.name === widgetName),
          widgetType: host.widgets?.find((w) => w.name === widgetName)?.type ?? null,
        }
      }

      const before = snap('unconnected')

      const prim = LiteGraph.createNode('PrimitiveNode')
      prim.pos = [200, 120]
      g.add(prim)
      prim.connect(0, host, idx)
      g.setDirtyCanvas(true, true)
      await new Promise((r) => setTimeout(r, 900))

      const after = snap('connected')
      return {
        nodeType, widgetName, before, after,
        primitiveWidget: prim.widgets?.[0] ? { name: prim.widgets[0].name, type: prim.widgets[0].type } : null,
        primitiveHasTextarea: !!document.querySelector(`.lg-node[data-node-id="${prim.id}"] textarea`),
      }
    },
    [nodeType, widgetName]
  )

const cases = [
  ['KSampler', 'steps'],           // number
  ['KSampler', 'sampler_name'],    // combo
  ['CLIPTextEncode', 'text'],      // multiline textarea -- the one that matters
  ['SaveImage', 'filename_prefix'] // single-line string
]

const results = []
for (const [t, w] of cases) {
  const r = await probe(t, w)
  results.push(r)
  if (r.error) { console.log(`\n${t}.${w}: ${r.error}`); continue }
  console.log(`\n=== ${t}.${w}  (widget type: ${r.before.widgetType}) ===`)
  for (const s of [r.before, r.after]) {
    console.log(
      `  ${s.label.padEnd(12)} rows=${s.gridRows} row=${s.rowFound} ctl=${String(s.controlTag).padEnd(8)} ` +
      `disabled=${String(s.controlDisabled).padEnd(5)} visible=${String(s.controlVisible).padEnd(5)} text="${s.rowText}"`
    )
  }
  console.log(`  primitive widget: ${JSON.stringify(r.primitiveWidget)}  primitiveHasTextarea=${r.primitiveHasTextarea}`)
}

console.log('\npage errors:', errs.length)
fs.writeFileSync('widget-when-linked.json', JSON.stringify({ results, errs }, null, 2))
await browser.close()
