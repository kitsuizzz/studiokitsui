// ─── nnstudio shell · 135 · models and weights ─────────────────────────────────────
// model binding, GGUF import, tensor/weight forms, and bxForm (the add/resize form).
// Order is load-bearing: this slice is concatenated after the one before it.

function bxInnerBinds(n) {                     // does its inside read tensors?
  const some = (doc) => ((doc && doc.nodes) || []).some(x =>
    (x.t && x.kind !== "custom") || (x.kind === "custom" && some(x.inner)));
  return some(n && n.inner);
}

function bxMissingFiles(n, inherited) {        // tensors with no file in reach
  const file0 = n && n.file ? n.file : inherited;
  let miss = 0;
  for (const x of ((n && n.inner && n.inner.nodes) || [])) {
    const file = x.file || file0;
    if (x.kind === "custom") miss += bxMissingFiles(x, file);
    else if (x.t && !file) miss++;
  }
  return miss;
}

function bxModelNeeded(n) {                    // a tensor box with no file in reach
  return !!(n && n.kind === "custom" && !n.file && bxMissingFiles(n, null) > 0);
}

function bxUnboundModels(nodes, inherited) {   // the top boxes that need one
  const out = [];
  for (const n of nodes || []) {
    const file = n.file || inherited;
    if (n.kind !== "custom") continue;
    if (!n.file && bxMissingFiles(n, file) > 0) {
      out.push(n);                             // binding it covers its inside
      continue;
    }
    out.push(...bxUnboundModels(n.inner && n.inner.nodes, file));
  }
  return out;
}

function bxModelMatch(box, models) {           // the one file whose name fits
  const want = String((box && box.name) || "").trim().toLowerCase();
  if (!want) return null;
  const hits = (models || []).filter(m => m.kind === "gguf" &&
    (String(m.name || "").toLowerCase().startsWith(want) ||
     String(m.path || "").toLowerCase().split("/").pop().startsWith(want)));
  return hits.length === 1 ? hits[0] : null;
}

function bxBindModels(nodes, models, inherited) {
  const bound = [], missing = [];
  const walk = (list, parentFile) => {
    for (const n of list || []) {
      const file = n.file || parentFile;
      if (n.kind === "custom") {
        if (!file && bxModelNeeded(n)) {
          const hit = bxModelMatch(n, models);
          if (hit) { n.file = bxClip(hit.path, 300); bound.push(n); }
          else missing.push(n);
        }
        walk(n.inner && n.inner.nodes, n.file || file);
      }
    }
  };
  walk(nodes, inherited || null);
  return { bound, missing };
}

