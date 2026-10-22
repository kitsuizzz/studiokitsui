// ─── nnstudio shell · 75 · the card renderer ─────────────────────────────────────
// snap/guides, bxCard, pane scroll restore, bxRender, the drag-time painters,
// and entering/leaving a nested box.
// Order is load-bearing: this slice is concatenated after the one before it.

// --------------------------------------------------------------- align assist
// While a box is dragged it snaps to what is already on the canvas: left /
// centre / right with other boxes, top / middle / bottom likewise. The lines it
// snapped along are shown for as long as the drag lasts. The reach is a few
// screen pixels, so it feels the same at any zoom.
function bxSnapGrid(v) { return Math.round(v / BX_GRID) * BX_GRID; }
// the lattice is the same at every zoom: the lines drawn always include it
function bxSnapTo(v) { return bxSnapGrid(v); }
function bxSnapMove(node, x, y) {
  // the breadboard: the box lands on the lines you can see, at any zoom
  const nx = bxSnapTo(x), ny = bxSnapTo(y);
  if (!node) return { x: nx, y: ny, guides: [] };
  const h = bxNodeH(node), w = bxNodeW(node);
  const ax = [nx, nx + w / 2, nx + w];
  const ay = [ny, ny + h / 2, ny + h];
  let vx = null, hy = null;
  for (const o of BX.nodes) {
    if (o.id === node.id) continue;
    const oh = bxNodeH(o), ow = bxNodeW(o);
    const ox = [o.x, o.x + ow / 2, o.x + ow];
    const oy = [o.y, o.y + oh / 2, o.y + oh];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (vx == null && Math.abs(ox[j] - ax[i]) < 0.5) vx = ox[j];
        if (hy == null && Math.abs(oy[j] - ay[i]) < 0.5) hy = oy[j];
      }
    }
  }
  // shared lines become amber guides — what lines up, drawn
  const guides = [];
  const span = (pairs) => [Math.min.apply(null, pairs.map(p => p[0])) - 24,
                           Math.max.apply(null, pairs.map(p => p[1])) + 24];
  if (vx != null) {
    const pairs = [[ny, ny + h]];
    for (const o of BX.nodes)
      if (o.id !== node.id && (o.x === vx || o.x + bxNodeW(o) / 2 === vx || o.x + bxNodeW(o) === vx))
        pairs.push([o.y, o.y + bxNodeH(o)]);
    const [a, b] = span(pairs);
    guides.push({ dir: "v", at: vx, a: a, b: b });
  }
  if (hy != null) {
    const pairs = [[nx, nx + w]];
    for (const o of BX.nodes)
      if (o.id !== node.id && (o.y === hy || o.y + bxNodeH(o) / 2 === hy || o.y + bxNodeH(o) === hy))
        pairs.push([o.x, o.x + bxNodeW(o)]);
    const [a, b] = span(pairs);
    guides.push({ dir: "h", at: hy, a: a, b: b });
  }
  return { x: nx, y: ny, guides: guides };
}
function bxGuideLayer() {
  const g = svg("g", { class: "bxguides" });
  for (const l of bxGuides) {
    if (l.dir === "v") g.appendChild(svg("line", { x1: l.at, y1: l.a, x2: l.at, y2: l.b, class: "bxguide" }));
    else g.appendChild(svg("line", { x1: l.a, y1: l.at, x2: l.b, y2: l.at, class: "bxguide" }));
  }
  return g;
}
// ---- the drag-time painter -------------------------------------------------
// A full bxRender rebuilds every card, every wire and every embedded pane. That
// is the right cost for a structural change, but not for a pointer move: while
// a box is dragged we move its existing <g> with a transform and re-route only
// the wires that touch it. The full render lands once, on drop.
function bxGuidesPaint(root) {
  if (!root || !root.querySelector) return;
  const old = root.querySelector(".bxguides");
  if (old && old.parentNode) old.parentNode.removeChild(old);
  if (bxGuides.length) root.appendChild(bxGuideLayer());
}
// One wire's two DOM strokes (the visible path and its hit path) plus the port
// counts the path needs. The drag painter caches this once per gesture; a
// one-card resize builds a few of them on the spot.
function bxWireEls(root, e) {
  const a = bxNode(e.from), b = bxNode(e.to);
  if (!a || !b) return null;
  const vis = bxVisPaths.get(bxEdgeKey(e));
  const hit = root && root.querySelector
    ? root.querySelector('.dedge-hit[data-from="' + e.from + '"][data-to="' + e.to +
                         '"][data-fp="' + (e.fromPort || 0) + '"][data-tp="' +
                         (e.toPort || 0) + '"]')
    : null;
  return { e, vis, hit, ac: bxPortDefs(a, "out").length, bc: bxPortDefs(b, "in").length };
}
function bxWirePaint(w) {
  const a = bxNode(w.e.from), b = bxNode(w.e.to);
  if (!a || !b) return;
  const d = bxWirePath(a, b, w.e.via, w.e.fromPort, w.ac, w.e.toPort, w.bc);
  if (w.vis && w.vis.setAttribute) w.vis.setAttribute("d", d);
  if (w.hit && w.hit.setAttribute) w.hit.setAttribute("d", d);
}
function bxDragPaint() {
  if (!bxDrag || bxDrag.kind !== "move" || !bxDrag.moved) return;
  const host = bxHost();
  const root = host && host.querySelector ? host.querySelector("svg") : null;
  if (!root) return;
  // A poll or another action may have replaced the SVG under the drag; rebuild
  // the small per-drag cache when that happens.
  if (bxDrag.root !== root) {
    bxDrag.root = root;
    bxDrag.groups = null;
    bxDrag.wireEls = null;
  }
  if (!bxDrag.groups) {
    bxDrag.groups = [];
    for (const id of (bxDrag.ids || [])) {
      const g = root.querySelector ? root.querySelector('.dnode[data-id="' + id + '"]') : null;
      bxDrag.groups.push({ id, g });
    }
  }
  for (const it of bxDrag.groups) {
    const n = bxNode(it.id), st = bxDrag.starts && bxDrag.starts[it.id];
    if (!n || !st || !it.g || !it.g.setAttribute) continue;
    it.g.setAttribute("transform", "translate(" + (n.x - st.x) + " " + (n.y - st.y) + ")");
  }
  if (!bxDrag.wireEls) {
    const moved = new Set(bxDrag.ids || []);
    bxDrag.wireEls = [];
    for (const e of BX.edges) {
      if (!moved.has(e.from) && !moved.has(e.to)) continue;
      const w = bxWireEls(root, e);
      if (w) bxDrag.wireEls.push(w);
    }
  }
  for (const w of bxDrag.wireEls) bxWirePaint(w);
  bxGuidesPaint(root);
}
function bxWireRepaint(root, ids) {           // re-route the wires touching `ids`
  if (!root) return;
  const touched = new Set(ids || []);
  for (const e of BX.edges) {
    if (!touched.has(e.from) && !touched.has(e.to)) continue;
    const w = bxWireEls(root, e);
    if (w) bxWirePaint(w);
  }
}
// A live corner-resize redraws one card, not the whole canvas. The card's pane
// is carried over, so a dataset table or agent log keeps its scroll and focus
// while the window grows. The drop lands a full render once.
function bxResizePaint(n) {
  const host = bxHost();
  const root = host && host.querySelector ? host.querySelector("svg") : null;
  if (!root || !n) return false;
  const oldG = root.querySelector ? root.querySelector('.dnode[data-id="' + n.id + '"]') : null;
  if (!oldG || !oldG.parentNode) return false;
  const pane = oldG.querySelector ? oldG.querySelector(".bxlogpane") : null;
  const next = bxCard(n, { pane: pane });
  oldG.parentNode.replaceChild(next, oldG);
  bxWireRepaint(root, [n.id]);
  return true;
}
function bxMarqueePaint() {
  const host = bxHost();
  const root = host && host.querySelector ? host.querySelector("svg") : null;
  if (!root) return;
  let el = root.querySelector ? root.querySelector(".bxmarquee") : null;
  if (!bxMarqueeRect) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    return;
  }
  if (!el) {
    el = svg("rect", { class: "bxmarquee" });
    root.appendChild(el);
  }
  const r = bxMarqueeRect;
  const x = Math.min(r.x0, r.x1), y = Math.min(r.y0, r.y1);
  if (el.setAttribute) {
    el.setAttribute("x", x);
    el.setAttribute("y", y);
    el.setAttribute("width", Math.abs(r.x1 - r.x0));
    el.setAttribute("height", Math.abs(r.y1 - r.y0));
  }
}
function bxMoveTo(id, x, y) {
  const n = bxNode(id);
  if (!n) return;
  n.x = Math.round(x); n.y = Math.round(y);
  bxRender();
}
function bxBoxErrorText(n) {
  const mine = BX.nodes.some(x => x.id === n.id);
  const edges = mine ? BX.edges : null;
  if (edges) {
    const nIn = bxPortDefs(n, "in").length, nOut = bxPortDefs(n, "out").length;
    const wi = new Set(), wo = new Set();
    for (const e of edges) {
      if (e.to === n.id) wi.add(e.toPort || 0);
      if (e.from === n.id) wo.add(e.fromPort || 0);
      if ((e.from === n.id || e.to === n.id) && bxWireState(e) === "bad")
        return "size mismatch on this box's wire";
    }
    for (let i = 0; i < nIn; i++) if (!wi.has(i)) return "an input dot is not wired";
    if (nOut && !wo.size) return "its output goes nowhere";
    if (!nIn && !nOut && !wi.size && !wo.size) return "this box is isolated";
  }
  if (n.kind === "custom" && bxErrorSet(n.inner || { nodes: [], edges: [] }).size)
    return "something inside this box is in error";
  return null;
}
function bxNumText(v) {                        // a value, short enough for a card
  if (v == null || v === "") return "?";       // an inf/nan stat arrives as null
  const n = Number(v);
  if (!isFinite(n)) return "?";
  if (n === 0) return "0";
  if (Number.isInteger(n)) return String(n);   // an id, a count — kept exact
  const a = Math.abs(n);
  if (a >= 1000 || a < 0.001) return n.toExponential(1).replace("e+", "e");
  return String(Math.round(n * 1000) / 1000);
}
function bxNodeState(n) {                      // what the last run left on this box
  if (bxDataState[n.id] != null) return bxDataState[n.id];
  if (n.kind !== "input" && n.kind !== "output" && n.kind !== "sample" &&
      n.kind !== "detokenize" && n.kind !== "hf" && n.kind !== "heatmap")
    return null;                               // only the data boxes wear values
  const path = (bxCurrentPath() || []).concat(n.id).join("/");
  return bxRunValues[path] || null;            // keyed by full path: any level works
}
function bxStateText(st) {                     // the data a box carries, as content
  if (!st) return null;
  if (st.text != null) return "\u201c" + bxClip(st.text, 22) + "\u201d";
  if (st.image)                                // a picture, not numbers
    return "image " + (st.image.w || "?") + "\u00d7" + (st.image.h || "?");
  const peek = st.peek || [];
  const sh = (st.shape || []).map(Number);
  if (peek.length) {
    const count = sh.reduce((a, b) => a * b, 1);
    const nums = peek.map(bxNumText);
    return nums.join(", ") + (count > peek.length ? ", \u2026" : "");
  }
  if (st.scalar != null) return bxNumText(st.scalar);
  if ((sh.length === 0 || (sh.length === 1 && sh[0] === 1)) && st.mean != null)
    return bxNumText(st.mean);
  return "[" + sh.join("\u00d7") + "] \u00b7 \u03bc " + (st.mean == null ? "?" : bxNumText(st.mean));
}
function bxPlainPort(n) {                      // a nested boundary port: a box,
  return !!n && !!BX.up && (n.kind === "input" || n.kind === "output");
}                                              // and nothing painted on it
function bxHasPane(n) {                        // a box whose card holds an editor
  if (!n) return false;
  if (n.kind === "input" || n.kind === "output")
    return !BX.up;                             // inside a nested box they are the
  return (n.kind === "agent" || n.kind === "train" ||   // boundary's ports, and a
          n.kind === "dataset" || n.kind === "select" ||  // model is a container:
          n.kind === "config" || n.kind === "training" || // both stay plain —
          n.kind === "heatmap");
}                                              // no editor, no readout inside
/**
 * Draw one box as an SVG group: body, rails, labels, ports and, when it has
 * one, its embedded pane. `opts.pane` reuses an existing pane — a live resize
 * moves it into the new foreignObject instead of rebuilding it.
 */
