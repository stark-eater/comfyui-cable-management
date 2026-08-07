// Pure-node unit test for nudge.js collision gating (no browser). Locks the pairwise
// rule: segments spread only when within CLUSTER on the lane axis AND longitudinally
// overlapped -- and a span-disjoint segment must not BRIDGE two properly spaced runs
// into one cluster (the lora_stack-kink regression).
import { nudgePass } from '../web/pathing/nudge.js'

const mk = (key, raw) => ({ key, raw, pts: null })
const untouched = (e) => JSON.stringify(e.pts) === JSON.stringify(e.raw)
let pass = true
const check = (name, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) pass = false
}

// 1. Bridge: two ribbon strands, verticals at x=296 and x=304 (a full lane apart,
// overlapping y-spans), plus a kink vertical at x=300 whose span is far below both.
// Nothing may move: the strands are not within CLUSTER of each other, and the kink
// overlaps neither.
{
  const A = mk('a', [[200, 100], [296, 100], [296, 200], [400, 200]])
  const B = mk('b', [[200, 108], [304, 108], [304, 208], [400, 208]])
  const K = mk('k', [[200, 260], [300, 260], [300, 268], [400, 268]])
  nudgePass([A, B, K])
  check('bridge does not merge spaced strands', untouched(A) && untouched(B) && untouched(K))
}

// 2. Real collision: two verticals on the same lane with overlapping spans spread a
// full LANE apart.
{
  const A = mk('a', [[200, 100], [300, 100], [300, 200], [400, 200]])
  const B = mk('b', [[200, 150], [300, 150], [300, 250], [400, 250]])
  nudgePass([A, B])
  const xa = A.pts[1][0], xb = B.pts[1][0]
  check('overlapping same-lane runs spread', Math.abs(xa - xb) >= 7.9 && xa !== xb)
}

// 3. Sequential touch (the relay in/out shape): two horizontals on one lane whose
// spans meet end-to-end. Continuation, not collision -- untouched.
{
  const A = mk('a', [[100, 340], [124, 340], [124, 300], [296, 300], [296, 340], [320, 340]])
  const B = mk('b', [[304, 260], [304, 300], [476, 300], [500, 300], [500, 340], [520, 340]])
  nudgePass([A, B])
  check('touching spans on one lane stay put', untouched(A) && untouched(B))
}

// 4. Obstacle bias (polish round): five same-lane verticals at x=300 with a node box
// ending at x=284 alongside. Blind centring would put the leftmost strand at 284 --
// on the node. The fan must shift right so every strand clears the box by CLEAR (6),
// keeping the 8px pitch and the order.
{
  const es = [0, 1, 2, 3, 4].map((i) =>
    mk('o' + i, [[100, 100 + i * 10], [300, 100 + i * 10], [300, 200 + i * 10], [400, 200 + i * 10]])
  )
  nudgePass(es, [[200, 80, 84, 200]]) // right edge x=284, y-range overlaps all spans
  const xs = es.map((e) => e.pts[1][0]).sort((a, b) => a - b)
  const pitched = xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1] - 8) < 0.1)
  check('fan shifts off the node box', xs[0] >= 290 - 0.1, `min=${xs[0]}`)
  check('pitch and count survive the bias', xs.length === 5 && pitched)
}

// 5. Narrow corridor: node boxes both sides leave [290, 310] free; a five-strand fan
// (32px wide) cannot fit, so it centres on the corridor -- overflow splits evenly
// instead of one node eating all of it. Lane at 296 -> centre moves to 300.
{
  const es = [0, 1, 2, 3, 4].map((i) =>
    mk('n' + i, [[100, 100 + i * 10], [296, 100 + i * 10], [296, 200 + i * 10], [400, 200 + i * 10]])
  )
  nudgePass(es, [[200, 80, 84, 200], [316, 80, 84, 200]])
  const xs = es.map((e) => e.pts[1][0]).sort((a, b) => a - b)
  check('narrow corridor centres the fan', Math.abs((xs[0] + xs[4]) / 2 - 300) < 0.1, `centre=${(xs[0] + xs[4]) / 2}`)
}

console.log(pass ? 'PASS' : 'FAIL')
process.exit(pass ? 0 : 1)
