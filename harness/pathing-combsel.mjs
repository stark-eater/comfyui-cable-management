// Gate selection acts as node selection (Barney's QA round):
// (1) click gate body selects it (core selection cleared); (2) shift-click adds;
// (3) click empty canvas clears; (4) marquee over the comb selects the GATES via
// the teeth proxies and purges the teeth from core's selection; (5) dragging a
// marquee'd node moves the selected gates by the same delta; (6) selecting a comb
// moves its record to the end (z-order jump-to-top, persisted); (7) [del]
// semantics depend on the selection: one gate -> that gate's teeth dissolve and
// the partner decomposes into plain reroutes; both gates -> the comb dissolves
// wholesale and the links heal; mixed with a node -> core still deletes its own
// items; no "Nothing selected" toast in any case.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
const settle = () => page.evaluate(async () => {
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})
const screen = (gx, gy) => page.evaluate(([gx, gy]) => {
  const { ds } = window.app.canvas
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
}, [gx, gy])
const click = async (gx, gy, mods = []) => {
  const [sx, sy] = await screen(gx, gy)
  for (const m of mods) await page.keyboard.down(m)
  await page.mouse.click(sx, sy)
  for (const m of mods) await page.keyboard.up(m)
  await page.waitForTimeout(200)
  await settle()
}

const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('CheckpointLoaderSimple', 60, 60)
  const t1 = mk('CheckpointSave', 1500, 80)
  const s2 = mk('CheckpointLoaderSimple', 60, 260)
  const t2 = mk('CheckpointSave', 1500, 280)
  const s3 = mk('CheckpointLoaderSimple', 650, 560) // rides the group-drag case
  s1.connect(0, t1, 0); s2.connect(0, t2, 0)
  const [l1, l2] = [...g._links.values()].map((l) => l.id)
  const combId = window.__cablemanagementCombs.create(l1, l2, 700, 300)
  window.__cablemanagementCombs.move(combId, 'out', 1100, 300)
  return { s3: s3.id, combId }
})
await settle()

const sel = () => page.evaluate(() => window.__cablemanagementCombs.selection())
const gatePos = (which) => page.evaluate((w) => {
  const c = window.app.graph.extra.cablemanagement_combs.find(Boolean)
  return [c[w].pos[0], c[w].pos[1], c.lanes.length]
}, which)

// (1) click in-gate body
const [ix, iy, n1] = await gatePos('in')
await click(ix + 21, iy + (24 + Math.max(2, n1 - 1) * 20) / 2)
let s = await sel()
ok('click selects the gate', s.length === 1 && s[0].endsWith('|in'), JSON.stringify(s))

// (2) shift-click out-gate body
const [ox, oy, n2] = await gatePos('out')
await click(ox + 2, oy + (24 + Math.max(2, n2 - 1) * 20) / 2, ['Shift'])
s = await sel()
ok('shift-click adds the other gate', s.length === 2, JSON.stringify(s))

// (3) click empty canvas
await click(400, 700)
s = await sel()
ok('empty click clears', s.length === 0, JSON.stringify(s))

