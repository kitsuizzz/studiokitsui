// ─── nnstudio shell · 40 · model edit ──────────────────────────────────────
// drop targets, connect, wire state, mismatch rules, and bxConfigure (the per-kind settings writer).
// Order is load-bearing: this slice is concatenated after the one before it.

// --------------------------------------------------------------- move into a box
// Dropping a box onto a nested box moves it inside — with every wire kept.
// Each input dot it had becomes a port on the nested box (a fresh input box is
// made inside when none is free), each output side becomes a port too, and the
// inside is wired between those ports and the box. One output port serves all
// of that side's wires; several wires into one dot share its port.
function bxHasInside(box, id) {
  if (!box || box.kind !== "custom" || !box.inner) return false;
  for (const n of box.inner.nodes || []) {
    if (n.id === id || bxHasInside(n, id)) return true;
  }
  return false;
}
function bxPortBoxes(box, dir) {
  return ((box.inner && box.inner.nodes) || [])
    .filter(n => (dir === "in" ? n.kind === "input" : n.kind === "output"))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
}
function bxPortBoxAt(target, dir, index) { return bxPortBoxes(target, dir)[index] || null; }
// a port that ended up with no wire at all goes away again — whoever used it
// has moved inside, so the box must not keep a dead dot
function bxPrunePort(target, dir, index) {
  const box = bxPortBoxAt(target, dir, index);
  if (!box || !target.inner) return;
  const inner = target.inner;
  if ((inner.edges || []).some(e => e.from === box.id || e.to === box.id)) return;
  const outer = BX.edges.some(e => dir === "in"
    ? (e.to === target.id && (e.toPort || 0) === index)
    : (e.from === target.id && (e.fromPort || 0) === index));
  if (outer) return;
  inner.nodes = (inner.nodes || []).filter(n => n.id !== box.id);
  inner.edges = (inner.edges || []).filter(e => e.from !== box.id && e.to !== box.id);
  for (const e of BX.edges) {                // the later dots shift down
    if (dir === "in" && e.to === target.id && (e.toPort || 0) > index) e.toPort = (e.toPort || 0) - 1;
    if (dir === "out" && e.from === target.id && (e.fromPort || 0) > index)
      e.fromPort = (e.fromPort || 0) - 1;
  }
}
function bxMoveInto(nodeId, targetId) {
  const node = bxNode(nodeId), target = bxNode(targetId);
  if (!node || !target || node.id === target.id || target.kind !== "custom") return false;
  if (node.kind === "train") return false;     // the Run box stays at the top level
  if (bxHasInside(node, target.id)) return false;          // never into itself or its own inside
  const inner = target.inner = target.inner || { nodes: [], edges: [] };
  inner.edges = inner.edges || [];
  const freed = [];
  let anchor = null;                         // where the move lands it, if the
                                             // absorbed wires name a neighbour
  // wires between the box and the target itself cross the target's own port:
  // absorb them — the inside is wired directly and the port becomes free for
  // the box's own wire, so a chain moved in one box at a time never grows
  // duplicate in/out
  const absorbed = BX.edges.filter(e => (e.from === node.id && e.to === target.id) ||
                                        (e.from === target.id && e.to === node.id));
  const incoming = BX.edges.filter(e => e.to === node.id && e.from !== target.id);
  const outgoing = BX.edges.filter(e => e.from === node.id && e.to !== target.id);
  for (const e of absorbed) {
    const outSide = e.from === target.id;    // the target's output dot fed the box
    const dir = outSide ? "out" : "in";
    const p = outSide ? (e.fromPort || 0) : (e.toPort || 0);
    const box = bxPortBoxAt(target, dir, p);
    // the port may also feed (or be fed by) something else: then its inside
    // wiring stays and the box is fed from the same place as well
    const others = BX.edges.some(x => x !== e && (outSide
      ? (x.from === target.id && (x.fromPort || 0) === p)
      : (x.to === target.id && (x.toPort || 0) === p)));
    const feeders = box ? inner.edges.filter(x => (outSide ? x.to === box.id : x.from === box.id)) : [];
    BX.edges = BX.edges.filter(x => x !== e);
    for (const y of feeders) {
      if (!others) inner.edges = inner.edges.filter(x => x !== y);   // now feeds the box directly
      inner.edges.push(outSide
        ? { from: y.from, fromPort: y.fromPort || 0, to: node.id, toPort: e.toPort || 0 }
        : { from: node.id, fromPort: e.fromPort || 0, to: y.to, toPort: y.toPort || 0 });
      const nb = inner.nodes.find(x2 => x2.id === (outSide ? y.from : y.to));
      if (nb && !anchor) anchor = { x: nb.x + (outSide ? BXW + 80 : -(BXW + 80)), y: nb.y };
    }
    freed.push([dir, p]);
  }
  // settle it inside, beside whatever is already there
  const xs = (inner.nodes || []).map(n => n.x + BXW);
  const ys = (inner.nodes || []).map(n => n.y);
  node.x = Math.round((xs.length ? Math.max.apply(null, xs) : 0) + 260);
  node.y = Math.round(ys.length ? Math.min.apply(null, ys) : 0);
  // a chain moved in backwards still reads left to right: sit before what it feeds
  if (anchor) { node.x = Math.round(anchor.x); node.y = Math.round(anchor.y); }
  const free = (dir) => {
    const boxes = bxPortBoxes(target, dir);
    const used = new Set();
    for (const e of BX.edges) {
      if (dir === "in" && e.to === target.id) used.add(e.toPort || 0);
      if (dir === "out" && e.from === target.id) used.add(e.fromPort || 0);
    }
    for (let i = 0; i < boxes.length; i++) if (!used.has(i)) return { port: i, box: boxes[i] };
    // no free dot left: grow one, always below the others so no index shifts
    const same = bxPortBoxes(target, dir);
    const y = Math.max.apply(null, [(inner.nodes || []).length ? Math.max.apply(null, (inner.nodes || []).map(n => n.y)) : 0]
                                    .concat(same.length ? same.map(n => n.y) : [0])) + 150;
    const word = dir === "in" ? "in" : "out";
    const box = { id: bxId(), kind: dir === "in" ? "input" : "output",
                  name: word + (same.length ? " " + (same.length + 1) : ""),
                  x: 0, y: Math.round(y) };
    if (dir === "in") box.dout = null; else box.din = null;
    inner.nodes = inner.nodes.concat([box]);
    return { port: same.length, box };
  };
  // take it out of this level
  BX.nodes = BX.nodes.filter(n => n.id !== node.id);
  BX.edges = BX.edges.filter(e => e.from !== node.id && e.to !== node.id);
  inner.nodes = (inner.nodes || []).concat([node]);
  inner.edges = inner.edges || [];
  const byIn = {}, byOut = {};
  for (const e of incoming) (byIn[e.toPort || 0] = byIn[e.toPort || 0] || []).push(e);
  for (const e of outgoing) (byOut[e.fromPort || 0] = byOut[e.fromPort || 0] || []).push(e);
  for (const key of Object.keys(byIn)) {
    const { port, box } = free("in");
    inner.edges.push({ from: box.id, fromPort: 0, to: node.id, toPort: Number(key) || 0 });
    for (const e of byIn[key])
      BX.edges.push({ from: e.from, fromPort: e.fromPort || 0, to: target.id, toPort: port });
  }
  for (const key of Object.keys(byOut)) {
    const { port, box } = free("out");
    inner.edges.push({ from: node.id, fromPort: Number(key) || 0, to: box.id, toPort: 0 });
    for (const e of byOut[key])
      BX.edges.push({ from: target.id, fromPort: port, to: e.to, toPort: e.toPort || 0 });
  }
  for (const [dir, p] of freed) bxPrunePort(target, dir, p);   // only if unused
  if (bxSel && bxSel.kind === "boxes") {
    bxSel.ids = bxSel.ids.filter(x => x !== node.id);
    if (!bxSel.ids.length) bxSel = null;
  }
  bxSyncDoc();
  bxSettleSizes();
  bxRender();
  bxCommit();
  return true;
}
// what nested box is under the cursor right now (for the move-into gesture)
function bxBoxUnder(ev, skipId) {              // the box under the pointer, past
  const stack = (document.elementsFromPoint && ev)   // the one being dragged: its
    ? document.elementsFromPoint(ev.clientX, ev.clientY)   // own card is what the
    : ((document.elementFromPoint && ev)               // cursor is over, so the
       ? [document.elementFromPoint(ev.clientX, ev.clientY)] : []);   // stack is read
  for (const t of (stack || [])) {
    const el = t && t.closest ? t.closest(".dnode") : null;
    const id = el && el.getAttribute ? el.getAttribute("data-id") : null;
    const hit = id ? bxNode(id) : null;
    if (hit && hit.id !== skipId) return hit;
  }
  return null;
}
function bxDropTargetAt(ev) {
  if (!bxDrag || bxDrag.kind !== "move") return null;
  const n = bxBoxUnder(ev, bxDrag.id);
  if (!n || (n.kind !== "custom" && n.kind !== "training")) return null;
  const dragging = bxNode(bxDrag.id);
  if (!dragging || dragging.kind === "train") return null;   // the Run box stays at the top
  if (bxHasInside(dragging, n.id)) return null;
  return n.id;
}
// one wire per input dot: a new wire replaces whatever was on that dot
function bxConnect(from, to, fromPort, toPort) {
  const chk = bxCheckLink(from, to, fromPort, toPort);
  if (chk.error) { bxToast(chk.error); return chk.error; }
  const fp = fromPort || 0, tp = toPort || 0;
  BX.edges = BX.edges.filter(e => !(e.to === to && (e.toPort || 0) === tp));
  BX.edges.push({ from, fromPort: fp, to, toPort: tp });
  bxSyncDoc();
  bxSettleSizes();                       // the new wire joins the network: sweep it
  bxRender();
  bxCommit();
  return null;
}
// a settled wire is one of three things: both sizes known and equal (match),
// both still unknown (?/?, drawn grey), or known but different (bad, drawn red)
function bxWireState(e) {
  const a = bxNode(e.from), b = bxNode(e.to);
  if (!a || !b) return "unknown";
  if (bxBoxOff(a) || bxBoxOff(b)) return "off";       // nothing flows over an off box
  if (bxPortOff(a, "out", e.fromPort)) return "off";  // that output dot is deactivated
  const op = bxPortDefs(a, "out")[e.fromPort || 0] || null;
  const ip = bxPortDefs(b, "in")[e.toPort || 0] || null;
  const o = op ? op.size : null, i = ip ? ip.size : null;
  if (o != null && i != null && o !== i) return "bad";
  if (bxLinkFit(a, b, e.fromPort || 0, e.toPort || 0)) return "bad";
  if (o == null && i == null) return "unknown";
  return "match";
}
// a wire the two ends do not agree on — size, kind of data, or shape
function bxEdgeMismatch(e) {
  const a = bxNode(e.from), b = bxNode(e.to);
  if (!a || !b) return null;
  return bxLinkFit(a, b, e.fromPort || 0, e.toPort || 0);
}
/**
 * Apply a settings patch to one box — the single writer for box fields.
 * `vals` is a partial field map (name, dtype, shape, op settings, ...);
 * returns true when the box exists and the patch was applied.
 */
