// ─── nnstudio shell · 80 · menus and toolbar ─────────────────────────────────────
// the two right-click menus, the JSON form, and the toolbar dropdowns/palette toggles.
// Order is load-bearing: this slice is concatenated after the one before it.

// ---- the two right-click menus ---------------------------------------------
function bxMenuPlace() {
  const m = $("bxmenu"), w = $("bxwrap");
  if (!m || !w || m.hidden || !bxMenuAt) return;
  const r = w.getBoundingClientRect ? w.getBoundingClientRect() : { width: 900, height: 500 };
  m.style.left = Math.max(6, Math.min(bxMenuAt.x, (r.width || 900) - (m.offsetWidth || 170) - 6)) + "px";
  m.style.top = Math.max(6, Math.min(bxMenuAt.y, (r.height || 500) - (m.offsetHeight || 120) - 6)) + "px";
}
function bxMenuClose() {
  const m = $("bxmenu");
  bxMenuAt = null;
  bxAddOpen = null;                            // every fresh menu starts collapsed
  if (m) { m.hidden = true; m.innerHTML = ""; }
}
function bxMenuAt_(x, y) { bxMenuAt = { x, y }; }
function bxMenuShow() {                        // a form opened with no menu under it
  const m = $("bxmenu");                       // (the Import door, a chip): show it
  if (!m) return;                              // up front, like the gguf import
  m.hidden = false;
  const w = $("bxwrap");
  const r = (w && w.getBoundingClientRect) ? w.getBoundingClientRect()
                                           : { width: 900, height: 500 };
  bxMenuAt_(Math.max(6, ((r.width || 900) - (m.offsetWidth || 340)) / 2),
            Math.max(6, ((r.height || 500) - (m.offsetHeight || 180)) / 2));
  bxMenuPlace();
}
function bxMenu(ev) {
  ev.preventDefault();
  bxTipHide();
  const w = $("bxwrap"), m = $("bxmenu");
  if (!w || !m) return;
  const r = w.getBoundingClientRect ? w.getBoundingClientRect() : { left: 0, top: 0 };
  bxMenuAt_((ev.clientX || 0) - r.left, (ev.clientY || 0) - r.top);
  const box = ev.target && ev.target.closest ? ev.target.closest(".dnode") : null;
  const id = box && box.getAttribute ? box.getAttribute("data-id") : null;
  const wire = ev.target && ev.target.closest ? ev.target.closest(".dedge-hit") : null;
  const wkey = wire && wire.getAttribute
    ? [wire.getAttribute("data-from") || "", wire.getAttribute("data-to") || "",
       wire.getAttribute("data-fp") || 0, wire.getAttribute("data-tp") || 0].join(">") : null;
  bxMenuBuild(id ? "box" : (wkey ? "edge" : "canvas"), id || wkey, ev);
  m.hidden = false;
  bxMenuPlace();
}
let bxAddOpen = null;                          // which add-menu category is dropped down
/**
 * Fill #bxmenu for the current context: "canvas" (add a box / design actions),
 * "box" (rename, settings, freeze, off, nesting), or "edge" (reshape/remove).
 * A fresh menu starts with every category collapsed.
 */
