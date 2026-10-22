// ─── nnstudio shell · 10 · values and shapes ─────────────────────────────────────
// undo/redo, numeric/dtype parsing, kind labels, shape inference, and the box vocabulary (BX_ACTS/BX_OPS/BX_KINDS).
// Order is load-bearing: this slice is concatenated after the one before it.

function bxUndoDepth() { return { undo: bxUndoStack.length, redo: bxRedoStack.length }; }
function bxCurrentPath() {                     // the boxes we are inside, outermost first
  return (BX.stack || []).map(s2 => s2.up).concat([BX.up]).filter(id => !!id);
}
function bxSnapshotNow() {
  const root = (BX.stack && BX.stack.length) ? BX.stack[0] : { nodes: BX.nodes, edges: BX.edges };
  const path = bxCurrentPath();
  return { doc: JSON.parse(JSON.stringify({ nodes: root.nodes || [], edges: root.edges || [] })),
           model: BX.model ? JSON.parse(JSON.stringify(BX.model)) : null,
           sel: bxSel ? JSON.parse(JSON.stringify(bxSel)) : null,
           path: path };
}
let bxDataState = {};                          // what the last run left on the data boxes
let bxRunValues = {};                          // every value of the last run, by full path
                                               // (so any nesting level can show its own)
let bxFlowSet = new Set();                     // full paths the run has marked done
let bxFlowNow = null;                          // the newest mark — where data is now
let bxFlowRendered = 0;                        // batched draws: one per 40 ms
let bxFlowPending = null;                      // the throttled draw, when one is due
let bxFlowStep = null;                         // the forward pass the marks belong to
let bxTrainTint = null;                        // the training signal's marks, at this level
let bxRunErr = null;                           // the block a failed run pointed at
let bxAudit = null;                            // connection problems on the design
function bxCommit(keep) {
  if (bxUndoLock) return;                      // a composite action is still running
  bxHubFieldsSync();                           // the Training box's dots become its
                                               // fields before anything is saved
  if (!keep) {                                 // `keep`: a re-placement only looks
    bxDataState = {};                          // different — the last run's data, its
    bxRunValues = {};                          // marks and its verdict still hold
    bxFlowClear();
    bxRunErr = null;
    bxAudit = null;
  }
  const snap = bxSnapshotNow();
  const text = JSON.stringify(snap);
  if (text === bxUndoLast) return;             // nothing moved: no new step
  bxUndoStack.push(snap);
  if (bxUndoStack.length > 60) bxUndoStack.shift();
  bxUndoLast = text;
  bxRedoStack = [];
  bxTabDirty();                                // the canvas wears its star
}
function bxRestore(snap, path) {
  const targetPath = path || snap.path || [];
  // undoing must not move the canvas: keep the camera whenever it lands on the
  // level we are already looking at
  const keepView = bxCurrentPath().join(">") === targetPath.join(">");
  const view = { cx: BX.view.cx, cy: BX.view.cy, k: BX.view.k };
  const doc = JSON.parse(JSON.stringify(snap.doc));
  BX.stack = [];
  BX.up = null;
  BX.nodes = doc.nodes || [];
  BX.edges = doc.edges || [];
  BX.model = snap.model ? JSON.parse(JSON.stringify(snap.model)) : null;
  BX.view = { cx: null, cy: null, k: 1 };
  bxSel = null;
  for (const id of targetPath) {               // back to where the change was made
    const n = bxNode(id);
    if (!n || n.kind !== "custom") break;
    bxEnter(id);
  }
  if (keepView) BX.view = view;                // …with the canvas exactly where it was
  if (snap.sel) {                              // and with what was selected then
    if (snap.sel.kind === "boxes") bxSelectBoxes(snap.sel.ids);
    else bxSelect(snap.sel);
  }
  bxSettleSizes();
  bxRender();
  bxRenderPalette();
}
function bxUndoStep() {
  if (bxUndoStack.length < 2) return false;
  const cur = bxUndoStack.pop();               // the state being left behind
  bxRedoStack.push(cur);
  const snap = bxUndoStack[bxUndoStack.length - 1];
  bxUndoLast = JSON.stringify(snap);
  bxRestore(snap, cur.path);                   // stand where that action happened
  return true;
}
function bxRedoStep() {
  if (!bxRedoStack.length) return false;
  const snap = bxRedoStack.pop();
  bxUndoStack.push(snap);
  bxUndoLast = JSON.stringify(snap);
  bxRestore(snap, snap.path);                  // redo lands where its action was
  return true;
}
function bxDim(d) { return d == null ? "?" : String(d); }
function bxInt(x, keep) {                      // a plain integer: negatives stay
  if (x === undefined) return keep === undefined ? null : keep;
  if (x === null || String(x).trim() === "") return null;
  const v = Number(x);
  return isFinite(v) ? Math.round(v) : (keep === undefined ? null : keep);
}
function bxSize(x, keep) {
  if (x === undefined) return keep === undefined ? null : keep;  // not given: leave it
  if (x === null || x === "") return null;                       // cleared: unconfigured
  const v = Number(x);
  return isFinite(v) ? Math.max(1, Math.round(v))                // a real size
                     : (keep === undefined ? null : keep);       // junk keeps what was there
}
function bxNum(x, keep) {                       // a positive number, unrounded (an eps, a rope base)
  if (x === undefined) return keep === undefined ? null : keep;
  if (x === null || x === "") return null;
  const v = Number(x);
  return isFinite(v) && v > 0 ? v : (keep === undefined ? null : keep);
}
function bxEpsText(v) { const x = Number(v); return x >= 0.001 ? String(x) : x.toExponential(0); }
// ---------------------------------------------------------------- dtype & size
// The picker's dtypes, in two families: **torch**'s own storage types and the
// **gguf** quant formats (k-quants carry their block overhead). Bytes per
// weight drive the VRAM estimate; the engine casts any of them where it runs.
const BX_DTYPE_GROUPS = [
  ["torch", [["f64", 8], ["f32", 4], ["bf16", 2], ["f16", 2],
             ["f8_e4m3", 1], ["f8_e5m2", 1],
             ["i64", 8], ["i32", 4], ["i16", 2], ["i8", 1],
             ["u8", 1], ["bool", 1]]],
  ["gguf", [["q8_0", 1.0625], ["q8_k", 1.0625], ["q6_k", 0.828125],
            ["q5_k", 0.703125], ["q5_1", 0.75], ["q5_0", 0.6875],
            ["q4_k", 0.5625], ["q4_1", 0.625], ["q4_0", 0.5625],
            ["iq4_xs", 0.515625], ["iq4_nl", 0.5625], ["q3_k", 0.4375],
            ["iq3_s", 0.4375], ["iq3_xxs", 0.375], ["q2_k", 0.34375],
            ["iq2_s", 0.28125], ["iq2_xs", 0.25], ["iq1_s", 0.1875]]],
];
const BX_DTYPES = {};
for (const [, dts] of BX_DTYPE_GROUPS) for (const [d, b] of dts) BX_DTYPES[d] = b;
function bxDtypeFill(sel, current, fallback) {   // a select, grouped by family
  for (const [group, dts] of BX_DTYPE_GROUPS) {
    const og = mk("optgroup", { label: group });
    for (const [d] of dts) og.appendChild(mk("option", { value: d, text: d }));
    sel.appendChild(og);
  }
  sel.value = BX_DTYPES[current] != null ? current
             : (BX_DTYPES[fallback] != null ? fallback : "f16");
  return sel;
}
function bxBytes(dtype) { return BX_DTYPES[dtype] != null ? BX_DTYPES[dtype] : 2; }
function bxDtypeName(x, fallback) {
  if (x === undefined) return fallback === undefined ? null : fallback;
  const t = String(x == null ? "" : x).trim();
  return BX_DTYPES[t] != null ? t : (fallback === undefined ? null : fallback);
}
function bxGB(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1073741824) {
    const g = b / 1073741824;
    return (g >= 100 ? g.toFixed(0) : g >= 10 ? g.toFixed(1) : g.toFixed(2)) + " GiB";
  }
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " MiB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KiB";
  return Math.round(b) + " B";
}
function bxBig(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + " k";
  return String(n);
}
function bxSciText(v) { const x = Number(v); return (x >= 1000 || x < 0.01) ? x.toExponential(0) : String(x); }
function bxKindLabel(kind) {
  return kind === "embed" ? "Embedding"
       : kind === "layer" ? "Fully Connected"
       : kind === "act" ? "Activation"
       : kind === "op" ? "Operation"
       : kind === "norm" ? "Norm"
       : kind === "script" ? "Script"
       : kind === "tokenize" ? "Tokenizer"
       : kind === "detokenize" ? "De-tokenizer"
       : kind === "sample" ? "Sample"
       : kind === "hf" ? "HF model"
       : kind === "agent" ? "Agent"
       : kind === "train" ? "Server config"
       : kind === "conv" ? "Convolution"
       : kind === "select" ? "Select columns"
       : kind === "config" ? "Train config"
       : kind === "training" ? "Training"
       : kind === "model" ? "Model"
       : kind === "heatmap" ? "Heatmap"
       : kind === "custom" ? "Nested"
       : kind === "vision" ? "Vision tower"
       : kind;
}
// the activation functions a box can be set to
const BX_ACTS = ["none", "relu", "leaky relu", "gelu", "gelu_pytorch_tanh", "silu", "tanh", "sigmoid", "softmax"];
// the static operations an operation box can do. They hold no weights: they
// only rearrange or combine what the wires bring.
//   transpose / reshape — one wire in, one out, the size passes straight through;
//   add/subtract/multiply/divide — element-wise: two in-dots of one size, out
//     is that same size;
//   dot product — two in-dots of one size, out is a single number (size 1).
const BX_OPS = ["transpose", "dot product", "matmul", "concat", "add", "subtract", "multiply",
                "divide", "rope", "scale", "topk", "conv1d", "scan", "reshape",
                "permute", "repeat", "mask", "slice", "zeros", "upsample",
                "timestep", "mean"];
