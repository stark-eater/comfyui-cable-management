// Mid-drag feedback parity (audit 2g fix round): the snap hint and the dim
// contract on extension pins, measured the way the audit measured the gaps.
//  1. source drag snaps to a ribbon in-pin (exact + 9px off), release connects
//  2. type-mismatched source drag gets NO false hint and NO connect
//  3. consumer drag of a foreign type dims node pins; undim after release
//  4. consumer drag of the matching type leaves the pin bright
//  5. source drag dims all node pins (they are outputs)
//  6. tooth pull dims core slots (wrong-type input, all outputs); restores after
//  7. gate pins dim on canvas during a source drag (out-pins dim, in-pin bright)
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2560, height: 1300 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}

await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(2600)

async function drag(from, to) {
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
}
const pinPos = (id, idx) => page.evaluate(({ id, idx }) => {
  const p = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${idx}"]`)
  const r = p?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })
const dotPos = (id, idx, out) => page.evaluate(({ id, idx, out }) => {
  const d = document.querySelector(`[data-slot-key="${id}-${out ? 'out' : 'in'}-${idx}"]`)
  const r = d?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx, out })
const gp = (x, y) => page.evaluate(({ x, y }) => {
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return [view.left + (x + ds.offset[0]) * ds.scale, view.top + (y + ds.offset[1]) * ds.scale]
}, { x, y })
const rr = (rid) => page.evaluate(({ rid }) => {
  const r = window.app.graph.reroutes.get(rid)
  if (!r) return null
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return { pos: [...r.pos], pt: [view.left + (r.pos[0] + ds.offset[0]) * ds.scale, view.top + (r.pos[1] + ds.offset[1]) * ds.scale] }
}, { rid })
const snapState = () => page.evaluate(() => {
  const lc = window.app.canvas.linkConnector
  return {
    isConnecting: lc.isConnecting,
    to: lc.state?.connectingTo ?? null,
    snap: lc.state?.snapLinksPos ? [Math.round(lc.state.snapLinksPos[0]), Math.round(lc.state.snapLinksPos[1])] : null,
  }
})
const pinDim = (id, idx) => page.evaluate(({ id, idx }) => {
  const p = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${idx}"]`)
  return p ? { dim: p.dataset.cablemanagementDim ?? null, opacity: getComputedStyle(p).opacity } : null
}, { id, idx })
const slotOpacity = (id, idx, out) => page.evaluate(({ id, idx, out }) => {
  const d = document.querySelector(`[data-slot-key="${id}-${out ? 'out' : 'in'}-${idx}"]`)
  return d ? d.style.opacity : null
}, { id, idx, out })
const feed = (id, idx) => page.evaluate(({ id, idx }) => {
  const g = window.app.graph
  const n = g.getNodeById(Number(id))
  const lid = n.inputs?.[idx]?.link
  const link = lid != null ? g.getLink(lid) : null
  return { lid: lid ?? null, origin: link ? String(link.origin_id) : null, parent: link?.parentId ?? null }
}, { id, idx })
let neutral = null
const cleanup = async () => {
  if (await page.evaluate(() => document.querySelectorAll('.litecontextmenu').length)) {
    await page.mouse.click(...neutral); await page.waitForTimeout(500)
  }
  await page.evaluate(() => {
    document.querySelectorAll('.litecontextmenu').forEach((e) => e.remove())
    const lc = window.app.canvas.linkConnector
    if (lc?.isConnecting) lc.reset?.(true)
  })
  await page.waitForTimeout(300)
}
// mean RGB of a small clip around a screen point
async function brightness(pt) {
  const buf = await page.screenshot({ clip: { x: pt[0] - 4, y: pt[1] - 4, width: 8, height: 8 } })
  const png = await page.evaluate(async (b64) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const x = c.getContext('2d'); x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data
    let s = 0
    for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3
    return s / (d.length / 4)
  }, buf.toString('base64'))
  return png
}

const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
  const A = L.createNode('EmptyLatentImage'); A.pos = [150, 120]; A.title = 'A'; g.add(A)
  const A2 = L.createNode('EmptyLatentImage'); A2.pos = [150, 760]; A2.title = 'A2'; g.add(A2)
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [150, 1000]; CK.title = 'CK'; g.add(CK)
  const mk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const B = mk('B', 560, 100), C = mk('C', 1450, 80), C2 = mk('C2', 1450, 440), D = mk('D', 1700, 800)
  const idx = B.inputs.findIndex((s) => s.name === 'latent_image')
  const mIdx = B.inputs.findIndex((s) => s.name === 'model')
  A.connect(0, B, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  const o = { idx, mIdx }
  for (const n of [A, A2, CK, B, C, C2, D]) o[n.title] = String(n.id)
  return o
}, null)
neutral = await gp(950, 640)

