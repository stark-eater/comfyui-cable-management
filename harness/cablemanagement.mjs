// UI-RESEARCH.md 4.4 -- the central claim of the whole brief.
//
// Cable Management says: a node's input row gets a pass-through OUTPUT pin. Dragging from it must
// behave as if you had dragged from whatever actually feeds that input. The claim is that
// this needs NO fake slot: on drop, resolve the input's true upstream origin and connect
// from there, so the graph gains one ordinary link and serializes nothing extra.
//
// Deterministic graph, all core node types so nothing flattens out of the prompt:
//
//     CheckpointLoaderSimple ──CLIP──> CLIPTextEncode "HOST"
//                                        └─ its clip input row carries the Cable Management pin
//     CLIPTextEncode "CONSUMER"  <── drag from that pin
//
// Correct outcome: CONSUMER.clip is fed by the CHECKPOINT, not by HOST.

import { chromium } from 'playwright'
import fs from 'node:fs'

const URL = process.env.COMFY_URL ?? 'http://127.0.0.1:8187'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.__probe && window.app && window.app.graph, null, {
  timeout: 120_000,
})
await page.waitForTimeout(2500)

const result = await page.evaluate(() => {
  const app = window.app
  const LiteGraph = window.LiteGraph
  const graph = app.graph
  const out = { steps: [] }
  const log = (k, v) => out.steps.push([k, v])

  if (!LiteGraph) return { error: 'window.LiteGraph missing' }

  graph.clear()
  const mk = (type, pos) => {
    const n = LiteGraph.createNode(type)
    if (!n) throw new Error('createNode failed for ' + type)
    n.pos = pos
    graph.add(n)
    return n
  }

  const ckpt = mk('CheckpointLoaderSimple', [100, 100])
  const host = mk('CLIPTextEncode', [500, 100])
  const consumer = mk('CLIPTextEncode', [500, 400])

  const clipOut = ckpt.outputs.findIndex((o) => o.type === 'CLIP')
  const hostClipIn = host.inputs.findIndex((i) => i.type === 'CLIP')
  const consClipIn = consumer.inputs.findIndex((i) => i.type === 'CLIP')
  log('slots', `ckpt.out[${clipOut}]=CLIP host.in[${hostClipIn}] consumer.in[${consClipIn}]`)

  // Wire the checkpoint into HOST. This is the link the pass-through pin mirrors.
  ckpt.connect(clipOut, host, hostClipIn)
  log('pre-wired', `ckpt #${ckpt.id} -> host #${host.id}`)

  const before = JSON.parse(JSON.stringify(graph.serialize()))

  // ---- the Cable Management gesture ----------------------------------------------------------
  // The user drags from HOST's clip pass-through output pin onto CONSUMER's clip input.
  // The extension holds no state: it reads the host input's link and connects from the
  // link's true origin.
  const inSlot = host.inputs[hostClipIn]
  const link = graph.getLink ? graph.getLink(inSlot.link) : graph.links[inSlot.link]
  if (!link) return { error: 'host input link did not resolve' }
  const origin = graph.getNodeById(link.origin_id)
  log('resolved origin', `#${origin.id} ${origin.type} output[${link.origin_slot}]`)

  const made = origin.connect(link.origin_slot, consumer, consClipIn)
  log('connect() returned', made ? `link id ${made.id}` : String(made))

  const after = JSON.parse(JSON.stringify(graph.serialize()))

  // ---- 4. serialise diff -----------------------------------------------------------
  const bl = new Map((before.links || []).map((l) => [l[0], l]))
  const al = new Map((after.links || []).map((l) => [l[0], l]))
  const added = [...al.keys()].filter((k) => !bl.has(k)).map((k) => al.get(k))
  const removed = [...bl.keys()].filter((k) => !al.has(k)).map((k) => bl.get(k))
  out.linkDiff = { added, removed, before: before.links?.length ?? 0, after: after.links?.length ?? 0 }

  const strip = (g) => {
    const c = JSON.parse(JSON.stringify(g))
    delete c.links
    for (const n of c.nodes || []) {
      for (const s of n.inputs || []) delete s.link
      for (const s of n.outputs || []) delete s.links
    }
    return c
  }
  const sb = strip(before),
    sa = strip(after)
  out.nonLinkStateIdentical = JSON.stringify(sb) === JSON.stringify(sa)
  const paths = []
  const walk = (a, b, p) => {
    if (paths.length > 30 || a === b) return
    const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a
    const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b
    if (ta !== tb || (ta !== 'object' && ta !== 'array')) {
      if (JSON.stringify(a) !== JSON.stringify(b))
        paths.push(`${p}: ${String(JSON.stringify(a)).slice(0, 40)} -> ${String(JSON.stringify(b)).slice(0, 40)}`)
      return
    }
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) walk(a?.[k], b?.[k], p ? `${p}.${k}` : k)
  }
  walk(sb, sa, '')
  out.nonLinkDelta = paths

  const shapeOf = (l) => l.map((v) => (v === null ? 'null' : typeof v)).join(',')
  out.newLinkShapeMatchesExisting =
    added.length === 1 && new Set((before.links || []).map(shapeOf)).has(shapeOf(added[0]))
  out.serializedLeak = /probe|cablemanagement/i.test(JSON.stringify(after))

  out.ids = {
    ckpt: String(ckpt.id),
    host: String(host.id),
    consumer: String(consumer.id),
    originSlot: link.origin_slot,
  }
  return out
})