function bxRunFix() {                          // true: the run must wait
  const run = bxRunSet(BX.nodes, BX.edges);    // only the run's boxes need a file
  const need = bxUnboundModels(BX.nodes, null).filter(n => run.has(n.id));
  if (!need.length) return false;
  if (bxModels) {
    const r = bxBindModels(need, bxModels, null);
    if (r.bound.length) {
      bxCommit();                              // one undo step, the run goes on
      bxRender();
    }
    if (r.missing.length) {
      bxtRunMsg("\u201c" + r.missing.map(n => n.name || "model").join(", ")
                + "\u201d has no model file bound \u2014 bring the model in again "
                + "(Import \u25be \u2192 GGUF model \u2026)");
      return true;
    }
    return false;
  }
  if (typeof fetch === "function" && !bxRunFixing) {
    bxRunFixing = true;
    BXRUN.msg = "checking the model files\u2026";
    bxtRunSync();
    fetch("/api/models").then(r => r.json()).then(d => {
      bxModels = (d && d.models) || [];
      bxRunFixing = false;
      bxtRunGo();
    }).catch(() => {
      bxRunFixing = false;
      bxtRunMsg("could not read the model list from the app");
    });
    return true;
  }
  bxtRunMsg("a model box has no file bound \u2014 bring the model in again "
            + "(Import \u25be \u2192 GGUF model \u2026)");
  return true;
}
// Import → GGUF model: one pop-up, up front in the middle, one file in it.
// Only local .gguf models are offered — a single text model, no mmproj, no
// repo. Nothing lands before the file is chosen: the model is structured into
// a fresh nested box at the middle of the view, as one undo step.
function bxGGUFImportApply(canvas, file, repo, asModel) {  // a served structure -> one nested box
  const nodes = (canvas && canvas.nodes) || [];
  if (!nodes.length) return null;
  const src = nodes.find(n => n.kind === "custom" && n.inner);
  let inner, name = (canvas && canvas.name) || "";
  if (src) {                                   // a model: the box it came in holds
    inner = JSON.parse(JSON.stringify(src.inner));        // the whole structure
    name = src.name || name;
  } else {                                     // an encoder: the tower and its ports
    inner = { type: "nested", version: 1,      // are the structure
              nodes: JSON.parse(JSON.stringify(nodes)),
              edges: JSON.parse(JSON.stringify((canvas && canvas.edges) || [])) };
  }
  const c = bxHost();
  const r = (c && c.getBoundingClientRect) ? c.getBoundingClientRect()
                                           : { left: 0, top: 0, width: 600, height: 400 };
  const p = bxPoint({ clientX: (r.left || 0) + (r.width || 600) / 2,
                      clientY: (r.top || 0) + (r.height || 400) / 2 });
  bxUndoLock++;                                // the box and its inside: one undo step
  const made = bxAdd("custom", p.x, p.y, name ? { name: name } : {});
  if (!made) { bxUndoLock--; return null; }
  if (asModel) made.model = true;              // the agent's engineering box
  if (canvas.weights) BX.weights = canvas.weights;       // its tensor registry
  if (canvas.model) BX.model = Object.assign({}, BX.model, canvas.model);
  made.inner = inner;
  if (file) made.file = bxClip(String(file), 300);       // where its tensors read from
  if (repo) made.repo = bxClip(String(repo), 300);       // the repo the agent studied
  bxSelectBoxes([made.id]);
  bxSettleSizes();
  bxRender();
  bxRenderPalette();
  bxUndoLock--;
  bxCommit();
  return made;
}
function bxGGUFImport() {
  const m = $("bxmenu");
  if (!m) return false;
  m.innerHTML = "";
  const wrap = mk("div", { class: "bf bximp" });
  wrap.appendChild(mk("div", { class: "mhead", text: "load a GGUF model" }));
  const lab = mk("label", { text: "file" });
  const sel = mk("select", { class: "bxsel" });
  lab.appendChild(sel);
  wrap.appendChild(lab);
  wrap.appendChild(mk("div", { class: "panehint",
    text: "the file lands as one nested box with its structure inside" }));
  const note = mk("div", { class: "panehint", text: "reading the model list\u2026" });
  wrap.appendChild(note);
  const row = mk("div", { class: "row" });
  const cancel = mk("span", { class: "chip tiny", text: "cancel" });
  cancel.addEventListener("click", bxMenuClose);
  const go = mk("span", { class: "chip tiny", text: "load" });
  row.appendChild(cancel);
  row.appendChild(go);
  wrap.appendChild(row);
  m.appendChild(wrap);
  m.hidden = false;
  const place = () => {                        // up front, in the middle of the canvas
    const w = $("bxwrap");
    const r = (w && w.getBoundingClientRect) ? w.getBoundingClientRect()
                                             : { width: 900, height: 500 };
    bxMenuAt_(Math.max(6, ((r.width || 900) - (m.offsetWidth || 340)) / 2),
              Math.max(6, ((r.height || 500) - (m.offsetHeight || 170)) / 2));
    bxMenuPlace();
  };
  const apply = () => {                        // the one file chosen
    const path = String(sel.value || "");
    if (!path) { note.textContent = "there is no GGUF file to load"; place(); return; }
    if (typeof fetch !== "function") {
      note.textContent = "the app cannot reach the server";
      return;
    }
    go.textContent = "loading \u2026";
    note.textContent = "reading " + path.split("/").pop() + " \u2026";
    place();
    fetch("/api/gguf/canvas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: path }),   // one file, nothing else
    }).then(r => r.json().then(d => {
      if (!r.ok || !d.canvas) throw new Error(d.error || "the model could not be read");
      if (!bxGGUFImportApply(d.canvas, path))
        throw new Error("the file's structure could not land here");
      bxMarkAudit(d.canvas.model && d.canvas.model.audit);
      bxMenuClose();
    })).catch(e => {
      note.textContent = String((e && e.message) || e);
      go.textContent = "load";
      place();
    });
  };
  go.addEventListener("click", apply);
  if (typeof fetch === "function") {
    fetch("/api/models").then(r => r.json()).then(d => {
      bxModels = (d && d.models) || [];
      const ggufs = (bxModels || []).filter(x => x.kind === "gguf" || x.kind === "mmproj");
      sel.innerHTML = "";
      for (const g of ggufs)                    // a model and a vision encoder alike:
        sel.appendChild(mk("option", { value: g.path,          // each is a structure
                                       text: g.name + (g.kind === "mmproj"
                                                       ? " \u2014 vision encoder" : "") }));
      note.textContent = ggufs.length
        ? ggufs.length + " local GGUF" + (ggufs.length === 1 ? "" : "s")
        : "no GGUF file on the backend machine";
      place();
    }).catch(() => { note.textContent = "the model list is not available"; place(); });
  } else {
    note.textContent = "the model list is not available";
  }
  place();
  return true;
}
// ---- the model agent: a repo goes in, one Model box comes out ---------------
// The old manual Import menu is retired; this is the one loading door. The
// server studies the repo's config and tensor headers, or refuses by name.
function bxModelLoad() {
  if (BX.up || bxTalkOn()) return false;
  const m = $("bxmenu");
  if (!m) return false;
  m.innerHTML = "";
  const wrap = mk("div", { class: "bf bximp" });
  wrap.appendChild(mk("div", { class: "mhead", text: "load a model with the agent" }));
  wrap.appendChild(mk("div", { class: "panehint",
    text: "paste a Hugging Face repo id or URL, or a local diffusers folder. "
        + "the agent reads its config and tensor headers, proves what it can, "
        + "and lands one Model box." }));
  const field = mk("div", { class: "row" });
  const input = mk("input", { class: "bxbin", type: "text", placeholder: "org/name",
                              autocomplete: "off", spellcheck: "false" });
  field.appendChild(input);
  wrap.appendChild(field);
  const note = mk("div", { class: "panehint",
    text: "it refuses a repo it cannot prove; no blind canvas is created" });
  wrap.appendChild(note);
  const row = mk("div", { class: "row" });
  const cancel = mk("span", { class: "chip tiny", text: "cancel" });
  cancel.addEventListener("click", bxMenuClose);
  const go = mk("span", { class: "chip tiny", text: "study + load" });
  row.appendChild(cancel);
  row.appendChild(go);
  wrap.appendChild(row);
  m.appendChild(wrap);
  m.hidden = false;
  const place = () => {
    const w = $("bxwrap");
    const r = (w && w.getBoundingClientRect) ? w.getBoundingClientRect()
                                             : { width: 900, height: 500 };
    bxMenuAt_(Math.max(6, ((r.width || 900) - (m.offsetWidth || 420)) / 2),
              Math.max(6, ((r.height || 500) - (m.offsetHeight || 190)) / 2));
    bxMenuPlace();
  };
  const apply = () => {
    const repo = String(input.value || "").trim();
    if (!repo) { note.textContent = "paste the repo first"; return; }
    if (typeof fetch !== "function") {
      note.textContent = "the app cannot reach the server";
      return;
    }
    go.textContent = "studying \u2026";
    note.textContent = "reading the config and tensor headers\u2026";
    place();
    fetch("/api/model/study", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repo }),
    }).then(r => r.json().then(d => ({ ok: r.ok, d: d })))
      .then(res => {
        const d = res.d || {};
        if (!res.ok || !d.ok) throw new Error(d.error || "the repo could not be studied");
        const made = bxGGUFImportApply(d.canvas, null, d.source || repo, true);
        if (!made) throw new Error("the study produced no model box");
        if (d.warning) bxTabsSay(d.warning);
        bxMarkAudit(d.canvas.model && d.canvas.model.audit);
        bxMenuClose();
      })
      .catch(e => {
        note.textContent = String((e && e.message) || e);
        go.textContent = "study + load";
        place();
      });
  };
  go.addEventListener("click", apply);
  input.addEventListener("keydown", (ev) => {
    if (ev && ev.key === "Enter") {
      if (ev.preventDefault) ev.preventDefault();
      apply();
    }
  });
  place();
  return true;
}

