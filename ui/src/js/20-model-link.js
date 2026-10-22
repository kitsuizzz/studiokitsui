// ─── nnstudio shell · 20 · model links ─────────────────────────────────────
// dataset/matrix helpers, wrapping and docking a model, the training notch, and port definitions.
// Order is load-bearing: this slice is concatenated after the one before it.

// what a box accepts / emits: one port each, except a custom box, whose ports
// are the input/output boxes placed inside it (top to bottom)
function bxFindBox(id) {                     // one box anywhere, by id
  let out = null;
  if (id) bxEveryBox(x => { if (x.id === id) out = x; });
  return out;
}
function bxIsDataset(n) {                      // a dataset: the dataset box, or
  return !!n && (n.kind === "dataset" ||      // an input whose datatype reads as
                 (n.kind === "input" && n.input_mode === "dataset"));  // one
}
function bxSelectSource(n) {                  // a select col box's dataset: wired,
  if (!n) return null;                        // else the one it binds
  for (const e of (BX.edges || [])) {
    if (e.to !== n.id) continue;
    const s = bxNode(e.from);
    if (bxIsDataset(s)) return s;
  }
  return n.dataset ? bxFindBox(n.dataset) : null;
}
function bxColIndex(tok, names, width) {      // a name wins; a letter is a position
  const low = String(tok).toLowerCase();
  const at = (names || []).indexOf(low);
  if (at >= 0) return at;
  if (!/^[a-zA-Z]+$/.test(String(tok))) return null;
  let i = 0;
  for (const ch of String(tok).toUpperCase()) i = i * 26 + (ch.charCodeAt(0) - 64);
  return i - 1 < (width || 0) ? i - 1 : null;
}
function bxMatrixTell(n) {                    // a matrix box: what it hands out
  if (!n) return null;
  const ds = bxIsDataset(n) ? n : bxSelectSource(n);
  if (!ds)
    return { node: null, ds: null, cols: null, rows: null,
             bad: n.kind === "select" ? "no dataset — wire one in, or bind one"
                                      : "not a matrix box" };
  const spec0 = n.kind === "select" ? String(n.cols || "").trim() : "";
  if (ds.file) {                              // its rows are on the backend
    const hit = (BX.dsCache || {})[ds.file];
    const toks = spec0 ? spec0.split(/[\s,]+/).filter(x => x) : [];
    return { node: ds, ds, cols: null, count: toks.length || null, names: null,
             vnames: [], rows: hit && hit.ok ? (hit.rows || []).length : null,
             file: true, bad: null };
  }
  const t = bxTableRead(ds) || {};
  const names = (t.cols || []).map(c => String(c).toLowerCase());
  const rows = (t.rows || []).length;
  const spec = n.kind === "select" ? String(n.cols || "").trim() : "";
  let cols = null;
  if (spec) {
    cols = [];
    for (const tok of spec.split(/[\s,]+/).filter(x => x)) {
      const i = bxColIndex(tok, names, names.length);
      if (i == null)
        return { node: ds, ds, cols: null, rows,
                 bad: "no column " + tok + " in the sheet" };
      if (cols.indexOf(i) < 0) cols.push(i);
    }
  } else cols = names.map((_, i) => i);
  const vnames = cols.map(i => names[i] || "");
  return { node: ds, ds, cols, vnames, rows, names, bad: null };
}
function bxAttached() {                       // what the train config detects:
  // the one matrix wired into the input's data dot, and its columns
  const wired = bxTrainWired();
  const tell = wired.data ? bxMatrixTell(wired.data) : null;
  return { node: wired.data || null, tell,
           ds: tell && tell.ds, rows: tell ? tell.rows : null,
           cols: tell && tell.cols, vnames: (tell && tell.vnames) || [],
           names: (tell && tell.names) || [],
           file: !!(tell && tell.file), bad: tell ? tell.bad : null,
           count: tell ? (tell.cols ? tell.cols.length
                                    : (tell.count != null ? tell.count : null)) : null };
}
function bxColsOf(spec, at, dflt) {           // a config's x/y spec -> columns
  // names from what the matrix hands out, or letters within it; blank = A/B
  const toks = String(spec || "").trim().split(/[\s,]+/).filter(x => x);
  const vis = (at && at.cols) || null;
  const use = (p) => (vis && vis.length ? vis[Math.min(Math.max(0, p),
                                                       vis.length - 1)] : p);
  if (at && at.file && toks.length) return null;   // its columns are the backend's
  if (!toks.length)
    return [use(at && at.vnames && at.vnames.length > dflt ? dflt : 0)];
  const out = [];
  for (const tok of toks) {
    const p = bxColIndex(tok, (at && at.vnames) || [], (at && at.vnames || []).length);
    if (p == null) return null;
    out.push(use(p));
  }
  return out;
}
function bxColLabel(cols, at) {               // resolved columns as names/letters
  if (!cols) return "?";
  return cols.map(i => ((at && at.names && at.names[i]) || bxColLetter(i))).join(" ");
}
function bxTrainWired() {                     // the design's training wiring:
  // a config that names a model trains it, and the data wires into the config;
  // before models, the config boxed into an input and the data on the input
  const out = { cfg: null, model: null, input: null, data: null };
  const every = [];
  bxEveryBox(x => { every.push(x); });
  const cfg = every.find(x => (x.kind === "config" || x.kind === "training")
                              && x.model) || null;
  if (cfg) {
    out.cfg = cfg;
    out.model = bxFindBox(cfg.model);
    for (const e of (BX.edges || []))
      if (e.to === cfg.id && (e.toPort || 0) === 0) out.data = bxNode(e.from);
    return out;
  }
  for (const e of (BX.edges || [])) {
    const a = bxNode(e.from), b = bxNode(e.to);
    if (!a || !b || b.kind !== "input") continue;
    const p = e.toPort || 0;
    if (p === 0 && a.kind === "config") { if (!out.cfg) { out.cfg = a; out.input = b; } }
    else if (out.input && b.id === out.input.id && p === 1) out.data = a;
  }
  if (out.input && !out.data && bxIsDataset(out.input))
    out.data = out.input;                      // the input is its own data sheet
  return out;
}
function bxWrapModel(ids) {                   // the weights, into one model box
  const all = (BX.nodes || []).slice();
  const want = all.filter(n => ids && ids.length ? ids.indexOf(n.id) >= 0
                                                 : bxWeightsBox(n));
  if (!want.length) return null;
  const legacy = (function () {                // the old training wiring, folded
    for (const e of (BX.edges || [])) {        // onto the wrapped model after
      const a = bxNode(e.from), b = bxNode(e.to);
      if (a && b && a.kind === "config" && !a.model && b.kind === "input"
          && (e.toPort || 0) === 0)
        return { cfg: a, input: b,
                 data: BX.edges.find(x => x.to === b.id
                                       && (x.toPort || 0) === 1) || null };
    }
    return null;
  })();
  const move = new Set(want.map(n => n.id));
  const never = { input: 1, output: 1, dataset: 1, select: 1, loss: 1,
                  reward: 1, config: 1, train: 1, agent: 1 };
  let grew = true;                             // a param-free box that only serves
  while (grew) {                               // the cluster moves with it
    grew = false;
    for (const n of all) {
      if (move.has(n.id) || never[n.kind] || bxWeightsBox(n)) continue;
      const es = BX.edges.filter(e => e.from === n.id || e.to === n.id);
      if (!es.length) continue;
      if (es.every(e => move.has(e.from === n.id ? e.to : e.from))) {
        move.add(n.id);
        grew = true;
      }
    }
  }
  const moved = all.filter(n => move.has(n.id));
  if (!moved.length) return null;
  const ins = [], outs = [];                   // one boundary port per outer wire
  for (const e of BX.edges) {
    const f = move.has(e.from), t = move.has(e.to);
    if (f === t) continue;
    const list = f ? outs : ins;
    const key = (f ? [e.to, e.toPort || 0] : [e.from, e.fromPort || 0]).join(">");
    if (!list.some(o => o.key === key))
      list.push({ key, e, src: bxNode(e.from), dst: bxNode(e.to) });
  }
  ins.sort((a, b) => (a.src.y - b.src.y) || (a.src.x - b.src.x));
  outs.sort((a, b) => (a.dst.y - b.dst.y) || (a.dst.x - b.dst.x));
  const model = bxAdd("custom",
                      bxSnapTo(moved.reduce((a, n) => a + n.x, 0) / moved.length),
                      bxSnapTo(moved.reduce((a, n) => a + n.y, 0) / moved.length),
                      {});
  if (!model) return null;
  model.model = true;
  const remap = new Map();
  for (const n of moved) remap.set(n.id, bxId());
  const minX = Math.min(...moved.map(n => n.x));
  const minY = Math.min(...moved.map(n => n.y));
  const maxX = Math.max(...moved.map(n => n.x + bxNodeW(n)));
  const inIds = ins.map(() => bxId());
  const outIds = outs.map(() => bxId());
  const nodes = [], edges = [];
  ins.forEach((o, i) => {
    const p = bxPortDefs(o.src, "out")[o.e.fromPort || 0] || {};
    nodes.push({ id: inIds[i], kind: "input", input_mode: "matrix",
                 name: ins.length > 1 ? "in " + (i + 1) : "in",
                 x: -220, y: 60 + i * 140,
                 dout: p.size != null ? p.size : null });
  });
  for (const n of moved) {
    const c = JSON.parse(JSON.stringify(n));
    c.id = remap.get(n.id);
    c.x = n.x - minX;
    c.y = n.y - minY;
    nodes.push(c);
  }
  outs.forEach((o, i) => {
    const p = bxPortDefs(o.src, "out")[o.e.fromPort || 0] || {};
    nodes.push({ id: outIds[i], kind: "output",
                 name: outs.length > 1 ? "out " + (i + 1) : "out",
                 x: maxX - minX + 220, y: 60 + i * 140,
                 din: p.size != null ? p.size : null });
  });
  for (const e of BX.edges) {                  // the wires that stayed inside
    if (!move.has(e.from) || !move.has(e.to)) continue;
    edges.push({ from: remap.get(e.from), to: remap.get(e.to),
                 fromPort: e.fromPort || 0, toPort: e.toPort || 0 });
  }
  ins.forEach((o, i) => edges.push({ from: inIds[i], to: remap.get(o.e.to),
                                     fromPort: 0, toPort: o.e.toPort || 0 }));
  outs.forEach((o, i) => edges.push({ from: remap.get(o.e.from), to: outIds[i],
                                      fromPort: o.e.fromPort || 0, toPort: 0 }));
  model.inner = { nodes, edges };
  BX.edges = BX.edges.filter(e => move.has(e.from) === move.has(e.to));
  ins.forEach((o, i) => BX.edges.push({ from: o.e.from, fromPort: o.e.fromPort || 0,
                                        to: model.id, toPort: i }));
  outs.forEach((o, i) => BX.edges.push({ from: model.id, fromPort: i,
                                         to: o.e.to, toPort: o.e.toPort || 0 }));
  BX.nodes = BX.nodes.filter(n => !move.has(n.id));
  BX.nodes.push(model);
  if (legacy) {                                // the old training wiring: the
    for (const x of BX.nodes)                  // output's own tab retires, the
      if (x.kind === "output" && x.train) x.train = false;   // config takes over
    legacy.cfg.model = model.id;               // config names the new model, and
    BX.edges = BX.edges.filter(e => !(e.from === legacy.cfg.id   // its data
                                      && e.to === legacy.input.id));  // moves over
    if (legacy.data)
      BX.edges.push({ from: legacy.data.from, fromPort: legacy.data.fromPort || 0,
                      to: legacy.cfg.id, toPort: 0 });
  }
  bxSettleSizes();
  bxRender();
  bxCommit();
  return model;
}
function bxAnyModel() {                       // any nested model on the canvas
  let hit = null;
  bxEveryBox(x => { if (!hit && x.kind === "custom" && x.model) hit = x; });
  return hit;
}
function bxTrainNotch(n, w) {                  // the Training box's socket: cut
  const m = n && n.model ? bxFindBox(n.model) : null;   // to the model's whole
  const W = Math.max(120, w);                  // card — insert one and the
  const mw = Math.max(60, Math.min(m ? bxNodeW(m) : BXW, W - 24));  // bite is
  return { x: Math.round((W - mw) / 2), w: mw,   // filled: the card is a
           d: m ? bxNodeH(m) : BXH };            // rectangle again
}
function bxDockModel(tid, mid) {               // a model into that gap: it becomes
  const t = bxNode(tid), m = bxNode(mid);      // the architecture the box trains
  if (!t || !m || t.kind !== "training" || m.kind !== "custom") return false;
  t.model = m.id;
  const slot = bxTrainNotch(t, bxNodeW(t));
  m.x = Math.round(t.x + slot.x + (slot.w - bxNodeW(m)) / 2);
  m.y = Math.round(t.y + slot.d - bxNodeH(m));   // its foot sits in the socket
  const at = BX.nodes.indexOf(m), tt = BX.nodes.indexOf(t);
  if (at >= 0 && tt >= 0 && at < tt) {         // …and it draws over the card
    BX.nodes.splice(at, 1);
    BX.nodes.push(m);
  }
  bxSelectBoxes([m.id]);
  bxSettleSizes();
  bxRender();
  bxCommit();
  return true;
}
function bxDotClick(n) {                       // a click — not a drag — on a dot
  const host = bxTrainHostOf(n);               // of a seated model pops it out
  if (!host) return false;
  bxUndockModel(host.id);
  return true;
}
function bxUndockModel(tid) {                  // the pair separates: the model
  const t = bxNode(tid);                       // stays right where it stands
  if (!t || t.kind !== "training") return false;
  const m = t.model ? bxFindBox(t.model) : null;
  t.model = null;
  bxSelectBoxes(m ? [m.id] : [t.id]);
  bxRender();
  bxCommit();
  return true;
}
function bxHubFieldsSync() {                   // the Training box's dots are its
  const keys = ["dataset", "test_dataset", "val_dataset"];   // three splits: the
  const boxes = [];                                          // wires land in the
  bxEveryBox(x => { if (x.kind === "training") boxes.push(x); });   // fields
  if (!boxes.length) return;
  for (const n of boxes) {
    const got = {};
    for (const e of (BX.edges || [])) {
      if (e.to !== n.id) continue;
      const p = e.toPort || 0;
      if (p < 0 || p > 2) continue;
      const from = bxNode(e.from);
      if (from && bxIsDataset(from)) got[keys[p]] = from.id;
    }
    for (const k of keys) if (got[k]) n[k] = got[k];
  }
}
function bxInputLink(n) {                     // one input's own training dots
  const out = { on: false, cfg: null, data: null };
  let trainOn = false;
  bxEveryBox(x => { if (x.kind === "output" && x.train) trainOn = true; });
  for (const e of (BX.edges || [])) {
    if (e.to !== n.id) continue;
    const s = bxNode(e.from);
    const p = e.toPort || 0;
    if (p === 0 && s && s.kind === "config") out.cfg = s;
    else if (p === 1) out.data = s;
  }
  if (bxIsDataset(n)) out.data = out.data || n;   // an input that is a sheet is
  out.on = trainOn || !!out.cfg;                  // its own data
  return out;
}
function bxPortDefs(n, dir, seen) {
  if (!n) return [];
  if (n.kind === "agent" || n.kind === "train" || n.kind === "reward")
    return [];                                  // a display or a scorer: no wires
  if (bxIsDataset(n) && n.kind === "dataset")
    // the box's rows ride out to a loss box's second dot — an input that
    // reads as a dataset keeps its own hub dots (below) and sends rows instead
    return dir === "out" ? [{ size: null, node: n, field: "dout", act: true }] : [];
  if (n.kind === "loss")     // the model's scores, then the dataset's labels
    return dir === "in"
      ? [{ size: null, node: n, field: "din", act: true },
         { size: null, node: n, field: "din", act: true }]
      : [{ size: 1, node: n }];
  if (n.kind === "training")                 // train / test / validation in,
    return dir === "in"                      // the run's result out
      ? [{ size: null, node: n, field: "din", act: true },
         { size: null, node: n, field: "din", act: true },
         { size: null, node: n, field: "din", act: true }]
      : [{ size: null, node: n, field: "dout", act: true }];
  seen = seen || new Set();
  if (seen.has(n.id)) return [];                 // a loop of pass-throughs stops here
  seen.add(n.id);
  if (n.kind === "input") {                  // a source — and, training on, its
    if (dir === "out")                       // hub: the train config, then data
      return [bxIsDataset(n)
              ? { size: null, node: n, field: "dout", act: true }   // its own rows
              : { size: n.dout, node: n, field: "dout" }];
    const link = bxInputLink(n);
    if (!link.on) return [];
    const ports = [{ size: null, node: n, field: "din", act: true, opt: true }];
    if (link.cfg)
      ports.push({ size: null, node: n, field: "din", act: true, opt: true });
    return ports;
  }
  if (n.kind === "select")                   // a sheet's columns, as a matrix
    return dir === "out"
      ? [{ size: null, node: n, field: "cols", act: true }]
      : [{ size: null, node: n, field: "din", act: true, opt: true }];
  if (n.kind === "config") {                 // a model's config: the data wires
    if (n.model)                             // into its own dot
      return dir === "in"
        ? [{ size: null, node: n, field: "din", act: true, opt: true }] : [];
    return dir === "out"                   // the older shape: settings ride to an
      ? [{ size: null, node: n, field: "dout", act: true }] : [];   // input box
  }
  if (n.kind === "heatmap")                  // one vector in, one picture out
    return dir === "in" ? [{ size: n.din, node: n, field: "din" }]
                        : [{ size: null, node: n, field: "dout", act: true }];
  if (n.kind === "output")                   // its data — the training's dots
    return dir === "in"                      // live on the input box now
      ? [{ size: n.din, node: n, field: "din" }] : [];
  if (n.kind === "tokenize")               // text in — from an input's text — one id per token out
    return dir === "in" ? [{ size: null, node: n, field: "din", act: true }]
                        : [{ size: 1, node: n }];
  if (n.kind === "sample")                 // logits in (any size), one picked id out
    return dir === "in" ? [{ size: null, node: n, field: "din", act: true }]
                        : [{ size: 1, node: n }];
  if (n.kind === "detokenize")             // ids in, text out — the text is the output
    return dir === "in" ? [{ size: null, node: n, field: "din", act: true }]
                        : [{ size: null, node: n, field: "dout", act: true }];
  if (n.kind === "hf")                     // text in, the next token's text out
    return dir === "in" ? [{ size: null, node: n, field: "din", act: true }]
                        : [{ size: null, node: n, field: "dout", act: true }];
  if (n.kind === "act" || n.kind === "norm" || n.kind === "script")
    return [{ size: bxActSize(n, seen), node: n, field: dir === "in" ? "din" : "dout", act: true }];
  if (n.kind === "op") {
    const op = bxOpName(n);
    if (op === "concat") {                      // widths add up: one wire per part, one out
      if (dir === "in") {
        const ports = [];
        for (let i = 0; i < bxOpArity(op); i++) ports.push({ size: n.din, node: n, field: "din" });
        return ports;
      }
      return [{ size: n.dout, node: n, field: "dout" }];
    }
    if (BX_OPAQUE.indexOf(op) >= 0) {           // a contraction/selection: no size to check
      if (dir === "in") {
        const ports = [];
        for (let i = 0; i < bxOpArity(op); i++)
          ports.push({ size: null, node: n, field: "din", act: true });
        return ports;
      }
      return [{ size: null, node: n, field: "dout", act: true }];
    }
    const shape = op === "reshape" ? bxReshapeSize(n) : null;   // its configured element count
    if (dir === "in") {
      const ports = [];
      for (let i = 0; i < bxOpArity(op); i++)
        ports.push({ size: shape != null ? shape : n.din, node: n, field: "din" });
      return ports;                                             // both dots share one size
    }
    // a dot product sends a single number; a shaped reshape sends its element
    // count; every other operation sends its size. (the field points back at
    // din, so a known destination can fill the shared size)
    return [{ size: op === "dot product" ? 1 : (shape != null ? shape : n.din),
              node: n, field: "din" }];
  }
  if (n.kind === "custom") {
    return bxBoundary(n, dir).map(k => ({ size: dir === "in" ? k.dout : k.din, node: k,
                                          field: dir === "in" ? "dout" : "din" }));
  }
  if (n.kind === "vision")                   // an image's patches in, embeddings out
    return [{ size: dir === "in" ? n.din : n.dout, node: n,
              field: dir === "in" ? "din" : "dout" }];
  return [{ size: dir === "in" ? n.din : n.dout, node: n, field: dir === "in" ? "din" : "dout" }];
}
function bxPortSizes(n, dir, seen) { return bxPortDefs(n, dir, seen).map(p => p.size); }

