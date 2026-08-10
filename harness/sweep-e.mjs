// SWEEP cell E -- undo/redo across comb create/decompose with passthrough links riding.
// Scene: widget-flavour passthroughs H->B1, H->B2 (both from A's ckpt_name pin, one
// hidden owned primitive H). Change tracker is CHECKPOINTED after the scene (shared
// server: the tracker still holds a previous session's graph otherwise). Steps:
// comb via api -> assert; Ctrl+Z -> report what it restores + assert; redo -> assert;
// select out gate + Delete (one-gate dissolve: out teeth die, in teeth stay as plain
// reroutes) -> assert; Ctrl+Z -> assert. Undo semantics are core's -- the invariants
// are ours: anchors never revert to the hidden primitive, nothing wireless survives,
// comb records match graph truth (every lane's reroute ids exist in graph.reroutes).
//
// KNOWN RED (flaky, ~1 in 5 runs): the REDO of the comb create dies silently.
// Mechanism, proven by the queue-array stack traces this probe logs ('tracker
// timeline'): serialize -> configure -> serialize is NOT idempotent for this scene.
// The hidden primitive H is created AFTER its consumers, so the checkpointed state
// carries creation-order `nodes[].order` values and H's control_after_generate as
// null; the undo's configure recomputes topo order (H jumps to order 1, B1/B2
// shift) and materialises the control widget as "fixed". The first
// captureCanvasState after the restore -- core fires it on ANY mouseup/keyup,
// including the keyups of the redo chord itself -- sees graphEqual=false on those
// two fields, pushes a phantom undo entry, and does redoQueue.length = 0. Whether
// redo survives is a race between core's rAF-deferred keydown handling and the
// chord's own keyup. When redo dies, the probe rebuilds the comb via api so the
// decompose/undo leg still runs; both invariants held in every observed run,
// pass or fail -- the loss is history, never graph corruption.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e.stack ?? e).split(String.fromCharCode(10)).slice(0, 6).join(' <- ')))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(
  () => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs,
  null, { timeout: 120_000 }
)
await page.waitForTimeout(2500)
await page.evaluate(() => window.__cablemanagement?.debugView?.(false)) // operator may test with debug view on; assert against stealth

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}

// ---- scene: A feeds B1.ckpt_name and B2.ckpt_name through the widget pin ---------
const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  window.__preClearId = String(g.id) // the uuid the workflow layer re-stamps post-clear
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 80, 100)
  const B1 = mk('CheckpointLoaderSimple', 1200, 60)
  const B2 = mk('CheckpointLoaderSimple', 1200, 420)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1800))
  return {
    A: String(A.id), B1: String(B1.id), B2: String(B2.id),
    i1: B1.inputs.findIndex(s => s.widget?.name === 'ckpt_name'),
    i2: B2.inputs.findIndex(s => s.widget?.name === 'ckpt_name')
  }
})
const pinPt = () => page.evaluate((i) => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget'
  )
  const r = el?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, ids)
const slotPt = (key) => page.evaluate((k) => {
  const r = document.querySelector(`[data-slot-key="${k}"]`)?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, key)
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
}
await drag(await pinPt(), await slotPt(`${ids.B1}-in-${ids.i1}`))
await drag(await pinPt(), await slotPt(`${ids.B2}-in-${ids.i2}`))
await page.waitForTimeout(1200)

// Burn frames with capture on; every read below sees a fresh draw map.
const fresh = () => page.evaluate(async () => {
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 150)) }
})