function bxMenuBuild(mode, id, ev) {
  const m = $("bxmenu");
  if (!m) return;
  m.innerHTML = "";
  const item = (text, fn) => {
    const it = mk("div", { class: "mi", text });
    it.addEventListener("click", fn);
    m.appendChild(it);
  };
  // a category header that drops down into its items — the canvas and the
  // box menus share it; a fresh menu always starts collapsed
  const section = (name, label, entries, rebuild) => {
    const open = bxAddOpen === name;
    const head = mk("div", { class: "mhead drop" + (open ? " on" : ""),
                             text: label, title: open ? "collapse" : "expand" });
    head.appendChild(mk("span", { class: "chev", text: open ? "\u25be" : "\u25b8" }));
    head.addEventListener("click", () => {
      bxAddOpen = open ? null : name;
      rebuild();
      bxMenuPlace();
    });
    m.appendChild(head);
    if (!open) return;
    for (const [text, fn] of entries) item(text, fn);
  };
  if (mode === "edge") {
    const e = bxKeyEdge(id);
    if (e && e.via)
      item("reset the wire's shape", () => { bxMenuClose(); bxClearVia(e); bxCommit(); });
    item("remove this wire", () => {
      bxMenuClose();
      if (e) bxRemoveEdge(e.from, e.to, e.fromPort, e.toPort);
    });
    return;
  }
  if (mode === "box") {
    const n = id ? bxNode(id) : null;
    if (n) {
      const again = () => bxMenuBuild("box", n.id, ev);
      const selIds = bxSelectedIds();
      const many = selIds.indexOf(n.id) >= 0 && selIds.length > 1;
      const group = many ? BX.nodes.filter(x => selIds.indexOf(x.id) >= 0) : [n];
      const allOff = group.every(x => bxOffHere(x));    // what the cards show
      const allFrozen = group.every(x => x.frozen);
      // this box: its name, copy, and whatever sets this kind
      const mine = [];
      if (n.kind !== "train")                    // the Run box has no rename
        mine.push(["rename this box", () => bxForm(n.kind, null, n, "rename")]);
      mine.push([many ? ("copy these " + selIds.length + " boxes") : "copy this box",
                 () => { bxMenuClose(); bxCopyBoxes(many ? selIds : [n.id]); }]);
      if (n.kind === "act") mine.push(["set the activation", () => bxForm(n.kind, null, n, "activation")]);
      else if (n.kind === "agent" || n.kind === "train") {
        mine.push(["expand / shrink the display", () => { bxMenuClose();
          const p = n.panel || (n.panel = {});
          p.expand = !p.expand;
          n.box = p.expand ? { w: 800, h: 480 } : { w: 480, h: 320 };
          bxRender(); }]);
      }
      else if (n.kind === "op") mine.push(["set the operation", () => bxForm(n.kind, null, n, "operation")]);
      else if (n.kind === "embed") mine.push(["set the embedding", () => bxForm(n.kind, null, n, "embed")]);
      else if (n.kind === "norm") mine.push(["set the norm", () => bxForm(n.kind, null, n, "norm")]);
      else if (n.kind === "conv") mine.push(["set the convolution …",
                                             () => bxForm(n.kind, null, n, "resize")]);
      else if (n.kind === "script") mine.push(["edit the script …", () => bxForm(n.kind, null, n, "script")]);
      else if (n.kind === "tokenize" || n.kind === "detokenize")
        mine.push(["set the tokenizer …", () => bxForm(n.kind, null, n, "token")]);
      else if (n.kind === "hf")
        mine.push(["set the model …", () => bxForm(n.kind, null, n, "hf")]);
      else if (n.kind === "sample") mine.push(["set the sample …", () => bxForm(n.kind, null, n, "sample")]);
      else if (n.kind === "dataset") {
        mine.push(["set the rows …", () => bxForm(n.kind, null, n, "dataset")]);
        mine.push(["expand / shrink the sheet", () => {
          bxMenuClose();
          bxDatasetExpand(n);
          bxRender();
        }]);
      }
      else if (n.kind === "reward") mine.push(["set the reward …", () => bxForm(n.kind, null, n, "reward")]);
      else if (n.kind === "training") {
        if (n.model && bxFindBox(n.model))
          mine.push(["undock the model", () => {
            bxMenuClose();
            bxUndockModel(n.id);
          }]);
        mine.push(["resize this box", () => bxForm(n.kind, null, n, "resize")]);
      }
      else if (n.kind === "input") {
        mine.push(["set input", () => bxForm(n.kind, null, n, "matrix")]);
        mine.push(["resize this box", () => bxForm(n.kind, null, n, "resize")]);
      } else if (n.kind !== "custom")
        mine.push(["resize this box", () => bxForm(n.kind, null, n, "resize")]);
      if (n.kind === "custom") {               // a seated model can step back
        const host = bxTrainHostOf(n);         // out of its socket
        if (host)
          mine.push(["undock from " + (host.name || "the training box"), () => {
            bxMenuClose();
            bxUndockModel(host.id);
          }]);
      }
      if (!BX.up && bxWeightsBox(n))            // the weights, into a model
        mine.push(["wrap the weights into a model", () => {
          bxMenuClose();
          bxWrapModel();
        }]);
      section("this box", "this box", mine, again);
      // weights: the dtype, where it loads, external files
      const wts = [];
      if (n.kind === "layer" || n.kind === "norm" || n.kind === "embed" ||
          (n.t && n.kind !== "custom"))
        wts.push(["set the dtype", () => bxForm(n.kind, null, n, "dtype")]);
      if (bxWeightedBox(n)) {
        const cur = n.place === "system" ? "system" : "gpu";
        const place = (key, label) =>
          [(cur === key ? "\u25cf " : "\u00a0\u00a0 ") + label,
           () => { bxMenuClose(); bxSetPlace(n.id, key); }];
        wts.push(place("gpu", "load on the gpu \u2014 video memory"));
        wts.push(place("system", "load on the system \u2014 this machine's ram"));
      }
      if (bxWeightedBox(n) || n.t)
        wts.push(["load external weights …", () => bxWeightsForm(n.id)]);
      if (wts.length) section("weights", "weights", wts, again);
      // inside: a nested box's own network (custom only)
      if (n.kind === "custom") {
        const inside = [];
        inside.push(["go inside", () => { bxMenuClose(); bxEnter(n.id); }]);
        inside.push(["export this nested box as JSON", () => bxJSONForm("export", n, null)]);
        inside.push(["import into this nested box …", () => bxJSONForm("import", n, null)]);
        section("inside", "inside", inside, again);
      }
      // flow: deactivated, frozen
      section("flow", "flow", [
        [many ? (allOff ? "activate these " + group.length + " boxes"
                        : "deactivate these " + group.length + " boxes")
              : (bxOffHere(n) ? "activate this box" : "deactivate this box"),
         () => {
           bxMenuClose();
           const on = !allOff;
           for (const x of group) {
             if (on) {
               x.off = true;
             } else {
               delete x.off;                           // back on…
               if (bxInnerOutOff(x))                   // …and its dead outputs with it
                 bxBoundary(x, "out").forEach(k => delete k.off);
             }
           }
           bxSettleSizes();
           bxRender();
           bxCommit();
         }],
        [many ? (allFrozen ? "unfreeze these " + group.length + " boxes"
                           : "freeze these " + group.length + " boxes")
              : (n.frozen ? "unfreeze this box" : "freeze this box"),
         () => {
           bxMenuClose();
           const on = !allFrozen;
           for (const x of group) { if (on) x.frozen = true; else delete x.frozen; }
           bxSettleSizes();
           bxRender();
           bxCommit();
         }],
      ], again);
      item("remove this box", () => { bxMenuClose(); bxRemove(n.id); });
    }
    return;
  }
  // the add menu: categories that drop down, one at a time
  const again = () => bxMenuBuild("canvas", null, ev);
  // the shelves, the same list the palette shows \u2014 one taxonomy, both doors
  for (const [name, cards] of BX_PALETTE()) {
    const here = cards.filter(([kind]) => bxPlaceable(kind));
    const entries = here.map(([kind, label]) => [label, () => {
      const w = bxPoint(ev);
      bxMenuClose();
      bxAddKind(kind, w.x, w.y);
    }]);
    if (name === "Text" && here.length)          // the shortcut the pair deserves
      entries.push(["load a tokenizer \u2026",
                    () => bxForm("tokenize", ev, null, "loadtok")]);
    if (!entries.length) continue;               // nothing here lands at this level
    section(name, name, entries, again);
  }
  const design = [];
  if (bxCopied) design.push(["paste", () => {     // at the point you right-clicked
    const w = ev ? bxPoint(ev) : null;
    bxMenuClose();
    bxPasteBoxes(null, w);
  }]);
  if (BX.up) {                                    // inside a nested box: no canvas to save/load
    design.push(["import a nested box …", () => bxJSONForm("import", null, ev)]);
  } else {
    design.push(["export the canvas as JSON", () => bxJSONForm("export", null, ev)]);
    design.push(["import JSON …", () => bxJSONForm("import", null, ev)]);
    design.push(["export weights …", () => {
      bxMenuClose();
      bxWeightsExportForm();
    }]);
  }
  section("the design", "the design", design, again);
}
// the design as JSON: export opens it in a textarea to copy out, import reads
// one back. A refused import just reddens the field and stays open — no text.
function bxJSONForm(mode, node, ev) {
  const m = $("bxmenu");
  if (!m) return;
  const isExport = mode === "export";
  m.innerHTML = "";
  const wrap = mk("div", { class: "bf" });
  const ta = mk("textarea", { class: "bxjson", spellcheck: "false",
    placeholder: node ? "paste a nested design here"
                      : "paste a canvas or a nested design here" });
  if (isExport) {
    ta.value = JSON.stringify(node ? bxExportNested(node.id) : bxExportCanvas(), null, 2);
    ta.readOnly = true;
  }
  wrap.appendChild(ta);
  const row = mk("div", { class: "row" });
  const chip = (text, fn) => {
    const c = mk("span", { class: "chip tiny", text });
    c.addEventListener("click", fn);
    row.appendChild(c);
    return c;
  };
  if (isExport) {
    chip("select all", () => { if (ta.focus) ta.focus(); if (ta.select) ta.select(); });
    chip("close", bxMenuClose);
  } else {
    const warn = mk("div", { class: "warnbx",
      text: "loading this canvas replaces everything already on the canvas" });
    warn.hidden = true;
    let armed = false;
    chip("cancel", bxMenuClose);
    const go = chip("load", () => {
      const where = node ? { box: node.id } : (ev ? bxPoint(ev) : { x: 0, y: 0 });
      const read = bxJSONRead(ta.value, where);
      if (!read.ok) { if (ta.classList) ta.classList.add("bad"); return; }  // refused, silently
      if (read.replaces && !armed) {           // a canvas over work: warn first
        armed = true;
        warn.hidden = false;
        go.textContent = "overwrite";
        bxMenuPlace();                         // the form grew: fit it again
        return;
      }
      bxJSONApply(read, where);
      bxMenuClose();
    });
    ta.addEventListener("input", () => { if (ta.classList) ta.classList.remove("bad"); });
    wrap.appendChild(warn);
  }
  wrap.appendChild(row);
  m.appendChild(wrap);
  bxMenuPlace();
}
// ---------------------------------------------------------------- the toolbar
// A reserved strip above the canvas. For now it carries a Files menu —
// export/import of the design as JSON, the same forms the right-click menu
// opens; the space on the right is for the tools that come later.
function bxtAnchor() {
  const w = $("bxwrap");
  const r = (w && w.getBoundingClientRect) ? w.getBoundingClientRect()
                                           : { left: 0, top: 0, width: 900, height: 500 };
  return { clientX: (r.left || 0) + 24, clientY: (r.top || 0) + 48 };
}
function bxtForm(mode) {
  if (BX.up) return false;                     // a canvas exists only at the top
  bxMenuAt_(24, 10);
  bxJSONForm(mode, null, mode === "import" ? bxtAnchor() : null);
  const m = $("bxmenu");
  if (m) m.hidden = false;                     // opened from the toolbar, not a menu
  bxMenuPlace();
  return true;
}
function bxtExport() { return bxtForm("export"); }
function bxtImport() { return bxtForm("import"); }
function bxtDropsClose(keep) {
  for (const id of ["bxtPalMenu", "bxtImportMenu", "bxtBackendMenu",
                    "bxtVramMenu", "bxtAccountMenu"]) {
    if (id === keep) continue;
    const m = $(id);
    if (m) m.hidden = true;
  }
}
function bxtPlace(menuId, btnId, hostId) {     // under its own button, never stretched
  if (!btnId) return;
  const m = $(menuId), b = $(btnId), w = $(hostId || "bxtools");
  if (!m || !b || !w || !m.style) return;
  if (m.classList && m.classList.contains("bxtdrop-r")) return;   // the right-anchored one
  const br = b.getBoundingClientRect ? b.getBoundingClientRect() : null;
  const wr = w.getBoundingClientRect ? w.getBoundingClientRect() : null;
  if (!br || !wr) return;
  const max = Math.max(6, (wr.width || 900) - (m.offsetWidth || 200) - 6);
  m.style.left = Math.max(6, Math.min(Math.round((br.left || 0) - (wr.left || 0)), max)) + "px";
  m.style.right = "auto";                      // left and right together stretch it
}
function bxtToggle(id, btnId) {
  const m = $(id);
  if (!m) return false;
  const open = !!m.hidden;                     // it was hidden: this opens it
  bxtDropsClose(id);
  m.hidden = !open;
  if (open) bxtPlace(id, btnId);               // the strip's left edge is not an address
  return open;
}
function bxtPaletteToggle() {
  return bxTalkOn() ? false : bxtToggle("bxtPalMenu", "bxtPalette");
}
function bxtImportToggle() {
  return (BX.up || bxTalkOn()) ? false : bxtToggle("bxtImportMenu", "bxtImport");
}
function bxtVramToggle() {
  if (bxTalkOn()) return false;                // no canvas: no estimate
  const open = bxtToggle("bxtVramMenu");
  if (open) bxRenderEstimate();                // the live vram line, fresh
  return open;
}
// ---- the account: guests by default, and designs even the server can't read
// Nothing is kept for a guest — drawing, wiring, running and training are all
// free, but saving a design is what an account is for. The account is Chat's
// account: one sign-in serves both halves of the app. The browser mints an
// access key (ast_ + 256 random bits, shown exactly once) and sends the server
// only its SHA-256, so the server can authenticate but never decrypt. Designs
// are sealed with an AES-GCM key derived from the access key (HKDF, byte for
// byte the derivation the Chat half uses) and live in the account's encrypted
// store as `canvas` records. The server holds ciphertext; without the access
// key nobody — the server included — can read it. Lose the key and the designs
// are gone for good.
//
// The session itself is an HttpOnly cookie the server sets: page scripts never
// hold it. What this page keeps is the derived key — a non-extractable
// CryptoKey in IndexedDB, the same cache the Chat half uses, so unlocking
// either half unlocks both — and a localStorage hint shared with the Chat half.
let BXACCT = { user: null, name: "", key: null, locked: false, site: "", captcha: false,
               known: false };                 // known: the server has said who is here
let BX_TS = { queue: null, failed: false, widget: null };
const BX_E2E = { salt: "aistudio:e2e:v1", info: "conversations", db: "aistudio" };
const BX_KEY_PREFIX = "ast_";
const BX_CANVAS_MAX = 24 * 1024 * 1024;

