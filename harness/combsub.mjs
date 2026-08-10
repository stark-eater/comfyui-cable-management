// Comb layer x subgraphs (root-vs-active-graph fix): every gesture and API path must
// resolve the graph ON SCREEN, never app.graph (the root).
// (1) comb created inside a subgraph lands in the SUBGRAPH's extra, enrolling subgraph
//     links; the root stays untouched;
// (2) gate body drag works inside the subgraph (teeth follow);
// (3) a link drag released over empty subgraph canvas at coordinates where a ROOT
//     reroute sits (positions genuinely overlap after convertToSubgraph) must NOT
//     connect through the root reroute -- pre-fix this minted a cross-graph link that
//     persisted on save;
// (4) a press inside the subgraph at a ROOT comb gate's coordinates is not swallowed
//     and selects nothing (pre-fix: invisible root gates ate presses);
// (5) back at root, the root comb still works (gate drag moves teeth).
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
  const g = window.app.canvas.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 200)) }
})
const screen = (gx, gy) => page.evaluate(([gx, gy]) => {
  const { ds } = window.app.canvas
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
}, [gx, gy])
const drag = async (fx, fy, tx, ty) => {
  const [sx, sy] = await screen(fx, fy)
  const [ex, ey] = await screen(tx, ty)
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(ex, ey, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  await settle()
}

// Scene. Root: one pair with a DECOY free reroute at [700, 200], plus a root comb
// built from two more pairs (its gates live around x=2300 -- clear of everything the
// subgraph will contain). Then two further pairs converted into a subgraph; conversion
// preserves inner positions, so subgraph coordinates overlap root coordinates.
const ids = await page.evaluate(() => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  // decoy pair
  const dA = mk('CheckpointLoaderSimple', 60, 100)
  const dB = mk('CheckpointSave', 1480, 120)
  dA.connect(0, dB, 0)
  const decoy = g.createReroute([700, 200], [...g._links.values()].at(-1))
  // root comb from two pairs. Gate at [1600, 320]: ON-SCREEN in the 1900px viewport
  // (off-screen presses silently no-op and turn the swallow assert into a false
  // positive), clear of root nodes, and empty space in the subgraph view.
  const r1 = mk('CheckpointLoaderSimple', 2400, 100); const r2 = mk('CheckpointSave', 3400, 120)
  const r3 = mk('CheckpointLoaderSimple', 2400, 400); const r4 = mk('CheckpointSave', 3400, 420)
  r1.connect(0, r2, 0); r3.connect(0, r4, 0)
  const links = [...g._links.values()]
  const combId = window.__cablemanagementCombs.create(links.at(-2).id, links.at(-1).id, 1600, 320)
  // subgraph fodder: two linked pairs occupying the SAME band as the decoy
  const s1 = mk('CheckpointLoaderSimple', 60, 600); const s2 = mk('CheckpointSave', 1480, 620)
  const s3 = mk('CheckpointLoaderSimple', 60, 900); const s4 = mk('CheckpointSave', 1480, 920)
  s1.connect(0, s2, 0); s3.connect(0, s4, 0)
  const { subgraph } = g.convertToSubgraph(new Set([s1, s2, s3, s4]))
  const rootComb = g.extra.cablemanagement_combs.find((c) => c.id === combId)
  return {
    decoyId: decoy.id, decoyLinks: [...decoy.linkIds], combId,
    rootGate: [...rootComb.in.pos], rootLinkCount: g._links.size,
    subId: subgraph.id,
  }
})
await page.evaluate((i) => {
  const sub = window.app.graph.subgraphs?.get?.(i.subId) ??
    window.app.graph.nodes.find((n) => n.subgraph)?.subgraph
  window.app.canvas.openSubgraph(sub)
}, ids)
await page.waitForTimeout(1500)
const inSub = await page.evaluate(() => window.app.canvas.graph !== window.app.graph)
ok('entered subgraph', inSub)

// (1) comb creation inside the subgraph: two reroutes on the two inner links, then a
// real-mouse drop of one onto the other.
const prep = await page.evaluate(() => {
  const g = window.app.canvas.graph
  const links = [...g._links.values()].filter((l) => l.origin_id > 0 && l.target_id > 0)
  const a = g.createReroute([700, 650], links[0])
  const c = g.createReroute([700, 950], links[1])
  g.setDirtyCanvas(true, true)
  return { links: links.length, a: a.id, c: c.id }
})
await settle()
await drag(700, 950, 700, 650)
const c1 = await page.evaluate(() => {
  const app = window.app
  const sub = app.canvas.graph
  return {
    subCombs: sub.extra?.cablemanagement_combs?.length ?? 0,
    subLanes: sub.extra?.cablemanagement_combs?.[0]?.lanes?.length ?? 0,
    rootCombs: app.graph.extra?.cablemanagement_combs?.length ?? 0,
    subReroutes: sub.reroutes.size,
  }
})
ok('comb created in the SUBGRAPH extra', c1.subCombs === 1 && c1.subLanes === 2, JSON.stringify(c1))
ok('root comb records untouched', c1.rootCombs === 1, `rootCombs=${c1.rootCombs}`)