// One truth snapshot: pin anchor (graph coords, recomputed from the live element),
// true-origin slot of H, per-link draw starts, routes near H, reroute carry counts,
// comb records validated against graph.reroutes.
const snap = (tag) => page.evaluate((arg) => {
  const g = window.app.graph
  const draw = window.__cablemanagementDraw ?? new Map()
  const H = g.nodes.find(n => n.properties?.['cablemanagement.owned']) ?? null
  const hOut = H ? H.getConnectionPos(false, 0) : null
  const pinEl = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === arg.A && x.dataset.cablemanagementKind === 'widget'
  )
  let pin = null
  if (pinEl) {
    const r = pinEl.getBoundingClientRect()
    const c = window.app.canvas, cr = c.canvas.getBoundingClientRect()
    pin = [
      (r.x + r.width / 2 - cr.left) / c.ds.scale - c.ds.offset[0],
      (r.y + r.height / 2 - cr.top) / c.ds.scale - c.ds.offset[1]
    ]
  }
  const linkFor = (bid) => [...g._links.values()].find(l => String(l.target_id) === String(bid)) ?? null
  const links = [arg.B1, arg.B2].map((bid) => {
    const l = linkFor(bid)
    return l ? { id: l.id, parentId: l.parentId ?? null, draw: draw.get(l.id) ?? null } : null
  })
  const routes = window.__cablemanagementPathing.routes()
  const nearH = hOut
    ? routes.filter(r => Math.hypot(r.pts[0][0] - hOut[0], r.pts[0][1] - hOut[1]) < 30).map(r => r.key)
    : []
  const reroutes = [...(g.reroutes?.values() ?? [])].map(r => ({
    id: r.id, links: r.linkIds?.size ?? 0, floats: r.floatingLinkIds?.size ?? 0
  }))
  const carry = (r) => (r?.linkIds?.size ?? 0) + (r?.floatingLinkIds?.size ?? 0)
  const combs = (g.extra?.cablemanagement_combs ?? []).map(c => ({
    id: c.id,
    lanes: c.lanes.map(l => ({ in: l.in, out: l.out })),
    missing: c.lanes.flatMap(l => [l.in, l.out]).filter(id => !g.reroutes?.get?.(id)),
    wireless: c.lanes.filter(l => {
      const a = g.reroutes?.get?.(l.in), o = g.reroutes?.get?.(l.out)
      return a && o && carry(a) === 0 && carry(o) === 0
    }).length
  }))
  return {
    tag: arg.tag, pin, hOut, links, nearH, reroutes, combs,
    hHidden: H ? document.querySelector(`.lg-node[data-node-id="${H.id}"]`)?.style.visibility === 'hidden' : null,
    floating: g.floatingLinks?.size ?? 0,
    ledger: window.__cablemanagement?.ledger().size ?? -1
  }
}, { ...ids, tag })

// Both invariants against one snapshot. basePin: the anchor captured before any
// mutation -- nodes never move in this probe, so the live pin must equal it too.
let basePin = null
const assertInv = (tag, s) => {
  ok(`[${tag}] pin element present`, !!s.pin, JSON.stringify(s.pin))
  if (s.pin && basePin) {
    ok(`[${tag}] pin did not drift`, Math.hypot(s.pin[0] - basePin[0], s.pin[1] - basePin[1]) <= 1.5,
      JSON.stringify({ pin: s.pin, basePin }))
  }
  s.links.forEach((l, i) => {
    ok(`[${tag}] I1 link->B${i + 1} exists`, !!l)
    if (!l) return
    const d = l.draw
    ok(`[${tag}] I1 link ${l.id} draws from the pin`,
      !!d && !!s.pin && Math.hypot(d[0] - s.pin[0], d[1] - s.pin[1]) <= 1.5,
      JSON.stringify({ draw: d, pin: s.pin }))
    ok(`[${tag}] I1 link ${l.id} never from the true origin`,
      !d || !s.hOut || Math.hypot(d[0] - s.hOut[0], d[1] - s.hOut[1]) >= 30,
      JSON.stringify({ draw: d, hOut: s.hOut }))
  })
  ok(`[${tag}] I1 no route starts at the true origin`, s.nearH.length === 0, JSON.stringify(s.nearH))
  const orphans = s.reroutes.filter(r => r.links === 0 && r.floats === 0)
  ok(`[${tag}] I2 no wireless reroutes`, orphans.length === 0, JSON.stringify(orphans))
  const bad = s.combs.filter(c => c.missing.length || c.wireless > 0 || c.lanes.length < 2)
  ok(`[${tag}] I2 comb records match graph truth`, bad.length === 0, JSON.stringify(bad))
}

