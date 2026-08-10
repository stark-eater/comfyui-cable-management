// Gate flow carets (polish round): the IN gate carries a caret pointing from its
// pin column toward the ribbon, the OUT gate from the ribbon toward its pins --
// both read as travel direction. Asserted by sampling the gate overlay canvas on
// either side of the gate centre: the apex side holds more stroke pixels, and
// flipping a gate flips the asymmetry.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
const settle = () => page.evaluate(async () => {
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})

const combId = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('CheckpointLoaderSimple', 60, 60)
  const t1 = mk('CheckpointSave', 1500, 80)
  const s2 = mk('CheckpointLoaderSimple', 60, 300)
  const t2 = mk('CheckpointSave', 1500, 320)
  s1.connect(0, t1, 0); s2.connect(0, t2, 0)
  const [l1, l2] = [...g._links.values()].map((l) => l.id)
  const id = window.__cablemanagementCombs.create(l1, l2, 700, 300)
  window.__cablemanagementCombs.move(id, 'out', 1100, 300)
  return id
})
await settle()

// Stroke pixels in 4x4 boxes centred on the two candidate APEX points (gate
// centre +-3 on x). The caret's apex sits at mid-height where its arms never
// reach the mirror side, so the apex box lights up and the other stays dark.
const sample = (which) => page.evaluate((which) => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const n = c.lanes.length
  const h = 24 + Math.max(2, n - 1) * 20
  const gx = c[which].pos[0] + 12, gy = c[which].pos[1] + h / 2
  const overlay = document.querySelector('.cablemanagement-gate-overlay')
  const { scale, offset } = window.app.canvas.ds
  const dpr = window.devicePixelRatio || 1
  const k = dpr * scale
  const ctx = overlay.getContext('2d')
  // Chrome-round caret: FILLED rgba(0,0,0,0.45) -- caret pixels are the body
  // colour darkened, so count pixels clearly darker than a body reference.
  const bref = ctx.getImageData(Math.round(k * (gx + offset[0])), Math.round(k * (gy - 10 + offset[1])), 1, 1).data
  const count = (cx) => {
    const img = ctx.getImageData(Math.round(k * (cx - 2 + offset[0])), Math.round(k * (gy - 2 + offset[1])), Math.ceil(4 * k), Math.ceil(4 * k))
    let lit = 0
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 0 && img.data[i] < bref[0] - 6) lit++
    return lit
  }
  return { left: count(gx - 3), right: count(gx + 3) }
}, which)

// The filled triangle is SOLID at its base and a sliver at the apex, so the
// box OPPOSITE the pointing direction lights up: points right => left > right.
const in1 = await sample('in')
ok('in-gate caret points at the ribbon (right)', in1.left > in1.right + 2, JSON.stringify(in1))
const out1 = await sample('out')
ok('out-gate caret points at the pins (right)', out1.left > out1.right + 2, JSON.stringify(out1))

await page.evaluate((id) => window.__cablemanagementCombs.flip(id, 'in'), combId)
await settle()
const in2 = await sample('in')
ok('flipping the in-gate flips its caret', in2.right > in2.left + 2, JSON.stringify(in2))

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