function bxConfigure(id, vals) {
  const n = bxNode(id);
  if (!n || !vals) return false;
  if (vals.name !== undefined && n.kind !== "train")   // the Run box has no rename
    n.name = String(vals.name).trim() || n.name || bxKindLabel(n.kind);
  if (n.kind === "act" && vals.act !== undefined) {
    const want = String(vals.act);
    n.act = BX_ACTS.indexOf(want) >= 0 ? want : (n.act || "silu");
  }
  if (n.kind === "script" && vals.script !== undefined)
    n.script = String(vals.script == null ? "" : vals.script);
  if (n.kind === "op" && vals.op !== undefined) {
    const want = String(vals.op);
    n.op = BX_OPS.indexOf(want) >= 0 ? want : bxOpName(n);
    bxPruneWires();              // an operation set back to one wire loses the extra dot
    bxSyncDoc();                 // …and the box that owns this list is told
  }
  if (n.kind === "output" && vals.train !== undefined) {
    n.train = !!vals.train;
    bxPruneWires();              // training off: the dataset dot goes, with its wire
  }
  if (n.kind === "train" || n.kind === "config" || n.kind === "training" ||
      (n.kind === "output" && n.train)) {
    // the training: data, columns, signal, parameters. A train config box
    // carries them for the new wiring; the output's tab (and, before that, the
    // train node) carries them for the older designs.
    const isOut = n.kind === "output";
    const onCanvas = (id) => {
      if (!id) return false;
      let hit = false;
      bxEveryBox(x => { if (x.id === id) hit = true; });
      return hit;
    };
    const bind = (key) => {                   // a stale id is dropped, not kept
      if (vals[key] === undefined) return;
      const id = String(vals[key] == null ? "" : vals[key]).trim();
      n[key] = id && onCanvas(id) ? id : null;
    };
    bind("dataset"); bind("test_dataset"); bind("val_dataset");
    bind("reward"); bind("model");
    if (!isOut) bind("target");               // an output trains on itself
    const col = (key) => {
      if (vals[key] === undefined) return;
      const toks = String(vals[key] == null ? "" : vals[key]).trim()
        .split(/[\s,]+/).filter(x => x)
        .slice(0, 16).map(x => bxClip(x.toUpperCase(), 8));
      if (toks.length)                            // one column, or a sequence:
        n[key] = toks.join(" ");                  // x0 x1 x2 is a vector
    };
    col("x_col"); col("y_col");
    if (vals.y_class !== undefined) {
      n.y_class = !!vals.y_class;             // y is a class label: the column
      if (!n.y_class) n.classes = null;       // itself names the classes
    }
    if (vals.classes !== undefined
        && (n.kind === "config" || n.kind === "training")) {
      const cs = String(vals.classes == null ? "" : vals.classes)
        .split(/\s+/).filter(x => x).map(x => bxClip(x, 40));
      n.classes = cs.length ? cs : null;      // a legacy list: its index order
    }
    if (vals.paradigm !== undefined) {
      const p = String(vals.paradigm);
      n.paradigm = p === "rl" ? "rl" : p === "unsupervised" ? "unsupervised"
                                                           : "supervised";
      bxPruneWires();        // unsupervised drops the Y dot, and its wire
    }
    if (vals.optimizer !== undefined) {
      const o = String(vals.optimizer == null ? "" : vals.optimizer);
      if (o === "adamw" || o === "sgd") n.optimizer = o;
    }
    const num = (key, min) => {
      if (vals[key] === undefined) return;
      const raw = String(vals[key] == null ? "" : vals[key]).trim();
      if (raw === "") return;                      // a blank field keeps the old value
      const v = Number(raw);
      if (isFinite(v) && v >= min) n[key] = v;    // junk keeps the old value
    };
    num("lr", 0); num("weight_decay", 0);
    num("batch", 1); num("steps", 0); num("clip", 0);
    num("save_every", 0); num("eval_every", 0);
    num("temperature", 0); num("max_tokens", 0); num("n_samples", 1);
  }
  if (vals.t !== undefined) {
    const bind = String(vals.t == null ? "" : vals.t).trim();
    n.t = bind ? bxClip(bind, 200) : null;               // the tensor(s) this box reads
  }
  if (vals.file !== undefined) {
    const f = String(vals.file == null ? "" : vals.file).trim();
    n.file = f ? bxClip(f, 300) : null;                  // the weight file it reads from
  }
  if (n.kind === "input") {                  // how this input's value is made
    if (vals.input_mode !== undefined) {
      const m = String(vals.input_mode || "");
      n.input_mode = ["text", "image", "dataset"].indexOf(m) >= 0 ? m : "matrix";
    }
    if (vals.text !== undefined) {
      const t = String(vals.text == null ? "" : vals.text);
      n.text = t ? bxClip(t, 4096) : null;   // the string a text input carries
    }
    if (vals.values !== undefined) {         // the numbers the input carries
      const vv = String(vals.values == null ? "" : vals.values).trim();
      n.values = vv ? bxClip(vv, 4096) : null;
    }
    if (vals.image !== undefined) {          // the picture an image input carries
      const s = String(vals.image == null ? "" : vals.image).trim();
      n.image = s ? bxClip(s, 300) : null;
    }
    if (vals.image_size !== undefined) {
      const s = bxSize(vals.image_size, n.image_size);
      n.image_size = s && s >= 8 ? s : null;      // the side the pixels are sent at
    }
    if (vals.patch_size !== undefined) {
      const p2 = bxSize(vals.patch_size, n.patch_size);
      n.patch_size = p2 && p2 >= 1 ? p2 : null;
    }
    if (vals.image_mean !== undefined)
      n.image_mean = String(vals.image_mean == null ? "" : vals.image_mean).slice(0, 80) || null;
    if (vals.image_std !== undefined)
      n.image_std = String(vals.image_std == null ? "" : vals.image_std).slice(0, 80) || null;
  }
  if ((n.kind === "tokenize" || n.kind === "detokenize") && vals.repo !== undefined) {
    const s = String(vals.repo == null ? "" : vals.repo).trim();
    n.repo = s ? bxClip(s, 200) : null;      // a huggingface repo: the real tokenizer
    if (!s) n.tokens = null;
  }
  if ((n.kind === "tokenize" || n.kind === "detokenize") && vals.tokens !== undefined) {
    const t = bxSize(vals.tokens, null);
    n.tokens = t && t > 0 ? t : null;        // the token count the repo reported
  }
  if (n.kind === "sample" && vals.temperature !== undefined) {
    const raw = String(vals.temperature == null ? "" : vals.temperature).trim();
    const t = raw === "" ? null : Number(raw);
    n.temperature = (t != null && isFinite(t) && t >= 0) ? t : null;   // 0 = greedy
  }
  if (n.kind === "sample" && vals.sample_seed !== undefined) {
    const raw = String(vals.sample_seed == null ? "" : vals.sample_seed).trim();
    const s = raw === "" ? null : Number(raw);
    n.sample_seed = (s != null && isFinite(s) && s >= 0) ? Math.round(s) : null;
  }
  if ((n.kind === "tokenize" || n.kind === "detokenize") && vals.vocab !== undefined) {
    const v = String(vals.vocab == null ? "" : vals.vocab);
    n.vocab = v ? bxClip(v, 4096) : null;    // the character vocabulary, as a string
  }
  if (n.kind === "tokenize" && vals.text !== undefined) {
    const t = String(vals.text == null ? "" : vals.text);
    n.text = t ? bxClip(t, 4096) : null;     // the text it tokenizes when the run has none
  }
  if (n.kind === "hf") {                     // the repo, its prompt, its temperature
    if (vals.repo !== undefined) {
      const s = String(vals.repo == null ? "" : vals.repo).trim();
      n.repo = s ? bxClip(s, 200) : null;
    }
    if (vals.text !== undefined) {
      const t = String(vals.text == null ? "" : vals.text);
      n.text = t ? bxClip(t, 4096) : null;   // the prompt when the run wires none in
    }
    if (vals.temperature !== undefined) {
      const raw = String(vals.temperature == null ? "" : vals.temperature).trim();
      const tp = raw === "" ? null : Number(raw);
      n.temperature = (tp != null && isFinite(tp) && tp >= 0) ? tp : null;
    }
  }
  if (n.kind === "dataset") {                  // the rows it trains on
    if (vals.text !== undefined) {
      const t = String(vals.text == null ? "" : vals.text);
      n.text = t ? bxClip(t, 200000) : null;
    }
    if (vals.repo !== undefined) {
      const s = String(vals.repo == null ? "" : vals.repo).trim();
      n.repo = s ? bxClip(s, 200) : null;
    }
    if (vals.vocab !== undefined) {
      const v = String(vals.vocab == null ? "" : vals.vocab);
      n.vocab = v ? bxClip(v, 4096) : null;
    }
  }
  if (n.kind === "select") {                   // a dataset's columns, as a matrix
    if (vals.dataset !== undefined) {
      const id = String(vals.dataset == null ? "" : vals.dataset).trim();
      let hit = null;
      bxEveryBox(x => { if (x.id === id && bxIsDataset(x)) hit = x; });
      n.dataset = hit ? id : null;             // a stale id is dropped, not kept
    }
    if (vals.cols !== undefined) {
      const toks = String(vals.cols == null ? "" : vals.cols).trim()
        .split(/[\s,]+/).filter(x => x)
        .slice(0, 16).map(x => bxClip(x.toUpperCase(), 8));
      n.cols = toks.length ? toks.join(" ") : null;    // blank = every column
    }
  }
  if (n.kind === "reward") {                   // how it scores a piece of text
    if (vals.reward !== undefined) {
      const r = String(vals.reward == null ? "" : vals.reward);
      n.reward = ["python", "exact", "regex", "length"].indexOf(r) >= 0 ? r : null;
    }
    if (vals.expr !== undefined) {
      const t = String(vals.expr == null ? "" : vals.expr);
      n.expr = t ? bxClip(t, 20000) : null;
    }
    if (vals.pattern !== undefined) {
      const t = String(vals.pattern == null ? "" : vals.pattern);
      n.pattern = t ? bxClip(t, 200) : null;
    }
    if (vals.match !== undefined) {
      const t = String(vals.match == null ? "" : vals.match);
      n.match = t ? bxClip(t, 200) : null;
    }
  }
  if (n.kind === "norm") {
    if (vals.norm !== undefined)
      n.norm = vals.norm === "layer" ? "layer"
             : vals.norm === "group" ? "group" : "rms";
    if (vals.groups !== undefined) {
      const g = bxInt(vals.groups, null);
      n.groups = g && g > 1 ? g : null;
    }
    if (vals.eps !== undefined) n.eps = bxNum(vals.eps, n.eps);
  }
  if (n.kind === "embed" && vals.vocab !== undefined)
    n.vocab = bxSize(vals.vocab, n.vocab);
  if (vals.dtype !== undefined) {
    const d = bxDtypeName(vals.dtype, null);
    if (d) { n.dtype = d; n.wbytes = null; }       // retyped: estimate from params × this dtype
    else if (!String(vals.dtype == null ? "" : vals.dtype).trim()) n.dtype = null;
  }
  for (const k of ["axis", "index", "start", "stop"]) {  // the slice's own fields
    if (n.kind === "op" && vals[k] !== undefined) n[k] = bxInt(vals[k], n[k]);
  }
  for (const k of ["factor", "repeats", "dim", "window", "width"]) {
    if (n.kind === "op" && vals[k] !== undefined)      // the op's own numbers
      n[k] = bxInt(vals[k], null);
  }
  if (n.kind === "op" && vals.theta !== undefined)
    n.theta = bxNum(vals.theta, null);
  if (n.kind === "op" && vals.axes !== undefined) {    // a permute's order
    const raw = String(vals.axes == null ? "" : vals.axes).trim();
    n.axes = raw ? raw.replace(/,/g, " ") : null;
  }
  if (n.kind === "op" && vals.op_mode !== undefined)   // a mask's kind, an
    n.mode = String(vals.op_mode == null ? "" : vals.op_mode).trim() || null;
  if (n.kind === "op" && vals.dims !== undefined) {      // the shape a reshape makes
    const raw = String(vals.dims == null ? "" : vals.dims).trim();
    if (!raw) n.dims = null;                             // cleared: no shape
    else { const d = bxDims(raw); if (d) n.dims = d.join("x"); }   // junk keeps it
  }
  if (n.kind === "conv") {                   // its channels, and the kernel's
    if (vals.din !== undefined) bxUnfix(n, "din");
    if (vals.dout !== undefined) bxUnfix(n, "dout");
    n.din = bxSize(vals.din, n.din);
    n.dout = bxSize(vals.dout, n.dout);
    for (const k of ["k", "stride", "pad", "groups"]) {
      if (vals[k] === undefined) continue;
      const v = bxInt(vals[k], null);
      if (v != null && v > 0) n[k] = v;
      else delete n[k];                      // blank = the default
    }
  } else if (n.kind === "embed") {
    if (vals.din !== undefined) bxUnfix(n, "din");
    if (vals.dout !== undefined) bxUnfix(n, "dout");
    n.din = bxSize(vals.din, n.din) || 1;    // the id
    n.dout = bxSize(vals.dout, n.dout);      // the vector it returns
  } else if (n.kind === "layer") {
    if (vals.din !== undefined) bxUnfix(n, "din");
    if (vals.dout !== undefined) bxUnfix(n, "dout");
    n.din = bxSize(vals.din, n.din);
    n.dout = bxSize(vals.dout, n.dout);
  } else if (n.kind === "input") {
    if (vals.dout !== undefined) bxUnfix(n, "dout");
    n.dout = bxSize(vals.dout, n.dout);
  } else {
    if (vals.din !== undefined) bxUnfix(n, "din");
    n.din = bxSize(vals.din, n.din);
  }
  bxSettleSizes();                     // the check sweeps every wire again on a re-configure
  bxRender();
  bxCommit();
  return true;
}
// ---- where a layer loads: the gpu, or the system's ram ----------------------
// `place` travels in the design (`gpu` / `system`); unset takes the backend's
// own device. The engine moves each box there before its forward.
function bxParamsOf(n) {                      // the weights a box holds, in all
  if (!n) return 0;                           // its depths
  if (n.kind === "layer")
    return (bxSize(n.din, 0) || 0) * (bxSize(n.dout, 0) || 0);
  if (n.kind === "conv") {                    // dout kernels of din/g × k × k
    const kk = Math.max(1, Number(n.k) || 3);
    const g = Math.max(1, Number(n.groups) || 1);
    return Math.floor((bxSize(n.din, 0) || 0) / g) * (bxSize(n.dout, 0) || 0)
         * kk * kk;
  }
  if (n.kind === "embed")
    return (bxSize(n.vocab, 0) || 0) * (bxSize(n.dout, 0) || 0);
  if (n.kind === "norm")
    return bxSize(n.size, 0) || bxSize(n.din, 0) || 0;
  if (n.params) return Number(n.params) || 0;
  if (n.kind === "custom")
    return ((n.inner && n.inner.nodes) || [])
      .reduce((a, x) => a + bxParamsOf(x), 0);
  return 0;
}
function bxWeightsBox(n) {                    // a box that owns weights of its own
  if (!n) return false;
  if (n.kind === "layer" || n.kind === "embed" || n.kind === "norm" ||
      n.kind === "conv" || n.kind === "vision" || n.kind === "hf") return true;
  if (n.kind === "op" && bxOpName(n) === "scale") return true;
  if ((n.kind === "op" || n.kind === "script") && n.t && n.params) return true;
  return false;
}
function bxWeightsKind(kind) {                // …and the palette kinds that
  return kind === "layer" || kind === "embed" || kind === "norm" ||   // hold them
         kind === "conv" || kind === "vision" || kind === "hf";
}
function bxWeightedBox(n) {
  if (!n) return false;
  if (n.kind === "layer" || n.kind === "embed" || n.kind === "norm") return true;
  if (n.kind === "vision") return true;      // the mmproj tower holds its own weights
  if (n.kind === "op" && bxOpName(n) === "scale") return true;
  if (n.kind === "custom")
    return ((n.inner && n.inner.nodes) || []).some(x => bxWeightedBox(x));
  return false;
}