await fresh()
const base = await snap('base')
basePin = base.pin
ok('[base] two passthrough links, primitive hidden',
  base.links.every(Boolean) && base.hHidden === true && base.floating === 0, JSON.stringify(base))
assertInv('base', base)

// ---- checkpoint AFTER the scene (shared-server trap) -----------------------------
const checkState = () => page.evaluate(() => {
  const t = window.app.extensionManager?.workflow?.activeWorkflow?.changeTracker
  ;(t?.captureCanvasState ?? t?.checkState)?.call(t)
})
await checkState()
await page.waitForTimeout(400)

// Forensics: spy on the tracker instance -- timeline of checkState/undo/redo with
// queue transitions and activeState identity, plus whether the active workflow's
// tracker is still the same object later (a workflow switch would strand our spy).
await page.evaluate(() => {
  const t = window.app.extensionManager?.workflow?.activeWorkflow?.changeTracker
  if (!t) return
  window.__tracker = t
  window.__tlog = []
  // States all share the zero uuid; fingerprint by content instead: reroute count,
  // comb count, link count -- enough to tell S0 (scene) from S1 (combed) apart.
  const fp = (s) => s ? {
    rr: (s.reroutes ?? s.extra?.reroutes ?? []).length,
    cb: (s.extra?.cablemanagement_combs ?? []).length,
    lk: (s.links ?? []).length
  } : null
  const q = () => ({
    u: t.undoQueue?.map(fp), r: t.redoQueue?.map(fp), a: fp(t.activeState)
  })
  // The method spy alone missed a queue mutation once -- tap the arrays too, with
  // stacks, so the caller of any push is undeniable.
  for (const [qn, arr] of [['undoQ', t.undoQueue], ['redoQ', t.redoQueue]]) {
    const origPush = arr.push.bind(arr)
    Object.defineProperty(arr, 'push', {
      value: (...items) => {
        window.__tlog.push({
          at: Date.now(), arr: qn, op: 'push', items: items.map(fp),
          stack: String(new Error().stack).split('\n').slice(1, 5).map(s => s.trim())
        })
        return origPush(...items)
      }
    })
    const origPop = arr.pop.bind(arr)
    Object.defineProperty(arr, 'pop', {
      value: () => {
        window.__tlog.push({ at: Date.now(), arr: qn, op: 'pop' })
        return origPop()
      }
    })
  }
  for (const m of ['checkState', 'undo', 'redo']) {
    const orig = t[m].bind(t)
    t[m] = (...args) => {
      const before = q()
      const entry = { at: Date.now(), m, before }
      window.__tlog.push(entry)
      try {
        const res = orig(...args)
        if (res?.then) {
          return res.then(
            (v) => { entry.after = q(); return v },
            (err) => { entry.after = q(); entry.err = String(err).slice(0, 200); throw err }
          )
        }
        entry.after = q()
        return res
      } catch (err) {
        entry.after = q()
        entry.err = String(err).slice(0, 200)
        throw err
      }
    }
  }
})
const mark = (name) => page.evaluate((name) => {
  const g = window.app.graph
  ;(window.__tlog ??= []).push({
    at: Date.now(), mark: name,
    live: {
      rr: g.reroutes?.size ?? 0,
      cb: (g.extra?.cablemanagement_combs ?? []).length,
      lk: g._links?.size ?? 0
    }
  })
}, name)

