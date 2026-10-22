// ─── nnstudio shell · 65 · clipboard and JSON import ─────────────────────────────────────
// copy/paste, the legacy normalizer, JSON import, and the account state constants (the crypto tests pin this slice).
// Order is load-bearing: this slice is concatenated after the one before it.

// ---- copy & paste: the selected boxes (and the wires between them) leave as
// a little "boxes" design and land back wherever you are -- the same level, or
// inside a nested box -- with fresh ids, one undo step per paste
function bxCopyBoxes(ids) {
  ids = (ids && ids.length) ? ids : bxSelectedIds();
  const set = new Set(ids);
  const nodes = BX.nodes.filter(n => set.has(n.id));
  if (!nodes.length) return false;
  const edges = BX.edges.filter(e => set.has(e.from) && set.has(e.to));
  bxCopied = bxJSONDoc(nodes, edges, "boxes");
  bxPasteAt = null;                          // a fresh copy starts a fresh spot
  return true;
}
function bxCopySelection() { return bxCopyBoxes(bxSelectedIds()); }
function bxPastePoint() {                    // the cursor, or the middle of the view
  const host = bxHost();
  const r = host && host.getBoundingClientRect ? host.getBoundingClientRect() : null;
  let p = null;
  if (r && bxMouse && bxMouse.x >= r.left && bxMouse.x <= r.right &&
      bxMouse.y >= r.top && bxMouse.y <= r.bottom)
    p = bxPoint({ clientX: bxMouse.x, clientY: bxMouse.y });
  if (!p) { const c = bxCenter(); p = { x: c.cx + 30, y: c.cy + 30 }; }
  if (bxPasteAt && Math.abs(bxPasteAt.x - p.x) < 2 && Math.abs(bxPasteAt.y - p.y) < 2)
    p = { x: p.x + 28, y: p.y + 28 };        // pasting again without moving: cascade
  bxPasteAt = p;
  return p;
}
function bxTyping(t) {                         // a field's own copy/paste is its own
  return !!(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
                  t.tagName === "SELECT" || t.isContentEditable));
}
function bxOnCopy(ev) {                        // the browser's copy event
  if (bxTyping(ev && ev.target)) return false;
  if (!bxCopySelection()) return false;        // nothing selected: leave the copy alone
  if (ev && ev.clipboardData) ev.clipboardData.setData("text/plain", JSON.stringify(bxCopied));
  if (ev) ev.preventDefault();
  return true;
}
function bxOnPaste(ev) {                       // the browser's paste event
  if (bxTyping(ev && ev.target)) return false;
  const cd0 = ev && ev.clipboardData;
  const files = cd0 && cd0.files;
  if (files && files.length) {                 // a picture pasted over the canvas
    const ids = (typeof bxSelectedIds === "function") ? bxSelectedIds() : [];
    const n = ids.length === 1 ? bxNode(ids[0]) : null;
    if (n && n.kind === "input" && n.input_mode === "image") {
      bxImageAttach(n, files[0], null);        // lands in the selected box
      if (ev && ev.preventDefault) ev.preventDefault();
      return true;
    }
    return false;
  }
  const text = ev && ev.clipboardData && ev.clipboardData.getData("text/plain");
  if (!text || !bxPasteBoxes(text)) return false;
  if (ev) ev.preventDefault();
  return true;
}
function bxPasteBoxes(text, at) {
  let obj = null;
  if (text != null && text !== "") {
    try { obj = JSON.parse(text); } catch (e) { return false; }
  } else {
    obj = bxCopied;
  }
  if (!obj || typeof obj !== "object") return false;
  if (obj.type === "nested") {               // a whole design: one nested box
    const doc = bxJSONDocFrom(obj, "nested");
    if (!doc) return false;
    bxTrainPrune(doc, false);                // a Run box never lands inside one
    const p = at || bxPastePoint();
    bxUndoLock++;
    const n = bxAdd("custom", p.x, p.y, { name: doc.name });
    n.inner = { nodes: doc.nodes, edges: doc.edges };
    bxSettleSizes();
    bxRender();
    bxUndoLock--;
    bxCommit();
    bxSelectBoxes([n.id]);
    return true;
  }
  const doc = bxJSONDocFrom(obj, "boxes");
  if (!doc) return false;
  bxTrainPrune(doc, !BX.up && !bxTrainAnywhere());   // one Run box, at the top only
  if (!doc.nodes.length) return false;
  const p = at || bxPastePoint();
  const xs = doc.nodes.map(n => n.x), ys = doc.nodes.map(n => n.y);
  const dx = Math.round(p.x - (Math.min(...xs) + Math.max(...xs)) / 2);
  const dy = Math.round(p.y - (Math.min(...ys) + Math.max(...ys)) / 2);
  const map = new Map();
  for (const n of doc.nodes) {               // fresh ids, placed under the cursor
    const id = bxId();
    map.set(n.id, id);
    n.id = id;
    n.x += dx;
    n.y += dy;
  }
  for (const e of doc.edges) {
    e.from = map.get(e.from);
    e.to = map.get(e.to);
    if (e.via) { e.via.x += dx; e.via.y += dy; }
  }
  bxUndoLock++;                              // the whole paste is one step
  for (const n of doc.nodes) BX.nodes.push(n);
  for (const e of doc.edges) BX.edges.push(e);
  bxSettleSizes();
  bxRender();
  bxUndoLock--;
  bxCommit();
  bxSelectBoxes(doc.nodes.map(n => n.id));
  return true;
}
function bxCount(v) {                          // a non-negative whole number, or nothing
  if (v == null || v === "") return null;
  const num = Number(v);
  return isFinite(num) && num >= 0 ? Math.round(num) : null;
}
function bxJSONNum(v, fallback) {
  const num = typeof v === "number" ? v
            : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  return isFinite(num) ? Math.round(num) : fallback;
}
function bxJSONPort(v) {
  if (v == null || v === "") return 0;
  const num = typeof v === "number" ? v : Number(v);
  return (isFinite(num) && num >= 0) ? Math.round(num) : null;
}
// an old design with an attn/ssm/moe box in it: those are not kinds any more —
// rebuild the nested box they should always have been, binding each atom to the
// tensor that names it
function bxLegacyBox(o) {
  const tpl = o.kind;
  const binds = String(o.t || "").split(",").map(x => x.trim()).filter(Boolean);
  const take = (re) => {
    const hit = binds.filter(b => re.test(b));
    return hit.length ? hit.join(", ") : undefined;
  };
  const opts = { rope: o.rope };
  let used = /^$/;
  if (tpl === "attn") {
    opts.tq = take(/attn_q\./); opts.tk = take(/attn_k\./);
    opts.tv = take(/attn_v\./); opts.to = take(/attn_output\./);
    opts.tqn = take(/attn_q_norm\./); opts.tkn = take(/attn_k_norm\./);
    opts.tg = take(/attn_gate\./);
    used = /attn_(q|k|v)\.|attn_output\.|attn_(q|k)_norm\.|attn_gate\./;
  } else if (tpl === "ssm") {
    opts.ti = take(/ssm_in\./); opts.to = take(/ssm_out\./); opts.tn = take(/ssm_norm\./);
    used = /ssm_/;
  } else {
    opts.tr = take(/ffn_gate_inp/); opts.tu = take(/ffn_(gate|up)_exps/);
    opts.td = take(/ffn_down_exps/); opts.topk = o.topk;
    used = /_exps|ffn_gate_inp/;
  }
  const rest = binds.filter(b => !used.test(b)).join(", ");
  const n = { id: o.id, kind: "custom",
              x: bxJSONNum(o.x, 0), y: bxJSONNum(o.y, 0),
              name: (typeof o.name === "string" && o.name.trim()) ? o.name.trim() : bxTemplateName(tpl),
              inner: BX_TEMPLATES[tpl](opts) };
  if (rest) n.t = bxClip(rest, 200);
  return n;
}
/**
 * Normalize a node read from a design file into the current node shape:
 * legacy kinds and fields are folded forward before the design is applied.
 */
