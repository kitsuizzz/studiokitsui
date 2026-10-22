// ─── nnstudio shell · 35 · validation and estimate ─────────────────────────────────────
// the error/warn sets, the dataflow audit, the VRAM estimate, and moving boxes into a model.
// Order is load-bearing: this slice is concatenated after the one before it.

function bxDocBad(nodes, edges) {
  const bad = new Set();
  if (bxLevelOff()) return bad;                  // everything here is off
  const view = bxRunDoc(nodes, edges);           // the run's boxes: the rest is discarded
  nodes = view.nodes;
  edges = view.edges;
  const has = (id) => nodes.some(n => n.id === id);
  const ins = new Map(), outs = new Map();
  for (const n of nodes) { ins.set(n.id, new Set()); outs.set(n.id, new Set()); }
  for (const e of edges) {
    if (!has(e.from) || !has(e.to)) continue;
    outs.get(e.from).add(e.fromPort || 0);
    ins.get(e.to).add(e.toPort || 0);
    if (bxWireState(e) === "bad") { bad.add(e.from); bad.add(e.to); }
  }
  for (const n of nodes) {
    if (bxOffHere(n)) continue;                  // off: neither dots nor inside matter
    const nIn = bxPortDefs(n, "in").length, nOut = bxPortDefs(n, "out").length;
    const wi = ins.get(n.id), wo = outs.get(n.id);
    // a tokenizer's in-dot is optional: text may come from its own definition
    if (n.kind !== "tokenize" && n.kind !== "hf") {
      const port = bxPortDefs(n, "in");         // and a dot marked optional may stay bare
      for (let i = 0; i < nIn; i++)
        if (!wi.has(i) && !(port[i] && port[i].opt)) bad.add(n.id);
    }
    // a de-tokenizer's out-dot (the text) may stay unwired: it still shows its state
    if (nOut && !wo.size && n.kind !== "detokenize" && n.kind !== "hf")
      bad.add(n.id);                                               // a dead-end box
    if (!nIn && !nOut && !wi.size && !wo.size &&
        n.kind !== "agent" && n.kind !== "train" && n.kind !== "reward")
      bad.add(n.id);                           // nothing at all — but a display box
                                               // (the Run box, an agent, a reward)
                                               // takes no wires and is not an error
    if (n.kind === "custom" && bxErrorSet(n.inner || { nodes: [], edges: [] }).size)
      bad.add(n.id);                                               // an error inside, deep or near
  }
  return bad;
}
function bxErrorSet(doc) {                     // ids, with this level's edges in view
  const save = { nodes: BX.nodes, edges: BX.edges };
  try {
    if (doc) { BX.nodes = doc.nodes || []; BX.edges = doc.edges || []; }
    return bxDocBad(BX.nodes, BX.edges);       // no doc: the level we are looking at
  } finally {
    BX.nodes = save.nodes;
    BX.edges = save.edges;
  }
}
let bxWarnBoxes = new Set();
function bxDocWarn(nodes, edges) {
  const warn = new Set();
  if (bxLevelOff()) return warn;                 // everything here is off anyway
  const view = bxRunDoc(nodes, edges);           // warnings only where the run goes
  nodes = view.nodes;
  edges = view.edges;
  const find = (id) => nodes.find(n => n.id === id) || null;
  for (const e of edges) {
    const a = find(e.from), b = find(e.to);
    const dead = a && (bxOffHere(a) || bxPortOff(a, "out", e.fromPort));
    if (a && b && dead && !bxOffHere(b)) warn.add(b.id);   // a dead output into a live box
  }
  for (const n of nodes) {
    if (bxOffHere(n) || n.kind !== "custom") continue;
    if (bxWarnSet(n.inner || { nodes: [], edges: [] }).size) warn.add(n.id);
  }
  return warn;
}
function bxWarnSet(doc) {                        // ids, with this level's edges in view
  const save = { nodes: BX.nodes, edges: BX.edges };
  try {
    if (doc) { BX.nodes = doc.nodes || []; BX.edges = doc.edges || []; }
    return bxDocWarn(BX.nodes, BX.edges);        // no doc: the level we are looking at
  } finally {
    BX.nodes = save.nodes;
    BX.edges = save.edges;
  }
}
// ---------------------------------------------------------------- the estimate
// Sums every weight in the graph: FCs from in × out, norms from the size that
// flows through them, scales as one weight, and — for boxes that came from a
// GGUF — the exact element count and byte size of the tensor(s) they bound.
// Nested boxes add up their whole inside. Then dtype turns params into bytes,
// and the model settings turn that into an inference / training figure.
function bxEstimate() {
  const out = { params: 0, weights: 0, unknown: 0, byDtype: {},
                byDtypeParams: {}, byDtypeFrozen: {},
                frozenParams: 0, frozenWeights: 0, frozenBoxes: 0, offParams: 0, offBoxes: 0 };
  const all = (BX.model && bxDtypeName(BX.model.allDtype, null)) || null;
  const save = { nodes: BX.nodes, edges: BX.edges };
  const visit = (doc, frozenUp, offUp) => {
    BX.nodes = (doc && doc.nodes) || [];
    BX.edges = (doc && doc.edges) || [];
    for (const n of BX.nodes) {
      const off = offUp || bxOffHere(n), froz = frozenUp || !!n.frozen;
      if (off && !offUp) out.offBoxes++;                // the box the user switched off
      if (froz && !frozenUp) out.frozenBoxes++;         // ...and the one they froze
      if (n.kind === "custom") {
        visit(n.inner || { nodes: [], edges: [] }, froz, off);
        continue;
      }
      if (n.kind === "input" || n.kind === "output") continue;
      let params = null, dtype = null;
      if (n.params != null) {
        params = n.params;                          // exact: what the file holds
        dtype = n.dtype || "mixed";
      } else if (n.kind === "embed") {
        if (n.vocab != null && n.dout != null) params = n.vocab * n.dout;
        dtype = n.dtype || "f16";
      } else if (n.kind === "layer") {
        if (n.din != null && n.dout != null) params = n.din * n.dout;
        dtype = n.dtype || "f16";
      } else if (n.kind === "conv") {
        const kk = Math.max(1, Number(n.k) || 3);
        const g = Math.max(1, Number(n.groups) || 1);
        if (n.din != null && n.dout != null)
          params = Math.floor(n.din / g) * n.dout * kk * kk;
        dtype = n.dtype || "f16";
      } else if (n.kind === "norm") {
        const s = bxActSize(n);
        if (s != null) params = s;                  // a norm weighs one number per channel
        dtype = n.dtype || "f32";
      } else {
        if (n.params != null) params = n.params;         // a bound group from a GGUF
        else if (n.kind === "act") params = 0;           // an activation holds no weights
        else if (bxOpName(n) === "scale" && n.t) params = 1;
        else if (!n.t) params = 0;                       // a plain operation holds none either
        dtype = n.dtype || "f32";                        // a bound op without a size stays unknown
      }
      if (params == null) { if (!off) out.unknown++; continue; }
      if (all) dtype = all;                        // "estimate everything as ..."
      const bytes = (all || n.wbytes == null) ? params * bxBytes(dtype) : n.wbytes;
      if (off) { out.offParams += params; continue; }   // deactivated: not in the model
      const dt = dtype || "f16";                        // every box, at its own dtype
      out.params += params;
      out.weights += bytes;
      out.byDtype[dt] = (out.byDtype[dt] || 0) + bytes;
      out.byDtypeParams[dt] = (out.byDtypeParams[dt] || 0) + params;
      if (froz) {
        out.frozenParams += params;
        out.frozenWeights += bytes;
        out.byDtypeFrozen[dt] = (out.byDtypeFrozen[dt] || 0) + params;
      }
    }
  };
  try { visit({ nodes: save.nodes, edges: save.edges }, bxLevelFrozen(), bxLevelOff()); }
  finally { BX.nodes = save.nodes; BX.edges = save.edges; }
  return out;
}
function bxEstimateRuns(est) {
  const m = BX.model || {};
  const ctx = m.ctx != null ? m.ctx : null;
  const batch = m.batch != null ? m.batch : 1;
  // only attention layers cache K/V (a hybrid model's state-space layers do
  // not), and a real run uses a real context, not the model's maximum
  const kvLayers = (m.attn_layers != null ? m.attn_layers : m.layers) || null;
  const kvCtx = m.kv_ctx != null ? m.kv_ctx : (ctx != null ? Math.min(ctx, 8192) : null);
  const kvPer = 2 * (m.kv_heads || 0) * (m.head_dim || 0) * 2;       // K + V, f16
  let kv = null, kvAtMax = null;
  if (kvLayers && m.kv_heads && m.head_dim && kvCtx)
    kv = kvPer * kvLayers * kvCtx * batch;
  if (kv != null && ctx != null && ctx > kvCtx)
    kvAtMax = kvPer * kvLayers * ctx * batch;                        // what the ceiling costs
  const opt = m.opt || "adamw";
  const params = est ? est.params : 0;
  const frozen = est && est.frozenParams ? est.frozenParams : 0;
  const trainable = Math.max(0, params - frozen);   // frozen weights never get gradients
  const training = opt !== "none" || m.master;      // is anything trained at all?
  const mom = opt === "adamw" ? 8 : (opt === "sgd" ? 4 : 0);   // fp32 optimizer state
  const byP = (est && est.byDtypeParams) || {}, byF = (est && est.byDtypeFrozen) || {};
  const masterOf = (bag) => {                       // f32 copies only where needed
    let b = 0;
    if (m.master) for (const d in bag) b += bag[d] * (d === "f32" ? 0 : 4);
    return b;
  };
  const grads = trainable * 4;
  const moments = trainable * mom;
  const trainableBag = {};                          // master copies follow the *trainable* part
  for (const d in byP) trainableBag[d] = (byP[d] || 0) - (byF[d] || 0);
  const masterBytes = masterOf(trainableBag);
  let train = null;
  if (training) train = grads + moments + masterBytes;
  let frozenTrain = 0;
  if (training) frozenTrain = frozen * (4 + mom) + masterOf(byF);   // the bill freezing spares
  const quantized = est && est.weights > 0 &&
    Object.keys(est.byDtype).some(d => ["f32", "f16", "bf16"].indexOf(d) < 0 &&
                                       est.byDtype[d] > est.weights * 0.5);
  return { kv, kvAtMax, kvCtx, kvLayers, ctx, batch, opt, master: !!m.master,
           train, grads, moments, masterBytes, frozenTrain,
           quantized: !!quantized, frozen: frozen, trainable: trainable };
}
function bxRenderEstimate() {
  const el = $("bxvram");
  if (!el) return;
  const est = bxEstimate();
  const run = bxEstimateRuns(est);
  const mix = Object.keys(est.byDtype).sort((a, b) => est.byDtype[b] - est.byDtype[a]).slice(0, 3);
  el.innerHTML = "";
  const head = mk("div", { class: "vhead" });
  head.appendChild(mk("span", { text: "VRAM estimate" }));
  const gear = mk("span", { class: "chip tiny", text: "settings" });
  gear.addEventListener("click", bxEstimateForm);
  head.appendChild(gear);
  el.appendChild(head);
  const row = (label, value, cls, sub) => {
    el.appendChild(mk("div", { class: "vrow" + (cls ? " " + cls : ""),
      text: (label ? label.padEnd(9, " ") + " " : "") + value }));
    if (sub) el.appendChild(mk("div", { class: "vrow sub", text: sub }));
  };
  const bar = (parts) => {
    const total = parts.reduce((a, p) => a + Math.max(0, p.bytes), 0);
    if (total <= 0) return;
    const b = mk("div", { class: "vbar" });
    for (const p of parts) {
      if (p.bytes <= 0) continue;
      const seg = mk("span", { class: p.cls });
      seg.style.width = (100 * p.bytes / total).toFixed(2) + "%";
      seg.setAttribute("title", p.title);
      b.appendChild(seg);
    }
    el.appendChild(b);
  };
  // what the card is holding right now, straight from the backend — so a load
  // onto vram moves this number, not just the estimate below
  const runner = bxLocalRunner() || null;
  const live = (runner && runner.usage) || {};
  if (live.vram_used_gb != null)
    row("vram now", live.vram_used_gb.toFixed(1) + " / " +
        (live.vram_total_gb != null ? live.vram_total_gb.toFixed(1) : "?") + " GB" +
        (live.vram_pct != null ? " \u00b7 " + live.vram_pct + "%" : ""), "now",
        BXRUN.loaded ? "the backend is holding the loaded design" : null);
  else if (runner)
    row("vram now", "\u2014", "now", "waiting for the runner's first reading");
  const kv = run.kv || 0, train = run.train || 0;
  el.appendChild(mk("div", { class: "vrow lead", text: bxBig(est.params) + " params" }));
  const dts = Object.keys(est.byDtype).sort((a, b) => est.byDtype[b] - est.byDtype[a]);
  if (dts.length > 1)
    for (const d of dts)                             // the whole dtype breakdown
      row(d, bxBig(est.byDtypeParams[d] || 0) + " params \u00b7 " + bxGB(est.byDtype[d]), "w");
  row("weights", bxGB(est.weights), "w");
  if (est.frozenParams)
    row("frozen", bxBig(est.frozenParams) + " params \u00b7 " + bxGB(est.frozenWeights), "frz",
        "kept in the weights \u00b7 " + bxGB(run.frozenTrain) + " of training skipped");
  if (run.kv != null) {
    row("inference", "+" + bxGB(kv), "kv",
        "KV cache \u00b7 " + bxBig(run.kvCtx) + " ctx \u00b7 b" + run.batch + " \u00b7 " +
        run.kvLayers + " attention layer" + (run.kvLayers === 1 ? "" : "s"));
    if (run.kvAtMax)
      el.appendChild(mk("div", { class: "vrow sub", text:
        "the model allows " + bxBig(run.ctx) + " ctx \u2248 " + bxGB(run.kvAtMax) + " of KV" }));
    row("total", bxGB(est.weights + kv) + " to run", "tot");
    bar([{ bytes: est.weights, cls: "w", title: "weights " + bxGB(est.weights) },
         { bytes: kv, cls: "kv", title: "KV cache " + bxGB(kv) }]);
  }
  if (run.train != null) {
    if (run.train === 0 && run.frozen)
      row("training", "nothing trainable \u2014 every weight is frozen", "tr");
    else
      row("training", "+" + bxGB(train), "tr",
          (run.opt === "none" ? "master only" : run.opt.toUpperCase() + (run.master ? " +master" : "")) +
          " \u00b7 " + bxBig(run.trainable) + " trainable" + (est.frozenParams ? " (frozen excluded)" : ""));
    if (run.train > 0) {
      const parts = ["gradients " + bxGB(run.grads)];
      if (run.moments) parts.push((run.opt === "adamw" ? "AdamW" : "SGD") + " " + bxGB(run.moments));
      if (run.masterBytes) parts.push("master " + bxGB(run.masterBytes));
      else if (run.master) parts.push("no master copy \u2014 already f32");
      el.appendChild(mk("div", { class: "vrow sub", text: parts.join(" \u00b7 ") }));
    }
    row("total", bxGB(est.weights + kv + train) + " to train", "tot");
    bar([{ bytes: est.weights, cls: "w", title: "weights " + bxGB(est.weights) },
         { bytes: kv, cls: "kv", title: "KV cache " + bxGB(kv) },
         { bytes: train, cls: "tr", title: "gradients + optimizer " + bxGB(train) }]);
  }
  if (est.offParams || est.offBoxes)
    row("off", est.offBoxes + " box(es) \u00b7 " + bxBig(est.offParams) + " params not counted", "note");
  if (est.unknown)
    row("unset", est.unknown + " box(es) without a size yet", "warn");
  if (run.train != null && run.train > 0 && run.quantized)
    row("", "quantized weights do not train as-is \u2014 f16/bf16 or LoRA", "warn");
}
// the knobs: context, batch, and the shapes the KV cache needs, plus how it is trained
function bxEstimateForm() {
  const m = $("bxmenu");
  if (!m) return;
  m.hidden = false;
  m.innerHTML = "";
  const wrap = mk("div", { class: "bf" });
  const model = BX.model = BX.model || {};
  const numF = (label, value) => {
    const lab = mk("label", { text: label });
    const inp = mk("input", { type: "number", placeholder: "?", value: value == null ? "" : String(value) });
    lab.appendChild(inp);
    wrap.appendChild(lab);
    return inp;
  };
  const selF = (label, list, value, dtypeGroups) => {
    const lab = mk("label", { text: label });
    const sel = mk("select", { class: "bxsel" });
    if (dtypeGroups) {                            // as set, torch, gguf
      sel.appendChild(mk("option", { value: "as set", text: "as set" }));
      for (const [group, dts] of BX_DTYPE_GROUPS) {
        const og = mk("optgroup", { label: group });
        const native = group === "gguf" ? bxNativeKernels() : [];
        for (const [d] of dts) og.appendChild(mk("option", { value: d,
          text: native.includes(d) ? d + " \u00b7 native" : d }));
        sel.appendChild(og);
      }
      sel.value = BX_DTYPES[value] != null ? value : "as set";
    } else {
      for (const v of list) sel.appendChild(mk("option", { value: v, text: v }));
      sel.value = list.indexOf(value) >= 0 ? value : list[0];
    }
    lab.appendChild(sel);
    wrap.appendChild(lab);
    return sel;
  };
  const runCtx = model.kv_ctx != null ? model.kv_ctx
               : (model.ctx != null ? Math.min(model.ctx, 8192) : 8192);
  const fCtx = numF("context" + (model.ctx != null ? " (max " + bxBig(model.ctx) + ")" : ""), runCtx);
  const fBatch = numF("batch", model.batch != null ? model.batch : 1);
  const fLayers = numF("layers", model.layers);
  const fKv = numF("kv heads", model.kv_heads);
  const fHd = numF("head dim", model.head_dim);
  const fAll = selF("estimate all as", null, model.allDtype || "as set", true);
  const fOpt = selF("optimizer", ["none", "sgd", "adamw"], model.opt || "adamw");
  const fMaster = selF("fp32 master", ["no", "yes"], model.master ? "yes" : "no");
  const row = mk("div", { class: "row" });
  const cancel = mk("span", { class: "chip tiny", text: "cancel" });
  cancel.addEventListener("click", bxMenuClose);
  const go = mk("span", { class: "chip tiny", text: "save" });
  go.addEventListener("click", () => {
    const val = (inp) => {
      const v = Number(inp.value);
      return inp.value !== "" && isFinite(v) && v > 0 ? Math.round(v) : null;
    };
    model.kv_ctx = val(fCtx) || null;     // blank: the sane default (min(max, 8k))
    model.batch = val(fBatch) || 1;
    model.layers = val(fLayers);
    model.kv_heads = val(fKv);
    model.head_dim = val(fHd);
    model.allDtype = fAll.value === "as set" ? null : fAll.value;
    model.opt = fOpt.value;
    model.master = fMaster.value === "yes";
    bxMenuClose();
    bxRenderEstimate();
    bxCommit();
  });
  row.appendChild(cancel);
  row.appendChild(go);
  wrap.appendChild(row);
  m.appendChild(wrap);
  bxMenuPlace();
}