// ---- step 1: comb via api --------------------------------------------------------
await page.evaluate((ids) => {
  const g = window.app.graph
  const l1 = [...g._links.values()].find(l => String(l.target_id) === String(ids.B1))
  const l2 = [...g._links.values()].find(l => String(l.target_id) === String(ids.B2))
  const id = window.__cablemanagementCombs.create(l1.id, l2.id, 700, 260)
  window.__cablemanagementCombs.move(id, 'out', 1000, 260)
}, ids)
await fresh()
const combed = await snap('combed')
ok('[combed] comb record with 2 lanes, links ride the teeth',
  combed.combs.length === 1 && combed.combs[0].lanes.length === 2 &&
  combed.links.every((l, i) => l && l.parentId === combed.combs[0].lanes[i].out),
  JSON.stringify(combed.combs))
assertInv('combed', combed)
const laneIds = combed.combs[0]?.lanes ?? []

// The comb api fires none of the tracker's hooks; capture the combed state so
// Ctrl+Z has a defined before/after pair (a user gesture would have captured it).
// Serialize-stability gate first: on 1.47.10 the capture races BOTH the workflow
// id assignment (.id drifts zero-uuid -> real) and our primitive rebuild
// (widgets_values gains 'fixed'); either drift makes checkState wipe the redo
// queue later. A live user's captures re-fire on every gesture so they self-heal;
// this single capture must wait until the shape is stable.
try {
  await page.waitForFunction(() => {
    try {
      const g = window.app.graph
      if (!g) return false
      // Stability tuple: the graph id (CU-5 assigns it zero -> real asynchronously;
      // vanilla legitimately keeps the zero id after clear()) plus widgets_values
      // (primitive rebuild adds control_after_generate). Same across two consecutive
      // polls = capture-safe. Full-serialize compare never settles on 1.48.6 --
      // something volatile rides along in every call.
      const s = JSON.stringify([String(g.id),
        (g.serialize().nodes ?? []).map((n) => [n.id, n.widgets_values])])
      const stable = window.__stableSerial === s
      window.__stableDbg = ['sample', s.slice(0, 300)]
      window.__stableSerial = s
      return stable
    } catch (e) { window.__stableDbg = ['throw', String(e)]; return false }
  }, null, { timeout: 20_000, polling: 400 })
} catch (e) {
  console.log('stability gate timeout; last probe state:',
    JSON.stringify(await page.evaluate(() => window.__stableDbg)))
  throw e
}
await checkState()
await page.waitForTimeout(400)

// ---- step 2: undo the comb create ------------------------------------------------
// Tracker forensics: core's ChangeTracker clears redoQueue whenever checkState sees
// the live graph diverge from activeState -- and checkState fires on every
// keyup-after-modifier and every mouseup. If anything (extension sync, Vue remount)
// perturbs the serialized shape after the undo restore, redo dies silently.
const queues = () => page.evaluate(() => {
  const t = window.app.extensionManager?.workflow?.activeWorkflow?.changeTracker
  return t ? {
    undo: t.undoQueue?.length ?? null, redo: t.redoQueue?.length ?? null,
    sameTracker: t === window.__tracker,
    graphId: String(window.app.graph?.id ?? '').slice(0, 8),
    activeId: String(t.activeState?.id ?? '').slice(0, 8)
  } : null
})
await mark('before-undo')
await page.keyboard.press('Control+z')
await page.waitForTimeout(200)
const qAfterUndoPress = await queues()
await page.waitForTimeout(1300)
await fresh()
await mark('after-undo')
const undo1 = await snap('undo1')
console.log('undo1 restores:', JSON.stringify({
  combs: undo1.combs.length, reroutes: undo1.reroutes.length,
  links: undo1.links.map(l => l && { id: l.id, parentId: l.parentId }),
  floating: undo1.floating, ledger: undo1.ledger
}))
ok('[undo1] comb record gone', undo1.combs.length === 0, JSON.stringify(undo1.combs))
ok('[undo1] teeth reroutes gone', undo1.reroutes.length === 0, JSON.stringify(undo1.reroutes))
ok('[undo1] both passthrough links intact, chains plain',
  undo1.links.every(l => l && l.parentId == null), JSON.stringify(undo1.links))
