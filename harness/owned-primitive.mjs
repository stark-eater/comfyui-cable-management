// Three questions before building the hidden-primitive path:
//  Q1  Does a custom `properties` key on PrimitiveNode survive save/load? (ownership marking)
//  Q2  When a widget-backed input is CONNECTED, does the host still render its widget?
//      (decides whether we re-surface the primitive's widget or just re-use the host's)
//  Q3  Does visibility:hidden on the primitive's .lg-node keep slot layout intact, and is
//      its link occluded when the primitive is parked behind the host?

import { chromium } from 'playwright'
import fs from 'node:fs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

const r = await page.evaluate(async () => {
  const app = window.app, LiteGraph = window.LiteGraph, g = app.graph
  const out = {}
  g.clear()
  const ks = LiteGraph.createNode('KSampler'); ks.pos = [500, 150]; g.add(ks)
  const stepsIdx = ks.inputs.findIndex((i) => i.widget?.name === 'steps' || i.name === 'steps')

  // --- baseline: widget rendering BEFORE the input is connected --------------------
  await new Promise((r) => setTimeout(r, 700))
  const rowsBefore = document.querySelectorAll(`[data-widgets-grid-node-id="${ks.id}"] .lg-node-widget`).length
  const stepsWidgetBefore = !!ks.widgets?.find((w) => w.name === 'steps')

  // --- create an OWNED primitive, parked behind the host --------------------------
  const prim = LiteGraph.createNode('PrimitiveNode')
  prim.pos = [ks.pos[0] + 10, ks.pos[1] + 10]
  g.add(prim)
  prim.properties['cablemanagement.owned'] = true
  prim.connect(0, ks, stepsIdx)
  if (prim.widgets?.[0]) { prim.widgets[0].value = 42; prim.widgets[0].callback?.(42) }
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 900))

  // Q2 -- is the host's steps widget still rendered / still in node.widgets?
  const rowsAfter = document.querySelectorAll(`[data-widgets-grid-node-id="${ks.id}"] .lg-node-widget`).length
  out.q2 = {
    hostWidgetRowsBefore: rowsBefore,
    hostWidgetRowsAfter: rowsAfter,
    stepsWidgetObjectBefore: stepsWidgetBefore,
    stepsWidgetObjectAfter: !!ks.widgets?.find((w) => w.name === 'steps'),
    hostStepsInputLinked: ks.inputs[stepsIdx].link != null,
    // Is the steps row visually still a widget control, or did it become a bare slot?
    stepsRowHasControl: (() => {
      const dot = document.querySelector(`[data-slot-key="${ks.id}-in-${stepsIdx}"]`)
      const row = dot?.closest('.lg-node-widget')
      if (!row) return null
      return { children: row.children.length, text: (row.textContent || '').trim().slice(0, 40), hasInput: !!row.querySelector('input,select,textarea') }
    })(),
  }

  // Q3 -- hide the primitive and see whether slot geometry survives
  const primEl = document.querySelector(`.lg-node[data-node-id="${prim.id}"]`)
  const outDotBefore = document.querySelector(`[data-slot-key="${prim.id}-out-0"]`)?.getBoundingClientRect()
  if (primEl) { primEl.style.visibility = 'hidden'; primEl.style.pointerEvents = 'none' }
  await new Promise((r) => setTimeout(r, 500))
  const outDotAfter = document.querySelector(`[data-slot-key="${prim.id}-out-0"]`)?.getBoundingClientRect()
  out.q3 = {
    primElFound: !!primEl,
    slotRectBefore: outDotBefore ? [Math.round(outDotBefore.x), Math.round(outDotBefore.y)] : null,
    slotRectAfter: outDotAfter ? [Math.round(outDotAfter.x), Math.round(outDotAfter.y)] : null,
    slotStillMeasurable: !!outDotAfter && outDotAfter.width > 0,
    primitiveRect: primEl ? (() => { const b = primEl.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] })() : null,
    hostRect: (() => { const h = document.querySelector(`.lg-node[data-node-id="${ks.id}"]`); if (!h) return null; const b = h.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] })(),
  }

  // Q1 -- ownership property round-trip
  const ser = JSON.parse(JSON.stringify(g.serialize()))
  const serPrim = ser.nodes.find((n) => n.type === 'PrimitiveNode')
  out.q1 = { inSerialized: serPrim?.properties?.['cablemanagement.owned'], serializedKeys: Object.keys(serPrim?.properties ?? {}) }

  await app.loadGraphData(ser)
  await new Promise((r) => setTimeout(r, 900))
  const reloaded = window.app.graph.nodes.find((n) => n.type === 'PrimitiveNode')
  const ks2 = window.app.graph.nodes.find((n) => n.type === 'KSampler')
  const p = await window.app.graphToPrompt()
  out.q1.afterReload = {
    ownedFlag: reloaded?.properties?.['cablemanagement.owned'],
    stepsInPrompt: p.output[String(ks2?.id)]?.inputs?.steps,
    primitiveInPrompt: Object.keys(p.output).includes(String(reloaded?.id)),
  }
  return out
})

console.log('Q1 ownership property round-trip:'); console.log(JSON.stringify(r.q1, null, 2))
console.log('\nQ2 host widget when its input is connected:'); console.log(JSON.stringify(r.q2, null, 2))
console.log('\nQ3 hiding the primitive:'); console.log(JSON.stringify(r.q3, null, 2))
console.log('\npage errors:', errs.length); errs.slice(0, 5).forEach((e) => console.log('  ' + e.slice(0, 140)))
fs.writeFileSync('owned-primitive.json', JSON.stringify({ r, errs }, null, 2))
await browser.close()