function bxCard(n, opts) {
  const preview = String(n.id || "").indexOf("pal-") === 0;   // palette chrome
  const off = preview ? !!n.off : bxBoxOff(n);
  const frozen = preview ? !!n.frozen : bxBoxFrozen(n);
  const err = bxErrBoxes.has(n.id);
  const warned = !preview && bxWarnBoxes.has(n.id);
  const warn = warned && !err;
  const fmark = preview ? null : bxNodePath(n);   // the mark this box carries
  const tint = !preview && bxTrainTint ? bxTrainTint.marks.get(n.id) : null;
  const g = svg("g", { class: "dnode" + (bxSelBox(n.id) ? " sel" : "") + (err ? " err" : "") +
                            (warn ? " warn" : "") + (off ? " off" : "") +
                            (fmark != null && bxFlowSet.has(fmark) ? " flow" : "") +
                            (fmark != null && bxFlowLive(fmark) ? " now" : "") +
                            (tint ? " " + tint : "") +
                            (bxRunErr && bxRunErr.ids && bxRunErr.ids.has(n.id) ? " runerr" : "") +
                            (bxAudit && bxAudit.ids && bxAudit.ids.has(n.id) ? " audit" : ""),
                       "data-id": n.id });
  const ins = bxPortDefs(n, "in"), outs = bxPortDefs(n, "out");
  // an input dot whose feed is a deactivated output starves: amber ring
  const starved = new Set();
  if (!off) for (const e of BX.edges) {
    if (e.to !== n.id) continue;
    const from = bxNode(e.from);
    if (from && (bxOffHere(from) || bxPortOff(from, "out", e.fromPort)))
      starved.add(e.toPort || 0);
  }
  const h = bxNodeH(n), w = bxNodeW(n);
  const popHost = !preview ? bxTrainHostOf(n) : null;   // a seated model: its side
  if (ins.length && !popHost)                  // dots and rails give way to the
    g.appendChild(svg("rect", { x: n.x - 9, y: n.y + 2, width: 18, height: h - 4, rx: 7,
                                class: "drail in", "data-node": n.id }));   // release
  if (outs.length && !popHost)                 // dot at its foot
    g.appendChild(svg("rect", { x: n.x + w - 9, y: n.y + 2, width: 18, height: h - 4, rx: 7,
                                class: "drail out", "data-node": n.id }));
  const isSheet = n.kind === "dataset";       // its sheet is inset inside the card
  const seated = !!(n.kind === "training" && n.model && bxFindBox(n.model));
  const slot = n.kind === "training" ? bxTrainNotch(n, w) : null;   // the model's
  if (slot && !seated)                        // empty: the top edge steps in —
    g.appendChild(svg("path", { class: "drect", "data-node": n.id,
                                d: "M " + n.x + " " + (n.y + h)
                                 + " L " + n.x + " " + n.y
                                 + " L " + (n.x + slot.x) + " " + n.y
                                 + " L " + (n.x + slot.x) + " " + (n.y + slot.d)
                                 + " L " + (n.x + slot.x + slot.w) + " "
                                 + (n.y + slot.d)
                                 + " L " + (n.x + slot.x + slot.w) + " " + n.y
                                 + " L " + (n.x + w) + " " + n.y
                                 + " L " + (n.x + w) + " " + (n.y + h) + " Z" }));
  else
    g.appendChild(svg("rect", { x: n.x, y: n.y, width: w, height: h,
                                rx: 9, class: "drect" }));
  if (slot) {                                 // the slot's own hit area: a drop
    g.appendChild(svg("rect", { x: n.x + slot.x, y: n.y - 0.5,   // on the notch
                                width: slot.w, height: slot.d + 0.5,   // docks too
                                class: "dslothit" }));
    if (!seated)                              // empty: a dashed ghost of a model
      g.appendChild(svg("rect", { x: n.x + slot.x + 2, y: n.y + 2,  // card, sitting
                                  width: Math.max(20, slot.w - 4),   // in the socket
                                  height: Math.max(16, slot.d - 4),
                                  rx: 9, class: "dslot" }));
  }
  g.appendChild(svgText(n.x + 9, n.y + 15,
                        slot ? bxClipFit(bxKindLabel(n.kind), slot.x - 12, 7)
                             : bxKindLabel(n.model ? "model" : n.kind),
                        "dtype " + (n.model ? "model" : n.kind)));
  if (!preview && bxSelBox(n.id))            // the red dot: "you are here" (Salon)
    g.appendChild(svg("circle", { cx: n.x + w - 8, cy: n.y + 8, r: 3, class: "seldot" }));
  let rightX = w - 9;                          // the corner marks stack right-to-left
  if (tint) {                                  // the training signal's mark
    const tag = TINT_TAG[tint] || "?";
    g.appendChild(svgText(n.x + rightX, n.y + 15, tag, "dtag " + tint));
    rightX -= Math.round(tag.length * 5.4) + 6;
  }
  if (err) { g.appendChild(svgText(n.x + rightX, n.y + 15, "!", "dwarn")); rightX -= 14; }
  else if (warn) { g.appendChild(svgText(n.x + rightX, n.y + 15, "!", "dwarn2")); rightX -= 14; }
  if (frozen) {                              // a tiny six-pointed snowflake
    const cx = n.x + rightX - 2, cy = n.y + 12, r = 4.5;
    for (let k = 0; k < 3; k++) {
      const a = Math.PI * k / 3;
      g.appendChild(svg("line", { x1: cx - Math.cos(a) * r, y1: cy - Math.sin(a) * r,
                                  x2: cx + Math.cos(a) * r, y2: cy + Math.sin(a) * r,
                                  class: "dfroz", "stroke-linecap": "round" }));
    }
    rightX -= 16;
  }
  if (n.place === "gpu" || n.place === "system")   // where this layer was loaded
    g.appendChild(svgText(n.x + rightX, n.y + 15, n.place === "gpu" ? "gpu" : "sys",
                          "dplace " + (n.place === "gpu" ? "gpu" : "sys")));
  g.appendChild(svgText(n.x + 9, n.y + 32,
                        bxClipFit(n.name || bxKindLabel(n.kind),
                                  slot ? slot.x - 12 : w, 7), "dlabel"));
  // the value line sits at the bottom of the card, so it is never cut
  const unset = (n.kind === "layer") ? (n.din == null || n.dout == null)
              : (n.kind === "embed") ? (n.vocab == null || n.dout == null)
              : (n.kind === "input") ? n.dout == null
              : (n.kind === "output") ? !bxOutputFeed(n) : false;   // nothing wired
  const vcls = n.kind === "act" ? " fn" : n.kind === "op" ? " opfn"
             : n.kind === "script" ? " fn"
             : (unset ? " unset" : "");
  let bottom = bxShape(n);
  if (n.kind === "input" && n.input_mode === "image") bottom += " \u00b7 img";
  if (n.dtype && (n.kind === "layer" || n.kind === "embed" || n.kind === "norm" ||
                  (n.t && (n.kind === "op" || n.kind === "script"))))
    bottom += " \u00b7 " + n.dtype;              // the weights' dtype, from the file
  if (!isSheet)
    g.appendChild(svgText(n.x + 9, n.y + h - 11, bxClipFit(bottom, w), "dshape lower" + vcls));
  const stateText = bxStateText(bxNodeState(n));  // the data the last run left here
  const task = n.kind === "agent" ? bxTask(n.task_id) : null;   // its agent task
  if (task && !preview) {                    // the ring: how far the task has got
    const cx = n.x + w - 24, cy = n.y + 28, r = 13;
    g.appendChild(svg("path", { d: bxArcPath(cx, cy, r, 1), class: "dringbg" }));
    const arc = bxArcPath(cx, cy, r, bxTaskFraction(task));
    if (arc) g.appendChild(svg("path", { d: arc, class: "dring" }));
    g.appendChild(svgText(cx, cy + 4,
                          Math.round(100 * bxTaskFraction(task)) + "%", "dringnum"));
  }
  if ((bxHasPane(n)) && !preview) {
    const ps = slot ? slot.d + 6 : 40;    // a Training box's pane starts below
    const fo = svg("foreignObject",       // the socket: the model never covers it
                   { x: n.x + 5, y: n.y + ps,
                     width: Math.max(80, w - 10),
                     height: Math.max(40, h - ps - 6), class: "bxlogfo" });
    const keep = opts && opts.pane;       // a live resize keeps the pane (and its
    const pane = keep || mk("div", { class: "bxlogpane" });   // scroll/focus)
    if (keep) {
      if (!pane.getAttribute || !pane.getAttribute("data-agent"))
        pane.setAttribute("data-agent", n.id);
    } else {
      pane.setAttribute("data-agent", n.id);
      bxPaneFill(pane, n);
    }
    fo.appendChild(pane);
    g.appendChild(fo);
  }
  // a pane box owns the space below its title — its data, its task and the
  // run's blame live in its window, never painted over it
  if (!isSheet && !bxHasPane(n)) {
    if (bxRunErr && bxRunErr.ids && bxRunErr.ids.has(n.id))
      g.appendChild(svgText(n.x + 9, n.y + 48,
                            bxClipFit(bxRunErr.here === n.id
                                      ? String(bxRunErr.msg).replace(/^[^:]{1,80}:\s*/, "")
                                      : "failed inside", w),
                            "dstate err"));
    else if (task)
      g.appendChild(svgText(n.x + 9, n.y + 48,
                            bxClipFit(bxTaskProgress(task) || bxTaskChip(task), w),
                            "dstate rev"));
    else if (stateText && !bxPlainPort(n))
      g.appendChild(svgText(n.x + 9, n.y + 48, bxClipFit(stateText, w), "dstate"));
  }
  const dot = (at, dir, i, size) => {
    const dead = off || (dir === "out" && bxPortOff(n, "out", i));
    const mark = dead ? " doff" : (dir === "in" && starved.has(i) ? " dstarved" : "");
    g.appendChild(svg("circle", { cx: at.x, cy: at.y, r: 5, class: "dport vis " + dir + mark,
                                  "data-node": n.id, "data-port": i }));
    const hit = svg("circle", { cx: at.x, cy: at.y, r: 11, class: "dport hit " + dir,
                                "data-node": n.id, "data-port": i });
    g.appendChild(hit);
  };
  if (!popHost) {
    outs.forEach((p, i) => dot(bxPortPos(n, "out", i, outs.length), "out", i, p.size));
    ins.forEach((p, i) => dot(bxPortPos(n, "in", i, ins.length), "in", i, p.size));
  } else {                                     // the release instead: one dot at the
    const cx = n.x + w / 2, cy = n.y + h;      // model's foot \u2014 clicking it
    g.appendChild(svg("circle", { cx, cy, r: 6, class: "dpop", "data-node": n.id }));
    g.appendChild(svg("circle", { cx, cy, r: 13, class: "dpop hit",
                                  "data-node": n.id }));   // pops the model out
  }
  return g;
}
function bxWirePath(a, b, via, aPort, aCount, bPort, bCount) {
  const p = bxPortPos(a, "out", aPort, aCount);
  const q = bxPortPos(b, "in", bPort, bCount);
  const dx = Math.max(40, Math.abs(q.x - p.x) * 0.5);
  let c1 = { x: p.x + dx, y: p.y }, c2 = { x: q.x - dx, y: q.y };
  if (via) {
    // shift both control points so the curve passes exactly through `via`
    const m = { x: (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8,
                y: (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8 };
    const k = 4 / 3, d = { x: (via.x - m.x) * k, y: (via.y - m.y) * k };
    c1 = { x: c1.x + d.x, y: c1.y + d.y };
    c2 = { x: c2.x + d.x, y: c2.y + d.y };
  }
  return "M " + p.x + " " + p.y + " C " + c1.x + " " + c1.y + ", " +
         c2.x + " " + c2.y + ", " + q.x + " " + q.y;
}
function bxPaneScrollRestore(root) {           // after a render is attached:
  // every render rebuilds the windows whole — a running poll mid-scroll must
  // not throw the reader's place away. Each pane picks its offset back up.
  // (The agent's and the server config's logs keep their own, autoscrolling
  // memories.)
  if (!root || !root.querySelectorAll) return;
  const panes = root.querySelectorAll(".bxlogpane");
  if (!panes.length) return;                 // no windows: no layout read
  if (root.getBoundingClientRect) root.getBoundingClientRect();   // layout first:
  for (const pane of panes) {                // an unlaid-out
                                                                 // scroller clamps
                                                                 // the offset to 0
    const id = pane.getAttribute ? pane.getAttribute("data-agent") : null;
    const n = id ? bxNode(id) : null;
    if (!n || n.kind === "agent" || n.kind === "train") continue;
    const sc = pane.querySelector
      ? (pane.querySelector(".bxpbody") || pane.querySelector(".bxinputbody"))
      : null;
    const want = Number((n._scroll || {}).top) || 0;
    if (sc && want && sc.scrollTop !== undefined) sc.scrollTop = want;
  }
}
/**
 * Redraw the whole canvas from BX: grid, wires, cards, guides, marquee and the
 * nested-box breadcrumb. Also restores each pane's scroll offset and reflows
 * the floating menu. This is a full rebuild; the live drag and marquee paths
 * use bxDragPaint/bxMarqueePaint instead and land here once, on drop.
 */
function bxRender() {
  const host = bxHost();
  if (!host) return;
  bxtRefresh();                             // the toolbar follows nesting
  if (BX.view.cx == null) {                 // materialise the view once, so
    const b = bxBounds();                   // later moves never re-centre it
    BX.view = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, k: 1 };
  }
  host.innerHTML = "";
  const root = svg("svg", { class: "bxsvg", width: "100%", height: "100%",
                            viewBox: bxViewBox(), preserveAspectRatio: "xMidYMid slice" });
  root.appendChild(bxGrid());               // the grid sits behind everything
  bxVisPaths = new Map();
  bxHotEdge = null;
  bxHotBadge = null;
  bxTipHide();                             // a redraw takes the hover card with it
  bxErrBoxes = bxErrorSet({ nodes: BX.nodes, edges: BX.edges });
  bxWarnBoxes = bxWarnSet({ nodes: BX.nodes, edges: BX.edges });
  bxTrainTint = bxTrainTintInfo();              // the training signal's marks
  const vramMenu = $("bxtVramMenu");
  if ($("bxvram") && vramMenu && !vramMenu.hidden) bxRenderEstimate();
  for (const e of BX.edges) {
    const a = bxNode(e.from), b = bxNode(e.to);
    if (!a || !b || a.hidden || b.hidden) continue;
    const ac = bxPortDefs(a, "out").length, bc = bxPortDefs(b, "in").length;
    const d = bxWirePath(a, b, e.via, e.fromPort, ac, e.toPort, bc);
    const state = bxWireState(e);
    const sel = bxSelEdge(e) ? " sel" : "";
    const attrs = { d, class: "dedge" + (state === "match" ? "" : " " + state) + sel +
                            (bxFlowSet.has(bxPathId(e.from)) ? " flow" : "") +
                            (bxTrainTint && bxTrainTint.edges.has(bxPathId(e.from)) ? " tgrad" : ""),
                    "data-from": e.from, "data-to": e.to,
                    "data-fp": e.fromPort || 0, "data-tp": e.toPort || 0 };
    const vis = svg("path", attrs);
    bxVisPaths.set(bxEdgeKey(e), vis);
    root.appendChild(vis);
    const hitAttrs = {};
    for (const k2 in attrs) hitAttrs[k2] = attrs[k2];
    hitAttrs.class = "dedge-hit" + sel;        // its own class, not the wire's
    root.appendChild(svg("path", hitAttrs));
  }
  for (const n of BX.nodes) if (!n.hidden) root.appendChild(bxCard(n));
  if (bxGuides.length) root.appendChild(bxGuideLayer());
  if (bxMarqueeRect) {
    const r = bxMarqueeRect;
    root.appendChild(svg("rect", { x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1),
                                   width: Math.abs(r.x1 - r.x0), height: Math.abs(r.y1 - r.y0),
                                   class: "bxmarquee" }));
  }
  host.appendChild(root);
  bxPaneScrollRestore(root);                // the windows pick their scroll back
  bxMenuPlace();
  if (BX.up) {                              // inside a custom box: a way back
    const up = bxUpBox();
    const bar = mk("div", { class: "bxcrumbs" });
    const back = mk("span", { class: "chip tiny", text: "\u2190 back" });
    back.addEventListener("click", bxLeave);
    bar.appendChild(back);
    bar.appendChild(mk("b", { text: up ? up.name : "nested box" }));
    bar.appendChild(mk("span", { class: "panehint",
      text: (BX.stack.length > 1 ? "nested " + BX.stack.length + " deep — " : "") +
            "its input/output boxes are this box's dots" }));
    host.appendChild(bar);
  }
}
// ---- inside a custom box ----------------------------------------------------
function bxUpBox() {
  if (!BX.up || !BX.stack || !BX.stack.length) return null;
  const parent = BX.stack[BX.stack.length - 1];
  return parent.nodes.find(n => n.id === BX.up) || null;
}
function bxEnter(id) {
  const n = bxNode(id);
  if (!n || n.kind !== "custom") return false;
  if (!n.inner) n.inner = { nodes: [], edges: [] };
  BX.stack = BX.stack || [];
  BX.stack.push({ nodes: BX.nodes, edges: BX.edges, up: BX.up || null,
                  view: { cx: BX.view.cx, cy: BX.view.cy, k: BX.view.k } });
  BX.nodes = n.inner.nodes;
  BX.edges = n.inner.edges;
  BX.up = n.id;
  bxSel = null;                                // the marks are keyed by path:
  BX.view = { cx: null, cy: null, k: 1 };      // entering only changes what is drawn
  bxRender();
  bxRenderPalette();
  return true;
}
function bxLeave() {
  const top = (BX.stack || []).pop();
  if (!top) return false;
  BX.nodes = top.nodes;
  BX.edges = top.edges;
  BX.up = top.up;
  bxSel = null;                                // the marks survive the trip
  BX.view = top.view || { cx: null, cy: null, k: 1 };
  bxRender();
  bxRenderPalette();
  return true;
}
function bxRefresh() { bxRender(); }