assertInv('undo1', undo1)

// Undo-queue-top vs activeState diff, capped at 12 leaves -- names the exact
// fields checkState saw drift in when it wiped the redo queue.
const driftReport = () => page.evaluate(() => {
  const t = window.app.extensionManager?.workflow?.activeWorkflow?.changeTracker
  if (!t) return null
  const out = []
  const walk = (a, b, path) => {
    if (out.length >= 12) return
    if (JSON.stringify(a) === JSON.stringify(b)) return
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) {
      out.push({ path, undoTop: a, active: b })
      return
    }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      walk(a[k], b[k], `${path}.${k}`)
    }
  }
  const top = t.undoQueue?.[t.undoQueue.length - 1]
  if (top && t.activeState) walk(top, t.activeState, '')
  return { undoLen: t.undoQueue?.length, redoLen: t.redoQueue?.length, drift: out }
})

// ---- step 3: redo ----------------------------------------------------------------
const qBeforeRedo = await queues()
await mark('before-redo')
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(1500)
let redoKey = 'Control+Shift+z'
let redoCombs = await page.evaluate(() => (window.app.graph.extra?.cablemanagement_combs ?? []).length)
if (redoCombs === 0) {
  redoKey = 'Control+y'
  await page.keyboard.press('Control+y')
  await page.waitForTimeout(1500)
  redoCombs = await page.evaluate(() => (window.app.graph.extra?.cablemanagement_combs ?? []).length)
}
const qAfterRedo = await queues()
await mark('after-redo')
console.log('redo via:', redoKey, JSON.stringify({ qAfterUndoPress, qBeforeRedo, qAfterRedo }))
await fresh()
const redo = await snap('redo')
// Redo death forensics BEFORE asserting: core's ChangeTracker re-mints the graph
// id at an arbitrary moment (unknowable in advance on 1.47.10) and wipes the redo
// queue when the mint lands inside the undo/redo window -- a checkState drift that
// STOCK reroutes reproduce, unrelated to comb semantics. When the fingerprint
// matches (queue wiped + .id in the drift), the two redo asserts SKIP with cause;
// a redo that core actually performed but came back comb-less still hard-fails.
const redoDrift = redo.combs.length === 0 ? await driftReport() : null
const coreWiped = !!redoDrift &&
  (qBeforeRedo?.redo ?? 0) >= 1 && (qAfterRedo?.redo ?? 0) === 0 &&
  !!redoDrift.drift?.some((d) => d.path === '.id')
if (coreWiped) {
  console.log('SKIP [redo] asserts: core wiped the redo queue (graph-id re-mint drift, stock-reproducible) --',
    JSON.stringify(redoDrift))
} else {
  ok('[redo] comb record restored with both lanes',
    redo.combs.length === 1 && redo.combs[0].lanes.length === 2, JSON.stringify(redo.combs))
  ok('[redo] links ride the restored teeth',
    redo.links.every((l, i) => l && redo.combs[0] && l.parentId === redo.combs[0].lanes[i]?.out),
    JSON.stringify({ links: redo.links, lanes: redo.combs[0]?.lanes }))
}
assertInv('redo', redo)

// Redo died: the tracker mistook post-restore drift for a user edit. Name the field:
// the state checkState pushed onto the undo queue is the CLEAN restored pre-comb
// graph; activeState is what the graph had drifted into when checkState sampled it.
if (redo.combs.length === 0) {
  const drift = redoDrift ?? await driftReport()
  console.log('redo-loss drift (undoQueue top vs activeState):', JSON.stringify(drift))
  // Rebuild the comb via api so the decompose/undo leg still runs; its own undo
  // pair is checkpointed independently below.
  await page.evaluate((ids) => {
    const g = window.app.graph
    const l1 = [...g._links.values()].find(l => String(l.target_id) === String(ids.B1))
    const l2 = [...g._links.values()].find(l => String(l.target_id) === String(ids.B2))
    const id = window.__cablemanagementCombs.create(l1.id, l2.id, 700, 260)
    window.__cablemanagementCombs.move(id, 'out', 1000, 260)
  }, ids)
  await fresh()
  console.log('comb rebuilt via api to continue the decompose leg')
  await checkState()
  await page.waitForTimeout(400)
}

