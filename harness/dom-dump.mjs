// Dump the real DOM structure of a rendered Nodes 2.0 node, so pin positioning can be
// written against fact rather than guesswork.

import { chromium } from 'playwright'
import fs from 'node:fs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))

await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

// Deterministic node with inputs, widgets and outputs.
await page.evaluate(() => {
  const g = window.app.graph
  g.clear()
  const ck = window.LiteGraph.createNode('CheckpointLoaderSimple')
  ck.pos = [80, 80]
  g.add(ck)
  const te = window.LiteGraph.createNode('CLIPTextEncode')
  te.pos = [520, 80]
  g.add(te)
  const ks = window.LiteGraph.createNode('KSampler')
  ks.pos = [900, 80]
  g.add(ks)
  ck.connect(1, te, 0)
})
await page.waitForTimeout(2000)

const dump = await page.evaluate(() => {
  const out = {}
  const node = document.querySelector('.lg-node')
  if (!node) return { error: 'no .lg-node' }

  const describe = (el, depth = 0, max = 5) => {
    if (depth > max) return null
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().slice(0, 110),
      data: Object.fromEntries(Object.entries(el.dataset || {})),
      rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })(),
      kids: [...el.children].slice(0, 12).map((c) => describe(c, depth + 1, max)).filter(Boolean),
    }
  }
  out.tree = describe(node)

  const cs = getComputedStyle(node)
  out.nodeStyle = { position: cs.position, display: cs.display, overflow: cs.overflow, contain: cs.contain, transform: cs.transform.slice(0, 40), zIndex: cs.zIndex }

  out.slotKeys = [...document.querySelectorAll('[data-slot-key]')].slice(0, 24).map((e) => ({
    key: e.getAttribute('data-slot-key'),
    tag: e.tagName.toLowerCase(),
    cls: (e.className || '').toString().slice(0, 60),
    rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })(),
  }))

  // What identifies an input row / widget row?
  const q = (s) => [...document.querySelectorAll(s)].length
  out.counts = {
    lgNode: q('.lg-node'),
    dataNodeId: q('[data-node-id]'),
    dataSlotKey: q('[data-slot-key]'),
    testidNodeWidget: q('[data-testid="node-widget"]'),
    lgNodeWidget: q('.lg-node-widget'),
    lgNodeSlots: q('.lg-node-slots'),
    lgNodeWidgets: q('.lg-node-widgets'),
    inputSlotRows: q('.lg-node [class*="slot"]'),
  }

  // A representative input row + widget row, with ancestry
  const chain = (el) => { const c = []; let e = el; while (e && !e.classList?.contains('lg-node')) { c.unshift(`${e.tagName.toLowerCase()}.${(e.className||'').toString().split(' ').filter(Boolean).slice(0,3).join('.')}`); e = e.parentElement } return c }
  const inDot = document.querySelector('[data-slot-key*="-in-"]')
  const outDot = document.querySelector('[data-slot-key*="-out-"]')
  const widget = document.querySelector('[data-testid="node-widget"], .lg-node-widget')
  out.ancestry = {
    input: inDot ? { key: inDot.getAttribute('data-slot-key'), chain: chain(inDot) } : null,
    output: outDot ? { key: outDot.getAttribute('data-slot-key'), chain: chain(outDot) } : null,
    widget: widget ? { chain: chain(widget) } : null,
  }
  return out
})

fs.writeFileSync('dom-dump.json', JSON.stringify(dump, null, 2))
console.log(JSON.stringify({ counts: dump.counts, nodeStyle: dump.nodeStyle, ancestry: dump.ancestry }, null, 2))
console.log('\nslotKeys sample:')
for (const s of (dump.slotKeys || []).slice(0, 12)) console.log(' ', s.key, s.tag, JSON.stringify(s.rect), s.cls.slice(0, 40))
console.log('\npage errors:', errs.length)
errs.slice(0, 5).forEach((e) => console.log('  ' + e.slice(0, 140)))
console.log('\nfull tree -> dom-dump.json')
await browser.close()