// (2) gate body drag inside the subgraph
const before = await page.evaluate(() => {
  const c = window.app.canvas.graph.extra.cablemanagement_combs[0]
  const teeth = c.lanes.map((l) => [...window.app.canvas.graph.reroutes.get(l.in).pos])
  return { gate: [...c.in.pos], teeth }
})
await drag(before.gate[0] + 21, before.gate[1] + 30, before.gate[0] + 212, before.gate[1] + 90)
const after = await page.evaluate(() => {
  const c = window.app.canvas.graph.extra.cablemanagement_combs[0]
  const teeth = c.lanes.map((l) => [...window.app.canvas.graph.reroutes.get(l.in).pos])
  return { gate: [...c.in.pos], teeth }
})
const gateMoved = Math.abs(after.gate[0] - before.gate[0]) > 100
const teethFollowed = after.teeth.every((t, i) => Math.abs(t[0] - before.teeth[i][0]) > 100)
ok('gate drag works inside subgraph', gateMoved, `gate ${before.gate} -> ${after.gate}`)
ok('teeth follow the gate', teethFollowed)

// (3) press at the ROOT gate's coordinates while inside the subgraph: nothing selects
// and nothing is swallowed. (Must run before the empty-canvas drop below -- dismissing
// the link-release search box with Escape EXITS the subgraph.)
const [gx, gy] = await screen(ids.rootGate[0] + 12, ids.rootGate[1] + 30)
await page.mouse.click(gx, gy)
await page.waitForTimeout(300)
const sel = await page.evaluate(() => ({
  sel: window.__cablemanagementCombs.selection(),
  stillInSub: window.app.canvas.graph !== window.app.graph,
}))
ok('root gate does not swallow subgraph presses', sel.stillInSub && sel.sel.length === 0, JSON.stringify(sel))

// (4) corruption regression: drag the free inner loader output and release at the
// DECOY's coordinates [700, 200] -- empty canvas in the subgraph, root reroute there.
const dragFrom = await page.evaluate(() => {
  const g = window.app.canvas.graph
  const n = g.nodes.find((n) => n.outputs?.[0]?.type === 'MODEL' && !(n.outputs[0].links?.length))
    ?? g.nodes.find((n) => n.outputs?.some((o) => o.links?.length))
  const slot = n.outputs.findIndex((o) => o) // first output
  const p = n.getConnectionPos ? n.getConnectionPos(false, slot) : [n.pos[0] + n.size[0], n.pos[1] + 20]
  return [p[0], p[1]]
})
const preDrop = await page.evaluate((i) => ({
  rootLinks: window.app.graph._links.size,
  decoyLinks: [...(window.app.graph.reroutes.get(i.decoyId)?.linkIds ?? [])],
  subLinks: window.app.canvas.graph._links.size,
}), ids)
await drag(dragFrom[0], dragFrom[1], 700, 200)
await page.keyboard.press('Escape') // stock link-release opens the search box; dismiss
await page.waitForTimeout(500)
const postDrop = await page.evaluate((i) => {
  const app = window.app
  const sub = app.canvas.graph
  const subNodeIds = new Set(sub.nodes.map((n) => String(n.id)))
  const alien = [...sub._links.values()].filter(
    (l) => l.origin_id > 0 && l.target_id > 0 &&
      (!subNodeIds.has(String(l.origin_id)) || !subNodeIds.has(String(l.target_id)))
  )
  return {
    rootLinks: app.graph._links.size,
    decoyLinks: [...(app.graph.reroutes.get(i.decoyId)?.linkIds ?? [])],
    subLinks: sub._links.size,
    alienLinks: alien.length,
  }
}, ids)
ok('no cross-graph link minted', postDrop.alienLinks === 0, `alien=${postDrop.alienLinks}`)
ok('root links untouched by subgraph drop', postDrop.rootLinks === preDrop.rootLinks,
  `${preDrop.rootLinks} -> ${postDrop.rootLinks}`)
ok('decoy root reroute untouched', JSON.stringify(postDrop.decoyLinks) === JSON.stringify(preDrop.decoyLinks))

// (5) exit; root comb still functional. (Escape after the search box may already have
// exited -- the hash write is a no-op in that case.)
await page.evaluate(() => { location.hash = '#' + window.app.graph.id })
await page.waitForTimeout(1500)
const atRoot = await page.evaluate(() => window.app.canvas.graph === window.app.graph)
ok('back at root', atRoot)
const rBefore = await page.evaluate((i) => {
  const c = window.app.graph.extra.cablemanagement_combs.find((c) => c.id === i.combId)
  return { gate: [...c.in.pos], tooth: [...window.app.graph.reroutes.get(c.lanes[0].in).pos] }
}, ids)
await drag(rBefore.gate[0] + 21, rBefore.gate[1] + 30, rBefore.gate[0] + 162, rBefore.gate[1] + 80)
const rAfter = await page.evaluate((i) => {
  const c = window.app.graph.extra.cablemanagement_combs.find((c) => c.id === i.combId)
  return { gate: [...c.in.pos], tooth: [...window.app.graph.reroutes.get(c.lanes[0].in).pos] }
}, ids)
ok('root comb gate drag still works after round trip',
  Math.abs(rAfter.gate[0] - rBefore.gate[0]) > 80 && Math.abs(rAfter.tooth[0] - rBefore.tooth[0]) > 80,
  `gate ${rBefore.gate} -> ${rAfter.gate}`)

console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach((e) => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