// Ctrl+drag is the marquee on this instance (legacy nav mode: plain drag pans).
// Screen coords are computed fresh inside -- a pan invalidates precomputed ones.
const marquee = async (x0, y0, x1, y1) => {
  const [sx0, sy0] = await screen(x0, y0)
  const [sx1, sy1] = await screen(x1, y1)
  await page.keyboard.down('Control')
  await page.mouse.move(sx0, sy0)
  await page.mouse.down()
  await page.mouse.move(sx1, sy1, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  await settle()
}

// (4) marquee over the comb (gates only; teeth become proxies then purge)
await marquee(640, 250, 1200, 420)
s = await sel()
const core = await page.evaluate(() => {
  const its = [...window.app.canvas.selectedItems]
  return { size: its.length, reroutes: its.filter((it) => it?.linkIds && it.pos).length }
})
ok('marquee selects both gates', s.length === 2, JSON.stringify(s))
ok('teeth purged from core selection', core.reroutes === 0, JSON.stringify(core))

// (5) marquee node + comb, then drag the node -- gates follow
await page.evaluate(() => window.app.canvas.deselectAll?.())
await marquee(600, 250, 1250, 760)
const pre = await page.evaluate((ids) => {
  const g = window.app.graph
  const c = g.extra.cablemanagement_combs.find(Boolean)
  return {
    sel: window.__cablemanagementCombs.selection().length,
    nodeSelected: [...window.app.canvas.selectedItems].some((it) => it?.id === ids.s3),
    node: g.getNodeById(ids.s3).pos.slice(),
    gin: c.in.pos.slice(),
    gout: c.out.pos.slice()
  }
}, ids)
ok('marquee catches node and gates', pre.sel === 2 && pre.nodeSelected, JSON.stringify({ sel: pre.sel, node: pre.nodeSelected }))
const nodeTitle = await page.evaluate((ids) => {
  const n = window.app.graph.getNodeById(ids.s3)
  const { ds } = window.app.canvas
  return [(n.pos[0] + 80 + ds.offset[0]) * ds.scale, (n.pos[1] - 12 + ds.offset[1]) * ds.scale]
}, ids)
await page.mouse.move(nodeTitle[0], nodeTitle[1])
await page.mouse.down()
await page.mouse.move(nodeTitle[0] + 120, nodeTitle[1] + 70, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(300)
await settle()
const post = await page.evaluate((ids) => {
  const g = window.app.graph
  const c = g.extra.cablemanagement_combs.find(Boolean)
  return { node: g.getNodeById(ids.s3).pos.slice(), gin: c.in.pos.slice(), gout: c.out.pos.slice() }
}, ids)
const nd = [post.node[0] - pre.node[0], post.node[1] - pre.node[1]]
const gd = [post.gin[0] - pre.gin[0], post.gin[1] - pre.gin[1]]
const gd2 = [post.gout[0] - pre.gout[0], post.gout[1] - pre.gout[1]]
ok('node moved', Math.abs(nd[0]) > 50, `nd=${nd}`)
ok('gates follow the group drag', Math.abs(gd[0] - nd[0]) < 1 && Math.abs(gd[1] - nd[1]) < 1 && Math.abs(gd2[0] - nd[0]) < 1, `gd=${gd} gd2=${gd2}`)

// (5b) the other direction: drag the GATE body -- the selected node rides along
const pre2 = await page.evaluate((ids) => {
  const g = window.app.graph
  const c = g.extra.cablemanagement_combs.find(Boolean)
  return { node: g.getNodeById(ids.s3).pos.slice(), gin: c.in.pos.slice() }
}, ids)
// x+21: right of the hover glyph column (x+6..x+18), still inside the body
const [gsx, gsy] = await screen(pre2.gin[0] + 21, pre2.gin[1] + 22)
await page.mouse.move(gsx, gsy)
await page.mouse.down()
await page.mouse.move(gsx - 90, gsy - 50, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(300)
await settle()
const post2 = await page.evaluate((ids) => {
  const g = window.app.graph
  const c = g.extra.cablemanagement_combs.find(Boolean)
  return { node: g.getNodeById(ids.s3).pos.slice(), gin: c.in.pos.slice() }
}, ids)
const gd3 = [post2.gin[0] - pre2.gin[0], post2.gin[1] - pre2.gin[1]]
const nd2 = [post2.node[0] - pre2.node[0], post2.node[1] - pre2.node[1]]
ok('gate drag moves the gate', Math.abs(gd3[0]) > 30, `gd=${gd3}`)
ok('selected node rides the gate drag', Math.abs(nd2[0] - gd3[0]) < 1 && Math.abs(nd2[1] - gd3[1]) < 1, `nd=${nd2} gd=${gd3}`)

// (6) z-order: second comb, select first -> its record moves to the end
await page.evaluate(async (ids) => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s4 = mk('CheckpointLoaderSimple', 60, 820)
  const t4 = mk('CheckpointSave', 1500, 840)
  s4.connect(0, t4, 0)
  const s5 = mk('CheckpointLoaderSimple', 60, 1040)
  const t5 = mk('CheckpointSave', 1500, 1060)
  s5.connect(0, t5, 0)
  const links = [...g._links.values()].filter((l) => !l.parentId).map((l) => l.id)
  window.__cablemanagementCombs.create(links[0], links[1], 700, 900)
})
await settle()
const [zx, zy, zn] = await gatePos('in') // first comb (find(Boolean) = first record)
const firstId = await page.evaluate(() => window.app.graph.extra.cablemanagement_combs[0].id)
await click(zx + 21, zy + (24 + Math.max(2, zn - 1) * 20) / 2)
const zorder = await page.evaluate(() => window.app.graph.extra.cablemanagement_combs.map((c) => c.id))
ok('selection moves comb to top of z-order', zorder[zorder.length - 1] === firstId, `order=${zorder} first=${firstId}`)

// (7) delete key semantics -- fresh graph per sub-case
const build = () => page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('CheckpointLoaderSimple', 60, 60)
  const t1 = mk('CheckpointSave', 1500, 80)
  const s2 = mk('CheckpointLoaderSimple', 60, 260)
  const t2 = mk('CheckpointSave', 1500, 280)
  s1.connect(0, t1, 0); s2.connect(0, t2, 0)
  const links = [...g._links.values()].map((l) => l.id)
  const id = window.__cablemanagementCombs.create(links[0], links[1], 700, 300)
  window.__cablemanagementCombs.move(id, 'out', 1100, 300)
  return { links }
})
const del = async () => {
  await page.keyboard.press('Delete')
  await page.waitForTimeout(300)
  await settle()
}
const state = (links) => page.evaluate((links) => {
  const g = window.app.graph
  const chains = links.map((id) => {
    const l = g._links.get(id)
    const ids = []
    let rid = l?.parentId
    while (rid != null) { ids.push(rid); rid = g.getReroute(rid)?.parentId }
    return ids.length
  })
  return {
    records: g.extra?.cablemanagement_combs?.length ?? 0,
    reroutes: g.reroutes.size,
    chains,
    toast: document.body.innerText.includes('Nothing selected')
  }
}, links)

