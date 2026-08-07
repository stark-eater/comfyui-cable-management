// End-to-end test of the cablemanagement extension: pins appear on connected inputs, a real mouse
// drag from a pin to another node's input creates a link from the resolved ORIGIN, and the
// graph stays clean.

import { chromium } from 'playwright'
import fs from 'node:fs'

const HEADLESS = process.env.HEADED !== '1'
const browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 250 })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
const logs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(m.text().slice(0, 160))
})

await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

// Deterministic graph:  ckpt --CLIP--> encodeA        encodeB (clip input free)
const ids = await page.evaluate(() => {
  const g = window.app.graph
  g.clear()
  const mk = (t, pos) => { const n = window.LiteGraph.createNode(t); n.pos = pos; g.add(n); return n }
  const ckpt = mk('CheckpointLoaderSimple', [60, 120])
  const a = mk('CLIPTextEncode', [460, 120])
  const b = mk('CLIPTextEncode', [460, 420])
  ckpt.connect(1, a, 0)
  g.setDirtyCanvas(true, true)
  return { ckpt: String(ckpt.id), a: String(a.id), b: String(b.id) }
})
await page.waitForTimeout(1500)

// --- pins present? --------------------------------------------------------------------
const pins = await page.evaluate(() => {
  return [...document.querySelectorAll('.cablemanagement-pin')].map((p) => {
    const r = p.getBoundingClientRect()
    return {
      node: p.dataset.cablemanagementNode,
      index: p.dataset.cablemanagementIndex,
      type: p.dataset.cablemanagementType,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      title: p.title,
    }
  })
})
console.log('--- pins rendered ---')
console.log(pins.length ? JSON.stringify(pins, null, 2) : '(none)')

const cssLoaded = await page.evaluate(() =>
  [...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href.includes('cablemanagement'))
)
console.log('stylesheet loaded:', cssLoaded)

if (!pins.length) {
  console.log('\nNO PINS -- aborting.')
  console.log('console errors:', logs.slice(0, 10))
  console.log('page errors:', errs.slice(0, 10))
  await browser.close()
  process.exit(1)
}

// --- the drag -------------------------------------------------------------------------
// Pin belongs to encodeA's clip input. Drag it onto encodeB's clip input.
const targetBox = await page.evaluate((ids) => {
  const dot = document.querySelector(`[data-slot-key="${ids.b}-in-0"]`)
  if (!dot) return null
  const r = dot.getBoundingClientRect()
  return [r.left + r.width / 2, r.top + r.height / 2]
}, ids)
console.log('\ntarget dot at', targetBox)

const srcPin = pins.find((p) => p.node === ids.a)
if (!srcPin || !targetBox) {
  console.log('missing source pin or target'); await browser.close(); process.exit(1)
}
const from = [srcPin.rect[0] + srcPin.rect[2] / 2, srcPin.rect[1] + srcPin.rect[3] / 2]

const before = await page.evaluate(() => JSON.stringify(window.app.graph.serialize().links))

await page.mouse.move(from[0], from[1])
await page.mouse.down()
await page.mouse.move(from[0] + 40, from[1] + 60, { steps: 8 })
const midWire = await page.evaluate(() => {
  const w = document.querySelector('.cablemanagement-wire')
  const o = document.querySelector('.cablemanagement-overlay')
  return { hasPath: !!w?.getAttribute('d'), dragging: !!o?.classList.contains('is-dragging') }
})
await page.mouse.move(targetBox[0], targetBox[1], { steps: 12 })
const hoverState = await page.evaluate(() => ({
  targetHighlighted: !!document.querySelector('.cablemanagement-target'),
  badHighlighted: !!document.querySelector('.cablemanagement-target--bad'),
  wireValid: !!document.querySelector('.cablemanagement-wire.is-valid'),
}))
await page.mouse.up()
await page.waitForTimeout(800)

console.log('mid-drag  :', JSON.stringify(midWire))
console.log('on hover  :', JSON.stringify(hoverState))

// --- did it wire to the ORIGIN? -------------------------------------------------------
const after = await page.evaluate(async (ids) => {
  const g = window.app.graph
  const links = g.serialize().links
  const b = g.getNodeById(Number(ids.b))
  const link = b.inputs[0].link != null ? g.getLink(b.inputs[0].link) : null
  const p = await window.app.graphToPrompt()
  return {
    links,
    consumerFedBy: link ? String(link.origin_id) : null,
    consumerClipInPrompt: p.output[ids.b]?.inputs?.clip ?? null,
    overlayHidden: !document.querySelector('.cablemanagement-overlay.is-dragging'),
    leftoverHighlights: document.querySelectorAll('.cablemanagement-target, .cablemanagement-target--bad').length,
  }
}, ids)

const beforeLinks = JSON.parse(before)
console.log('\n--- result ---')
console.log('links before:', beforeLinks.length, ' after:', after.links.length)
console.log('encodeB fed by node:', after.consumerFedBy, '(expected ckpt =', ids.ckpt + ')')
console.log('prompt clip input  :', JSON.stringify(after.consumerClipInPrompt))
console.log('overlay hidden after drop:', after.overlayHidden, '| leftover highlights:', after.leftoverHighlights)

// --- pin count should now be 2: encodeA.clip and encodeB.clip ---------------------------
const pinsAfter = await page.evaluate(() =>
  [...document.querySelectorAll('.cablemanagement-pin')].map((p) => `${p.dataset.cablemanagementNode}-in-${p.dataset.cablemanagementIndex}`)
)
console.log('pins after drop:', JSON.stringify(pinsAfter))

console.log('\n================ VERDICT ================')
const ok =
  pins.length > 0 &&
  cssLoaded &&
  midWire.hasPath && midWire.dragging &&
  hoverState.targetHighlighted && hoverState.wireValid &&
  after.consumerFedBy === ids.ckpt &&
  Array.isArray(after.consumerClipInPrompt) && String(after.consumerClipInPrompt[0]) === ids.ckpt &&
  after.links.length === beforeLinks.length + 1 &&
  after.overlayHidden && after.leftoverHighlights === 0 &&
  pinsAfter.includes(`${ids.b}-in-0`)
console.log(ok ? 'Cable Management v1 WORKS END TO END' : 'NOT working -- see above')
console.log('page errors:', errs.length, errs.slice(0, 5))
console.log('console errors:', logs.length, logs.slice(0, 5))
fs.writeFileSync('cablemanagement-e2e.json', JSON.stringify({ pins, midWire, hoverState, after, pinsAfter, ok, errs, logs }, null, 2))
if (!HEADLESS) await page.waitForTimeout(6000)
await browser.close()
