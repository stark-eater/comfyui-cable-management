// Reroute direction rule (Barney's spec): the wire enters a reroute horizontally
// from the side its upstream hop sits on and leaves from the opposite side, so the
// chain flows straight through the dot -- arrival sign == departure sign, never a
// hook. Scenes: (A) forward flow -> in left, out right; (B) backward flow (source
// right of the dot) -> in right, out left; (C) vertical drop -- two stacked dots,
// the lower one's upstream is dead vertical, so it tie-breaks by its downstream
// (target on the left) -> in right, out left, exactly the screenshot shape.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

// Per scene: build, settle, then report arrival/departure x-sign at every reroute.
const scene = (nodes, reroutePos) => page.evaluate(async ({ nodes, reroutePos }) => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  const P = window.__cablemanagementPathing
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = P.PCB()
  const made = nodes.map(([type, x, y]) => { const n = L.createNode(type); n.pos = [x, y]; g.add(n); return n })
  made[0].connect(0, made[1], 0)
  const link = [...g._links.values()][0]
  const dots = reroutePos.map((p) => g.createReroute(p, link))
  const settle = async () => {
    for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 200)) }
  }
  await settle()
  const routes = P.routes()
  const near = (pt, p) => Math.abs(pt[0] - p[0]) < 20 && Math.abs(pt[1] - p[1]) < 20
  const out = dots.map((d) => {
    const p = [d.pos[0], d.pos[1]]
    const into = routes.find((r) => near(r.pts[r.pts.length - 1], p))
    const outof = routes.find((r) => near(r.pts[0], p))
    const arr = into ? Math.sign(into.pts[into.pts.length - 1][0] - into.pts[into.pts.length - 2][0]) : 0
    const dep = outof ? Math.sign(outof.pts[1][0] - outof.pts[0][0]) : 0
    return { arr, dep }
  })
  return { routes: routes.length, dots: out }
}, { nodes, reroutePos })

let pass = true
const check = (label, got, want) => {
  got.dots.forEach((d, i) => {
    const [wa, wd] = want[i]
    const ok = d.arr === wa && d.dep === wd
    console.log(`${label} dot${i}: arr=${d.arr} dep=${d.dep} want=${wa}/${wd} ${ok ? 'ok' : 'MISMATCH'}`)
    if (!ok) pass = false
  })
}

// (A) forward: loader left, dot mid, save right -- straight-through rightward.
const A = await scene(
  [['CheckpointLoaderSimple', 100, 80], ['CheckpointSave', 800, 300]],
  [[560, 200]]
)
check('A', A, [[1, 1]])

// (B) backward: loader RIGHT of the dot, save left -- straight-through leftward.
const B = await scene(
  [['CheckpointLoaderSimple', 800, 80], ['CheckpointSave', 100, 300]],
  [[560, 450]]
)
check('B', B, [[-1, -1]])

// (C) vertical drop: top dot enters left/exits right; bottom dot sits dead below
// it, tie-breaks by its downstream target on the left -> enters right/exits left.
const C = await scene(
  [['CheckpointLoaderSimple', 100, 80], ['CheckpointSave', 100, 450]],
  [[600, 110], [600, 400]]
)
check('C', C, [[1, 1], [-1, -1]])

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