// op attrs a spec may add that the UI itself does not model — they must
// survive the canvas round trip, or a run reaches the engine stripped:
// `keep` (reshape preserves leading dims) and the gated delta rule's heads /
// raw-A_log flag
const BX_OP_EXTRAS = ["keep", "k_heads", "k_dim", "heads", "head_dim", "partial", "a_log",
                      "v_tiled", "flip"];
// shape-changers: a contraction or a selection has a shape of its own, so their
// dots stay unknown (they never make a wire wrong)
const BX_OPAQUE = ["matmul", "topk", "scan", "permute", "repeat", "mask", "slice", "zeros",
                   "upsample", "timestep", "mean"];
// kinds whose boxes hold no size of their own: the wire's size passes through
const BX_UNSIZED = ["act", "op", "norm", "attn", "ssm", "moe", "script", "hf",
                    "dataset", "loss", "reward", "train", "select", "config",
                    "conv"];
// a reshape can be told the shape it makes, like "128x40" (x, ×, *, comma or
// spaces between the numbers). The element count is the product of the dims,
// and both sides of the box must carry it — a reshape never changes how much
// data there is, only how it is arranged.
function bxDims(v) {
  if (v == null) return null;
  const parts = String(v).match(/-?\d+/g) || [];   // a dim may be -1: let it infer
  if (!parts.length) return null;
  const dims = parts.map(Number)
    .filter(t => isFinite(t) && (t === -1 || t >= 1))
    .map(t => Math.round(t));
  return dims.length === parts.length ? dims : null;
}
function bxDimsShow(dims) { return String(dims || "").split("x").join("\u00d7"); }
function bxReshapeSize(n) {              // the fixed count a shaped reshape demands
  if (!n || n.kind !== "op" || bxOpName(n) !== "reshape" || !n.dims) return null;
  const d = bxDims(n.dims);
  if (!d) return null;
  let product = 1;
  for (const t of d) {
    if (t === -1) return null;           // one dim is inferred: the count is not fixed
    product *= t;
  }
  return product;
}
function bxOpName(n) { return BX_OPS.indexOf(n.op) >= 0 ? n.op : BX_OPS[0]; }
function bxOpArity(op) {
  return (op === "dot product" || op === "matmul" || op === "concat" || op === "add" ||
          op === "subtract" || op === "multiply" || op === "divide") ? 2 : 1;
}
function bxClip(s, max) {
  s = String(s == null ? "" : s);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
function bxClipFit(s, w, px) {              // clip to the card's own width: the
  s = String(s == null ? "" : s);           // mono face makes the count exact
  const max = Math.max(3, Math.floor((w - 20) / (px || 6)));
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
function bxModelDtype(n) {                     // the weights' own dtype: the
  const seen = {};                             // commonest one among the leaf
  (function walk(nodes) {                      // boxes inside the model (floats
    for (const x of nodes || []) {             // through the nested boxes too)
      if (x.kind === "custom") { walk((x.inner || {}).nodes); continue; }
      if (bxWeightedBox(x) && x.dtype) seen[x.dtype] = (seen[x.dtype] || 0) + 1;
    }
  })((n.inner || {}).nodes);
  let best = null, top = 0;
  for (const k of Object.keys(seen))
    if (seen[k] > top) { top = seen[k]; best = k; }
  return best;
}
function bxShape(n) {
  if (n.kind === "agent") return bxAgentShape(n);   // its task, not a size
  if (n.kind === "act") return n.act || "none";          // its function, not a size
  if (n.kind === "script") {                             // the function it runs
    const m = /^[ \t]*def[ \t]+([A-Za-z_]\w*)[ \t]*\(([^)]*)\)/m.exec(String(n.script || ""));
    return m ? m[1] + "(" + m[2].trim() + ")" : "python";
  }
  if (n.kind === "embed")                                // the table it indexes into
    return n.vocab == null && n.dout == null ? "embedding"
         : bxDim(n.vocab) + " \u00d7 " + bxDim(n.dout);
  if (n.kind === "norm") {
    return (n.norm === "layer" ? "layer" : n.norm === "group" ? "group" : "rms")
         + (n.norm === "group" && n.groups ? " g" + n.groups : "")
         + (n.eps != null ? " \u00b7 " + bxEpsText(n.eps) : "");
  }
  if (n.kind === "op") {                                 // its operation, not a size
    const op = bxOpName(n);
    if (op === "reshape" && n.dims)
      return bxDim(bxReshapeSize(n)) + " \u2192 " + bxDimsShow(n.dims);
    if (op === "scale" && n.factor != null)
      return "\u00d7 " + Number(n.factor).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    if (op === "repeat" && n.repeats != null)
      return "\u00d7 " + n.repeats + (n.dim ? " dim " + n.dim : "");
    if (op === "permute" && n.axes)
      return "[" + (Array.isArray(n.axes) ? n.axes.join(" ") : n.axes) + "]";
    if (op === "mean")
      return "dim " + (n.dim == null ? -2 : n.dim);
    if (op === "upsample")
      return "× " + (n.factor || 2) + (n.mode ? " " + n.mode : "");
    if (op === "timestep")
      return "d " + (n.width || 64);
    if (op === "mask")
      return (n.mode || "causal") + (n.window ? " w" + n.window : "");
    if (op === "slice") {
      const ax = n.axis == null ? 0 : Number(n.axis);
      if (n.index != null) return "axis " + ax + " \u00b7 index " + n.index;
      return "axis " + ax + " \u00b7 " + (n.start == null ? 0 : Number(n.start))
             + ":" + (n.stop == null ? "\u2026" : Number(n.stop));
    }
    return op;
  }
  if (n.kind === "conv") {                              // its map, its kernel
    const kk = Math.max(1, Number(n.k) || 3);
    const st = Math.max(1, Number(n.stride) || 1);
    return bxDim(n.din) + " → " + bxDim(n.dout)
         + " · k" + kk + (st !== 1 ? "s" + st : "")
         + (Number(n.groups) > 1 ? " · g" + n.groups : "");
  }
  if (n.kind === "select") {                             // the columns it hands out
    const tell = bxMatrixTell(n);
    if (!tell) return "select columns";
    if (tell.bad) return tell.bad;
    return (tell.ds && tell.ds.name ? bxClip(tell.ds.name, 14) + " \u00b7 " : "")
           + tell.cols.length + (tell.cols.length === 1 ? " col" : " cols");
  }
  if (n.kind === "config") {                             // the run it sets up
    const p = n.paradigm || "supervised";
    return p + (n.y_class ? " \u00b7 class" : "")
         + (n.lr != null ? " \u00b7 lr " + n.lr : "")
         + (n.batch != null ? " \u00b7 batch " + n.batch : "");
  }
  if (n.kind === "training") {                // the run it sets up: the live
    const st = (BXRUN.trainState || {})[n.id] || {};    // state wins the line
    if (st.step != null)
      return "step " + st.step
           + (st.loss != null ? " \u00b7 loss " + Number(st.loss).toFixed(3) : "")
           + (st.tloss != null ? " \u00b7 test " + Number(st.tloss).toFixed(3)
                               : "");
    const m = n.model ? bxFindBox(n.model) : null;
    return m ? (m.name || m.id) + " \u00b7 " + (n.paradigm || "supervised")
             : "no model in the slot";
  }
  if (n.kind === "custom") {
    if (n.model) {                             // a model's line reads three things
      const inner = n.inner || {};             // and nothing else: the shape its
      const tell = (pt) => {                   // dots take in, the shape they
        if (!pt) return "?";                   // send out, and the weights' dtype
        if (pt.kind === "text" || pt.kind === "ids" || pt.kind === "settings")
          return pt.kind;
        return pt.shape || "?";                // [? × N] — the dot's true
      };                                       // per-sample form, never bare N
      const ins = bxBoundary(n, "in").map(b => tell(bxPortType(b, "out")));
      const outs = bxBoundary(n, "out").map(
        b => tell(bxOutputExpect(b, inner.edges) || bxPortType(b, "in")));
      return (ins.length ? ins.join("+") : "?") + " → "
           + (outs.length ? outs.join("+") : "?")
           + " · " + (n.dtype || bxModelDtype(n) || "f16");
    }
    const i = bxPortDefs(n, "in").length, o = bxPortDefs(n, "out").length;
    return i + " in · " + o + " out";
  }
  if (n.kind === "input") {
    if (bxIsDataset(n)) {                        // an input reading as a sheet
      if (n.file) return "rows · file";
      const t = bxTableRead(n);
      return t.rows.length + " × " + t.cols.length;
    }
    if (n.input_mode === "text") return "text";
    if (n.input_mode === "image") return "image";
    const m = bxMatrixShape(n.values);
    if (m) return m;                           // typed numbers: the read is exact
    // no values of its own — a boundary port, or an empty box: it reads as
    // the dot it is (the batch axis is always there, so [? × width])
    return n.dout == null ? "?" : "[? × " + n.dout + "]";
  }
  if (n.kind === "output") {                             // what arrived, or what the
    const st = bxNodeState(n);                             // wire will bring — an
    const tag = n.train ? " \u00b7 training" : "";          // unwired output shows
    if (st && st.text != null) return "text" + tag;        // neither, so it asks
    if (st && st.image) return "image" + tag;
    return (bxTypeText(bxOutputExpect(n)) || "?") + tag;
  }
  if (n.kind === "heatmap") {                            // one vector → one picture
    const st = bxNodeState(n);
    if (st && st.image)
      return "image " + (st.image.w || "?") + "\u00d7" + (st.image.h || "?");
    return n.din != null ? n.din + " \u2192 image" : "vector \u2192 image";
  }
  if (n.kind === "sample")
    return n.temperature != null ? "t " + n.temperature : "greedy";
  if (bxIsDataset(n)) {                         // its sheet, box or input alike
    if (n.file) return "rows \u00b7 file";
    const t = bxTableRead(n);
    return t.rows.length + " \u00d7 " + t.cols.length;
  }
  if (n.kind === "loss") return "logits + labels";
  if (n.kind === "reward") return n.reward || "python";
  if (n.kind === "train") return "the machine";
  if (n.kind === "tokenize")
    return n.repo ? "hf \u00b7 " + bxClip(String(n.repo).split("/").pop(), 16)
                  : "vocab " + (String(n.vocab || "").length || "?");
  if (n.kind === "detokenize")
    return n.repo ? "hf \u00b7 " + bxClip(String(n.repo).split("/").pop(), 16)
                  : "text \u00b7 vocab " + (String(n.vocab || "").length || "?");
  if (n.kind === "hf")                                   // the model it continues
    return n.repo ? "next \u00b7 " + bxClip(String(n.repo).split("/").pop(), 16)
                  : "no repo set";
  const sh = bxSharedCount(n);
  return "in " + bxDim(n.din) + " \u2192 out " + bxDim(n.dout)
       + (sh > 1 ? " \u00b7 shared \u00d7" + sh : "");
}

