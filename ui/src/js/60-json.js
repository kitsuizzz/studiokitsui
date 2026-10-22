// ─── nnstudio shell · 60 · the design as JSON ─────────────────────────────────────
// exporting a design (and its nested docs) to files and back.
// Order is load-bearing: this slice is concatenated after the one before it.

function bxTrainDoc(o, n) {                    // the training a host carries, out
  if (n.task_id) o.task_id = n.task_id;
  if (typeof n.model === "string" && n.model) o.model = n.model;   // the slot's
  for (const k of ["dataset", "test_dataset", "val_dataset", "target", "reward"])
    if (n[k]) o[k] = n[k];
  if (n.x_col) o.x_col = n.x_col;
  if (n.y_col) o.y_col = n.y_col;
  if (n.y_class) o.y_class = true;
  if (n.classes && n.classes.length) o.classes = n.classes;   // legacy order
  if (n.paradigm) o.paradigm = n.paradigm;
  if (n.optimizer) o.optimizer = n.optimizer;
  for (const k of ["lr", "weight_decay", "batch", "steps", "clip",
                   "save_every", "eval_every", "temperature", "max_tokens", "n_samples"])
    if (n[k] != null) o[k] = n[k];
}
function bxTrainNode(o, n) {                   // …and back, validated
  if (typeof o.model === "string" && o.model) n.model = o.model;   // its model
  for (const k of ["dataset", "test_dataset", "val_dataset", "target", "reward"])
    if (typeof o[k] === "string" && o[k]) n[k] = o[k];
  for (const k of ["x_col", "y_col"])
    if (typeof o[k] === "string" && o[k]) n[k] = o[k].trim().toUpperCase();
  if (o.y_class === true) n.y_class = true;
  if (o.classes && typeof o.classes === "object" && o.classes.length)
    n.classes = o.classes.map(x => String(x)).filter(x => x);   // legacy order
  if (o.paradigm === "rl" || o.paradigm === "supervised") n.paradigm = o.paradigm;
  if (o.optimizer === "adamw" || o.optimizer === "sgd") n.optimizer = o.optimizer;
  for (const k of ["lr", "weight_decay", "batch", "steps", "clip",
                   "save_every", "eval_every", "temperature", "max_tokens", "n_samples"]) {
    const v = Number(o[k]);
    if (o[k] != null && isFinite(v)) n[k] = v;
  }
  if (typeof o.task_id === "string" && o.task_id) n.task_id = o.task_id;
}
function bxJSONNode(n) {
  const o = { id: n.id, kind: n.kind, name: n.name, x: Math.round(n.x), y: Math.round(n.y) };
  if (n.kind === "embed") {
    o.vocab = n.vocab == null ? null : n.vocab;
    o.din = n.din == null ? null : n.din;
    o.dout = n.dout == null ? null : n.dout;
    if (n.embed_scale != null) o.embed_scale = n.embed_scale;
  }
  else if (n.kind === "input") {
    o.dout = n.dout == null ? null : n.dout;
    const imode = bxInputMode(n);              // the data type: matrix is the plain one
    if (imode !== "matrix") o.input_mode = imode;
    if (n.values) o.values = n.values;
    if (n.text) o.text = n.text;
    if (n.image) o.image = n.image;
    if (imode === "dataset") {                 // the sheet rides the input too
      if (n.file) o.file = n.file;
      if (n.format) o.format = n.format;
    }
    for (const k of ["image_size", "patch_size", "image_mean", "image_std"])
      if (n[k] != null) o[k] = n[k];
    if (n.box) o.box = { w: Math.round(n.box.w || 420), h: Math.round(n.box.h || 280) };
    if (n.panel) o.panel = n.panel;      // {expand} — the editor's size
  }
  else if (n.kind === "output") { o.din = n.din == null ? null : n.din;
                                  if (n.box) o.box = { w: Math.round(n.box.w || 420), h: Math.round(n.box.h || 280) };
                                  if (n.panel) o.panel = n.panel;
                                  if (n.train) o.train = true;
                                  bxTrainDoc(o, n); }
  else if (n.kind === "heatmap") { o.din = n.din == null ? null : n.din;
                                   if (n.box) o.box = { w: Math.round(n.box.w || 360),
                                                        h: Math.round(n.box.h || 320) }; }
  else if (n.kind === "layer") { o.din = n.din == null ? null : n.din;
                                 o.dout = n.dout == null ? null : n.dout; }
  else if (n.kind === "conv") {
    o.din = n.din == null ? null : n.din;
    o.dout = n.dout == null ? null : n.dout;
    for (const k of ["k", "stride", "pad", "groups"])
      if (n[k] != null) o[k] = n[k];
  }
  else if (n.kind === "act") {
    o.act = n.act || "silu";
    if (n.gain != null) o.gain = n.gain;     // e.g. the attention scores' 1/sqrt(d)
    if (n.causal) o.causal = true;           // …and their future mask
  }
  else if (n.kind === "op") {
    o.op = bxOpName(n);
    if (n.dims) o.dims = n.dims;
    if (n.axes) o.axes = n.axes;
    if (n.repeats != null) o.repeats = n.repeats;
    if (n.dim != null) o.dim = n.dim;
    if (n.factor != null) o.factor = n.factor;
    if (n.theta != null) o.theta = n.theta;
    if (n.width != null) o.width = n.width;
    if (n.mode) o.mode = n.mode;
    if (n.window != null) o.window = n.window;
    if (n.axis != null) o.axis = n.axis;
    if (n.index != null) o.index = n.index;
    if (n.start != null) o.start = n.start;
    if (n.stop != null) o.stop = n.stop;
    if (n.din != null) o.din = n.din;
    if (n.dout != null) o.dout = n.dout;
    for (const k of BX_OP_EXTRAS) if (n[k] != null) o[k] = n[k];
  }
  else if (n.kind === "norm") {
    o.norm = n.norm === "layer" ? "layer" : n.norm === "group" ? "group" : "rms";
    if (n.eps != null) o.eps = n.eps;
    if (n.zc) o.zc = true;
    if (n.size != null) o.size = n.size;
    if (n.groups != null) o.groups = n.groups;
  }
  else if (n.kind === "script") {
    o.script = n.script || "";               // the code travels with the design
  }
  else if (n.kind === "tokenize") {
    o.vocab = n.vocab || "";
    if (n.repo) {
      o.repo = n.repo;
      if (n.tokens != null) o.tokens = n.tokens;
    }
    if (n.text) o.text = n.text;
  }
  else if (n.kind === "detokenize") {
    o.vocab = n.vocab || "";
    if (n.repo) {
      o.repo = n.repo;
      if (n.tokens != null) o.tokens = n.tokens;
    }
  }
  else if (n.kind === "hf") {
    o.repo = n.repo || "";
    if (n.text) o.text = n.text;
    if (n.temperature != null) o.temperature = n.temperature;
  }
  else if (n.kind === "sample") {
    if (n.temperature != null) o.temperature = n.temperature;
    if (n.sample_seed != null) o.sample_seed = n.sample_seed;
  }
  else if (n.kind === "agent") {
    if (n.task_id) o.task_id = n.task_id;
    if (n.box) o.box = { w: Math.round(n.box.w || 480), h: Math.round(n.box.h || 320) };
    if (n.panel) o.panel = n.panel;      // {lines, autoscroll, debug, expand}
    if (n.collapsed) o.collapsed = true;
  }
  else if (n.kind === "train" || n.kind === "config" || n.kind === "training") {
    bxTrainDoc(o, n);                    // a hub carries the same fields, old or new
    const d = n.kind === "config" ? { w: 360, h: 240 }
            : n.kind === "training" ? { w: 340, h: 300 } : { w: 480, h: 320 };
    if (n.box) o.box = { w: Math.round(n.box.w || d.w), h: Math.round(n.box.h || d.h) };
    if (n.kind === "train") {
      if (n.panel) o.panel = n.panel;    // {expand} — the display's size
      if (n.collapsed) o.collapsed = true;
      if (n.hidden) o.hidden = true;     // the Run button toggles the box's appearance
    }
  }
  else if (n.kind === "select") {
    if (n.dataset) o.dataset = n.dataset;
    if (n.cols) o.cols = n.cols;
    if (n.box) o.box = { w: Math.round(n.box.w || 360), h: Math.round(n.box.h || 240) };
  }
  else if (n.kind === "dataset") {
    if (n.text) o.text = n.text;
    if (n.file) o.file = n.file;
    if (n.repo) o.repo = n.repo;
    if (n.vocab) o.vocab = n.vocab;
    if (n.rows != null) o.rows = n.rows;
    if (n.format) o.format = n.format;       // csv | tsv | jsonl
    if (n.colw && n.colw.length)             // the column widths, as drawn
      o.colw = n.colw.map(x => Math.round(Number(x) || 0));
    if (n.colt && n.colt.length)             // per-column type overrides
      o.colt = n.colt.map(x => String(x || ""));
    if (n.box) o.box = { w: Math.round(n.box.w || 440), h: Math.round(n.box.h || 300) };
    if (n.panel) o.panel = n.panel;      // {expand} — small sheet or big one
    if (n.collapsed) o.collapsed = true;
  }
  else if (n.kind === "reward") {
    if (n.reward) o.reward = n.reward;      // python | exact | regex | length
    if (n.expr) o.expr = n.expr;
    if (n.pattern) o.pattern = n.pattern;
    if (n.match) o.match = n.match;
    if (n.limit != null) o.limit = n.limit;
  }
  else if (n.kind === "loss") {
    if (n.loss) o.loss = n.loss;
  }
  else if (n.kind === "custom") {
    o.inner = bxJSONDoc((n.inner && n.inner.nodes) || [], (n.inner && n.inner.edges) || [], "nested");
    if (n.repo) o.repo = n.repo;         // the HF repo that filled it, if any
    if (n.model) o.model = true;         // the architecture's own box
    if (n.box) o.box = { w: Math.round(n.box.w || 380), h: Math.round(n.box.h || 220) };
  }
  else if (n.kind === "vision") {        // the mmproj tower: its file + geometry
    o.din = n.din == null ? null : n.din;
    o.dout = n.dout == null ? null : n.dout;
    o.projector = n.projector || "";
    for (const k of ["d_model", "heads", "blocks", "patch", "merge",
                     "image_size", "proj_dim"])
      if (n[k] != null) o[k] = n[k];
    if (n.eps != null) o.eps = n.eps;
    if (n.image_mean != null) o.image_mean = n.image_mean;
    if (n.image_std != null) o.image_std = n.image_std;
  }
  if (n.t) o.t = n.t;
  if (n.file) o.file = n.file;
  if (n.shared) o.shared = true;
  if (n.off) o.off = true;
  if (n.frozen) o.frozen = true;
  if (n.dtype) o.dtype = n.dtype;
  if (n.place === "gpu" || n.place === "system") o.place = n.place;
  if (n.params != null) o.params = n.params;
  if (n.wbytes != null) o.wbytes = n.wbytes;
  return o;
}
function bxJSONEdge(e) {
  const o = { from: e.from, to: e.to, fromPort: e.fromPort || 0, toPort: e.toPort || 0 };
  if (e.via) o.via = { x: Math.round(e.via.x), y: Math.round(e.via.y) };
  return o;
}
function bxJSONDoc(nodes, edges, type, name, weights) {
  const o = { type, version: BX_JSON_VERSION };
  if (name) o.name = name;
  if (weights) o.weights = weights;          // the file's namespace registry
  o.nodes = (nodes || []).map(bxJSONNode);
  o.edges = (edges || []).map(bxJSONEdge);
  return o;
}
function bxExportCanvas() {                     // top level only — that is the whole canvas
  if (BX.up) return null;                       // inside a nested box there is no canvas here
  const d = bxAllDocs()[0];
  const o = bxJSONDoc(d.nodes, d.edges, "canvas", null, BX.weights);
  if (BX.model) o.model = BX.model;
  return o;
}
function bxExportNested(id) {                   // one nested box, name and all
  const n = typeof id === "string" ? bxNode(id) : id;
  if (!n || n.kind !== "custom") return null;
  return bxJSONDoc((n.inner && n.inner.nodes) || [], (n.inner && n.inner.edges) || [],
                   "nested", n.name);
}

