// PR #4 probe: ribbons ride group drags.
//   s1 group around ribbon+nodes, drag TITLE -> gates + teeth + nodes move together
//   s2 group NOT containing the ribbon, drag title -> gates stay put
//   s3 selected group + node drag -> gates ride
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2560, height: 1300 } })
page.on('pageerror', (e) => console.log('PAGEERR', String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const build = () => page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
  window.app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('EmptyLatentImage', 60, 200)
  const s2 = mk('CheckpointLoaderSimple', 60, 500)
  const y1 = mk('KSampler', 1200, 180)
  const y2 = mk('CheckpointSave', 1200, 600)
  const idx = y1.inputs.findIndex((s) => s.name === 'latent_image')
  s1.connect(0, y1, idx); s2.connect(0, y2, 0)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1500))
  window.__cablemanagementCombs.create(y1.inputs[idx].link, y2.inputs[0].link, 600, 350)
  await new Promise((r) => setTimeout(r, 900))
  const grp = new L.LGraphGroup('ribbon zone')
  grp.pos = [520, 260]; grp.size = [260, 260] // covers both gates, no nodes
  g.add(grp)
  const far = new L.LGraphGroup('empty zone')
  far.pos = [1900, 900]; far.size = [200, 150]
  g.add(far)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 600))
  return { title: [grp.pos[0] + 60, grp.pos[1] + 10], farTitle: [far.pos[0] + 60, far.pos[1] + 10] }
})

const snap = () => page.evaluate(() => {
  const g = window.app.graph
  const c = g.extra.cablemanagement_combs[0]
  return {
    gin: [...c.in.pos], gout: [...c.out.pos],
    teeth: c.lanes.map((l) => [g.reroutes.get(l.in)?.pos[1] | 0, g.reroutes.get(l.out)?.pos[1] | 0])
  }
})
const screen = (gx, gy) => page.evaluate(([gx, gy]) => {
  const { ds } = window.app.canvas
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
}, [gx, gy])
const drag = async (fromG, dx, dy) => {
  const [sx, sy] = await screen(fromG[0], fromG[1])
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + dx, sy + dy, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(800)
}

let pass = true
const ok = (l, c, x = '') => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}${x ? ' -- ' + x : ''}`); if (!c) pass = false }

// s3: select ribbon group + a node, drag the NODE -> gates ride
let pts = await build()
await page.evaluate(() => {
  const g = window.app.graph
  const grp = [...g.groups].find((x) => x.title === 'ribbon zone')
  const n = g._nodes.find((n) => n.type === 'EmptyLatentImage')
  window.app.canvas.selectItems([grp, n])
})
await page.waitForTimeout(400)
let before = await snap()
await page.waitForFunction(() => {
  const n = window.app.graph._nodes.find((n) => n.type === 'EmptyLatentImage')
  return n && !!document.querySelector(`.lg-node[data-node-id="${n.id}"]`)
}, null, { timeout: 15_000 })
const nodePt = await page.evaluate(() => {
  const n = window.app.graph._nodes.find((n) => n.type === 'EmptyLatentImage')
  const el = document.querySelector(`.lg-node[data-node-id="${n.id}"]`)
  const r = el.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + 14]
})
await page.mouse.move(nodePt[0], nodePt[1])
await page.mouse.down()
await page.mouse.move(nodePt[0] + 180, nodePt[1] + 90, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(900)
let after = await snap()
const d3 = [after.gin[0] - before.gin[0], after.gin[1] - before.gin[1]]
ok('s3: node drag carries selected group\'s gates', Math.abs(d3[0] - 180) <= 12 && Math.abs(d3[1] - 90) <= 12, JSON.stringify({ d3 }))

// s1: drag the ribbon group's title
pts = await build()
before = await snap()
await drag(pts.title, 200, 120)
after = await snap()
const d1 = [after.gin[0] - before.gin[0], after.gin[1] - before.gin[1]]
ok('s1: gates ride the group-title drag', Math.abs(d1[0] - 200) <= 12 && Math.abs(d1[1] - 120) <= 12, JSON.stringify({ d1 }))
const toothsFollow = after.teeth.every((t, i) => Math.abs(t[0] - before.teeth[i][0] - d1[1]) <= 12)
ok('s1: teeth follow (ribbon intact)', toothsFollow, JSON.stringify({ before: before.teeth, after: after.teeth }))

// s2: drag the far (empty) group's title
before = await snap()
await drag(pts.farTitle, -150, -80)
after = await snap()
ok('s2: uninvolved group drag leaves gates put',
  after.gin[0] === before.gin[0] && after.gin[1] === before.gin[1] && after.gout[0] === before.gout[0],
  JSON.stringify({ before: before.gin, after: after.gin }))

await b.close()
console.log(pass ? 'PASS' : 'FAIL')
if (!pass) process.exit(1)
