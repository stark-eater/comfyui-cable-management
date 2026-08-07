import { chromium } from 'playwright'
import fs from 'node:fs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 820 }, deviceScaleFactor: 2 })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

// Mirror Barney's screenshot: a left-to-right pair and a right-to-left pair, using his own
// pack's nodes so the restored colour coding is visible too.
await page.evaluate(() => {
  const g = window.app.graph
  g.clear()
  const mk = (t, pos, title) => {
    const n = window.LiteGraph.createNode(t)
    if (!n) return null
    n.pos = pos
    if (title) n.title = title
    g.add(n)
    return n
  }
  const ckpt = mk('CheckpointLoaderSimple', [40, 60])
  const a = mk('CLIPTextEncode', [430, 60], 'A')
  const b = mk('CLIPTextEncode', [840, 60], 'B')
  const c = mk('CLIPTextEncode', [430, 330], 'C')
  ckpt.connect(1, a, 0)
  ckpt.connect(1, c, 0)
  g.setDirtyCanvas(true, true)
})
await page.waitForTimeout(1200)

// Hover a pin so the affordance shows in the shot.
const pin = await page.evaluate(() => {
  const p = document.querySelector('.cablemanagement-pin')
  if (!p) return null
  const r = p.getBoundingClientRect()
  return [r.left + r.width / 2, r.top + r.height / 2]
})
if (pin) await page.mouse.move(pin[0], pin[1])
await page.waitForTimeout(400)

await page.screenshot({ path: 'cablemanagement-pins.png' })
console.log('wrote cablemanagement-pins.png; pin at', pin)

// Second shot: mid-drag, wire visible.
if (pin) {
  const target = await page.evaluate(() => {
    const dots = [...document.querySelectorAll('[data-slot-key$="-in-0"]')]
    const d = dots[dots.length - 1]
    if (!d) return null
    const r = d.getBoundingClientRect()
    return [r.left + r.width / 2, r.top + r.height / 2]
  })
  await page.mouse.move(pin[0], pin[1])
  await page.mouse.down()
  await page.mouse.move(target[0], target[1], { steps: 15 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'cablemanagement-drag.png' })
  await page.mouse.up()
  console.log('wrote cablemanagement-drag.png')
}

const colours = await page.evaluate(() =>
  window.app.graph.nodes.map((n) => ({ t: n.title, color: n.color, bg: n.bgcolor }))
)
console.log('node colours:', JSON.stringify(colours))
await browser.close()
