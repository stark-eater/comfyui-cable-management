// Reconcile: does the multiline textarea vanish when linked on the CANVAS path (Nodes 2.0
// off) while surviving disabled on the VUE path (Nodes 2.0 on)?
//
// Toggles Comfy.VueNodes.Enabled, measures both, and ALWAYS restores the original value --
// this is a server-side user setting, not a browser-profile one.

import { chromium } from 'playwright'
import fs from 'node:fs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))

const goto = async () => {
  await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
  await page.waitForTimeout(3000)
}

await goto()
const original = await page.evaluate(() => window.app.extensionManager.setting.get('Comfy.VueNodes.Enabled'))
console.log('original Comfy.VueNodes.Enabled =', original)

const measure = async (label) => {
  const r = await page.evaluate(async () => {
    const app = window.app, LiteGraph = window.LiteGraph, g = app.graph
    g.clear()
    const host = LiteGraph.createNode('CLIPTextEncode'); host.pos = [700, 150]; g.add(host)
    await new Promise((r) => setTimeout(r, 1200))
    const idx = host.inputs.findIndex((i) => i.widget?.name === 'text')

    const count = () => {
      // Vue path renders into .lg-node; canvas path mounts DOM widgets elsewhere, so count
      // textareas globally and also note where they live.
      const all = [...document.querySelectorAll('textarea')]
      const visible = all.filter((t) => {
        const cs = getComputedStyle(t)
        const r = t.getBoundingClientRect()
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0
      })
      return {
        total: all.length,
        visible: visible.length,
        disabled: all.map((t) => !!t.disabled),
        classes: all.map((t) => (t.className || '').toString().slice(0, 40)),
        inLgNode: all.filter((t) => t.closest('.lg-node')).length,
      }
    }

    const before = count()
    const src = LiteGraph.createNode('PrimitiveNode'); src.pos = [250, 150]; g.add(src)
    src.connect(0, host, idx)
    g.setDirtyCanvas(true, true)
    await new Promise((r) => setTimeout(r, 1400))
    const after = count()
    return {
      vueNodes: !!app.extensionManager.setting.get('Comfy.VueNodes.Enabled'),
      lgNodes: document.querySelectorAll('.lg-node').length,
      widgetObjStillThere: !!host.widgets?.find((w) => w.name === 'text'),
      linked: host.inputs[idx].link != null,
      before, after,
    }
  })
  console.log(`\n=== ${label} (VueNodes=${r.vueNodes}, .lg-node count=${r.lgNodes}) ===`)
  console.log(`  before: total=${r.before.total} visible=${r.before.visible} inLgNode=${r.before.inLgNode} disabled=${JSON.stringify(r.before.disabled)}`)
  console.log(`  after : total=${r.after.total} visible=${r.after.visible} inLgNode=${r.after.inLgNode} disabled=${JSON.stringify(r.after.disabled)}`)
  console.log(`  widget object still on node: ${r.widgetObjStillThere} | linked: ${r.linked}`)
  const verdict =
    r.before.visible > 0 && r.after.visible === 0 ? 'TEXTAREA GONE when linked'
    : r.after.visible > 0 && r.after.disabled.some(Boolean) ? 'textarea retained, DISABLED'
    : r.after.visible > 0 ? 'textarea retained, editable'
    : 'no textarea either way'
  console.log(`  VERDICT: ${verdict}`)
  return { label, ...r, verdict }
}

const results = []
try {
  // Ensure Vue path first
  if (!original) {
    await page.evaluate(async () => await window.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', true))
    await goto()
  }
  results.push(await measure('Nodes 2.0 ON  (Vue path)'))

  await page.evaluate(async () => await window.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', false))
  await goto()
  results.push(await measure('Nodes 2.0 OFF (canvas path)'))
} finally {
  await page.evaluate(async (v) => await window.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', v), original)
  await page.waitForTimeout(800)
  const restored = await page.evaluate(() => window.app.extensionManager.setting.get('Comfy.VueNodes.Enabled'))
  console.log(`\nrestored Comfy.VueNodes.Enabled = ${restored} (was ${original})`)
}

console.log('\npage errors:', errs.length)
fs.writeFileSync('both-paths.json', JSON.stringify({ original, results, errs }, null, 2))
await browser.close()
