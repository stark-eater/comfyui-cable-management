// Does the core virtual PrimitiveNode still work under Nodes 2.0, and can it be created and
// wired programmatically? This is the mechanism for pass-through on an UNCONNECTED widget:
// the primitive adopts the widget's type/config (so combos work), and at prompt time copies
// its value into every connected consumer's widget. It is isVirtualNode, so it never appears
// in the executable prompt.

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
  const app = window.app
  const LiteGraph = window.LiteGraph
  const g = app.graph
  const out = { steps: [] }
  const log = (k, v) => out.steps.push([k, v])

  g.clear()
  const mk = (t, pos) => { const n = LiteGraph.createNode(t); if (!n) return null; n.pos = pos; g.add(n); return n }

  // Two KSamplers. We will drive BOTH their `steps` widgets from one primitive, and also
  // test a COMBO widget (sampler_name) which the real Primitive* nodes cannot type-match.
  const ka = mk('KSampler', [400, 80])
  const kb = mk('KSampler', [800, 80])
  if (!ka || !kb) return { error: 'KSampler unavailable' }

  const prim = mk('PrimitiveNode', [80, 80])
  if (!prim) return { error: 'PrimitiveNode not registered' }
  log('created', `PrimitiveNode id=${prim.id} isVirtualNode=${prim.isVirtualNode} outputs=${JSON.stringify(prim.outputs.map(o=>o.type))}`)

  // Find the widget-backed input for `steps` on each sampler.
  const findWidgetInput = (node, name) => (node.inputs ?? []).findIndex((i) => i.widget?.name === name || i.name === name)
  const aSteps = findWidgetInput(ka, 'steps')
  const bSteps = findWidgetInput(kb, 'steps')
  log('widget inputs', `ka.steps=${aSteps} kb.steps=${bSteps} (inputs: ${ka.inputs.map(i=>i.name).join(',')})`)
  if (aSteps < 0) return { error: 'no widget-backed `steps` input on KSampler', partial: out }

  // Connect primitive -> both consumers. First connection makes it adopt the widget config.
  const l1 = prim.connect(0, ka, aSteps)
  log('connect A', l1 ? `link ${l1.id}` : String(l1))
  log('after adopt', `output type=${prim.outputs[0].type} widgets=${(prim.widgets??[]).map(w=>`${w.name}:${w.type}`).join(',')}`)

  const l2 = prim.connect(0, kb, bSteps)
  log('connect B', l2 ? `link ${l2.id}` : String(l2))

  // Set a distinctive value on the primitive.
  if (prim.widgets?.[0]) {
    prim.widgets[0].value = 37
    prim.widgets[0].callback?.(37)
  }
  log('primitive value', String(prim.widgets?.[0]?.value))

  const prompt = await app.graphToPrompt()
  out.promptIds = Object.keys(prompt.output)
  out.primitiveInPrompt = Object.keys(prompt.output).includes(String(prim.id))
  out.aSteps = prompt.output[String(ka.id)]?.inputs?.steps
  out.bSteps = prompt.output[String(kb.id)]?.inputs?.steps

  // Now the COMBO case -- sampler_name. No core Primitive* node outputs a COMBO type.
  const aSampler = findWidgetInput(ka, 'sampler_name')
  const prim2 = mk('PrimitiveNode', [80, 400])
  const l3 = aSampler >= 0 ? prim2.connect(0, ka, aSampler) : null
  out.combo = {
    inputIndex: aSampler,
    connected: !!l3,
    adoptedType: prim2.outputs?.[0]?.type,
    widget: prim2.widgets?.[0] ? { name: prim2.widgets[0].name, type: prim2.widgets[0].type, value: prim2.widgets[0].value, options: (prim2.widgets[0].options?.values ?? []).slice(0, 4) } : null,
  }
  if (prim2.widgets?.[0]?.options?.values?.length > 1) {
    const pick = prim2.widgets[0].options.values[1]
    prim2.widgets[0].value = pick
    prim2.widgets[0].callback?.(pick)
    out.combo.picked = pick
  }
  const prompt2 = await app.graphToPrompt()
  out.combo.aSamplerInPrompt = prompt2.output[String(ka.id)]?.inputs?.sampler_name
  out.combo.primitiveInPrompt = Object.keys(prompt2.output).includes(String(prim2.id))

  // Round-trip through save/load.
  const ser = JSON.parse(JSON.stringify(g.serialize()))
  await app.loadGraphData(ser)
  await new Promise((r) => setTimeout(r, 900))
  const prompt3 = await window.app.graphToPrompt()
  const ka2 = window.app.graph.nodes.find((n) => n.type === 'KSampler')
  out.afterReload = {
    steps: prompt3.output[String(ka2?.id)]?.inputs?.steps,
    sampler: prompt3.output[String(ka2?.id)]?.inputs?.sampler_name,
    primitivesStillVirtual: window.app.graph.nodes.filter((n) => n.type === 'PrimitiveNode').map((n) => n.isVirtualNode),
  }
  return out
})

console.log('--- core virtual PrimitiveNode under Nodes 2.0 ---')
if (r.error) console.log('ERROR:', r.error, JSON.stringify(r.partial ?? {}, null, 2))
else {
  for (const [k, v] of r.steps) console.log(`  ${k.padEnd(16)} ${v}`)
  console.log('\n  prompt node ids      :', JSON.stringify(r.promptIds))
  console.log('  primitive in prompt  :', r.primitiveInPrompt, '(false = virtual, correct)')
  console.log('  KSampler A steps     :', JSON.stringify(r.aSteps), '(expect 37)')
  console.log('  KSampler B steps     :', JSON.stringify(r.bSteps), '(expect 37 -- one primitive, two consumers)')
  console.log('\n  COMBO case:', JSON.stringify(r.combo, null, 2))
  console.log('\n  after save/reload:', JSON.stringify(r.afterReload, null, 2))
}
console.log('\npage errors:', errs.length); errs.slice(0, 6).forEach((e) => console.log('  ' + e.slice(0, 150)))
fs.writeFileSync('primitive-results.json', JSON.stringify({ r, errs }, null, 2))
await browser.close()
