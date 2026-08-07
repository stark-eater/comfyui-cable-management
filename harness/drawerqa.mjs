// Drawers QA round: (1) caret shows its ACTION, uniform -- down closes, up opens;
// (2) collapse drops the node's --node-height floor to the folded natural height so the
//     box shrinks with the rows and grows back on expand (core's advanced-inputs
//     semantics), UNLESS the node was manually made larger -- then the size is the
//     user's and the fold happens inside it;
// (3) remount (subgraph enter/exit) and true refresh do NOT enlarge collapsed nodes --
//     the old mount-time nudge re-emitted a ResizeObserver-clamped open height through
//     setSize, ratcheting the floor tall;
// (4) collapsed inputs hide only UNLINKED OPTIONAL slots (core's hollow-circle shape 7);
//     required inputs keep their row, and a node with nothing hideable gets no caret.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
const results = []
const check = (name, ok, detail) => { results.push([name, !!ok]); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' ' + JSON.stringify(detail) : ''}`) }

await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [80, 80]; g.add(CK)
  const E = L.createNode('EmptyLatentImage'); E.pos = [80, 420]; g.add(E)
  const LCM = L.createNode('LatentCompositeMasked'); LCM.pos = [560, 380]; g.add(LCM)
  const K = L.createNode('KSampler'); K.pos = [1040, 80]; g.add(K)
  const SM = L.createNode('SolidMask'); SM.pos = [1040, 560]; g.add(SM)
  E.connect(0, LCM, LCM.inputs.findIndex(s => s.name === 'destination'))
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { CK: String(CK.id), E: String(E.id), LCM: String(LCM.id), K: String(K.id), SM: String(SM.id) }
})

const el = (id) => `.lg-node[data-node-id="${id}"]`
const boxH = (id) => page.evaluate((sel) => {
  const e = document.querySelector(sel)
  return e ? e.getBoundingClientRect().height / (window.app.canvas.ds.scale || 1) : null
}, el(id))
const caret = (id, which) => page.evaluate(({ sel, which }) => {
  const c = document.querySelector(`${sel} .cablemanagement-collapse[data-which="${which}"]`)
  return c ? c.textContent : null
}, { sel: el(id), which })
const clickCaret = async (id, which) => {
  await page.evaluate(({ sel, which }) => document.querySelector(`${sel} .cablemanagement-collapse[data-which="${which}"]`)?.click(), { sel: el(id), which })
  await page.waitForTimeout(700)
}
const clickMore = async (id, which) => {
  await page.evaluate(({ sel, which }) => document.querySelector(`${sel} .cablemanagement-more[data-which="${which}"]`)?.click(), { sel: el(id), which })
  await page.waitForTimeout(700)
}

// --- (1)+(4) carets: open shows the CLOSE action (down); nothing hideable -> no caret
const open = await page.evaluate((i) => {
  const q = (id, w) => document.querySelector(`.lg-node[data-node-id="${id}"] .cablemanagement-collapse[data-which="${w}"]`)?.textContent ?? null
  return { ckOut: q(i.CK, 'outputs'), lcmIn: q(i.LCM, 'inputs'), kIn: q(i.K, 'inputs'), kOut: q(i.K, 'outputs') }
}, ids)
check('open carets point down (close action)', open.ckOut === '▾' && open.lcmIn === '▾' && open.kOut === '▾', open)
check('KSampler inputs (all required) get NO caret', open.kIn === null, open)

// --- (4) collapse LCM inputs: optional mask folds, required source stays, linked destination stays
const lcmOpenH = await boxH(ids.LCM)
await clickCaret(ids.LCM, 'inputs')
const lcm = await page.evaluate((i) => {
  const g = window.app.graph, n = g.getNodeById(Number(i.LCM))
  const e = document.querySelector(`.lg-node[data-node-id="${i.LCM}"]`)
  const row = (name) => {
    const idx = n.inputs.findIndex(s => s.name === name)
    const d = document.querySelector(`[data-slot-key="${i.LCM}-in-${idx}"]`)
    const r = d?.closest('.lg-slot')
    return r ? { h: r.getBoundingClientRect().height, req: r.dataset.cablemanagementReq ?? null } : null
  }
  return {
    state: e.dataset.cablemanagementInputs, caret: e.querySelector('.cablemanagement-collapse[data-which="inputs"]')?.textContent,
    mask: row('mask'), source: row('source'), destination: row('destination'),
    sizeH: n.size[1], scale: window.app.canvas.ds.scale || 1,
    box: e.getBoundingClientRect().height / (window.app.canvas.ds.scale || 1),
  }
}, ids)
check('collapsed caret points up (open action)', lcm.caret === '▴', lcm.caret)
check('optional mask row folded', lcm.mask && lcm.mask.h < 1, lcm.mask)
check('required source row visible + marked', lcm.source && lcm.source.h > 5 && lcm.source.req === '1', lcm.source)
check('linked destination row visible', lcm.destination && lcm.destination.h > 5, lcm.destination)
// One 18px row folds but the drawer reserves 16px for the ellipsis seam -- the net
// shrink here is small; the BIG shrink is CK's three-row case below.
check('LCM box shrank on collapse', lcm.box < lcmOpenH - 2, { open: lcmOpenH, collapsed: lcm.box })
check('node.size tracks the folded box', Math.abs(lcm.box - lcm.sizeH - 30) < 4, { box: lcm.box, sizeH: lcm.sizeH })

// --- (2) CK outputs: collapse shrinks hard (3 rows), expand restores, collapse again
const ckOpenH = await boxH(ids.CK)
await clickCaret(ids.CK, 'outputs')
const ckColH = await boxH(ids.CK)
check('CK box shrank on outputs collapse', ckColH < ckOpenH - 30, { open: ckOpenH, collapsed: ckColH })
await clickMore(ids.CK, 'outputs')
const ckReH = await boxH(ids.CK)
check('CK box regrows on expand', Math.abs(ckReH - ckOpenH) < 4, { open: ckOpenH, re: ckReH })
await clickCaret(ids.CK, 'outputs')
const ckCol2H = await boxH(ids.CK)
check('CK box shrinks again', Math.abs(ckCol2H - ckColH) < 4, { first: ckColH, second: ckCol2H })

// --- (2) manual size preserved: enlarge LCM, collapse folds INSIDE the box, no ratchet
await clickMore(ids.LCM, 'inputs') // back to open first
const manual = await page.evaluate((i) => {
  const n = window.app.graph.getNodeById(Number(i.LCM))
  n.setSize([n.size[0], n.size[1] + 80])
  window.app.graph.setDirtyCanvas(true, true)
  return n.size[1]
}, ids)
await page.waitForTimeout(500)
const lcmManualH = await boxH(ids.LCM)
await clickCaret(ids.LCM, 'inputs')
await page.waitForTimeout(500) // nudge round trip
const pres = await page.evaluate((i) => {
  const n = window.app.graph.getNodeById(Number(i.LCM))
  const e = document.querySelector(`.lg-node[data-node-id="${i.LCM}"]`)
  return { sizeH: n.size[1], box: e.getBoundingClientRect().height / (window.app.canvas.ds.scale || 1), state: e.dataset.cablemanagementInputs }
}, ids)
check('manual-enlarged box preserved through collapse', Math.abs(pres.box - lcmManualH) < 3, { manual: lcmManualH, after: pres.box })
check('no floor ratchet after nudge settles', Math.abs(pres.sizeH - manual) < 3, { set: manual, after: pres.sizeH })

// --- (3) remount via subgraph enter/exit: no enlargement
const preRemount = { ck: await boxH(ids.CK), lcm: await boxH(ids.LCM) }
await page.evaluate(async (i) => {
  const g = window.app.graph
  const sm = g.getNodeById(Number(i.SM))
  const { subgraph } = g.convertToSubgraph(new Set([sm]))
  window.app.canvas.openSubgraph(subgraph)
}, ids)
await page.waitForTimeout(1200)
await page.evaluate(() => { location.hash = '#' + window.app.graph.id })
await page.waitForTimeout(1800)
const postRemount = { ck: await boxH(ids.CK), lcm: await boxH(ids.LCM) }
check('CK not enlarged by remount', Math.abs(postRemount.ck - preRemount.ck) < 3, { pre: preRemount.ck, post: postRemount.ck })
check('LCM (manual, collapsed) not resized by remount', Math.abs(postRemount.lcm - preRemount.lcm) < 3, { pre: preRemount.lcm, post: postRemount.lcm })

// --- (3) true refresh: draft restore, still folded, no enlargement
await page.waitForTimeout(2600) // let the draft persist debounce fire
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(4000)
const refreshed = await page.evaluate((i) => {
  const q = (id) => {
    const e = document.querySelector(`.lg-node[data-node-id="${id}"]`)
    return e ? { box: e.getBoundingClientRect().height / (window.app.canvas.ds.scale || 1), in: e.dataset.cablemanagementInputs ?? null, out: e.dataset.cablemanagementOutputs ?? null } : null
  }
  const kIn = document.querySelector(`.lg-node[data-node-id="${i.K}"] .cablemanagement-collapse[data-which="inputs"]`)
  return { ck: q(i.CK), lcm: q(i.LCM), kInCaret: !!kIn }
}, ids)
check('refresh: CK still folded at the small height', refreshed.ck && refreshed.ck.out === 'collapsed' && Math.abs(refreshed.ck.box - preRemount.ck) < 3, refreshed.ck)
check('refresh: LCM collapsed at its manual height', refreshed.lcm && refreshed.lcm.in === 'collapsed' && Math.abs(refreshed.lcm.box - preRemount.lcm) < 3, refreshed.lcm)
check('refresh: KSampler still has no inputs caret', !refreshed.kInCaret)

const pass = results.every(([, ok]) => ok)
console.log(pass ? 'PASS' : 'FAIL', `(${results.filter(([, ok]) => ok).length}/${results.length})`)
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