// ---- external weights: a file's metadata, a tensor, a block ----------------
// The app asks the server what is inside a weight file (/api/weights/meta) —
// gguf, safetensors and pt alike — and shows every tensor with its shape and
// dtype. The block's name is matched against the names so the right one is
// flagged; binding stores {file, t} in the design, and the backend loads those
// weights instead of the random init. The tensor's shape also sizes the block.
function bxWeightScore(boxName, tensorName) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const needle = norm(boxName);
  if (!needle) return 0;
  const cols = norm(tensorName).split(" ").filter(Boolean);
  const tail = cols.length ? cols[cols.length - 1] : "";
  if (tail === "weight") cols.pop();
  let score = 0;
  for (const w of needle.split(" ")) if (w && cols.indexOf(w) >= 0) score++;
  if (norm(tensorName).indexOf(needle) >= 0) score += 2;
  if (score > 0) {                             // of a weight/bias pair, prefer the weight
    if (tail === "weight") score += 0.5;
    else if (tail === "bias") score -= 0.5;
  }
  return score;
}
function bxTensorDims(n, shape) {
  const sh = (shape || []).map(Number).filter(x => !isNaN(x) && x > 0);
  const out = {};
  if (n.kind === "layer" && sh.length >= 2) { out.dout = sh[0]; out.din = sh[sh.length - 1]; }
  else if (n.kind === "embed" && sh.length >= 2) { out.vocab = sh[0]; out.dout = sh[1]; }
  else if ((n.kind === "norm" || n.kind === "op") && sh.length === 1) out.din = sh[0];
  return out;
}
function bxTensorDtype(name) {
  const s = String(name || "").toUpperCase().replace("TORCH.", "");
  const map = { F32: "f32", FLOAT32: "f32", F16: "f16", FLOAT16: "f16",
                BF16: "bf16", BFLOAT16: "bf16", F64: "f64", FLOAT64: "f64",
                F8_E4M3: "f8_e4m3", FLOAT8_E4M3FN: "f8_e4m3",
                F8_E5M2: "f8_e5m2", FLOAT8_E5M2: "f8_e5m2",
                I8: "i8", INT8: "i8", U8: "u8", UINT8: "u8",
                I16: "i16", INT16: "i16", I32: "i32", INT32: "i32",
                I64: "i64", INT64: "i64", BOOL: "bool" };
  return map[s] || null;                       // quantized/other: leave the dtype alone
}
function bxWeightsApply(n, file, tensor) {
  if (!n || !tensor) return false;
  const v = { file: file || "", t: tensor.name };
  const dims = bxTensorDims(n, tensor.shape);
  for (const k of Object.keys(dims)) v[k] = dims[k];
  const dt = bxTensorDtype(tensor.dtype);
  if (dt && BX_DTYPES[dt] != null) v.dtype = dt;
  return bxConfigure(n.id, v);
}
function bxApplyManifest(file, tensors) {      // an export: every box -> its keys
  const by = {};
  for (const t of tensors || []) (by[t.id] = by[t.id] || []).push(t.key);
  let count = 0;
  bxEveryBox(box => {
    if (!bxWeightedBox(box)) return;
    const keys = by[box.id];
    if (keys && keys.length) { box.file = file; box.t = keys.join(","); count++; }
  });
  bxRender();
  bxCommit();
  return count;
}
function bxWeightsForm(boxId) {
  const m = $("bxmenu");
  const n = boxId ? bxNode(boxId) : null;
  if (!m || !n) return;
  m.innerHTML = "";
  const wrap = mk("div", { class: "bf" });
  wrap.appendChild(mk("div", { class: "panehint",
    text: "this block's weights from a file \u2014 gguf, safetensors or pt" }));
  const fileLab = mk("label", { text: "file" });
  const sel = mk("select", { class: "bxsel" });
  sel.appendChild(mk("option", { value: "", text: "the local list \u2026" }));
  fileLab.appendChild(sel);
  wrap.appendChild(fileLab);
  const pathLab = mk("label", { text: "path" });
  const pathIn = mk("input", { type: "text", placeholder: "weights/model.safetensors",
                               value: n.file || "" });
  pathLab.appendChild(pathIn);
  wrap.appendChild(pathLab);
  const note = mk("div", { class: "panehint", text: "reading the file list\u2026" });
  wrap.appendChild(note);
  const list = mk("div", { class: "wlist" });
  wrap.appendChild(list);
  const row = mk("div", { class: "row" });
  const cancel = mk("span", { class: "chip tiny", text: "cancel" });
  cancel.addEventListener("click", bxMenuClose);
  row.appendChild(cancel);
  if (n.file || n.t) {
    const off = mk("span", { class: "chip tiny", text: "unbind" });
    off.addEventListener("click", () => { bxMenuClose(); bxConfigure(n.id, { file: "", t: "" }); });
    row.appendChild(off);
  }
  const goBind = mk("span", { class: "chip tiny", text: "bind" });
  row.appendChild(goBind);
  wrap.appendChild(row);
  m.appendChild(wrap);
  if (m.hidden) bxMenuShow();                  // the add form's chip: same door
  else bxMenuPlace();

  let picked = null;
  const mark = () => {
    for (const it of list.children)
      if (it.classList) it.classList.toggle("on", it._tensor === picked);
  };
  const show = (meta, filePath) => {
    list.innerHTML = "";
    picked = null;
    const tensors = (meta.tensors || []).slice();
    for (const t of tensors) t._score = bxWeightScore(n.name, t.name);
    tensors.sort((a, b) => (b._score - a._score) || (a.name < b.name ? -1 : 1));
    const best = tensors.length && tensors[0]._score > 0 ? tensors[0] : null;
    const bound = String(n.t || "").split(",").map(s => s.trim()).filter(Boolean);
    note.textContent = meta.kind + " \u00b7 " + tensors.length + " tensors \u00b7 "
                       + bxGB(meta.bytes) + (best ? " \u00b7 matches flagged" : "");
    for (const t of tensors) {
      const it = mk("div", { class: "wten" + (t._score > 0 ? " hit" : "") });
      it._tensor = t;
      it.appendChild(mk("div", { class: "wn",
        text: (t._score > 0 ? "\u25cf " : "") + t.name + (t._score > 0 ? "  \u00b7 match" : "") }));
      it.appendChild(mk("div", { class: "wd",
        text: "[" + (t.shape || []).join(" \u00d7 ") + "] \u00b7 " + (t.dtype || "?") }));
      it.addEventListener("click", () => { picked = t; mark(); bxMenuPlace(); });
      list.appendChild(it);
    }
    picked = tensors.find(t => bound.indexOf(t.name) >= 0) || best;
    mark();
    goBind.textContent = picked ? "bind " + bxClip(picked.name, 18) : "bind";
    bxMenuPlace();
  };
  const read = (file) => {
    if (!file || typeof fetch !== "function") return;
    note.textContent = "reading " + String(file).split("/").pop() + " \u2026";
    fetch("/api/weights/meta?file=" + encodeURIComponent(file))
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(res => {
        if (!res.ok || !res.d || !res.d.ok)
          throw new Error((res.d && res.d.error) || "no metadata");
        show(res.d, file);
      })
      .catch(e => {
        list.innerHTML = "";
        note.textContent = String((e && e.message) || e);
        if (wrap.classList) wrap.classList.add("bad");
      });
  };
  goBind.addEventListener("click", () => {
    if (!picked) { note.textContent = "pick a tensor first"; return; }
    bxMenuClose();
    bxWeightsApply(n, pathIn.value.trim(), picked);
  });
  sel.addEventListener("change", () => {
    if (sel.value) { pathIn.value = sel.value; read(sel.value); }
  });
  if (pathIn.addEventListener)
    pathIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); read(pathIn.value); }
    });
  if (typeof fetch === "function") {
    fetch("/api/weights").then(r => r.json()).then(d => {
      const files = (d && d.files) || [];
      sel.innerHTML = "";
      sel.appendChild(mk("option", { value: "",
        text: files.length ? "the local list \u2026" : "no files found" }));
      for (const f of files)
        sel.appendChild(mk("option", { value: f.path,
                                       text: f.path + " \u00b7 " + bxGB(f.size_mb * 2 ** 20) }));
      if (!pathIn.value && files.length) pathIn.value = files[0].path;
      if (n.file || pathIn.value) read(n.file || pathIn.value);
      else note.textContent = files.length + " weight file" + (files.length === 1 ? "" : "s")
                              + " found \u2014 pick one, or type a path";
      bxMenuPlace();
    }).catch(() => { note.textContent = "the weight list is not available"; });
  } else {
    note.textContent = "the weight list is not available";
  }
}
function bxWeightsExportForm() {               // the canvas as one pt / safetensors
  const m = $("bxmenu");
  if (!m) return;
  const canvas = bxExportCanvas();
  if (!canvas) return;
  m.innerHTML = "";
  const wrap = mk("div", { class: "bf" });
  wrap.appendChild(mk("div", { class: "panehint",
    text: "every weight box into one file \u2014 the boxes are pointed at it, so runs "
        + "use these weights" }));
  const fmtLab = mk("label", { text: "format" });
  const fmt = mk("select", { class: "bxsel" });
  for (const f of ["safetensors", "pt"]) fmt.appendChild(mk("option", { value: f, text: f }));
  fmtLab.appendChild(fmt);
  wrap.appendChild(fmtLab);
  const nameLab = mk("label", { text: "name" });
  const name = mk("input", { type: "text", value: "nnstudio-weights" });
  nameLab.appendChild(name);
  wrap.appendChild(nameLab);
  let weightCount = 0;
  bxEveryBox(box => { if (bxWeightedBox(box) && box.kind !== "custom") weightCount++; });
  const note = mk("div", { class: "panehint",
    text: weightCount + " weight box" + (weightCount === 1 ? "" : "es") + " on the canvas" });
  wrap.appendChild(note);
  const row = mk("div", { class: "row" });
  const cancel = mk("span", { class: "chip tiny", text: "cancel" });
  cancel.addEventListener("click", bxMenuClose);
  const go = mk("span", { class: "chip tiny", text: "export" });
  let done = false;
  go.addEventListener("click", () => {
    if (done) { bxMenuClose(); return; }
    if (!weightCount) { note.textContent = "nothing to export yet"; return; }
    note.textContent = "compiling the design and writing " + fmt.value + " \u2026";
    fetch("/api/weights/export", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canvas: canvas, format: fmt.value, name: name.value }),
    }).then(r => r.json().then(d => ({ ok: r.ok, d }))).then(res => {
      if (!res.ok || !res.d || !res.d.ok)
        throw new Error((res.d && res.d.error) || "the export failed");
      const d = res.d;
      const bound = bxApplyManifest(d.path || d.file, d.tensors);
      done = true;
      go.textContent = "done";
      note.textContent = "saved " + (d.path || d.file) + " \u00b7 " + (d.keys || 0)
                         + " tensors \u00b7 " + bxGB(d.bytes) + " \u2014 " + bound
                         + " block" + (bound === 1 ? "" : "s") + " now load from it";
      bxMenuPlace();
    }).catch(e => {
      note.textContent = String((e && e.message) || e);
      if (wrap.classList) wrap.classList.add("bad");
    });
  });
  row.appendChild(cancel);
  row.appendChild(go);
  wrap.appendChild(row);
  m.appendChild(wrap);
  m.hidden = false;                            // opened from the toolbar, not a menu
  bxMenuPlace();
}
/**
 * Open the add/resize box form in the floating menu.
 * The fields are chosen by kind; `mode` is "add" (a new box at the click) or
 * "resize" (the selected box). Mutates #bxmenu and bxAddOpen; nothing returns.
 */