// (7a) one gate selected: in-side dissolves, out column decomposes to reroutes
let { links } = await build()
await settle()
let [gx, gy, gn] = await gatePos('in')
await click(gx + 21, gy + (24 + Math.max(2, gn - 1) * 20) / 2)
await del()
let st = await state(links)
ok('one-gate delete dissolves the comb', st.records === 0, JSON.stringify(st))
ok('partner column decomposes to plain reroutes', st.reroutes === 2 && st.chains.every((c) => c === 1), JSON.stringify(st))
ok('no toast on gates-only delete', !st.toast)

// (7b) both gates selected: full dissolve, links heal plain
;({ links } = await build())
await settle()
;[gx, gy, gn] = await gatePos('in')
await click(gx + 21, gy + (24 + Math.max(2, gn - 1) * 20) / 2)
const [ox2, oy2, on2] = await gatePos('out')
await click(ox2 + 2, oy2 + (24 + Math.max(2, on2 - 1) * 20) / 2, ['Shift'])
await del()
st = await state(links)
ok('both-gates delete heals the links', st.records === 0 && st.reroutes === 0 && st.chains.every((c) => c === 0), JSON.stringify(st))

// (7c) mixed: node + both gates -- core deletes its item, we dissolve the comb
;({ links } = await build())
const extraId = await page.evaluate(() => {
  const n = window.LiteGraph.createNode('EmptyLatentImage')
  n.pos = [700, 700]
  window.app.graph.add(n)
  return n.id
})
await settle()
await marquee(640, 650, 1000, 830) // node only
;[gx, gy, gn] = await gatePos('in')
await click(gx + 21, gy + (24 + Math.max(2, gn - 1) * 20) / 2, ['Shift'])
const [ox3, oy3, on3] = await gatePos('out')
await click(ox3 + 2, oy3 + (24 + Math.max(2, on3 - 1) * 20) / 2, ['Shift'])
const preMix = await page.evaluate((id) => ({
  node: !!window.app.graph.getNodeById(id),
  coreSel: window.app.canvas.selectedItems.size,
  gates: window.__cablemanagementCombs.selection().length
}), extraId)
await del()
st = await state(links)
const postMix = await page.evaluate((id) => !!window.app.graph.getNodeById(id), extraId)
ok('mixed selection armed', preMix.node && preMix.coreSel >= 1 && preMix.gates === 2, JSON.stringify(preMix))
ok('mixed delete dissolves the comb', st.records === 0 && st.reroutes === 0, JSON.stringify(st))
ok('mixed delete lets core delete the node', postMix === false)

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
