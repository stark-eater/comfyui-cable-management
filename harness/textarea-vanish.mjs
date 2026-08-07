// Two variables, not one:
//   widget type -- `customtext` (multiline textarea) vs `text` (single-line input)
//   link source -- core PrimitiveNode (purpose-built for widget inputs) vs a plain STRING output
// Barney reports the multiline textarea VANISHES when linked while single-line merely greys.
// My earlier test only covered customtext + PrimitiveNode and saw it survive, so the source
// kind is the likely discriminator. Measure the 2x2, scoped to the host NODE (not the row),
// with a visibility check that walks ancestors.

import { chromium } from 'playwright'
import fs from 'node:fs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

const probe = (hostType, widgetName, sourceType) =>
  page.evaluate(
    async ([hostType, widgetName, sourceType]) => {
      const app = window.app, LiteGraph = window.LiteGraph, g = app.graph
      g.clear()
      const host = LiteGraph.createNode(hostType); host.pos = [700, 140]; g.add(host)
      await new Promise((r) => setTimeout(r, 900))

      const idx = host.inputs.findIndex((i) => i.widget?.name === widgetName || i.name === widgetName)
      if (idx < 0) return { error: `no input ${widgetName}`, inputs: host.inputs.map((i) => i.name) }

      const shown = (el) => {
        if (!el) return null
        let e = el
        while (e && e.nodeType === 1) {
          const cs = getComputedStyle(e)
          if (cs.display === 'none' || cs.visibility === 'hidden') return false
          e = e.parentElement
        }
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }
      const snap = () => {
        const nodeEl = document.querySelector(`.lg-node[data-node-id="${host.id}"]`)
        const tas = [...(nodeEl?.querySelectorAll('textarea') ?? [])]
        const ins = [...(nodeEl?.querySelectorAll('input') ?? [])]
        return {
          textareaCount: tas.length,
          textareaShown: tas.map(shown),
          textareaDisabled: tas.map((t) => !!t.disabled),
          inputCount: ins.length,
          inputShown: ins.map(shown),
          inputDisabled: ins.map((i) => !!i.disabled),
          widgetRows: document.querySelectorAll(`[data-widgets-grid-node-id="${host.id}"] .lg-node-widget`).length,
          widgetObj: host.widgets?.find((w) => w.name === widgetName)?.type ?? null,
          nodeHeight: nodeEl ? Math.round(nodeEl.getBoundingClientRect().height) : null,
        }
      }

      const before = snap()

      let src
      if (sourceType === 'PrimitiveNode') {
        src = LiteGraph.createNode('PrimitiveNode'); src.pos = [250, 140]; g.add(src)
        src.connect(0, host, idx)
      } else {
        src = LiteGraph.createNode(sourceType); src.pos = [250, 140]; g.add(src)
        src.connect(0, host, idx)
      }
      g.setDirtyCanvas(true, true)
      await new Promise((r) => setTimeout(r, 1100))
      const after = snap()
      return { hostType, widgetName, sourceType, linked: host.inputs[idx].link != null, before, after }
    },
    [hostType, widgetName, sourceType]
  )

const cases = [
  ['CLIPTextEncode', 'text', 'PrimitiveNode'],
  ['CLIPTextEncode', 'text', 'PrimitiveStringMultiline'],
  ['CLIPTextEncode', 'text', 'PrimitiveString'],
  ['SaveImage', 'filename_prefix', 'PrimitiveNode'],
  ['SaveImage', 'filename_prefix', 'PrimitiveString'],
]

const results = []
for (const c of cases) {
  const r = await probe(...c)
  results.push(r)
  if (r.error) { console.log(`\n${c[0]}.${c[1]} <- ${c[2]}: ${r.error}`); continue }
  const f = (s) => `ta=${s.textareaCount}${s.textareaCount ? `(shown=${s.textareaShown}, dis=${s.textareaDisabled})` : ''} in=${s.inputCount}${s.inputCount ? `(dis=${s.inputDisabled})` : ''} rows=${s.widgetRows} h=${s.nodeHeight}`
  console.log(`\n=== ${c[0]}.${c[1]}  <-  ${c[2]}   (widget type ${r.before.widgetObj}, linked=${r.linked})`)
  console.log(`   before  ${f(r.before)}`)
  console.log(`   after   ${f(r.after)}`)
  const vanished = r.before.textareaCount > 0 && r.after.textareaCount === 0
  const hidden = r.after.textareaShown.some((s) => s === false)
  console.log(`   VERDICT: ${vanished ? 'TEXTAREA REMOVED' : hidden ? 'TEXTAREA HIDDEN' : r.after.textareaCount ? 'textarea retained' : 'n/a'}`)
}

console.log('\npage errors:', errs.length); errs.slice(0, 5).forEach((e) => console.log('  ' + e.slice(0, 140)))
fs.writeFileSync('textarea-vanish.json', JSON.stringify({ results, errs }, null, 2))
await browser.close()
