// The enabled flag, alone.
//
// SCOPE, which the setting's own name and tooltip have always stated: this flag
// governs the NODE FEATURES only -- pass-through pins, the drawers, and the
// outputs-at-bottom layout, all of which need Nodes 2.0. It has never meant
// "turn the pack off". PCB routing answers to the LINK RENDER MODE and ribbons
// answer to nothing; wanting the routing without the ribbons is what the
// standalone pcb pack is for. Reading this flag anywhere in pathing/ or combs
// is the regression, not the fix -- the only two legitimate readers there are
// the passthrough-pin drop seams, which are node features on a ribbon surface.
//
// A leaf module with no imports, so modules that need the flag (bridge, convert,
// paste, pathing, stitch) depend on THIS instead of
// index.js. Importing index.js made a cycle -- and on frontends where the
// settings store is already hydrated at registerExtension time, onChange fired
// start() synchronously while drag.js was still mid-evaluation on the import
// stack (TDZ crashes on `currentPending`/`finish`, partial installs behind the
// CU-5 sweep-e flake). A leaf breaks the cycle: index.js's body -- and thus
// registerExtension -- cannot run before every module it imports has fully
// evaluated.

let enabled = true;

export function isEnabled() {
  return enabled;
}

export function setEnabled(value) {
  enabled = value;
}