function bxJSONNodeFrom(o) {
  if (!o || typeof o !== "object") return null;
  if (o.kind === "attn" || o.kind === "ssm" || o.kind === "moe") return bxLegacyBox(o);
  if (BX_KINDS.indexOf(o.kind) < 0) return null;
  const n = { id: (typeof o.id === "string" && o.id) ? o.id : bxId(), kind: o.kind,
              x: bxJSONNum(o.x, 0), y: bxJSONNum(o.y, 0),
              name: (typeof o.name === "string" && o.name.trim()) ? o.name.trim()
                                                                 : bxDefaultName(o.kind) };
  if (o.kind === "embed") {
    n.vocab = bxSize(o.vocab);
    n.din = bxSize(o.din) || 1;
    n.dout = bxSize(o.dout);
    if (o.embed_scale != null && isFinite(Number(o.embed_scale)))
      n.embed_scale = Number(o.embed_scale);
  }
  else if (o.kind === "input") {
    n.dout = bxSize(o.dout);
    if (["text", "image", "dataset"].indexOf(o.input_mode) >= 0) n.input_mode = o.input_mode;
    else if (o.input_mode != null) n.input_mode = "matrix";   // legacy python/random/values
    if (typeof o.file === "string" && o.file) n.file = bxClip(o.file, 300);
    if (["csv", "tsv", "jsonl"].indexOf(o.format) >= 0) n.format = o.format;
    if (typeof o.values === "string" && o.values.trim()) n.values = bxClip(o.values, 4096);
    if (typeof o.text === "string") n.text = bxClip(o.text, 4096);
    if (typeof o.image === "string" && o.image) n.image = bxClip(o.image, 300);
    const isz = bxSize(o.image_size);
    if (isz) n.image_size = isz;
    const psz = bxSize(o.patch_size);
    if (psz) n.patch_size = psz;
    if (o.image_mean != null) n.image_mean = String(o.image_mean).slice(0, 80);
    if (o.image_std != null) n.image_std = String(o.image_std).slice(0, 80);
    if (o.box && typeof o.box === "object")
      n.box = { w: bxSize(o.box.w, 420), h: bxSize(o.box.h, 280) };
    if (o.panel && typeof o.panel === "object") n.panel = { expand: !!o.panel.expand };
  }
  else if (o.kind === "output") {
    n.din = bxSize(o.din);
    if (o.box && typeof o.box === "object")
      n.box = { w: bxSize(o.box.w, 420), h: bxSize(o.box.h, 280) };
    if (o.panel && typeof o.panel === "object") {
      n.panel = { expand: !!o.panel.expand };
      if (o.panel.tab === "training") n.panel.tab = "training";
    }
    if (o.train) n.train = true;         // the training tab carries the run's setup
    bxTrainNode(o, n);
  }
  else if (o.kind === "heatmap") {
    n.din = bxSize(o.din);
    if (o.box && typeof o.box === "object")
      n.box = { w: bxSize(o.box.w, 360), h: bxSize(o.box.h, 320) };
  }
  else if (o.kind === "layer") { n.din = bxSize(o.din); n.dout = bxSize(o.dout); }
  else if (o.kind === "conv") {
    n.din = bxSize(o.din);
    n.dout = bxSize(o.dout);
    for (const k of ["k", "stride", "pad", "groups"]) {
      const v = bxInt(o[k], null);
      if (v != null && v > 0) n[k] = v;
    }
  }
  else if (o.kind === "act") {
    n.act = BX_ACTS.indexOf(o.act) >= 0 ? o.act : "silu";
    if (o.gain != null && isFinite(Number(o.gain))) n.gain = Number(o.gain);
    if (o.causal) n.causal = true;
  }
  else if (o.kind === "op") {
    n.op = BX_OPS.indexOf(o.op) >= 0 ? o.op : BX_OPS[0];
    const d = bxDims(o.dims);
    if (d) n.dims = d.join("x");
    if (o.axes) n.axes = Array.isArray(o.axes) ? o.axes.map(Number)
                                              : String(o.axes);
    if (o.repeats != null) n.repeats = Number(o.repeats);
    if (o.dim != null) n.dim = Number(o.dim);
    if (o.factor != null) n.factor = Number(o.factor);
    if (o.theta != null) n.theta = Number(o.theta);
    if (o.width != null) n.width = Number(o.width);
    if (o.mode) n.mode = String(o.mode);
    if (o.window != null) n.window = Number(o.window);
    if (o.axis != null) n.axis = Number(o.axis);
    if (o.index != null) n.index = Number(o.index);
    if (o.start != null) n.start = Number(o.start);
    if (o.stop != null) n.stop = Number(o.stop);
    for (const k of BX_OP_EXTRAS) {             // spec attrs the UI does not model
      const v = Number(o[k]);
      if (o[k] != null && isFinite(v) && v !== 0) n[k] = v;
    }
    n.din = bxSize(o.din);
    n.dout = bxSize(o.dout);
  }
  else if (o.kind === "norm") {
    n.norm = o.norm === "layer" ? "layer"
           : o.norm === "group" ? "group" : "rms";
    n.eps = bxNum(o.eps, null);
    if (o.zc) n.zc = true;
    const sz = bxSize(o.size);
    if (sz) n.size = sz;
    const gg = bxInt(o.groups, null);
    if (gg && gg > 1) n.groups = gg;
  }
  else if (o.kind === "script") {
    n.script = typeof o.script === "string" ? o.script : "";
  }
  else if (o.kind === "tokenize" || o.kind === "detokenize") {
    n.vocab = typeof o.vocab === "string" ? bxClip(o.vocab, 4096) : "";
    if (typeof o.repo === "string" && o.repo.trim()) {
      n.repo = bxClip(o.repo.trim(), 200);
      const tk = bxSize(o.tokens, null);
      if (tk && tk > 0) n.tokens = tk;
    }
    if (o.kind === "tokenize" && typeof o.text === "string") n.text = bxClip(o.text, 4096);
  }
  else if (o.kind === "hf") {
    if (typeof o.repo === "string" && o.repo.trim()) n.repo = bxClip(o.repo.trim(), 200);
    if (typeof o.text === "string") n.text = bxClip(o.text, 4096);
    if (o.temperature != null) {
      const t = Number(o.temperature);
      if (isFinite(t) && t >= 0) n.temperature = t;
    }
  }
  else if (o.kind === "sample") {
    if (o.temperature != null) {
      const t = Number(o.temperature);
      if (isFinite(t) && t >= 0) n.temperature = t;
    }
    const sd = bxSize(o.sample_seed);
    if (sd != null && sd >= 0) n.sample_seed = sd;
  }
  else if (o.kind === "dataset") {
    if (typeof o.text === "string") n.text = bxClip(o.text, 200000);
    if (typeof o.file === "string" && o.file) n.file = bxClip(o.file, 300);
    if (typeof o.repo === "string" && o.repo) n.repo = bxClip(o.repo, 200);
    if (typeof o.vocab === "string") n.vocab = bxClip(o.vocab, 4096);
    const rw = bxSize(o.rows);
    if (rw) n.rows = rw;
    if (["csv", "tsv", "jsonl"].indexOf(o.format) >= 0) n.format = o.format;
    if (Array.isArray(o.colw))               // widths: numbers, at most 512 cols
      n.colw = o.colw.slice(0, 512).map(x => Math.max(0, Math.round(Number(x) || 0)));
    if (Array.isArray(o.colt))
      n.colt = o.colt.slice(0, 512).map(x =>
        ["int64", "float64", "bool", "object", "image", "video"].indexOf(String(x)) >= 0
          ? String(x) : "");
    if (o.box && typeof o.box === "object")
      n.box = { w: Math.round(Number(o.box.w) || 440), h: Math.round(Number(o.box.h) || 300) };
    if (o.panel && typeof o.panel === "object") n.panel = o.panel;
    if (o.collapsed) n.collapsed = true;
  }
  else if (o.kind === "reward") {
    if (["python", "exact", "regex", "length"].indexOf(o.reward) >= 0) n.reward = o.reward;
    if (typeof o.expr === "string") n.expr = bxClip(o.expr, 20000);
    if (typeof o.pattern === "string") n.pattern = bxClip(o.pattern, 200);
    if (typeof o.match === "string") n.match = bxClip(o.match, 200);
    const lm = bxSize(o.limit);
    if (lm) n.limit = lm;
  }
  else if (o.kind === "loss") {
    if (typeof o.loss === "string") n.loss = o.loss;
  }
  else if (o.kind === "agent") {
    if (typeof o.task_id === "string" && o.task_id) n.task_id = o.task_id;
    if (o.box && typeof o.box === "object")
      n.box = { w: bxSize(o.box.w, 480), h: bxSize(o.box.h, 320) };
    if (o.panel && typeof o.panel === "object") {
      const p = o.panel;
      n.panel = { lines: bxSize(p.lines, 200), autoscroll: p.autoscroll !== false,
                  debug: !!p.debug, expand: !!p.expand };
    }
    if (o.collapsed) n.collapsed = true;
  }
  else if (o.kind === "train" || o.kind === "config" || o.kind === "training") {
    bxTrainNode(o, n);
    const dw = o.kind === "config" ? 360 : o.kind === "training" ? 340 : 480;
    const dh = o.kind === "config" ? 240 : o.kind === "training" ? 300 : 320;
    if (o.box && typeof o.box === "object")
      n.box = { w: bxSize(o.box.w, dw), h: bxSize(o.box.h, dh) };
    if (o.kind === "train" && o.panel && typeof o.panel === "object") {
      const p = o.panel;
      n.panel = { lines: bxSize(p.lines, 200), autoscroll: p.autoscroll !== false,
                  debug: !!p.debug, expand: !!p.expand };
    }
    if (o.kind === "train" && o.collapsed) n.collapsed = true;
    if (o.kind === "train" && o.hidden) n.hidden = true;   // still the hub
  }
  else if (o.kind === "select") {
    if (typeof o.dataset === "string" && o.dataset) n.dataset = bxClip(o.dataset, 200);
    if (typeof o.cols === "string") n.cols = bxClip(o.cols.trim().toUpperCase(), 200) || null;
    if (o.box && typeof o.box === "object")
      n.box = { w: bxSize(o.box.w, 360), h: bxSize(o.box.h, 240) };
  }
  else if (o.kind === "vision") {        // the mmproj tower: its file + geometry
    n.din = bxSize(o.din);
    n.dout = bxSize(o.dout);
    if (typeof o.projector === "string") n.projector = o.projector.slice(0, 40);
    for (const k of ["d_model", "heads", "blocks", "patch", "merge",
                     "image_size", "proj_dim"]) {
      const v = bxSize(o[k]);
      if (v) n[k] = v;
    }
    if (o.eps != null && isFinite(Number(o.eps))) n.eps = Number(o.eps);
    if (o.image_mean != null) n.image_mean = String(o.image_mean).slice(0, 80);
    if (o.image_std != null) n.image_std = String(o.image_std).slice(0, 80);
  }
  else {
    const inner = o.inner == null ? { nodes: [], edges: [] } : bxJSONDocFrom(o.inner, "nested");
    if (!inner) return null;                    // a canvas can never sit inside a nested box
    n.inner = { nodes: inner.nodes, edges: inner.edges };
    if (typeof o.repo === "string" && o.repo.trim()) n.repo = bxClip(o.repo.trim(), 200);
    if (o.model === true) n.model = true;       // the architecture's own box
    if (o.box && typeof o.box === "object")
      n.box = { w: bxSize(o.box.w, 380), h: bxSize(o.box.h, 220) };
  }
  if (typeof o.t === "string" && o.t.trim()) n.t = bxClip(o.t.trim(), 200);
  if (typeof o.file === "string" && o.file.trim()) n.file = bxClip(o.file.trim(), 300);
  if (o.shared) n.shared = true;
  if (o.off) n.off = true;
  if (o.frozen) n.frozen = true;
  const dt = bxDtypeName(o.dtype, null);
  if (dt) n.dtype = dt;
  if (o.place === "gpu" || o.place === "system") n.place = o.place;
  n.params = bxCount(o.params);
  n.wbytes = bxCount(o.wbytes);
  return n;
}
function bxJSONDocFrom(o, expect) {
  if (!o || typeof o !== "object" || o.type !== expect) return null;
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) return null;
  const nodes = [], ids = new Set();
  for (const raw of o.nodes) {
    const n = bxJSONNodeFrom(raw);
    if (!n || ids.has(n.id)) return null;       // ids must be unique inside a design
    ids.add(n.id);
    nodes.push(n);
  }
  const edges = [];
  for (const raw of o.edges) {
    if (!raw || typeof raw !== "object") return null;
    if (!ids.has(raw.from) || !ids.has(raw.to) || raw.from === raw.to) return null;
    const fp = bxJSONPort(raw.fromPort), tp = bxJSONPort(raw.toPort);
    if (fp == null || tp == null) return null;
    const e = { from: raw.from, to: raw.to, fromPort: fp, toPort: tp };
    if (raw.via && typeof raw.via.x === "number" && typeof raw.via.y === "number")
      e.via = { x: Math.round(raw.via.x), y: Math.round(raw.via.y) };
    for (let k = edges.length - 1; k >= 0; k--)  // one wire per input dot, the last wins
      if (edges[k].to === e.to && (edges[k].toPort || 0) === tp) edges.splice(k, 1);
    edges.push(e);
  }
  // an older design's dataset dot on the output box: that wire moved to the
  // input's X dot, so it lands as the output's stored dataset (the engine keeps
  // reading it) and the stale edge goes
  const drop = new Set();
  for (const e of edges) {
    if ((e.toPort || 0) < 1) continue;
    const dst = nodes.find(n => n.id === e.to);
    const src = nodes.find(n => n.id === e.from);
    if (!dst || !src || dst.kind !== "output" || src.kind !== "dataset") continue;
    if (!dst.dataset) dst.dataset = src.id;
    drop.add(e);
  }
  const kept = drop.size ? edges.filter(e => !drop.has(e)) : edges;
  return { nodes, edges: kept, name: typeof o.name === "string" ? o.name.trim() : "",
           weights: (expect === "canvas" && o.weights && typeof o.weights === "object")
             ? o.weights : null,
           model: expect === "canvas" ? bxModelFrom(o.model) : null };
}
// the canvas' model block: what the file said (layers, kv heads, head dim, its
// own params/bytes/dtypes) plus the knobs the estimate runs on
function bxModelFrom(o) {
  if (!o || typeof o !== "object") return null;
  const num = (v) => (typeof v === "number" && isFinite(v) && v >= 0) ? Math.round(v) : null;
  const m = { arch: typeof o.arch === "string" ? o.arch : null,
              layers: num(o.layers), attn_layers: num(o.attn_layers),
              kv_heads: num(o.kv_heads), head_dim: num(o.head_dim),
              ctx: num(o.ctx) || 8192, kv_ctx: num(o.kv_ctx), batch: num(o.batch) || 1,
              allDtype: bxDtypeName(o.allDtype, null),
              cpu_offload: Math.max(0, Math.min(100, num(o.cpu_offload) || 0)),
              params: num(o.params), bytes: num(o.bytes),
              dtypes: (o.dtypes && typeof o.dtypes === "object") ? o.dtypes : null,
              opt: ["none", "sgd", "adamw"].indexOf(o.opt) >= 0 ? o.opt : "adamw",
              master: !!o.master };
  return m;
}
// What a pasted design is, and what loading it would do — before doing it.
// A canvas is the top level's alone: inside a nested box there is no canvas to
// save or load. A nested design loads anywhere, as a nested box.
function bxJSONRead(text, where) {
  let obj = null;
  try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: "not JSON" }; }
  where = where || {};
  if (where.box) {
    const b = typeof where.box === "string" ? bxNode(where.box) : where.box;
    if (!b || b.kind !== "custom") return { ok: false, error: "no nested box there" };
    const doc = bxJSONDocFrom(obj, "nested");
    if (!doc) return { ok: false, error: "a nested box takes a nested design, never a canvas" };
    return { ok: true, kind: "nested", doc };
  }
  if (obj && obj.type === "canvas") {
    if (BX.up) return { ok: false, error: "a canvas loads at the top level only" };
    const doc = bxJSONDocFrom(obj, "canvas");
    if (!doc) return { ok: false, error: "not a valid canvas design" };
    return { ok: true, kind: "canvas", doc, replaces: BX.nodes.length > 0 };
  }
  const doc = bxJSONDocFrom(obj, "nested");
  if (!doc) return { ok: false, error: "neither a canvas nor a nested design" };
  return { ok: true, kind: "nested box", doc };
}
function bxJSONApply(read, where) {
  if (!read || !read.ok) return { ok: false, error: (read && read.error) || "nothing to load" };
  where = where || {};
  if (read.kind === "nested" && where.box) {    // into one nested box, in place
    const b = typeof where.box === "string" ? bxNode(where.box) : where.box;
    if (!b || b.kind !== "custom") return { ok: false, error: "no nested box there" };
    bxTrainPrune(read.doc, false);              // a Run box never lands inside one
    b.inner = { nodes: read.doc.nodes, edges: read.doc.edges };
    if (read.doc.name) b.name = read.doc.name;
    if (BX.up === b.id) { BX.nodes = b.inner.nodes; BX.edges = b.inner.edges; }
    bxSel = null;
    bxSettleSizes();
    bxRender();
    bxCommit();
    return { ok: true, kind: "nested" };
  }
  if (read.kind === "canvas") {                 // the whole canvas, replaced
    if (BX.up) return { ok: false, error: "a canvas loads at the top level only" };
    BX.stack = [];
    BX.up = null;
    bxTrainPrune(read.doc, true);               // one Run box, at the top only
    BX.nodes = read.doc.nodes;
    BX.edges = read.doc.edges;
    BX.model = read.doc.model || null;          // its own numbers + the estimate knobs
    if (read.doc.weights) BX.weights = read.doc.weights;   // the namespace registry
    BX.view = { cx: null, cy: null, k: 1 };
    bxSel = null;
    bxSettleSizes();
    bxRender();
    bxCommit();
    return { ok: true, kind: "canvas" };
  }
  if (read.kind === "nested box") {             // a nested box, wherever you are
    bxUndoLock++;                           // the box and its network land together
    bxTrainPrune(read.doc, false);              // a Run box never lands inside one
    const n = bxAdd("custom", where.x || 0, where.y || 0, { name: read.doc.name });
    n.inner = { nodes: read.doc.nodes, edges: read.doc.edges };
    bxSettleSizes();
    bxRender();
    bxUndoLock--;
    bxCommit();
    return { ok: true, kind: "nested box" };
  }
  return { ok: false, error: "nothing to load" };
}
// load a design: into the canvas (no target), or into a nested box (where.box)
function bxImportJSON(text, where) { return bxJSONApply(bxJSONRead(text, where), where); }