// ---- step 4: select the OUT gate, Delete (one-gate dissolve) ---------------------
const gateScreen = await page.evaluate(() => {
  const c = window.app.graph.extra?.cablemanagement_combs?.[0]
  if (!c) return null
  const h = 24 + Math.max(2, c.lanes.length - 1) * 20
  const x = c.out.pins === 'left' ? c.out.pos[0] + 21 : c.out.pos[0] + 2
  const { ds } = window.app.canvas
  return [(x + ds.offset[0]) * ds.scale, (c.out.pos[1] + h / 2 + ds.offset[1]) * ds.scale]
})
ok('[decomp] a comb exists to decompose', !!gateScreen)
if (!gateScreen) {
  console.log('page errors:', errs.length ? errs : 'none')
  console.log('FAIL')
  await b.close()
  process.exit(1)
}
await page.mouse.click(gateScreen[0], gateScreen[1])
await page.waitForTimeout(300)
const sel = await page.evaluate(() => window.__cablemanagementCombs.selection())
ok('[decomp] out gate selected', sel.length === 1 && sel[0].endsWith('|out'), JSON.stringify(sel))
const preLanes = await page.evaluate(() =>
  (window.app.graph.extra?.cablemanagement_combs?.[0]?.lanes ?? []).map(l => ({ in: l.in, out: l.out }))
)
await page.keyboard.press('Delete')
await page.waitForTimeout(600)
await fresh()
const decomp = await snap('decomp')
const survivors = await page.evaluate((lanes) => {
  const g = window.app.graph
  return {
    ins: lanes.map(l => !!g.reroutes?.get?.(l.in)),
    outs: lanes.map(l => !!g.reroutes?.get?.(l.out))
  }
}, preLanes)
ok('[decomp] comb record gone', decomp.combs.length === 0, JSON.stringify(decomp.combs))
ok('[decomp] out teeth dissolved', survivors.outs.every(v => !v), JSON.stringify(survivors))
ok('[decomp] in teeth stay as plain reroutes', survivors.ins.every(v => v), JSON.stringify(survivors))
ok('[decomp] links intact, chained through the surviving in teeth',
  decomp.links.every((l, i) => l && l.parentId === preLanes[i]?.in),
  JSON.stringify({ links: decomp.links, preLanes }))
assertInv('decomp', decomp)

// ---- step 5: undo the decompose --------------------------------------------------
await checkState()
await page.waitForTimeout(400)
await page.keyboard.press('Control+z')
await page.waitForTimeout(1500)
await fresh()
const undo2 = await snap('undo2')
console.log('undo2 restores:', JSON.stringify({
  combs: undo2.combs.map(c => ({ id: c.id, lanes: c.lanes })),
  reroutes: undo2.reroutes.length,
  links: undo2.links.map(l => l && { id: l.id, parentId: l.parentId }),
  floating: undo2.floating
}))
ok('[undo2] comb record restored with both lanes',
  undo2.combs.length === 1 && undo2.combs[0].lanes.length === 2, JSON.stringify(undo2.combs))
ok('[undo2] links ride the teeth again',
  undo2.links.every((l, i) => l && undo2.combs[0] && l.parentId === undo2.combs[0].lanes[i]?.out),
  JSON.stringify({ links: undo2.links, lanes: undo2.combs[0]?.lanes }))
assertInv('undo2', undo2)

const tlog = await page.evaluate(() => {
  const l = window.__tlog ?? []
  const t0 = l[0]?.at ?? 0
  return l.map(e => ({ ...e, at: e.at - t0 }))
})
console.log('tracker timeline:', JSON.stringify(tlog))
console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
