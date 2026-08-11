// Obstacle-aware decollide (polish round): five links forced through the gap
// between two stacked blocker nodes all pick the same lane (the upper blocker's
// inflated bottom edge) and the nudge fans them out. Blind centring used to push
// the outer strands INTO the blocker; the biased fan must keep every strand
// inside the gap, clear of both node boxes, without losing the spread.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}

const out = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  // Blockers: walls above and below a 60px gap (rects y ..430 and 490..; the
  // boundingRect adds the title bar above pos). The upper wall extends far past
  // the top of the canvas so wrapping over it never beats the gap.
  const b1 = mk('EmptyLatentImage', 700, -400); b1.setSize([220, 830])
  const b2 = mk('EmptyLatentImage', 700, 520); b2.setSize([220, 380])
  for (let i = 0; i < 5; i++) {
    const s = mk('CheckpointLoaderSimple', 60, 60 + i * 70)
    const t = mk('CheckpointSave', 1500, 60 + i * 70)
    s.connect(0, t, 0)
  }
  // Burn redraw frames so routes settle past the default-slot-position ghosts.
  for (let i = 0; i < 8; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 200)) }
  const boxes = [b1, b2].map((n) => {
    const r = n.boundingRect ?? [n.pos[0], n.pos[1], n.size[0], n.size[1]]
    return [r[0], r[1], r[0] + r[2], r[1] + r[3]]
  })
  return { routes: window.__cablemanagementPathing.routes().map((r) => r.pts), boxes }
})

// Interior segments overlapping the blocker column must not enter either box
// (with the router's 4px hard margin).
const [bx0, , bx1] = [out.boxes[0][0], 0, out.boxes[0][2]]
const inGap = []
let violations = 0
for (const pts of out.routes) {
  for (let k = 1; k < pts.length - 2; k++) {
    const a = pts[k], c = pts[k + 1]
    const horiz = Math.abs(a[1] - c[1]) < 0.1
    const lo = Math.min(a[0], c[0]), hi = Math.max(a[0], c[0])
    if (!horiz || Math.min(hi, bx1) - Math.max(lo, bx0) < 20) continue
    inGap.push(Math.round(a[1]))
    for (const [x0, y0, x1, y1] of out.boxes) {
      if (a[1] > y0 - 4 && a[1] < y1 + 4 && hi > x0 && lo < x1) violations++
    }
  }
}
ok('five crossings ride the gap', inGap.length === 5, JSON.stringify(inGap))
ok('no strand enters a blocker box', violations === 0, `violations=${violations}`)
ok('fan survives the bias (distinct lanes)', new Set(inGap).size === 5, JSON.stringify([...new Set(inGap)]))
const span = inGap.length ? [Math.min(...inGap), Math.max(...inGap)] : null
ok('strands clear both boxes by >=CLEAR', span && span[0] >= out.boxes[0][3] + 5 && span[1] <= out.boxes[1][1] - 5, JSON.stringify({ span, gap: [out.boxes[0][3], out.boxes[1][1]] }))

await page.screenshot({ path: 'cablemanagement-screenshots/pathing-gapbias.png' })
console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
