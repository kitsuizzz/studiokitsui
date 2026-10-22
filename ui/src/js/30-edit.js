// ─── nnstudio shell · 30 · editing ─────────────────────────────────────────
// add/remove/select/marquee/move/delete, off/frozen flags, link checks, and wire settling.
// Order is load-bearing: this slice is concatenated after the one before it.

function bxAdd(kind, x, y, v) {
  v = v || {};
  if (kind === "train" && !bxTrainAllowed()) return null;   // one Run box, top level only
  const sizeless = kind === "act" || kind === "script" || kind === "custom" ||
                   kind === "hf" || BX_UNSIZED.indexOf(kind) >= 0;
  const n = { id: bxId(), kind, x: bxSnapTo(x), y: bxSnapTo(y),
              name: v.name || bxDefaultName(kind),
              din: kind === "input" || sizeless ? null : bxSize(v.din),
              dout: kind === "output" || sizeless ? null : bxSize(v.dout) };
  if (kind === "act") n.act = v.act || "silu";
  if (kind === "conv") {
    n.din = bxSize(v.din);                    // channels in, channels out
    n.dout = bxSize(v.dout);
    const kk = bxInt(v.k, 3);
    if (kk && kk > 0) n.k = kk;
    const st = bxInt(v.stride, null);
    if (st && st > 1) n.stride = st;
    const pd = bxInt(v.pad, null);
    if (pd != null && pd >= 0) n.pad = pd;
    const g = bxInt(v.groups, null);
    if (g && g > 1) n.groups = g;
  }
  if (kind === "script") n.script = typeof v.script === "string" ? v.script : "";
  if (kind === "select") {
    const cs = String(v.cols == null ? "" : v.cols).trim()
      .split(/[\s,]+/).filter(x => x).slice(0, 16)
      .map(x => bxClip(x.toUpperCase(), 8));
    if (cs.length) n.cols = cs.join(" ");
    if (typeof v.dataset === "string" && v.dataset) n.dataset = v.dataset;
  }
  if ((kind === "config" || kind === "training") && v.paradigm)
    n.paradigm = v.paradigm;
  if (kind === "op") {
    n.op = BX_OPS.indexOf(v.op) >= 0 ? v.op : BX_OPS[0];
    const d = bxDims(v.dims);
    if (d) n.dims = d.join("x");
    for (const k of ["axis", "index", "start", "stop"]) {   // the slice's own
      const x = bxInt(v[k], null);
      if (x != null) n[k] = x;
    }
  }
  if (kind === "norm") {
    n.norm = v.norm === "layer" ? "layer" : v.norm === "group" ? "group" : "rms";
    n.eps = bxNum(v.eps, null);
    const g = bxInt(v.groups, null);
    if (g && g > 1) n.groups = g;
  }
  if (kind === "embed") {
    n.vocab = bxSize(v.vocab);
    n.din = bxSize(v.din) || 1;              // the input is one id, not a vector
  }
  if (kind === "tokenize" || kind === "detokenize") {
    n.din = kind === "detokenize" ? bxSize(v.din) : null;   // one id out, text in
    n.dout = null;
    const vv = String(v.vocab == null ? "" : v.vocab);
    if (vv) n.vocab = bxClip(vv, 4096);
    const rp = String(v.repo == null ? "" : v.repo).trim();
    if (rp) n.repo = bxClip(rp, 200);
    const tk = bxSize(v.tokens, null);
    if (tk && tk > 0) n.tokens = tk;
    if (kind === "tokenize" && v.text != null && String(v.text))
      n.text = bxClip(String(v.text), 4096);
  }
  if (kind === "hf") {                         // a whole model, by repo
    const rp = String(v.repo == null ? "" : v.repo).trim();
    if (rp) n.repo = bxClip(rp, 200);
    if (v.text != null && String(v.text)) n.text = bxClip(String(v.text), 4096);
    if (v.temperature != null && String(v.temperature).trim() !== "") {
      const tp = Number(v.temperature);
      if (isFinite(tp) && tp >= 0) n.temperature = tp;
    }
  }
  if (kind === "sample") {                    // its sampling knobs
    if (v.temperature != null && String(v.temperature).trim() !== "") {
      const tp = Number(v.temperature);
      if (isFinite(tp) && tp >= 0) n.temperature = tp;
    }
    if (v.sample_seed != null && String(v.sample_seed).trim() !== "") {
      const sd = Number(v.sample_seed);
      if (isFinite(sd) && sd >= 0) n.sample_seed = Math.round(sd);
    }
  }
  if (kind === "input") {                     // the input's own definition, set at add time
    const mode = String(v.input_mode || "");
    if (mode === "text" || mode === "image" || mode === "dataset") n.input_mode = mode;
    else if (mode) n.input_mode = "matrix";  // matrix — and the old python/random
    if (v.text != null && String(v.text)) n.text = bxClip(String(v.text), 4096);
    if (v.values != null && String(v.values).trim()) n.values = bxClip(String(v.values), 4096);
  }
  const dtype = bxDtypeName(v.dtype, null);
  if (dtype) n.dtype = dtype;
  else if (kind === "layer") n.dtype = "f16";      // the usual weight format…
  else if (kind === "embed") n.dtype = "f16";      // …the table too…
  else if (kind === "norm") n.dtype = "f32";       // …while norms usually stay f32
  const bind = v.t == null ? "" : String(v.t).trim();
  if (bind) n.t = bxClip(bind, 200);
  if (kind === "custom") n.inner = { nodes: [], edges: [] };
  BX.nodes.push(n);
  bxSettleSizes();                      // a new box may expose or take on a size
  bxRender();
  bxCommit();
  return n;
}
function bxRemove(id) {
  BX.nodes = BX.nodes.filter(n => n.id !== id);
  BX.edges = BX.edges.filter(e => e.from !== id && e.to !== id);
  bxSyncDoc();
  bxSettleSizes();                      // ports may have shifted: sweep again
  if (bxSel && bxSel.kind === "boxes") {
    bxSel.ids = bxSel.ids.filter(x => x !== id);
    if (!bxSel.ids.length) bxSel = null;
  }
  bxRender();
  bxCommit();
}
// selecting touches only the two elements involved: a full re-render here
// would replace the DOM under the cursor and kill a double-click
function bxSelect(sel) {
  bxSel = sel || null;
  const root = bxHost() && bxHost().querySelector ? bxHost().querySelector("svg") : null;
  if (root && root.querySelectorAll) {
    for (const g of root.querySelectorAll(".dnode.sel")) g.classList.remove("sel");
    for (const q of root.querySelectorAll(".dedge.sel, .dedge-hit.sel")) q.classList.remove("sel");
    if (bxSel && bxSel.kind === "boxes") {
      for (const id of bxSel.ids) {
        const g = root.querySelector('.dnode[data-id="' + id + '"]');
        if (g && g.classList) g.classList.add("sel");
      }
    } else if (bxSel && bxSel.kind === "edge") {
      const vis = bxVisPaths.get(bxSel.from + ">" + bxSel.to + ">" +
                                 (bxSel.fromPort || 0) + ">" + (bxSel.toPort || 0));
      if (vis && vis.classList) vis.classList.add("sel");
    }
  }
  return bxSel;
}
function bxSelBox(id) {
  return !!(bxSel && bxSel.kind === "boxes" && bxSel.ids.indexOf(id) >= 0);
}
// several boxes at once: shift+click toggles one, shift+drag draws a marquee
function bxSelectedIds() { return bxSel && bxSel.kind === "boxes" ? bxSel.ids.slice() : []; }
function bxSelectBoxes(ids) {
  const list = [];
  for (const id of (ids || [])) if (bxNode(id) && list.indexOf(id) < 0) list.push(id);
  return bxSelect(list.length ? { kind: "boxes", ids: list } : null);
}
function bxToggleSelect(id) {
  const ids = bxSelectedIds();
  return bxSelectBoxes(ids.indexOf(id) >= 0 ? ids.filter(x => x !== id) : ids.concat([id]));
}
function bxMarqueeSelect(rect, additive) {
  if (!rect) return bxSelectBoxes([]);
  const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
  const hit = [];
  for (const n of BX.nodes) {
    const h = bxNodeH(n);
    if (n.x <= x1 && n.x + bxNodeW(n) >= x0 && n.y <= y1 && n.y + h >= y0) hit.push(n.id);
  }
  const ids = additive ? bxSelectedIds().concat(hit) : hit;
  return bxSelectBoxes(ids);
}
// a drag may carry a whole group: one delta, the grabbed box does the snapping
function bxTrainPair(n) {                      // the pair: the Training box and
  if (!n) return null;                         // its model travel as one unit
  if (n.kind === "training" && n.model) return bxFindBox(n.model);
  return null;                                 // (the model finds its box in
}                                              // bxTrainHostOf, just below)
function bxTrainHostOf(n) {                    // which Training box holds this model
  if (!n || n.kind !== "custom") return null;
  let host = null;
  bxEveryBox(x => { if (!host && x.kind === "training" && x.model === n.id) host = x; });
  return host;
}
function bxWithPairs(ids) {                    // every id, plus its partner's:
  const out = (ids || []).slice();             // the box carries its model, and a
  for (const id of out.slice()) {              // seated model travels with its box
    const n = bxNode(id);
    const pair = bxTrainPair(n) || bxTrainHostOf(n);
    if (pair && out.indexOf(pair.id) < 0) out.push(pair.id);
  }
  return out;
}
function bxStartMove(ids, primaryId, sx, sy) {
  const starts = {};
  for (const id of bxWithPairs(ids || [primaryId])) {
    const n = bxNode(id);
    if (n) starts[id] = { x: n.x, y: n.y };
  }
  const p = bxNode(primaryId);
  bxDrag = { kind: "move", id: primaryId, ids: Object.keys(starts), sx: sx, sy: sy,
             x0: p ? p.x : 0, y0: p ? p.y : 0, starts: starts, moved: false };
  bxGuides = [];
}
function bxSelEdge(e) {
  return !!(bxSel && bxSel.kind === "edge" && bxSel.from === e.from && bxSel.to === e.to &&
            (bxSel.fromPort || 0) === (e.fromPort || 0) && (bxSel.toPort || 0) === (e.toPort || 0));
}
function bxEdgeKey(e) {
  return e.from + ">" + e.to + ">" + (e.fromPort || 0) + ">" + (e.toPort || 0);
}
function bxKeyEdge(key) {
  const P = String(key).split(">");
  return BX.edges.find(e => e.from === P[0] && e.to === P[1] &&
                            (e.fromPort || 0) === Number(P[2] || 0) &&
                            (e.toPort || 0) === Number(P[3] || 0)) || null;
}
function bxDeleteSelection() {
  const s = bxSel;
  if (!s) return false;
  if (s.kind === "boxes") {                 // a whole group in one step
    const ids = s.ids.slice();
    bxSel = null;
    bxUndoLock++;
    for (const id of ids) bxRemove(id);
    bxUndoLock--;
    bxCommit();
    return true;
  }
  if (s.kind === "edge") {
    const e2 = { from: s.from, to: s.to, fromPort: s.fromPort, toPort: s.toPort };
    bxSel = null;
    return bxRemoveEdge(e2.from, e2.to, e2.fromPort, e2.toPort);
  }
  return false;
}
// the size a box sends / takes (input boxes have no in, output boxes no out)
function bxActSize(n, seen) {           // a pass-through: whatever it is wired to
  seen = seen || new Set();
  for (const e of BX.edges) {
    if (e.from !== n.id && e.to !== n.id) continue;
    const other = bxNode(e.from === n.id ? e.to : e.from);
    if (!other || seen.has(other.id)) continue;
    const dir = e.from === n.id ? "in" : "out";           // the neighbour's side
    const idx = e.from === n.id ? (e.toPort || 0) : (e.fromPort || 0);
    const sizes = bxPortSizes(other, dir, seen);
    if (sizes[idx] != null) return sizes[idx];
    const first = sizes.find(s2 => s2 != null);
    if (first != null) return first;
  }
  return null;
}
function bxOutSize(n, seen) { const q = bxPortSizes(n, "out", seen); return q.length ? q[0] : null; }
function bxInSize(n, seen) { const q = bxPortSizes(n, "in", seen); return q.length ? q[0] : null; }
// deactivate & freeze. An off box carries no data (nothing inside it is on
// either); a frozen box keeps its weights as they are during training. Both
// flags read through the stack above, so a nested box carries them inside.
function bxFlagUp(flag) {
  let id = BX.up, i = (BX.stack || []).length - 1;
  while (id != null && i >= 0) {
    const lvl = BX.stack[i];
    const box = (lvl.nodes || []).find(n => n.id === id);
    if (box && (box[flag] || (flag === "off" && bxInnerOutOff(box)))) return true;
    id = lvl.up;
    i--;
  }
  return false;
}
function bxLevelOff() { return bxFlagUp("off"); }
function bxLevelFrozen() { return bxFlagUp("frozen"); }
function bxBoundary(n, dir) {            // a nested box's own in- or out-dots
  if (!n || n.kind !== "custom" || !n.inner) return [];
  return (n.inner.nodes || []).filter(k => k.kind === (dir === "in" ? "input" : "output"))
                              .sort((x, y) => (x.y - y.y) || (x.x - y.x));
}
function bxPortOff(n, dir, i) {         // this one dot carries nothing
  if (!n) return false;
  if (bxOffHere(n)) return true;         // the whole box is off
  if (dir !== "out") return false;       // (an off input dot would starve it inwards)
  const port = bxBoundary(n, "out")[i || 0];
  return !!(port && port.off);
}
function bxInnerOutOff(n) {              // every output dot of a nested box is off
  const outs = bxBoundary(n, "out");
  return outs.length > 0 && outs.every(k => k.off);
}
function bxOffHere(n) { return !!(n && (n.off || bxInnerOutOff(n))); }
function bxBoxOff(n) { return !!(n && (bxOffHere(n) || bxLevelOff())); }
function bxBoxFrozen(n) { return !!(n && (n.frozen || bxLevelFrozen())); }
// What a wire between two ports means: equal is fine, an unknown end can take
// the known one, two known but different sizes are an error.
function bxLooseRowDot(n, i) {                 // a dot that takes a sheet or a
  if (!n) return false;                        // matrix: the training hosts' data
  if (n.kind === "config" || n.kind === "training") return (i || 0) === 0;
  if (n.kind === "input") return (i || 0) >= 1;      // …and the legacy hub dots
  return false;
}
function bxShapeWidth(pt) {                    // the size a shape stands for:
  if (!pt || !pt.shape) return null;           // [? × 3] → 3, and a
  const nums = String(pt.shape).split("×")   // [? × 2×3] → 6 —
                 .map(x => Number(String(x).replace(/[^\d]/g, "")))   // the dims
                 .filter(x => isFinite(x) && x > 0);                   // multiply
  if (!nums.length) return null;
  return nums.reduce((a, b2) => a * b2, 1);
}
function bxLinkFit(a, b, fp, tp) {             // do the emit side and the accept
  // side agree? The size first, then the kind of data. Text never rides a
  // numbers wire, a sheet never rides a tensor one, and where both sides know
  // a width, the widths must match — the refusal says which one it was.
  const op = bxPortDefs(a, "out")[fp || 0] || null;
  const ip = bxPortDefs(b, "in")[tp || 0] || null;
  if (!op || !ip) return null;                 // missing dots are bxCheckLink's
  if (op.size != null && ip.size != null && op.size !== ip.size)
    return "size mismatch: " + a.name + " out " + op.size + " ≠ " + b.name
                             + " in " + ip.size;
  const po = bxPortType(a, "out", fp || 0);
  const pi = bxPortType(b, "in", tp || 0);
  const ek = po ? po.kind : null, ak = pi ? pi.kind : null;
  const TENS = { matrix: 1, image: 1, ids: 1 };     // the tensor family travels
  if (ek && ak && ek !== ak && ek !== "any" && ak !== "any") {
    const loose = bxLooseRowDot(b, tp || 0);
    const fits = (TENS[ek] && TENS[ak])
              || (ek === "rows" && ak === "rows")
              || (ak === "rows" && ek === "matrix" && loose)
              || (ek === "rows" && ak === "matrix" && loose);
    if (!fits)
      return "type mismatch: " + a.name + " emits " + ek + " ≠ " + b.name
                               + " takes " + ak + " — different kinds of data";
  }
  if (!ek || !ak || ek === "any" || ak === "any") return null;
  if (TENS[ek] && TENS[ak] && ek !== "image" && ak !== "image") {
    const wo = bxShapeWidth(po), wi = bxShapeWidth(pi);   // widths, once known
    if (wo != null && wi != null && wo !== wi)
      return "shape mismatch: " + a.name + " out " + po.shape + " ≠ " + b.name
                                + " in " + pi.shape;
  }
  return null;
}
function bxCheckLink(from, to, fromPort, toPort) {
  const a = bxNode(from), b = bxNode(to);
  if (!a || !b) return { error: "pick two boxes" };
  if (a.id === b.id) return { error: "a box cannot feed itself" };
  const op = bxPortDefs(a, "out")[fromPort || 0] || null;
  const ip = bxPortDefs(b, "in")[toPort || 0] || null;
  if (!op) return { error: bxKindLabel(a.kind) + " has no output dot there" };
  if (!ip) return { error: bxKindLabel(b.kind) + " has no input dot there" };
  if (bxBoxOff(a) || bxBoxOff(b) || bxPortOff(a, "out", fromPort))
    return { ok: true };                               // an off box (or dot) takes anything
  const fit = bxLinkFit(a, b, fromPort, toPort);       // the size, the kind, the shape
  if (fit) return { error: fit };
  return { ok: true };
}
// The size check sweeps the whole network, not just the wire it started from.
// Every wire is visited over and over until nothing moves: a known port fills
// the unknown port facing it, and the box that just took a size carries it
// along its other wires — any number of hops, either direction, through
// activation boxes and into (and out of) nested boxes.
function bxAllDocs() {                    // every level we are editing, top first
  const base = (BX.stack && BX.stack.length) ? BX.stack[0] : null;
  const docs = [], seen = new Set();
  (function walk(nodes, edges) {
    if (!nodes || seen.has(nodes)) return;
    seen.add(nodes);
    docs.push({ nodes, edges: edges || [] });
    for (const n of nodes)
      if (n.kind === "custom" && n.inner && n.inner.nodes) walk(n.inner.nodes, n.inner.edges);
  })(base ? base.nodes : BX.nodes, base ? base.edges : BX.edges);
  return docs;
}
// one pass over a level's wires: fill whatever unknown end faces a known one
function bxSettleRound(nodes, edges, touched) {
  const ekey = (e) => [e.from, e.to, e.fromPort || 0, e.toPort || 0].join(">");
  const autoSrc = (p, key, side) => {
    const a = p.node._auto && p.node._auto[p.field];
    return !!(a && a.e === key && a.s === side);
  };
  const set = (p, size, key, side) => {          // remember where the size came from
    const k = p.node.id + "|" + p.field;
    if (touched.has(k)) return 0;                // this round already moved it
    if (p.size === size) return 0;
    p.node[p.field] = size;
    p.node._auto = p.node._auto || {};
    p.node._auto[p.field] = { e: key, s: side };
    touched.add(k);
    return 1;
  };
  let moved = 0;
  // 1) a size the sweep filled follows the connection that filled it
  for (const e of edges) {
    const a = nodes.find(n => n.id === e.from), b = nodes.find(n => n.id === e.to);
    if (!a || !b || bxOffHere(a) || bxOffHere(b) ||
        bxPortOff(a, "out", e.fromPort)) continue;               // nothing flows through an off box
    const op = bxPortDefs(a, "out")[e.fromPort || 0] || null;
    const ip = bxPortDefs(b, "in")[e.toPort || 0] || null;
    if (!op || !ip) continue;
    const key = ekey(e);
    if (!op.act && ip.size != null && autoSrc(op, key, "to")) moved += set(op, ip.size, key, "to");
    if (!ip.act && op.size != null && autoSrc(ip, key, "from")) moved += set(ip, op.size, key, "from");
  }
  // 2) an unknown end takes the known facing size
  for (const e of edges) {
    const a = nodes.find(n => n.id === e.from), b = nodes.find(n => n.id === e.to);
    if (!a || !b || bxOffHere(a) || bxOffHere(b) ||
        bxPortOff(a, "out", e.fromPort)) continue;
    const op = bxPortDefs(a, "out")[e.fromPort || 0] || null;
    const ip = bxPortDefs(b, "in")[e.toPort || 0] || null;
    if (!op || !ip) continue;
    const key = ekey(e);
    if (!op.act && op.size == null && ip.size != null) moved += set(op, ip.size, key, "to");
    else if (!ip.act && ip.size == null && op.size != null) moved += set(ip, op.size, key, "from");
  }
  return moved;
}
function bxSettleSizes() {
  const docs = bxAllDocs();
  const save = { nodes: BX.nodes, edges: BX.edges };
  let pinned = 0;
  try {
    for (let round = 0; round < 24; round++) {
      const touched = new Set();                   // each field moves once a round
      let step = 0;
      for (const d of docs) {
        BX.nodes = d.nodes; BX.edges = d.edges;    // act sizes read their own level
        step += bxSettleRound(d.nodes, d.edges, touched);
      }
      pinned += step;
      if (!step) break;
    }
  } finally {
    BX.nodes = save.nodes; BX.edges = save.edges;
  }
  return pinned;
}
function bxUnfix(n, field) {                 // a size the user typed stops following
  if (n._auto) {
    delete n._auto[field];
    if (!Object.keys(n._auto).length) delete n._auto;
  }
}
// a box whose dots changed (say, an operation set back to a one-wire one)
// cannot keep wires pointing at dots that are gone
function bxPruneWires() {
  BX.edges = BX.edges.filter(e => {
    const a = bxNode(e.from), b = bxNode(e.to);
    return a && b && bxPortDefs(a, "out")[e.fromPort || 0] && bxPortDefs(b, "in")[e.toPort || 0];
  });
}
// ---------------------------------------------------------------- error boxes
// Every box has to take part in the flow: each of its input dots wired, each of
// its output dots sending somewhere, and nothing touching a mismatched wire.
// A nested box that holds an error anywhere inside it is in error itself —
// and so is everything above it.
let bxErrBoxes = new Set();