console.log('--- Cable Management drop-resolution ---')
if (result.error) {
  console.log('ERROR:', result.error)
} else {
  for (const [k, v] of result.steps) console.log(`  ${k.padEnd(18)} ${v}`)
  console.log('\n  links       :', result.linkDiff.before, '->', result.linkDiff.after)
  console.log('  added       :', JSON.stringify(result.linkDiff.added))
  console.log('  removed     :', JSON.stringify(result.linkDiff.removed))
  console.log('  non-link state identical :', result.nonLinkStateIdentical)
  for (const p of result.nonLinkDelta) console.log('      delta ' + p)
  console.log('  new link shape matches   :', result.newLinkShapeMatchesExisting)
  console.log('  extension state leaked   :', result.serializedLeak)
}

// ---- 5. executable prompt ------------------------------------------------------------
const promptCheck = await page.evaluate(async (ids) => {
  const p = await window.app.graphToPrompt()
  const cons = p.output[ids.consumer]
  const host = p.output[ids.host]
  if (!cons) return { error: 'consumer missing from prompt', keys: Object.keys(p.output) }
  return {
    promptNodeIds: Object.keys(p.output),
    consumerClip: cons.inputs.clip,
    hostClip: host ? host.inputs.clip : null,
    routesToCheckpoint:
      Array.isArray(cons.inputs.clip) &&
      String(cons.inputs.clip[0]) === ids.ckpt &&
      Number(cons.inputs.clip[1]) === Number(ids.originSlot),
    doesNotRouteThroughHost:
      Array.isArray(cons.inputs.clip) && String(cons.inputs.clip[0]) !== ids.host,
  }
}, result.ids || {})

console.log('\n--- executable prompt ---')
console.log(JSON.stringify(promptCheck, null, 2))

// ---- 6. round-trip: save, reload, and confirm the link is ordinary --------------------
const roundTrip = await page.evaluate(async (ids) => {
  const json = JSON.parse(JSON.stringify(window.app.graph.serialize()))
  await window.app.loadGraphData(json)
  await new Promise((r) => setTimeout(r, 800))
  const p = await window.app.graphToPrompt()
  const cons = p.output[ids.consumer]
  return {
    survives: !!cons && Array.isArray(cons.inputs.clip),
    clipAfterReload: cons ? cons.inputs.clip : null,
    stillRoutesToCheckpoint: !!cons && String(cons.inputs.clip?.[0]) === ids.ckpt,
  }
}, result.ids || {})

console.log('\n--- save / reload round-trip ---')
console.log(JSON.stringify(roundTrip, null, 2))

console.log('\n================ VERDICT ================')
const ok =
  !result.error &&
  result.linkDiff.added.length === 1 &&
  result.linkDiff.removed.length === 0 &&
  result.newLinkShapeMatchesExisting &&
  !result.serializedLeak &&
  promptCheck.routesToCheckpoint === true &&
  promptCheck.doesNotRouteThroughHost === true &&
  roundTrip.stillRoutesToCheckpoint === true
console.log(ok ? 'Cable Management drop-resolution CONFIRMED' : 'Cable Management drop-resolution NOT confirmed')
console.log('page errors:', pageErrors.length)
pageErrors.slice(0, 5).forEach((e) => console.log('  ' + e.slice(0, 150)))
fs.writeFileSync('cablemanagement-results.json', JSON.stringify({ result, promptCheck, roundTrip, ok }, null, 2))
await browser.close()
