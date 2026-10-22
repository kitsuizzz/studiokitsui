// ─── nnstudio shell · 05 · canvas state ─────────────────────────────────────
// BX (the open document and view), selection/drag/run marks, undo/redo stacks, and the first box helpers. Top-level state here runs at load.
// Order is load-bearing: this slice is concatenated after the one before it.

const BXW = 160, BXH = 80;                 // every box is exactly this size —
                                           // 4 × 2 whole cells of the 40 grid
const BX_GRID = 40;                        // the breadboard's base step
let BX = { nodes: [], edges: [], view: { cx: null, cy: null, k: 1 }, stack: [], up: null,
           model: null, projects: [], active: null };   // …and the open canvases
let bxDrag = null, bxWire = null, bxBend = null, bxMenuAt = null, bxDropIn = null;
let bxGuides = [], bxMarqueeRect = null;
// what is selected: { kind: "boxes", ids } | { kind: "edge", from, to } | null.
// A click selects (a drag never does), Delete removes the selection.
let bxSel = null;
let bxCopied = null, bxPasteAt = null, bxMouse = null;   // copy & paste
let bxHotEdge = null, bxHotBadge = null, bxHotBox = null, bxVisPaths = new Map();

function bxId() { return "bx" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function bxNode(id) { return BX.nodes.find(n => n.id === id) || null; }
// The boxes/edges we are editing may be a custom box's own lists (after going
// inside). Mutations replace those arrays, so the box has to be pointed at the
// new ones — otherwise its saved network goes stale (invisible wires on re-entry).
function bxSyncDoc() {
  if (!BX.up || !BX.stack || !BX.stack.length) return;
  const top = BX.stack[BX.stack.length - 1];
  const box = (top.nodes || []).find(n => n.id === BX.up);
  if (box && box.inner) {
    box.inner.nodes = BX.nodes;
    box.inner.edges = BX.edges;
  }
}
// ---------------------------------------------------------------- undo / redo
// Every completed action (a box added, moved, configured or removed; a wire
// drawn, bent or cut; a canvas loaded; a box moved into a nested box) leaves a
// snapshot of the whole design behind it, so Ctrl+Z walks back through them —
// wherever you were when it happened — and Ctrl+Shift+Z (or Ctrl+Y) walks
// forward again. Panning, zooming and going in/out of boxes are not actions.
let bxUndoStack = [], bxRedoStack = [], bxUndoLock = 0, bxUndoLast = "";