function bxForm(kind, ev, node, mode) {
  const m = $("bxmenu");
  if (!m) return;
  mode = mode || (node ? "resize" : "add");
  const world = ev ? bxPoint(ev) : { x: bxCenter().cx, y: bxCenter().cy };
  m.innerHTML = "";
  const wrap = mk("div", { class: "bf" });
  const actField = (value) => {
    const lab = mk("label", { text: "function" });
    const sel = mk("select", { class: "bxsel" });
    for (const f of BX_ACTS) {
      const opt = mk("option", { value: f, text: f });
      sel.appendChild(opt);
    }
    sel.value = BX_ACTS.indexOf(value) >= 0 ? value : "silu";
    lab.appendChild(sel);
    wrap.appendChild(lab);
    return sel;
  };
  const numField = (label, value, ph) => {
    const lab = mk("label", { text: label });
    const inp = mk("input", { type: "number", placeholder: ph || "?",
                              value: value == null ? "" : String(value) });
    lab.appendChild(inp);
    wrap.appendChild(lab);
    return inp;
  };
  const opField = (value) => {
    const lab = mk("label", { text: "operation" });
    const sel = mk("select", { class: "bxsel" });
    for (const o of BX_OPS) {
      const opt = mk("option", { value: o, text: o });
      sel.appendChild(opt);
    }
    sel.value = BX_OPS.indexOf(value) >= 0 ? value : BX_OPS[0];
    lab.appendChild(sel);
    wrap.appendChild(lab);
    return sel;
  };
  const dimsField = (value) => {
    const lab = mk("label", { text: "output dim" });
    const inp = mk("input", { type: "text", placeholder: "128x40", value: value || "" });
    lab.appendChild(inp);
    wrap.appendChild(lab);
    return inp;
  };
  const nameField = (value) => {
    const lab = mk("label", { text: "name" });
    const inp = mk("input", { type: "text", value: value || "" });
    lab.appendChild(inp);
    wrap.appendChild(lab);
    return inp;
  };
  const selField = (label, options, value) => {
    const lab = mk("label", { text: label });
    const sel = mk("select", { class: "bxsel" });
    for (const o of options) sel.appendChild(mk("option", { value: o, text: o }));
    sel.value = options.indexOf(value) >= 0 ? value : options[0];
    lab.appendChild(sel);
    wrap.appendChild(lab);
    return sel;
  };
  const textField = (label, value, ph) => {
    const lab = mk("label", { text: label });
    const inp = mk("input", { type: "text", placeholder: ph || "",
                              value: value == null ? "" : String(value) });
    lab.appendChild(inp);
    wrap.appendChild(lab);
    return inp;
  };
  const scriptField = (value) => {            // the Python the backend will run
    wrap.appendChild(mk("div", { class: "panehint",
      text: "python \u2014 def run(x): \u2026 returns the tensor to pass on (backend CPU)" }));
    const ta = mk("textarea", { class: "bxjson", spellcheck: "false",
                                placeholder: "def run(x):\n    return x" });
    ta.value = value || "";
    wrap.appendChild(ta);
    return ta;
  };
  const inputModeField = (value) => {          // the data type this input carries
    const lab = mk("label", { text: "input" });
    const sel = mk("select", { class: "bxsel" });
    for (const [k, t] of [["matrix", "matrix \u2014 type its numbers"],
                          ["text", "text \u2014 a string"],
                          ["dataset", "dataset \u2014 a sheet of rows"]])
      sel.appendChild(mk("option", { value: k, text: t }));
    sel.value = value === "text" ? "text" : value === "dataset" ? "dataset" : "matrix";
    lab.appendChild(sel);
    wrap.appendChild(lab);
    return sel;
  };
  const matrixField = (value) => {              // the numbers, one row per line
    const box = mk("div", { class: "ifield" });
    box.appendChild(mk("div", { class: "panehint",
      text: "one row per line \u2014 spaces or commas between the numbers" }));
    const ta = mk("textarea", { class: "bxmat", spellcheck: "false",
                                placeholder: "1 2 3\n4 5 6" });
    ta.value = value == null ? "" : String(value);
    box.appendChild(ta);
    wrap.appendChild(box);
    ta._box = box;
    return ta;
  };
  const opAttrFields = (n0) => {             // the fields an op's maths reads:
    const at = (k) => (n0 && n0[k] != null ? n0[k] : "");   // shown by the op
    f.factor = numField("factor", at("factor"));
    f.repeats = numField("repeats", at("repeats"));
    f.dim = numField("dim", at("dim"));
    f.axes = textField("axes", at("axes"), "0 2 1 3 4");
    f.maskMode = textField("mode", at("mode"), "causal | nearest | bilinear");
    f.window = numField("window", at("window"));
    f.theta = numField("theta", at("theta"));
    f.width = numField("width", at("width") || 64);
  };
  const vocabField = (value) => {              // the chars a tokenizer maps to ids
    const lab = mk("label", { text: "vocab" });
    const inp = mk("input", { type: "text", placeholder: "abcdefghijklmnopqrstuvwxyz ",
                              value: value == null ? "" : String(value) });
    lab.appendChild(inp);
    wrap.appendChild(lab);
    return inp;
  };
  const hfField = (value) => {                 // or a huggingface repo for the real thing
    const lab = mk("label", { text: "huggingface" });
    const inp = mk("input", { type: "text", class: "wide",
                              placeholder: "Qwen/Qwen3-8B (or the URL)",
                              value: value == null ? "" : String(value) });
    lab.appendChild(inp);
    wrap.appendChild(lab);
    const row = mk("div", { class: "rrow" });
    const load = mk("span", { class: "chip tiny", text: "load the tokenizer" });
    row.appendChild(load);
    const note = mk("div", { class: "panehint" });
    row.appendChild(note);
    wrap.appendChild(row);
    load.addEventListener("click", () => {
      const repo = inp.value.trim();
      if (!repo) { note.textContent = "paste a repo first"; return; }
      if (typeof fetch !== "function") { note.textContent = "the app cannot reach the server"; return; }
      note.textContent = "reading " + repo + " \u2026";
      fetch("/api/tokenizer?repo=" + encodeURIComponent(repo))
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(res => {
          if (!res.ok || !res.d || !res.d.ok)
            throw new Error((res.d && res.d.error) || "cannot read that tokenizer");
          inp._tokens = res.d.tokens;
          note.textContent = (res.d.model || "?") + " \u00b7 " + res.d.tokens
                             + " tokens \u2014 cached, used instead of the vocab";
          bxMenuPlace();
        })
        .catch(e => { note.textContent = String((e && e.message) || e); });
    });
    inp.addEventListener("input", () => { inp._tokens = null; });
    return inp;
  };
  const dtypeField = (value) => {
    const lab = mk("label", { text: "dtype" });
    const sel = bxDtypeFill(mk("select", { class: "bxsel" }), value, "f16");
    lab.appendChild(sel);
    wrap.appendChild(lab);
    return sel;
  };
  const normField = (value) => {              // rms | layer | group
    const lab = mk("label", { text: "norm" });
    const sel = mk("select", { class: "bxsel" });
    for (const k of ["rms", "layer", "group"])
      sel.appendChild(mk("option", { value: k, text: k }));
    sel.value = value === "layer" || value === "group" ? value : "rms";
    lab.appendChild(sel);
    wrap.appendChild(lab);
    return sel;
  };
  const rewardField = (value) => {             // python | exact | regex | length
    const lab = mk("label", { text: "reward kind" });
    const sel = mk("select", { class: "bxsel" });
    for (const k of ["python", "exact", "regex", "length"])
      sel.appendChild(mk("option", { value: k, text: k }));
    sel.value = ["python", "exact", "regex", "length"].indexOf(value) >= 0 ? value : "python";
    lab.appendChild(sel);
    wrap.appendChild(lab);
    return sel;
  };
  const f = {};                               // this mode's fields, by name
  let hint = null;                            // a line some forms rewrite
  if (mode === "activation") {
    f.fn = actField(node ? node.act : "silu");
  } else if (mode === "operation") {
    f.op = opField(node ? node.op : BX_OPS[0]);
    f.dims = dimsField(node ? node.dims || "" : "");
    opAttrFields(node);
    f.axis = numField("axis", node && node.axis != null ? node.axis : 0);
    f.index = numField("index", node && node.index != null ? node.index : null);
    f.start = numField("start", node && node.start != null ? node.start : null);
    f.stop = numField("stop", node && node.stop != null ? node.stop : null);
    f.sliceHint = mk("div", { class: "panehint",
      text: "slice: index picks one slot along axis (that dim goes); "
          + "else start\u2013stop keeps a range \u2014 index -1 is the last one" });
    wrap.appendChild(f.sliceHint);
  } else if (mode === "norm") {
    f.norm = normField(node ? node.norm : "rms");
    f.eps = numField("epsilon", node ? node.eps : null);
    f.groups = numField("groups", node && node.groups != null ? node.groups : null);
  } else if (mode === "embed") {
    f.vocab = numField("vocab", node ? node.vocab : null);
    f.dout = numField("out", node ? node.dout : null);
  } else if (mode === "dtype") {
    f.dtype = dtypeField(node ? node.dtype : null);
  } else if (mode === "rename") {
    f.name = nameField(node ? node.name : bxDefaultName(kind));
  } else if (mode === "script") {
    f.code = scriptField(node ? node.script : "");
  } else if (mode === "add" && kind === "script") {
    f.name = nameField(bxDefaultName(kind));
    f.code = scriptField("");
  } else if (mode === "add" && kind === "act") {
    f.name = nameField(bxDefaultName(kind));
    f.fn = actField("silu");
  } else if (mode === "add" && kind === "op") {
    f.name = nameField(bxDefaultName(kind));
    f.op = opField(BX_OPS[0]);
    f.dims = dimsField("");
    opAttrFields(null);
  } else if (kind === "hf" && (mode === "add" || mode === "hf")) {
    if (mode === "add") f.name = nameField(bxDefaultName(kind));
    f.repo = hfField(node ? node.repo || "" : "");
    f.text = textField("prompt", node ? node.text || "" : "", "the text to continue");
    f.temp = numField("temperature", node ? node.temperature : null);
  } else if (mode === "add" && BX_UNSIZED.indexOf(kind) >= 0) {
    f.name = nameField(bxDefaultName(kind));
    if (kind === "norm") {
      f.norm = normField("rms"); f.eps = numField("epsilon", null);
      f.groups = numField("groups", null);
    }
    if (kind === "embed") {
      f.vocab = numField("vocab", null);
      f.dout = numField("out", null);
    }
  } else if (mode === "add" && kind === "custom") {
    f.name = nameField(bxDefaultName(kind));
  } else if ((mode === "add" || mode === "resize") && kind === "conv") {
    if (mode === "add") f.name = nameField(bxDefaultName(kind));
    f.a = numField("in", node ? node.din : null);
    f.b = numField("out", node ? node.dout : null);
    f.k = numField("kernel", node && node.k != null ? node.k : 3);
    f.st = numField("stride", node && node.stride != null ? node.stride : 1);
    f.pd = numField("pad", node && node.pad != null ? node.pad : "");
    f.g = numField("groups", node && node.groups != null ? node.groups : 1);
  } else if (mode === "add" && kind === "layer") {
    f.name = nameField(bxDefaultName(kind));
    f.a = numField("in", null);
    f.b = numField("out", null);
  } else if (mode === "add" && kind === "input") {
    f.name = nameField(bxDefaultName(kind));
    f.a = numField("size", null);
    f.mode = inputModeField("matrix");
    f.values = matrixField("1");
    f.text = textField("text", "", "the text to tokenize");
  } else if (mode === "matrix") {
    f.mode = inputModeField(node ? bxInputMode(node) : "matrix");
    f.values = matrixField(node ? node.values || "" : "");
    f.text = textField("text", node ? node.text || "" : "", "the text to tokenize");
  } else if (mode === "add" && (kind === "tokenize" || kind === "detokenize")) {
    f.name = nameField(bxDefaultName(kind));
    f.vocab = vocabField("");
    f.repo = hfField("");
    if (kind === "tokenize") f.text = textField("text", "", "cab");
  } else if (mode === "token") {
    f.vocab = vocabField(node ? node.vocab || "" : "");
    f.repo = hfField(node ? node.repo || "" : "");
    if (kind === "tokenize") f.text = textField("text", node ? node.text || "" : "", "cab");
  } else if (mode === "loadtok") {            // one repo: the tokenizer pair lands
    hint = mk("div", { class: "panehint",
      text: "one repo makes a pair: the tokenizer the text goes into, and the "
          + "de-tokenizer the ids come back out of." });
    wrap.appendChild(hint);
    f.repo = hfField("");
  } else if (mode === "loadhf") {             // one repo: a model box lands, the
    hint = mk("div", { class: "panehint",     // text pipeline inside of it
      text: "one repo makes a model box: the prompt goes in, the next token's "
          + "text comes out." });
    wrap.appendChild(hint);
    f.repo = hfField("");
    f.name = nameField("");
  } else if (mode === "add" && kind === "sample") {
    f.name = nameField(bxDefaultName(kind));
    f.temp = numField("temperature", null);
    f.seed = numField("seed", null);
  } else if (mode === "sample") {
    f.temp = numField("temperature", node ? node.temperature : null);
    f.seed = numField("seed", node ? node.sample_seed : null);
  } else if ((mode === "add" && kind === "dataset") || mode === "dataset") {
    f.name = nameField(node ? node.name : bxDefaultName(kind));
    f.text = textField("rows", node ? node.text || "" : "", "prompt<TAB>completion — one pair per line");
    f.file = textField("rows file (optional)", node ? node.file || "" : "",
                       "a .jsonl path on the backend machine");
    f.vocab = vocabField(node ? node.vocab || "" : "");
    f.repo = hfField(node ? node.repo || "" : "");
  } else if ((mode === "add" && kind === "reward") || mode === "reward") {
    f.name = nameField(node ? node.name : bxDefaultName(kind));
    f.rkind = rewardField(node ? node.reward : "python");
    f.expr = textField("reward expr", node ? node.expr || "" : "1.0", "python over prompt/output");
    f.pattern = textField("regex (optional)", node ? node.pattern || "" : "");
    f.match = textField("exact match (optional)", node ? node.match || "" : "");
  } else {                                   // "resize" (or adding an output)
    if (kind === "input") f.a = numField("size", node ? node.dout : null);
    else if (kind === "output") f.a = numField("size", node ? node.din : null);
    else { f.a = numField("in", node ? node.din : null);
           f.b = numField("out", node ? node.dout : null); }
  }
  if (mode !== "add" && mode !== "resize" && mode !== "rename" &&
      mode !== "script" && mode !== "matrix" && mode !== "token" &&
      mode !== "sample" && mode !== "hf" && mode !== "dataset" &&
      mode !== "reward" && mode !== "train")
    f.t = textField("tensor", node ? node.t || "" : "", "blk.0.attn_q.weight");
  if (f.op) {                                 // the dims fit reshape, the four fit slice
    const lab = f.dims && f.dims.parentNode;
    const slice = [f.axis, f.index, f.start, f.stop]
      .map(x => x && x.parentNode).filter(Boolean);
    if (f.sliceHint) slice.push(f.sliceHint);
    const attr = (fld, ops) => {
      const l = fld && fld.parentNode;
      if (l) l.hidden = ops.indexOf(f.op.value) < 0;
    };
    const sync = () => {
      if (lab) lab.hidden = f.op.value !== "reshape";
      for (const l of slice) l.hidden = f.op.value !== "slice";
      attr(f.factor, ["scale", "upsample"]);
      attr(f.repeats, ["repeat"]);
      attr(f.dim, ["repeat", "mean"]);
      attr(f.axes, ["permute"]);
      attr(f.maskMode, ["mask", "upsample"]);
      attr(f.window, ["mask"]);
      attr(f.theta, ["rope"]);
      attr(f.width, ["timestep"]);
    };
    f.op.addEventListener("change", () => { sync(); bxMenuPlace(); });
    sync();
  }
  if (f.mode && f.values) {                   // the type decides which field shows
    const syncInput = () => {
      const m = f.mode.value;
      const vbox = f.values._box || f.values.parentNode;
      if (vbox) vbox.hidden = m !== "matrix";
      if (f.text && f.text.parentNode) f.text.parentNode.hidden = m !== "text";
      bxMenuPlace();
    };
    f.mode.addEventListener("change", syncInput);
    syncInput();
  }
  const read = () => {
    const v = {};
    if (f.name) v.name = f.name.value;
    if (f.fn) v.act = f.fn.value;
    if (f.op) v.op = f.op.value;
    if (f.op) {                                // the fields an op's maths reads
      const o = f.op.value;
      if (o === "scale" || o === "upsample") { if (f.factor) v.factor = f.factor.value; }
      if (o === "upsample" || o === "mask") { if (f.maskMode) v.op_mode = f.maskMode.value; }
      if (o === "timestep") { if (f.width) v.width = f.width.value; }
      if (o === "repeat") {
        if (f.repeats) v.repeats = f.repeats.value;
        if (f.dim) v.dim = f.dim.value;
      }
      if (o === "mean") { if (f.dim) v.dim = f.dim.value; }
      if (o === "permute") { if (f.axes) v.axes = f.axes.value; }
      if (o === "mask") { if (f.window) v.window = f.window.value; }
      if (o === "rope") { if (f.theta) v.theta = f.theta.value; }
    }
    if (f.k && kind === "conv") {              // the kernel's own numbers
      v.k = f.k.value; v.stride = f.st.value; v.pad = f.pd.value;
      v.groups = f.g.value;
    }
    if (f.dims && f.op && f.op.value === "reshape") v.dims = f.dims.value;
    if (f.op && f.op.value === "slice") {      // read once, for the slice alone
      for (const [k, fld] of [["axis", f.axis], ["index", f.index],
                              ["start", f.start], ["stop", f.stop]])
        if (fld) v[k] = fld.value;             // "" clears the field
    }
    if (f.vocab) v.vocab = f.vocab.value;
    if (f.dout) v.dout = f.dout.value;
    if (f.norm) v.norm = f.norm.value;
    if (f.dtype) v.dtype = f.dtype.value;
    if (f.eps) v.eps = f.eps.value;
    if (f.groups) v.groups = f.groups.value;
    if (f.t) v.t = f.t.value;
    if (f.mode) v.input_mode = f.mode.value;
    if (f.values) v.values = f.values.value;
    if (f.vocab) v.vocab = f.vocab.value;
    if (f.repo) {
      v.repo = f.repo.value;
      if (f.repo._tokens != null) v.tokens = f.repo._tokens;   // from the load chip
    }
    if (f.text) v.text = f.text.value;
    if (f.file) v.file = f.file.value;
    if (f.rkind) v.reward = f.rkind.value;
    if (f.temp) v.temperature = f.temp.value;
    if (f.expr) v.expr = f.expr.value;
    if (f.pattern) v.pattern = f.pattern.value;
    if (f.match) v.match = f.match.value;
    if (f.seed) v.sample_seed = f.seed.value;
    if (f.code) v.script = f.code.value;
    if (mode !== "add" && mode !== "resize") return v;   // settings forms carry no sizes
    if (kind === "input") { v.dout = f.a.value; return v; }
    if (kind === "output") { v.din = f.a.value; return v; }
    if (BX_UNSIZED.indexOf(kind) >= 0) return v;         // no size of their own
    v.din = f.a.value;
    v.dout = f.b.value;
    return v;
  };
  const commit = () => {
    const v = read();
    if (mode === "loadtok") {                  // the pair needs the repo before it lands
      if (!String(v.repo || "").trim()) {
        if (hint)
          hint.textContent = "paste a huggingface repo first \u2014 it gives "
                           + "both boxes their vocabulary";
        return;
      }
      bxMenuClose();
      bxAddTokenizerPair(world.x, world.y, v);
      return;
    }
    if (mode === "loadhf") {                   // \u2026and so does the model box
      if (!String(v.repo || "").trim()) {
        if (hint)
          hint.textContent = "paste a huggingface repo first \u2014 the model "
                           + "reads its weights from there";
        return;
      }
      bxMenuClose();
      bxAddHFModel(world.x, world.y, v);
      return;
    }
    bxMenuClose();
    if (node) bxConfigure(node.id, v); else bxAddKind(kind, world.x, world.y, v);
  };
  for (const inp of [f.name, f.a, f.b]) if (inp)
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } });
  const row = mk("div", { class: "row" });
  const cancel = mk("span", { class: "chip tiny", text: "cancel" });
  cancel.addEventListener("click", bxMenuClose);
  if (mode === "add" && (kind === "layer" || kind === "embed" || kind === "norm" ||
                         kind === "conv")) {
    const w = mk("span", { class: "chip tiny", text: "load weights \u2026" });
    w.addEventListener("click", () => {          // add the block, then point it at a file
      const v = read();
      bxMenuClose();
      const made = bxAddKind(kind, world.x, world.y, v);
      if (made) bxWeightsForm(made.id);
    });
    row.appendChild(w);
  }
  const go = mk("span", { class: "chip tiny",
                          text: node ? "save"
                                     : (mode === "loadtok" || mode === "loadhf"
                                        ? "load" : "add") });
  go.addEventListener("click", commit);
  row.appendChild(cancel);
  row.appendChild(go);
  wrap.appendChild(row);
  m.appendChild(wrap);
  if (m.hidden) bxMenuShow();                  // the Import door: no menu carries it
  else bxMenuPlace();
}
// ---- the Palette menu (top bar): categories, expanding into their cards ---
// Only the categories are listed; clicking one opens its visual boxes (the
// same card renderer as the canvas). A card can be clicked to drop its box in
// the middle of the view, or dragged out of the menu and released over the
// canvas to land exactly there.
let bxpOpen = null;                            // the expanded category, if any

