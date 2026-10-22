// ─── nnstudio shell · 145 · gestures ───────────────────────────────────────
// double-click, pointer down/move/up, wiring, drops, and seeding a blank canvas.
// Order is load-bearing: this slice is concatenated after the one before it.

// ---- gestures ---------------------------------------------------------------
function bxDblClick(ev) {
  const t = ev.target;
  const onBox = t && t.closest ? t.closest(".dnode") : null;
  const id = onBox && onBox.getAttribute ? onBox.getAttribute("data-id") : null;
  const n = id ? bxNode(id) : null;
  if (n && n.kind === "custom") { ev.preventDefault(); bxEnter(n.id); return; }
  if (n && (n.kind === "agent" || n.kind === "train" || n.kind === "dataset" ||
            ((n.kind === "input" || n.kind === "output") && !BX.up))) {
    ev.preventDefault();                       // a display box: expand / shrink
    if (n.kind === "dataset") bxDatasetExpand(n);
    else if (n.kind === "input") bxInputExpand(n);
    else if (n.kind === "output") bxOutputExpand(n);
    else {
      const p = n.panel || (n.panel = {});
      p.expand = !p.expand;
      n.box = p.expand ? { w: 800, h: 480 } : { w: 480, h: 320 };
    }
    bxRender();
    return;
  }
  if (onBox) return;
  ev.preventDefault();
  bxFit();
}
function bxDown(ev) {
  if (ev.button != null && ev.button !== 0) return;
  bxTipHide();                             // a click puts the hover aids away
  if (bxMenuAt) { bxMenuClose(); return; }
  const t = ev.target;
  const nodeEl = t && t.closest ? t.closest(".dnode") : null;
  const id = nodeEl && nodeEl.getAttribute ? nodeEl.getAttribute("data-id") : null;
  const n = id ? bxNode(id) : null;
  const out = t && t.closest ? (t.closest(".dport.out") || t.closest(".drail.out")) : null;
  const inn = t && t.closest ? (t.closest(".dport.in") || t.closest(".drail.in")) : null;
  if (out && n && n.kind !== "output") { bxStartWire(ev, n); return; }
  if (inn && n && n.kind !== "input") { ev.preventDefault(); if (ev.stopPropagation) ev.stopPropagation(); return; }
  const wire = t && t.closest ? t.closest(".dedge-hit") : null;
  if (wire && wire.getAttribute) {
    const e = bxFindEdge(wire.getAttribute("data-from"), wire.getAttribute("data-to"));
    if (e) { bxStartWireShape(ev, e); return; }
  }
  if (n) {
    ev.preventDefault();
    if (ev.stopPropagation) ev.stopPropagation();
    if (ev.target && ev.target.closest && ev.target.closest(".dpop")) {
      bxDotClick(n);                         // the release dot: the model pops out
      return;
    }
    if (ev.shiftKey) { bxToggleSelect(n.id); return; }        // shift+click picks boxes one by one
    const ids = bxSelectedIds();
    if (ids.indexOf(n.id) < 0) bxSelectBoxes([n.id]);         // a plain click starts a fresh selection
    bxStartMove(ids.indexOf(n.id) >= 0 ? ids : [n.id], n.id, ev.clientX || 0, ev.clientY || 0);
    return;
  }
  ev.preventDefault();
  if (ev.shiftKey) {                                          // shift+drag draws a marquee
    const p0 = bxPoint(ev);
    bxDrag = { kind: "marquee", sx: ev.clientX || 0, sy: ev.clientY || 0 };
    bxMarqueeRect = { x0: p0.x, y0: p0.y, x1: p0.x, y1: p0.y };
    bxMarqueePaint();
    return;
  }
  const c = bxCenter();
  bxDrag = { kind: "pan", sx: ev.clientX || 0, sy: ev.clientY || 0, cx0: c.cx, cy0: c.cy, moved: false };
}
function bxStartWireShape(ev, edge) {
  ev.preventDefault();
  if (ev.stopPropagation) ev.stopPropagation();
  bxBend = { edge, sx: ev.clientX || 0, sy: ev.clientY || 0, moved: false };
}
function bxStartWire(ev, n) {
  ev.preventDefault();
  if (ev.stopPropagation) ev.stopPropagation();
  const host = bxHost();
  const root = host && host.querySelector ? host.querySelector("svg") : null;
  if (!root) return;
  const t = ev.target;
  const el = t && t.closest ? (t.closest(".dport.out") || t.closest(".drail.out")) : null;
  const fromPort = Number((el && el.getAttribute ? el.getAttribute("data-port") : 0) || 0);
  const fromCount = Math.max(1, bxPortDefs(n, "out").length);
  const p = bxPortPos(n, "out", fromPort, fromCount);
  const path = svg("path", { d: "M " + p.x + " " + p.y, class: "dedge live" });
  root.appendChild(path);
  bxWire = { from: n, fromPort, fromCount, path, sx: ev.clientX || 0,
             sy: ev.clientY || 0 };
}
function bxBadDrop(ev) {
  if (!bxWire) return false;
  const t = (document.elementFromPoint && ev) ? document.elementFromPoint(ev.clientX, ev.clientY) : null;
  const port = t && t.closest ? t.closest(".dport.in") : null;
  const toId = port && port.getAttribute ? port.getAttribute("data-node") : null;
  const toPort = port && port.getAttribute ? Number(port.getAttribute("data-port") || 0) : 0;
  return toId ? !!bxCheckLink(bxWire.from.id, toId, bxWire.fromPort, toPort).error : false;
}
function bxMove(ev) {
  if (bxBend) {                         // drag the wire itself: bend it
    const dx = (ev.clientX || 0) - bxBend.sx, dy = (ev.clientY || 0) - bxBend.sy;
    if (!bxBend.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    bxBend.moved = true;
    const p = bxPoint(ev);
    bxSetVia(bxBend.edge, bxSnapTo(p.x), bxSnapTo(p.y));       // bends sit on the grid
    return;
  }
  if (bxWire) {
    if (!bxWire.moved
        && Math.abs((ev.clientX || 0) - (bxWire.sx || 0)) +
           Math.abs((ev.clientY || 0) - (bxWire.sy || 0)) < 3) return;
    bxWire.moved = true;
    const t = bxPoint(ev);
    const p = bxPortPos(bxWire.from, "out", bxWire.fromPort, bxWire.fromCount);
    const dx = Math.max(40, Math.abs(t.x - p.x) * 0.4);
    if (bxWire.path) {
      bxWire.path.setAttribute("d",
        "M " + p.x + " " + p.y + " C " + (p.x + dx) + " " + p.y + ", " +
        (t.x - dx) + " " + t.y + ", " + t.x + " " + t.y);
      bxWire.path.setAttribute("class", "dedge live" + (bxBadDrop(ev) ? " bad" : ""));
    }
    return;
  }
  if (!bxDrag) return;
  const dx = (ev.clientX || 0) - bxDrag.sx, dy = (ev.clientY || 0) - bxDrag.sy;
  if (!bxDrag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;   // a click, not a drag
  bxDrag.moved = true;
  if (bxDrag.kind === "marquee") {
    const p = bxPoint(ev);
    if (bxMarqueeRect) { bxMarqueeRect.x1 = p.x; bxMarqueeRect.y1 = p.y; }
    bxMarqueePaint();
    return;
  }
  if (bxDrag.kind === "move") {
    const k = BX.view.k || 1;               // screen pixels → world units
    const snap = bxSnapMove(bxNode(bxDrag.id), bxDrag.x0 + dx / k, bxDrag.y0 + dy / k);
    bxGuides = snap.guides;
    const ox = snap.x - bxDrag.x0, oy = snap.y - bxDrag.y0;   // the grabbed box sets the delta
    for (const id of (bxDrag.ids || [bxDrag.id])) {
      const st = bxDrag.starts && bxDrag.starts[id];
      const n = bxNode(id);
      if (n && st) { n.x = Math.round(st.x + ox); n.y = Math.round(st.y + oy); }
    }
    bxDragPaint();
    const over = bxDropTargetAt(ev);        // hovering a nested box: show it
    if (over !== bxDropIn) {
      const root = bxHost() && bxHost().querySelector ? bxHost().querySelector("svg") : null;
      if (root && root.querySelectorAll)
        for (const g of root.querySelectorAll(".dnode.dropin")) g.classList.remove("dropin");
      bxDropIn = over;
      if (over && root) {
        const g = root.querySelector('.dnode[data-id="' + over + '"]');
        if (g && g.classList) g.classList.add("dropin");
      }
    }
    return;
  }
  const k = BX.view.k || 1;
  BX.view = { cx: bxDrag.cx0 - dx / k, cy: bxDrag.cy0 - dy / k, k };
  bxClampView();                             // the origin can never be lost
  const root = bxHost() && bxHost().querySelector ? bxHost().querySelector("svg") : null;
  if (root) root.setAttribute("viewBox", bxViewBox());
  bxGridRefresh();                           // panning only moves the viewBox
}
function bxUp(ev) {
  const movedMove = !!(bxDrag && bxDrag.moved && bxDrag.kind === "move");
  if (bxBend) {                         // dropped: near the straight middle = snap flat
    const g = bxBend;
    bxBend = null;
    if (g.moved) bxCommit();            // the new shape is one step
    if (!g.moved) {
      bxSelect({ kind: "edge", from: g.edge.from, to: g.edge.to,
                 fromPort: g.edge.fromPort, toPort: g.edge.toPort });
      return;
    }
    if (g.moved) {
      const e = g.edge, nat = bxNaturalMid(e);
      if (e.via && nat && Math.hypot(e.via.x - nat.x, e.via.y - nat.y) < 14) bxClearVia(e);
    }
    bxRender();
    return;
  }
  if (bxWire) {
    const path = bxWire.path, from = bxWire.from, fromPort = bxWire.fromPort;
    const moved = !!bxWire.moved;
    bxWire = null;
    if (path && path.parentNode) path.parentNode.removeChild(path);
    if (!moved && bxDotClick(from)) return;    // a click on a seated model's dot
    const t = (document.elementFromPoint && ev) ? document.elementFromPoint(ev.clientX, ev.clientY) : null;
    const to = t && t.closest ? t.closest(".dport.in") : null;
    const toId = to && to.getAttribute ? to.getAttribute("data-node") : null;
    const toPort = to && to.getAttribute ? Number(to.getAttribute("data-port") || 0) : 0;
    if (toId) bxConnect(from.id, toId, fromPort, toPort);
    return;
  }
  if (bxDrag && bxDrag.kind === "marquee") {
    const rect = bxMarqueeRect;
    bxMarqueeRect = null;
    bxDrag = null;
    bxMarqueeSelect(rect, false);             // the band takes what it touched
    bxRender();
    return;
  }
  if (bxDrag && bxDrag.moved && bxDrag.kind === "move" && (bxDrag.ids || []).length > 1) {
    bxCommit(true);                           // a whole group moved: one step, the run's
  } else if (bxDrag && bxDrag.moved && bxDrag.kind === "move") {   // marks stay put
    const into = bxDropTargetAt(ev);          // dropped on a nested box: move it in
    const tgt = into ? bxNode(into) : null, dra = bxNode(bxDrag.id);
    if (tgt && tgt.kind === "training" && dra && dra.kind === "custom")
      bxDockModel(tgt.id, dra.id);            // a model into the slot
    else if (into && !(tgt && tgt.kind === "training"))
      bxMoveInto(bxDrag.id, into);            // (a structural change: the data is stale)
    else bxCommit(true);                      // just a move
  } else if (bxDrag && !bxDrag.moved) {
    if (bxDrag.kind === "move") bxSelectBoxes([bxDrag.id]);   // a click leaves just that box
    else bxSelect(null);               // clicking empty canvas clears it
  }
  if (bxDropIn) {                      // no highlight survives the drag
    const root = bxHost() && bxHost().querySelector ? bxHost().querySelector("svg") : null;
    if (root && root.querySelectorAll)
      for (const g of root.querySelectorAll(".dnode.dropin")) g.classList.remove("dropin");
    bxDropIn = null;
  }
  // The drag painted transforms and wire paths; one full render puts the cards
  // back on their real coordinates and refreshes their state.
  const repaint = movedMove || bxGuides.length > 0;
  bxGuides = [];
  bxDrag = null;
  if (repaint) bxRender();
}

// A blank network is never a void: it opens as one input wired straight into
// one output — the skeleton you build outward from. A truly empty top-level
// canvas is seeded, and so is an empty canvas paired with a chat session
// (the chat half creates that record blank); a standalone design you delete
// by hand stays yours.
function bxSeedBlank() {
  if (BX.up || BX.nodes.length) return false;
  // the pair, straddling the world origin: the opening view sits on the
  // design's middle, so input and output land in the middle of the canvas
  // together — not strung off to one side
  const i = bxAdd("input", -520, -160, {});
  if (!i) return false;
  // the output sits clear of the input — a wire's runway, measured from the
  // input's real width (these are roomy windows, not little cards)
  const o = bxAdd("output", i.x + bxNodeW(i) + 200, i.y, {});
  if (!o) return false;
  bxConnect(i.id, o.id);                   // directly: input → output
  bxSettleSizes();
  // the first render materialises the camera from whatever it sees — which
  // can be the input alone. Pin it to the finished pair: both boxes open in
  // the middle of the canvas, together.
  const b = bxBounds();
  BX.view = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, k: 1 };
  bxRender();
  // a window too narrow for the pair zooms out until it holds both
  const z = bxViewport();
  if (z.w < bxNodeW(i) + bxNodeW(o) + 240) bxFit();
  return true;
}