await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.C, ids.idx))
await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.C2, ids.idx))
const comb = await page.evaluate(async ({ ids }) => {
  const g = window.app.graph
  const l1 = g.getNodeById(Number(ids.C)).inputs[ids.idx].link
  const l2 = g.getNodeById(Number(ids.C2)).inputs[ids.idx].link
  const id = window.__cablemanagementCombs.create(l1, l2, 1000, 300)
  await new Promise((x) => setTimeout(x, 900))
  const rec = g.extra.cablemanagement_combs.find((c) => c.id === id)
  const laneC = rec.lanes.findIndex((l) => g.reroutes.get(l.out)?.linkIds?.has?.(Number(l1)))
  return { laneC, lanes: rec.lanes.map((l) => ({ ...l })) }
}, { ids })
ok('setup: comb with 2 lanes', comb.lanes.length === 2, JSON.stringify(comb))
const laneCIn = comb.lanes[comb.laneC].in

// 1: source drag snaps to the in-pin, exact and 9px off; release connects
{
  const tooth = await rr(laneCIn)
  await page.mouse.move(...await dotPos(ids.A2, 0, true)); await page.mouse.down()
  await page.mouse.move(tooth.pt[0], tooth.pt[1], { steps: 12 }); await page.waitForTimeout(600)
  const exact = await snapState()
  await page.mouse.move(tooth.pt[0] - 9, tooth.pt[1] + 4, { steps: 4 }); await page.waitForTimeout(600)
  const off = await snapState()
  await page.mouse.move(tooth.pt[0], tooth.pt[1], { steps: 4 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
  const anchor = [Math.round(tooth.pos[0]), Math.round(tooth.pos[1])]
  ok('snap: exact hover reports the in-pin anchor', exact.snap?.[0] === anchor[0] && exact.snap?.[1] === anchor[1],
    JSON.stringify({ exact, anchor }))
  ok('snap: 9px-offset hover still reports the anchor (true candidate, not pointer echo)',
    off.snap?.[0] === anchor[0] && off.snap?.[1] === anchor[1], JSON.stringify({ off, anchor }))
  const c = await feed(ids.C, ids.idx)
  ok('snap: the hinted release connects (lane re-sourced to A2)', c.origin === ids.A2 && c.parent != null, JSON.stringify(c))
  await cleanup()
}

// 2: type-mismatched source drag: no false hint, no connect. Measured at a
// 9px offset -- at exact hover the pointer echo coincides with the anchor and
// proves nothing.
{
  const tooth = await rr(laneCIn)
  const ckOut = await dotPos(ids.CK, 0, true) // MODEL
  await page.mouse.move(...ckOut); await page.mouse.down()
  await page.mouse.move(tooth.pt[0] - 9, tooth.pt[1] + 4, { steps: 12 }); await page.waitForTimeout(600)
  const mid = await snapState()
  await page.mouse.up(); await page.waitForTimeout(1000)
  const anchor = [Math.round(tooth.pos[0]), Math.round(tooth.pos[1])]
  ok('mismatch: MODEL drag near the LATENT in-pin gets no anchor hint (pointer echo only)',
    !(mid.snap?.[0] === anchor[0] && mid.snap?.[1] === anchor[1]), JSON.stringify({ mid, anchor }))
  const c = await feed(ids.C, ids.idx)
  ok('mismatch: lane untouched', c.origin === ids.A2, JSON.stringify(c))
  await cleanup()
}

// 3: foreign-type consumer drag dims the pin; undims after release
{
  const before = await pinDim(ids.B, ids.idx)
  await page.mouse.move(...await dotPos(ids.B, ids.mIdx, false)); await page.mouse.down() // seek MODEL source
  await page.mouse.move(...await gp(900, 950), { steps: 10 }); await page.waitForTimeout(600)
  const mid = await pinDim(ids.B, ids.idx)
  await page.mouse.up(); await page.waitForTimeout(800)
  await cleanup()
  await page.mouse.move(...neutral); await page.waitForTimeout(400)
  const after = await pinDim(ids.B, ids.idx)
  ok('dim: LATENT pin dims during a MODEL consumer drag', mid?.dim === '1' && mid?.opacity === '0.4',
    JSON.stringify({ before, mid }))
  ok('dim: pin restored after the gesture', after?.dim == null && after?.opacity === '1', JSON.stringify(after))
}

// 4: matching consumer drag leaves the pin bright
{
  await page.mouse.move(...await dotPos(ids.D, ids.idx, false)); await page.mouse.down() // seek LATENT source
  await page.mouse.move(...await gp(900, 950), { steps: 10 }); await page.waitForTimeout(600)
  const mid = await pinDim(ids.B, ids.idx)
  await page.mouse.up(); await page.waitForTimeout(800)
  await cleanup()
  ok('dim: LATENT pin stays bright during a LATENT consumer drag', mid?.dim == null && mid?.opacity === '1',
    JSON.stringify(mid))
}

// 5: source drag dims node pins (pins are outputs; none is a target)
{
  await page.mouse.move(...await dotPos(ids.A2, 0, true)); await page.mouse.down()
  await page.mouse.move(...await gp(900, 950), { steps: 10 }); await page.waitForTimeout(600)
  const mid = await pinDim(ids.B, ids.idx)
  await page.mouse.up(); await page.waitForTimeout(800)
  await cleanup()
  ok('dim: pins dim during a source drag', mid?.dim === '1', JSON.stringify(mid))
}

// 6: tooth pull dims core slots; restored after the drop
{
  const outTooth = comb.lanes[comb.laneC].out
  const t = await rr(outTooth)
  await page.mouse.move(t.pt[0], t.pt[1]); await page.mouse.down()
  await page.mouse.move(...await gp(1200, 700), { steps: 10 }); await page.waitForTimeout(600)
  const mid = {
    wrongInput: await slotOpacity(ids.D, ids.mIdx, false),
    rightInput: await slotOpacity(ids.D, ids.idx, false),
    anyOutput: await slotOpacity(ids.A2, 0, true),
  }
  await page.mouse.move(...await dotPos(ids.D, ids.idx, false), { steps: 8 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
  const after = {
    wrongInput: await slotOpacity(ids.D, ids.mIdx, false),
    anyOutput: await slotOpacity(ids.A2, 0, true),
    d: await feed(ids.D, ids.idx),
  }
  ok('tooth pull: wrong-type input and outputs dim, matching input stays bright',
    mid.wrongInput === '0.4' && mid.anyOutput === '0.4' && mid.rightInput === '', JSON.stringify(mid))
  ok('tooth pull: dims restored and the branch connected',
    after.wrongInput === '' && after.anyOutput === '' && after.d.origin === ids.A2 && after.d.parent === outTooth,
    JSON.stringify(after))
  await cleanup()
}

// 7: gate pins dim on canvas during a source drag (out-pins dim, in-pin of an
// accepting lane stays bright) -- pixel brightness, overlay is composited
{
  const inT = await rr(comb.lanes[comb.laneC].in)
  const outT = await rr(comb.lanes[comb.laneC].out)
  const preIn = await brightness(inT.pt)
  const preOut = await brightness(outT.pt)
  await page.mouse.move(...await dotPos(ids.A2, 0, true)); await page.mouse.down()
  await page.mouse.move(...await gp(900, 950), { steps: 10 }); await page.waitForTimeout(700)
  const midIn = await brightness(inT.pt)
  const midOut = await brightness(outT.pt)
  await page.mouse.up(); await page.waitForTimeout(800)
  await cleanup()
  ok('gate dim: out-pin visibly dims during a source drag', midOut < preOut - 8,
    JSON.stringify({ preOut, midOut }))
  ok('gate dim: accepting in-pin stays bright', Math.abs(midIn - preIn) < 8,
    JSON.stringify({ preIn, midIn }))
}

// 8: the MIRROR (Barney's QA caveat): consumer drag from a node input snaps to
// the ribbon OUT pin (9px offset = true candidate), release connects through
// the lane to its source
{
  const d2 = await page.evaluate(async () => {
    const g = window.app.graph, L = window.LiteGraph
    const n = L.createNode('KSampler'); n.pos = [1750, 240]; n.title = 'D2'; g.add(n)
    g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1500))
    return String(n.id)
  })
  const outT = await rr(comb.lanes[comb.laneC].out)
  await page.mouse.move(...await dotPos(d2, ids.idx, false)); await page.mouse.down()
  await page.mouse.move(outT.pt[0] - 9, outT.pt[1] + 4, { steps: 12 }); await page.waitForTimeout(600)
  const off = await snapState()
  await page.mouse.move(outT.pt[0], outT.pt[1], { steps: 4 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
  const anchor = [Math.round(outT.pos[0]), Math.round(outT.pos[1])]
  ok('mirror: 9px-offset hover over the out-pin reports the anchor',
    off.snap?.[0] === anchor[0] && off.snap?.[1] === anchor[1], JSON.stringify({ off, anchor }))
  const d2feed = await feed(d2, ids.idx)
  ok('mirror: release connects through the lane to its source',
    d2feed.origin === ids.A2 && d2feed.parent === comb.lanes[comb.laneC].out, JSON.stringify(d2feed))
  await cleanup()

  // 9: mismatch mirror: MODEL consumer drag near the out-pin gets pointer echo only
  const mIdx2 = await page.evaluate(({ d2 }) => window.app.graph.getNodeById(Number(d2)).inputs.findIndex((s) => s.name === 'model'), { d2 })
  await page.mouse.move(...await dotPos(d2, mIdx2, false)); await page.mouse.down()
  await page.mouse.move(outT.pt[0] - 9, outT.pt[1] + 4, { steps: 12 }); await page.waitForTimeout(600)
  const mm = await snapState()
  await page.mouse.up(); await page.waitForTimeout(800)
  ok('mirror mismatch: no anchor hint for a foreign-type consumer drag',
    !(mm.snap?.[0] === anchor[0] && mm.snap?.[1] === anchor[1]), JSON.stringify({ mm, anchor }))
  await cleanup()
}

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
