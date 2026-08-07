// Definitive matrix on Barney's real node type.
//
// Reproduces the abcd.json shape: four ExpandPromptToggleable nodes, with one PrimitiveNode
// driving the `text` (customtext) widget input of two of them -- exactly the hand-built
// daisy-chain the extension is meant to automate. Measured on BOTH render paths.
//
// Also checks the ownership discriminator: a user-made PrimitiveNode (no cablemanagement.owned) must
// stay visible while an extension-made one is hidden.

import { chromium } from 'playwright'
import fs from 'node:fs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))

const goto = async () => {
  await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
  await page.waitForTimeout(3000)
}
await goto()
const original = await page.evaluate(() => window.app.extensionManager.setting.get('Comfy.VueNodes.Enabled'))

const measure = async (label) =>
  page.evaluate(async (label) => {
    const app = window.app, LiteGraph = window.LiteGraph, g = app.graph
    g.clear()
    const mk = (t, pos, title) => { const n = LiteGraph.createNode(t); if (!n) return null; n.pos = pos; if (title) n.title = title; g.add(n); return n }

    const A = mk('ExpandPromptToggleable', [100, 100], 'A')
    if (!A) return { error: 'ExpandPromptToggleable not registered' }
    const B = mk('ExpandPromptToggleable', [400, 100], 'B')
    const C = mk('ExpandPromptToggleable', [700, 100], 'C')
    const D = mk('ExpandPromptToggleable', [1000, 100], 'D')
    await new Promise((r) => setTimeout(r, 1000))

    const textIdx = A.inputs.findIndex((i) => i.widget?.name === 'text')
    const promptIdx = A.inputs.findIndex((i) => i.name === 'prompt' && !i.widget)

    // Chain A -> B (ordinary STRING link, like abcd.json link 6)
    A.connect(0, B, promptIdx)

    // One PrimitiveNode driving the `text` widget of BOTH B and D (abcd.json links 8 and 9)
    const userPrim = mk('PrimitiveNode', [400, 420], 'text')
    userPrim.connect(0, B, textIdx)
    userPrim.connect(0, D, textIdx)

    // An extension-owned one on C, to prove the ownership discriminator
    const ownedPrim = mk('PrimitiveNode', [C.pos[0] + 10, C.pos[1] + 10], 'owned')
    ownedPrim.properties['cablemanagement.owned'] = true
    ownedPrim.connect(0, C, textIdx)

    g.setDirtyCanvas(true, true)
    await new Promise((r) => setTimeout(r, 1500))

    const shown = (el) => {
      if (!el) return false
      let e = el
      while (e && e.nodeType === 1) {
        const cs = getComputedStyle(e)
        if (cs.display === 'none' || cs.visibility === 'hidden') return false
        e = e.parentElement
      }
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    const nodeInfo = (n, expectLinked) => {
      const el = document.querySelector(`.lg-node[data-node-id="${n.id}"]`)
      // Vue path renders inside .lg-node; canvas path mounts DOM widgets in an overlay, so
      // fall back to matching the widget element the node object holds.
      const w = n.widgets?.find((x) => x.name === 'text')
      const domEl = w?.element ?? w?.inputEl ?? null
      const inNode = el ? [...el.querySelectorAll('textarea')] : []
      return {
        title: n.title,
        textLinked: n.inputs[n.inputs.findIndex((i) => i.widget?.name === 'text')].link != null,
        expectLinked,
        widgetObjType: w?.type ?? null,
        textareasInsideNodeEl: inNode.length,
        textareaShownInsideNode: inNode.map(shown),
        domWidgetElShown: domEl ? shown(domEl) : null,
      }
    }

    const allTa = [...document.querySelectorAll('textarea')]
    return {
      label,
      vueNodes: !!app.extensionManager.setting.get('Comfy.VueNodes.Enabled'),
      lgNodeCount: document.querySelectorAll('.lg-node').length,
      globalTextareas: { total: allTa.length, visible: allTa.filter(shown).length },
      A: nodeInfo(A, false),
      B: nodeInfo(B, true),
      C: nodeInfo(C, true),
      D: nodeInfo(D, true),
      ownership: {
        userPrimVisible: (() => { const e = document.querySelector(`.lg-node[data-node-id="${userPrim.id}"]`); return e ? shown(e) : null })(),
        ownedPrimVisible: (() => { const e = document.querySelector(`.lg-node[data-node-id="${ownedPrim.id}"]`); return e ? shown(e) : null })(),
        userPrimHasOwnedFlag: userPrim.properties['cablemanagement.owned'] === true,
        ownedPrimHasOwnedFlag: ownedPrim.properties['cablemanagement.owned'] === true,
      },
    }
  }, label)

const out = []
try {
  if (!original) { await page.evaluate(async () => await window.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', true)); await goto() }
  out.push(await measure('Nodes 2.0 ON  (Vue)'))
  await page.evaluate(async () => await window.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', false))
  await goto()
  out.push(await measure('Nodes 2.0 OFF (canvas)'))
} finally {
  await page.evaluate(async (v) => await window.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', v), original)
  await page.waitForTimeout(800)
  console.log(`\nrestored Comfy.VueNodes.Enabled = ${await page.evaluate(() => window.app.extensionManager.setting.get('Comfy.VueNodes.Enabled'))} (was ${original})`)
}

for (const r of out) {
  if (r.error) { console.log(`\n${r.label}: ${r.error}`); continue }
  console.log(`\n=== ${r.label}  .lg-node=${r.lgNodeCount}  textareas total=${r.globalTextareas.total} visible=${r.globalTextareas.visible} ===`)
  for (const k of ['A', 'B', 'C', 'D']) {
    const n = r[k]
    console.log(
      `  ${n.title}  textLinked=${String(n.textLinked).padEnd(5)} widget=${String(n.widgetObjType).padEnd(11)} ` +
      `taInNodeEl=${n.textareasInsideNodeEl} shown=${JSON.stringify(n.textareaShownInsideNode)} domWidgetShown=${n.domWidgetElShown}`
    )
  }
  console.log(`  ownership: userPrim visible=${r.ownership.userPrimVisible} (flag=${r.ownership.userPrimHasOwnedFlag}) | ownedPrim visible=${r.ownership.ownedPrimVisible} (flag=${r.ownership.ownedPrimHasOwnedFlag})`)
}
console.log('\npage errors:', errs.length); errs.slice(0, 5).forEach((e) => console.log('  ' + e.slice(0, 140)))
fs.writeFileSync('expandprompt-matrix.json', JSON.stringify({ original, out, errs }, null, 2))
await browser.close()
