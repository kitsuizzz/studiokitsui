// ─── nnstudio shell · 70 · wires and hover ─────────────────────────────────────
// wire kinds/shapes/values, the hover card, toasts, and hot-target tracking.
// Order is load-bearing: this slice is concatenated after the one before it.

// a wire can be deleted on the spot: hover it and click the × parked in its
// middle, or right-click it for the same thing in the menu
function bxFindEdge(from, to, fromPort, toPort) {
  return BX.edges.find(e => e.from === from && e.to === to &&
                            (e.fromPort || 0) === (fromPort || 0) &&
                            (e.toPort || 0) === (toPort || 0)) || null;
}
// …and its shape is yours: drag any part of the wire (not the ×) to bend it
// through that point; drag it back near its natural middle to straighten it
function bxNaturalMid(e) {
  const a = bxNode(e.from), b = bxNode(e.to);
  if (!a || !b) return null;
  return bxWireMid(a, b, null, e.fromPort, bxPortDefs(a, "out").length,
                   e.toPort, bxPortDefs(b, "in").length);
}
function bxSetVia(e, x, y) {
  if (!e) return false;
  e.via = { x: Math.round(x), y: Math.round(y) };
  bxRender();
  return true;
}
function bxClearVia(e) {
  if (!e || !e.via) return false;
  delete e.via;
  bxRender();
  return true;
}
function bxRemoveEdge(from, to, fromPort, toPort) {
  const before = BX.edges.length;
  BX.edges = BX.edges.filter(e => !(e.from === from && e.to === to &&
                                    (e.fromPort || 0) === (fromPort || 0) &&
                                    (e.toPort || 0) === (toPort || 0)));
  bxSyncDoc();
  if (bxSel && bxSel.kind === "edge" && bxSel.from === from && bxSel.to === to &&
      (bxSel.fromPort || 0) === (fromPort || 0) && (bxSel.toPort || 0) === (toPort || 0))
    bxSel = null;
  bxHotSet(null);
  bxRender();
  bxCommit();
  return BX.edges.length < before;
}
// where a box's ports sit (one port is centred, several are spread evenly)
function bxNodeW(n) {
  if (n && (n.kind === "agent" || n.kind === "train"))                 // the AI box is as wide as its display
    return Math.max(320, Number((n.box || {}).w) || 480);
  if (n && n.kind === "dataset")           // …and so is the dataset's sheet
    return Math.max(320, Number((n.box || {}).w) || 440);
  if (n && n.kind === "training")          // the slot's box: wide enough for the
    return Math.max(300, Number((n.box || {}).w) || 340);   // model, tall for the pane
  if (n && (n.kind === "select" || n.kind === "config"))    // …and their windows
    return Math.max(280, Number((n.box || {}).w) || 360);
  if (n && n.kind === "input" && !BX.up)   // …and the input's own editor: roomy
    return Math.max(240, Number((n.box || {}).w) || 420);   // by default, so its
  if (n && n.kind === "output" && !BX.up)  // content fits; the corner adjusts it
    return Math.max(240, Number((n.box || {}).w) || 420);
  if (n && n.kind === "heatmap")           // a window for the picture it draws
    return Math.max(220, Number((n.box || {}).w) || 360);
  return BXW;
}
function bxNodeH(n) {
  if (n && (n.kind === "agent" || n.kind === "train"))                 // …and as tall: the content lives in it
    return Math.max(160, Number((n.box || {}).h) || 320);
  if (n && n.kind === "dataset")
    return Math.max(180, Number((n.box || {}).h) || 300);
  if (n && n.kind === "training")
    return Math.max(220, Number((n.box || {}).h) || 300);
  if (n && (n.kind === "select" || n.kind === "config"))
    return Math.max(140, Number((n.box || {}).h) || 240);
  if (n && n.kind === "input" && !BX.up)
    return Math.max(120, Number((n.box || {}).h) || 280);
  if (n && n.kind === "output" && !BX.up)
    return Math.max(120, Number((n.box || {}).h) || 280);
  if (n && n.kind === "heatmap")
    return Math.max(140, Number((n.box || {}).h) || 320);
  const p = Math.max(bxPortDefs(n, "in").length, bxPortDefs(n, "out").length);
  return p > 2 ? 40 * Math.ceil((30 + 16 * p) / 40) : BXH;   // whole cells, always
}
function bxPortPos(n, dir, i, count) {
  const h = bxNodeH(n), k = Math.max(1, count || 1);
  const j = Math.min(Math.max(0, i || 0), k - 1);
  return { x: dir === "in" ? n.x : n.x + bxNodeW(n),
           y: n.y + h * (k === 1 ? 0.5 : (j + 1) / (k + 1)) };
}
function bxWireMid(a, b, via, aPort, aCount, bPort, bCount) {
  if (via) return { x: via.x, y: via.y };        // the bend *is* the middle
  const p = bxPortPos(a, "out", aPort, aCount);
  const q = bxPortPos(b, "in", bPort, bCount);
  const dx = Math.max(40, Math.abs(q.x - p.x) * 0.5);
  const c1 = { x: p.x + dx, y: p.y }, c2 = { x: q.x - dx, y: q.y };
  return { x: (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8,
           y: (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8 };
}
function bxEdgeMid(edge) {
  const vis = bxVisPaths.get(bxEdgeKey(edge));
  if (vis && vis.getTotalLength && vis.getPointAtLength) {
    const len = vis.getTotalLength();
    if (len) return vis.getPointAtLength(len / 2);
  }
  const a = bxNode(edge.from), b = bxNode(edge.to);
  return (a && b) ? bxWireMid(a, b, edge.via) : { x: 0, y: 0 };
}
function bxBadge(p, edge) {
  const root = bxHost() && bxHost().querySelector ? bxHost().querySelector("svg") : null;
  if (!root) return null;
  const g = svg("g", { class: "bxdel", transform: "translate(" + p.x + " " + p.y + ")" });
  g.appendChild(svg("circle", { cx: 0, cy: 0, r: 9 }));
  g.appendChild(svgText(0, 4, "×", "bxdelx"));
  g.addEventListener("mousedown", (ev) => { ev.stopPropagation(); ev.preventDefault(); });
  g.addEventListener("click", (ev) => {
    if (ev.stopPropagation) ev.stopPropagation();
    if (ev.preventDefault) ev.preventDefault();
    if (edge) bxRemoveEdge(edge.from, edge.to, edge.fromPort, edge.toPort);
  });
  root.appendChild(g);
  return g;
}
// ---- the wire's hover card: every connection carries data, and the last run
// left a type and a shape for most of it. The card follows the cursor while a
// wire is hot — the same hover that lights the wire and parks the × on it.
function bxDtypeShort(dt) {
  const s = String(dt == null ? "" : dt).replace(/^torch\./, "");
  return s || null;
}
function bxWireKind(a, st) {                   // the data's kind, as a word
  if (st && st.image) return "image";
  if (st && st.text != null) return "text";
  if (st) {
    const sh = (st.shape || []).map(Number);
    const dt = bxDtypeShort(st.dtype) || "";
    if (sh.length <= 1 && /^[ui]\d+$/.test(dt)) return "ids";
    return "matrix";                           // a number is a 1-element matrix
  }
  if (a) return bxPortType(a, "out", 0).kind;  // before a run, its own dot knows
  return "matrix";
}
function bxWireShape(st) {                     // the shape, always a shape
  if (!st) return null;
  if (st.text != null) return "\u201c" + bxClip(st.text, 36) + "\u201d";
  const sh = (st.shape || []).map(Number);
  if (sh.length) return "[" + sh.join("\u00d7") + "]";
  if (st.scalar != null) return "[1]";         // a lone number is one element
  if (st.image)
    return "[" + (st.image.h || "?") + "\u00d7" + (st.image.w || "?") + "\u00d73]";
  return null;
}
function bxWireValue(edge) {                   // the source box's last value, any level
  const a = bxNode(edge.from);
  if (!a) return { node: null, st: null };
  if (a.kind === "custom") {                   // a port is an output box inside
    const k = bxBoundary(a, "out")[edge.fromPort || 0];
    const path = k ? (bxCurrentPath() || []).concat(a.id, k.id).join("/") : null;
    return { node: a, st: path ? (bxRunValues[path] || null) : null };
  }
  if (bxDataState[a.id] != null) return { node: a, st: bxDataState[a.id] };
  return { node: a, st: bxRunValues[(bxCurrentPath() || []).concat(a.id).join("/")] || null };
}
function bxPortType(n, dir, i) {               // what a dot is built to carry
  if (n.kind === "dataset") return { kind: "rows", shape: null };   // a sheet reads
  if (n.kind === "output" && dir === "in")     // as rows anywhere; a display takes
    return { kind: "any", shape: null };       // whatever it is shown
  // A dot's shape is a per-sample one: the first axis of everything on the
  // wires is the batch, and only a run knows its size — so design-time shapes
  // read [\u00d7 ? \u00d7 width], values that actually exist read as they are.
  if (n.kind === "input" && dir === "out") {   // an input emits its own value
    if (n.input_mode === "image") {
      const s = n.image_size || null;
      return { kind: "image",
               shape: "[" + (s || "?") + "\u00d7" + (s || "?") + "\u00d73]" };
    }
    if (n.input_mode === "text") return { kind: "text", shape: null };
    if (bxIsDataset(n)) return { kind: "rows", shape: null };   // its own sheet
    const m = bxMatrixParse(n.values);         // the data itself: exact
    if (m && !m.bad && !m.ragged)
      return { kind: "matrix",
               shape: m.r > 1 ? "[" + m.r + "\u00d7" + m.c + "]"
                              : "[" + m.count + "]" };
  }
  if (dir === "out") {                         // the kinds that carry text
    if (n.kind === "tokenize") return { kind: "ids", shape: null };
    if (n.kind === "detokenize" || n.kind === "hf") return { kind: "text", shape: null };
    if (n.kind === "config") return { kind: "settings", shape: null };
    if (n.kind === "sample") return { kind: "ids", shape: null };   // a draw
    if (n.kind === "training")                 // the train result: [loss, acc]
      return { kind: "matrix", shape: "[2]" };
  }
  if (n.kind === "training" && dir === "in")   // the three splits, by position
    return { kind: "rows", shape: null };
  if (n.kind === "loss" && dir === "in")       // the model's scores, then the
    return (i || 0) === 0 ? { kind: "matrix", shape: null }   // sheet's labels
                          : { kind: "rows", shape: null };
  if (n.kind === "tokenize" && dir === "in") return { kind: "text", shape: null };
  if (n.kind === "detokenize" && dir === "in") return { kind: "ids", shape: null };
  if (n.kind === "hf" && dir === "in") return { kind: "text", shape: null };
  if (n.kind === "embed" && dir === "in") return { kind: "ids", shape: null };
  if (n.kind === "select") {
    const tell = bxMatrixTell(n);
    if (dir === "out")
      return { kind: "matrix",
               shape: tell && tell.cols ? "[? \u00d7 " + tell.cols.length + "]" : null };
    return { kind: "rows",
             shape: tell && tell.rows != null ? "[" + tell.rows + " rows]" : null };
  }
  if (n.kind === "input" && dir === "in") {    // the training dots, by the wire
    const link = bxInputLink(n);
    const i2 = i || 0;
    if (i2 === 0) return { kind: "settings", shape: null };
    if (link.data) return bxPortType(link.data, "out", 0);
    return { kind: "matrix", shape: null };
  }
  if (dir === "out" && n.kind === "op" && bxOpName(n) === "reshape" && n.dims)
    return { kind: "matrix", shape: "[? \u00d7 " + bxDimsShow(n.dims) + "]" };
  if (n.kind === "custom") {                   // its dots are its boundary boxes:
    const b = bxBoundary(n, dir)[i || 0];      // in is the inner input's own dot,
    if (!b) return { kind: "matrix", shape: null };      // out is what its wire
    if (dir === "out")                                   // inside feeds the output
      return bxOutputExpect(b, (n.inner || {}).edges) || { kind: "any", shape: null };
    return bxPortType(b, "out", 0);
  }
  const p = bxPortDefs(n, dir)[i || 0];        // the declared width, as a shape
  const size = p && p.size != null ? p.size : null;
  if (size == null) return { kind: "matrix", shape: null };
  return { kind: "matrix", shape: "[? \u00d7 " + size + "]" };
}
function bxOutputFeed(n, edges) {              // the box wired into an output's dot.
  // `edges` names the level the box lives at — the canvas by default, a nested
  // box's own wiring when one of its dots is the one being read
  const inner = !!edges && edges !== BX.edges;
  let byId = null;
  if (inner) {                                 // inner levels resolve their own boxes
    byId = {};
    bxEveryBox(x => { byId[x.id] = x; });
  }
  for (const e of (edges || BX.edges || [])) {
    if (e.to !== n.id || (e.toPort || 0) !== 0) continue;   // port 0: the model's
    const src = inner ? byId[e.from] : bxNode(e.from);      // (port 1 is the dataset)
    if (src) return src;
  }
  return null;
}
function bxOutputExpect(n, edges) {            // what an output expects: its wire's
  const src = bxOutputFeed(n, edges);          // own type and shape — never a stale
  if (!src) return null;                       // declared size; nothing connected,
  return bxPortType(src, "out", 0);            // nothing expected
}
function bxTypeText(pt) {                      // "matrix [5120]" / "image [768\u00d7768\u00d73]"
  if (!pt) return null;
  if (pt.kind === "text" || pt.kind === "ids") return pt.kind;
  return pt.kind + (pt.shape ? " " + pt.shape : "");
}
function bxNodeValueAt(n, prefix) {            // the last run's value for this box
  if (!prefix && bxDataState[n.id] != null) return bxDataState[n.id];
  const path = (bxCurrentPath() || []).concat(prefix ? [prefix] : [], [n.id]).join("/");
  return bxRunValues[path] || null;
}
function bxRunLine(st) {                       // how the last run's value reads
  if (!st) return null;
  const bits = [];
  if (st.image) bits.push("image");
  else if (st.text != null) bits.push("text");
  const shp = bxWireShape(st);
  if (shp) bits.push(shp);
  if (st.dtype && !st.image && st.text == null) bits.push(bxDtypeShort(st.dtype));
  return bits.length ? "last run " + bits.join(" \u00b7 ") : null;
}
function bxTipStart() {                        // a blank card, ready for lines
  const tip = $("bxtip");
  if (tip) tip.innerHTML = "";
  return tip;
}
function bxTipAdd(tip, cls, text) {            // one line, when there is one
  if (tip && text != null) tip.appendChild(mk("div", { class: cls, text: text }));
}
function bxTipDone(tip, ev) {                  // show it, by the cursor
  if (!tip) return;
  tip.hidden = false;
  bxTipPlace(ev);
}
function bxTipShow(edge, ev) {                 // a wire: what data rides on it
  const tip = bxTipStart();
  const a = bxNode(edge.from);
  if (!tip || !a) { bxTipHide(); return; }
  const st = bxWireValue(edge).st;
  const kind = bxWireKind(a, st);
  const dt = st ? bxDtypeShort(st.dtype) : null;
  const numeric = kind === "matrix";           // the one numeric type
  const declared = bxPortType(a, "out", edge.fromPort || 0);   // what the dots say
  const outs = bxPortDefs(a, "out").length;
  bxTipAdd(tip, "who", "from " + bxClip(a.name || bxKindLabel(a.kind), 26) +
                       (outs > 1 ? " \u00b7 out " + ((edge.fromPort || 0) + 1) : ""));
  bxTipAdd(tip, "what", kind + (numeric && dt ? " \u00b7 " + dt : ""));
  const shape = st ? bxWireShape(st) : (declared && declared.shape);
  if (shape) bxTipAdd(tip, "shp", shape);      // tracked back through the wiring:
  else if (!st)                                // no run needed for the shape
    bxTipAdd(tip, "note", bxFlowSet.has(bxPathId(a.id)) ? "no value kept" : "not run yet");
  const wstate = bxWireState(edge);            // what the wire check found
  if (wstate === "bad") bxTipAdd(tip, "note", bxEdgeMismatch(edge));
  else if (wstate === "unknown") bxTipAdd(tip, "note", "its sizes are still unknown");
  bxTipDone(tip, ev);
}
function bxTipNode(target, ev) {               // a box: its name, and what it carries
  const tip = bxTipStart();
  const n = bxNode(target && target.id);
  if (!tip || !n) { bxTipHide(); return; }
  if (target.part === "list") {                // a nested box: its own i/o boxes
    bxTipAdd(tip, "who", "nested box");
    bxTipAdd(tip, "what", n.name || bxKindLabel(n.kind));
    const rows = [];
    const inner = (n.inner || {}).edges || [];
    for (const k of bxBoundary(n, "in")) rows.push(["in", k, bxPortType(k, "out", 0)]);
    for (const k of bxBoundary(n, "out")) rows.push(["out", k, bxOutputExpect(k, inner)]);
    for (const r of rows.slice(0, 10))
      bxTipAdd(tip, "row", r[0].padEnd(4) + bxClip(r[1].name || bxKindLabel(r[1].kind), 18) +
                             (r[2] ? " \u00b7 " + bxTypeText(r[2]) : ""));
    if (rows.length > 10)
      bxTipAdd(tip, "note", "… and " + (rows.length - 10) + " more");
    else if (!rows.length)
      bxTipAdd(tip, "note", "no input or output boxes inside");
    const host = bxTrainHostOf(n);             // seated in a Training box: the dot
    if (host)                                  // at its foot pops it out
      bxTipAdd(tip, "note", "seated in " + bxClip(host.name || "the training box", 22)
                            + " — the dot at its foot pops it out");
  } else if (target.part === "release") {
    const host = bxTrainHostOf(n);
    bxTipAdd(tip, "who", "the release");
    bxTipAdd(tip, "what", "detach " + bxClip(n.name || "the model", 22));
    bxTipAdd(tip, "note", "click it \u2014 the model pops out of "
                          + (host ? bxClip(host.name || "the training box", 20)
                                  : "the socket"));
  } else if (n.kind === "training" && target.part === "port") {
    const dir = target.dir === "out" ? "out" : "in";
    const p = target.port || 0;
    const split = [["train", "the rows it learns on \u2014 the batch comes from here"],
                   ["test", "scored after every eval \u2014 never trained on"],
                   ["validation", "a second hold-out \u2014 scored beside the "
                                  + "test split"]];
    if (dir === "out") {
      bxTipAdd(tip, "who", "Training box \u00b7 the result");
      bxTipAdd(tip, "what", "the train result");
      bxTipAdd(tip, "shp", "[\u00d7 2] \u2014 loss and accuracy");
      bxTipAdd(tip, "note", "the run leaves it here; the trainer updates it every "
                            + "step");
    } else {
      const sp = split[p] || [null, null];
      bxTipAdd(tip, "who", "Training box \u00b7 in dot " + (p + 1) + " of 3");
      bxTipAdd(tip, "what", sp[0] ? sp[0] + " data" : "a dataset dot");
      bxTipAdd(tip, "shp", "any dataset \u2014 an input reading as one, or a "
                           + "dataset box");
      bxTipAdd(tip, "note", sp[1] || "wire a dataset in");
    }
    if (bxBoxOff(n) || (dir === "out" && bxPortOff(n, "out", p)))
      bxTipAdd(tip, "note", "deactivated \u2014 no data");
  } else {
    let box = n, prefix = null;                // the box itself, or one inner box
    if (target.part === "port") {
      box = bxBoundary(n, target.dir === "out" ? "out" : "in")[target.port || 0];
      if (!box) { bxTipHide(); return; }
      prefix = n.id;
    }
    const takes = box.kind === "output";       // an output takes, an input emits —
    const innerEdges = box !== n ? ((n.inner || {}).edges || []) : null;
    const pt = takes ? bxOutputExpect(box, innerEdges)   // what an output takes is
                    : bxPortType(box, "out", 0);         // its wire's own type and shape
    const dead = target.part === "port"
      ? (bxBoxOff(n) || (target.dir === "out" && bxPortOff(n, "out", target.port || 0)))
      : bxBoxOff(n);
    bxTipAdd(tip, "who", bxKindLabel(box.kind));
    bxTipAdd(tip, "what", box.name || bxKindLabel(box.kind));
    bxTipAdd(tip, "shp", (takes ? "expects " : "emits ") + (bxTypeText(pt) || "?"));
    bxTipAdd(tip, "note", bxRunLine(bxNodeValueAt(box, prefix)));
    if (target.part === "port")
      bxTipAdd(tip, "note", "port " + ((target.port || 0) + 1) + " of " +
                            bxClip(n.name || bxKindLabel(n.kind), 20));
    if (dead) bxTipAdd(tip, "note", "deactivated \u2014 no data");
  }
  bxTipDone(tip, ev);
}
let bxToastT = null;
function bxToast(msg) {                        // a passing note on the canvas: a
  const el = $("bxtoast");                     // wire that was refused says why
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
  if (typeof clearTimeout === "function" && bxToastT) clearTimeout(bxToastT);
  if (msg) bxToastT = setTimeout(() => { el.hidden = true; }, 3600);
}
function bxTipHide() {
  bxHotBox = null;                             // the next hover starts the card fresh
  const tip = $("bxtip");
  if (tip) tip.hidden = true;
}
function bxTipPlace(ev) {                      // by the cursor, inside the canvas
  const tip = $("bxtip"), w = $("bxwrap");
  if (!tip || !w || tip.hidden || !ev) return;
  const r = w.getBoundingClientRect
    ? w.getBoundingClientRect() : { left: 0, top: 0, width: 900, height: 500 };
  const x = (ev.clientX || 0) - (r.left || 0), y = (ev.clientY || 0) - (r.top || 0);
  tip.style.left = Math.max(6, Math.min(x + 16,
    (r.width || 900) - (tip.offsetWidth || 200) - 6)) + "px";
  tip.style.top = Math.max(6, Math.min(y + 18,
    (r.height || 500) - (tip.offsetHeight || 64) - 6)) + "px";
}
// which wire — or input/output box, or a nested box's dot — the cursor is on
function bxHotMove(ev) {
  if (bxDrag || bxWire || bxBend) return;
  const t = ev.target;
  // the × sits on the wire: while the cursor is on it, keep the wire lit (and
  // the × there) — otherwise the badge would remove itself and reappear in a loop
  if (bxHotEdge && t && t.closest && t.closest(".bxdel")) return;
  const hit = t && t.closest ? t.closest(".dedge-hit") : null;
  const edge = hit && hit.getAttribute
    ? bxFindEdge(hit.getAttribute("data-from"), hit.getAttribute("data-to"),
                 Number(hit.getAttribute("data-fp") || 0),
                 Number(hit.getAttribute("data-tp") || 0)) : null;
  if (edge) {
    if (!bxHotEdge || bxEdgeKey(bxHotEdge) !== bxEdgeKey(edge)) bxHotSet(edge, ev);
    else bxTipPlace(ev);                       // the card rides along the wire
    return;
  }
  if (bxHotEdge) bxHotSet(null);               // off the wire: it lets go
  const boxEl = t && t.closest ? t.closest(".dnode") : null;
  const n = boxEl && boxEl.getAttribute ? bxNode(boxEl.getAttribute("data-id")) : null;
  const target = n ? bxHoverTarget(n, t) : null;
  if (!target) { if (bxHotBox) bxTipHide(); return; }
  if (!bxHotBox || bxHotBox.key !== bxHotKey(target)) bxHotNode(target, ev);
  else bxTipPlace(ev);                         // the card rides along the box
}
function bxHoverTarget(n, t) {                 // which card a hovered box asks for
  if (!n) return null;
  if (t && t.closest && t.closest(".bxlogfo"))
    return null;                               // a box's own window is editing space
  if (n.kind === "input" || n.kind === "output") return { id: n.id, part: "box" };
  if (n.kind === "training") {                 // its dots name the three splits
    const d0 = t && t.closest ? t.closest(".dport") : null;   // \u2014 and the
    if (!d0) return null;                      // result on the way out
    const p0 = d0.getAttribute ? d0.getAttribute("data-port") : null;
    const c0 = String((d0.getAttribute && d0.getAttribute("class")) || d0.className || "");
    return { id: n.id, part: "port", port: Math.max(0, Number(p0) || 0),
             dir: c0.indexOf("out") >= 0 ? "out" : "in" };
  }
  if (n.kind !== "custom") return null;        // only an i/o box has a card
  if (t && t.closest && t.closest(".dpop"))    // the release dot of a seated model
    return { id: n.id, part: "release" };
  const dot = t && t.closest ? t.closest(".dport") : null;
  const p = dot && dot.getAttribute ? dot.getAttribute("data-port") : null;
  if (p == null) return { id: n.id, part: "list" };   // the body: the whole list
  // an SVG element's .className is an SVGAnimatedString, never a string: the
  // dot's direction must come from its class attribute
  const cls = String((dot.getAttribute && dot.getAttribute("class")) || dot.className || "");
  return { id: n.id, part: "port", port: Math.max(0, Number(p) || 0),
           dir: cls.indexOf("out") >= 0 ? "out" : "in" };
}
function bxHotKey(target) {
  return target.id + ">" + target.part + ">" + (target.dir || "") + ">" + (target.port || 0);
}
function bxHotUnlight() {                      // the wire's light and its × go away
  if (bxHotEdge) {
    const was = bxVisPaths.get(bxEdgeKey(bxHotEdge));
    if (was && was.classList) was.classList.remove("hot");
  }
  if (bxHotBadge && bxHotBadge.parentNode) bxHotBadge.parentNode.removeChild(bxHotBadge);
  bxHotBadge = null;
  bxHotEdge = null;
}
function bxHotSet(edge, ev) {                  // a wire hover: light it, park the ×, card
  bxHotUnlight();
  bxHotBox = null;
  if (!edge) { bxTipHide(); return; }
  bxHotEdge = edge;
  const vis = bxVisPaths.get(bxEdgeKey(edge));
  if (vis && vis.classList) vis.classList.add("hot");
  bxHotBadge = bxBadge(bxEdgeMid(edge), edge);      // the × sits mid-wire
  bxTipShow(edge, ev);                              // …and the data card by the cursor
}
function bxHotNode(target, ev) {               // a box hover: the card alone
  bxHotUnlight();
  bxHotBox = Object.assign({ key: bxHotKey(target) }, target);
  bxTipNode(bxHotBox, ev);
}

