// ─── nnstudio shell · 115 · theme and boot ─────────────────────────────────────
// theme now/apply/toggle, save/chat/head helpers, bxtRefresh, and bxtInit.
// Order is load-bearing: this slice is concatenated after the one before it.

function bxThemeNow() {                        // "dark" (the canvas's home) or "light"
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
function bxCanvasSaveActive() {                 // best-effort: seal the canvas on
  return new Promise((resolve) => {              // screen and post it. Resolves true when
    try {                                        // the store has it, false when there's
      if (typeof fetch !== "function" || !BXACCT.user || !BXACCT.key) return resolve(false);
      const p = bxProject();
      if (!p || p.kind === "ai" || !p.canvas) return resolve(false);
      const design = bxExportCanvas() || (bxTabStash() || {}).doc || null;
      if (!design) return resolve(false);        // nothing on screen worth carrying
      (async () => {
        try {
          const rowId = bxCanvasAad(p.canvas);
          const blob = await bxSealRecord(BXACCT.key, rowId,
            { name: p.name, design: design, session: p.session || null });
          const r = await fetch("/chat/auth/store/sync", { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ canvases: {
              upserts: [{ id: rowId, blob: blob }],
              deletes: p.canvas !== rowId ? [p.canvas] : [] } }) });
          if (r.ok) { p.dirty = false; resolve(true); return; }
        } catch (e) {}
        resolve(false);
      })();
    } catch (e) { resolve(false); }
  });
}
function bxChatGo() {                           // the top bar's Chat switch
  const p = bxProject();
  if (!p) return;
  // The crossing is live, and a session is a pair: a canvas with a chat opens
  // that chat; a canvas without one gets its chat created on the same canvas;
  // the AI tab is a conversation of its own and crosses to a fresh session.
  // The save runs alongside — the switch does not wait on the network.
  void bxCanvasSaveActive();
  if (p.kind === "ai") { bxChatOpen(null); return; }
  const conv = p.session != null ? Number(p.session) : null;
  if (conv != null) bxChatOpen(conv); else bxChatAttachCanvas(p);
}
function bxHeadRefresh() {                     // the head: the canvas's name, its device
  const t = $("bxtTitle"), tag = $("bxtTag");
  const p = typeof bxProject === "function" ? bxProject() : null;
  if (t) t.textContent = (p && p.name) || "nnstudio";
  if (tag) {
    const a = bxLocalRunner();
    const d = a && a.specs && a.specs.device;
    tag.textContent = d === "mps" ? "gpu \u00b7 mps" : d === "cuda" ? "gpu \u00b7 cuda"
                    : d === "cpu" ? "cpu" : "no backend";
    tag.hidden = !a;
  }
}
function bxThemeApply() {                      // the button names the theme it would flip to
  const el = $("bxtTheme");
  if (!el || !el.children) return;
  const light = bxThemeNow() === "light";
  if (el.children[0]) el.children[0].textContent = light ? "\u263e" : "\u2600";
  if (el.children[1]) el.children[1].textContent = light ? "Dark theme" : "Light theme";
}
function bxThemeToggle() {
  const next = bxThemeNow() === "light" ? "dark" : "light";
  try { if (bxSessionHint()) localStorage.setItem("nnstudio_theme", next); } catch (e) {}
  const root = document.documentElement;
  if (root && root.classList) {
    root.classList.add("theme-flip");
    if (typeof setTimeout === "function")
      setTimeout(() => root.classList.remove("theme-flip"), 650);
  }
  if (next === "light") root.setAttribute("data-theme", "light");
  else root.setAttribute("data-theme", "dark");
  // the chat half's tokens live on its own scope; flip both, and let its app
  // follow with the same easing the shell uses
  const scope = $("nn-chat");
  if (scope) {
    scope.setAttribute("data-theme", next);
    if (scope.classList && typeof setTimeout === "function") {
      scope.classList.add("theme-flip");
      setTimeout(() => scope.classList.remove("theme-flip"), 650);
    }
  }
  try { window.dispatchEvent(new CustomEvent("nn:theme", { detail: next })); } catch (e) {}
  bxThemeApply();
  bxRender();                                  // the canvas redraws in the new ink
  return next;
}
function bxtRefresh() {
  const up = !!BX.up;
  const talk = bxTalkOn();                     // no canvas lies beneath the AI one
  const off = up || talk;
  const imp = $("bxtImport");                  // the old manual import stays out of sight
  if (imp) {
    if (imp.classList) imp.classList.toggle("off", off);
    imp.title = talk ? "the AI agent canvas has no canvas \u2014 the \u2318K switcher opens one"
              : up ? "come back out to the top level first"
              : "bring a GGUF model in";
  }
  const load = $("bxtLoad");                   // the one model-loading door
  if (load) {
    if (load.classList) load.classList.toggle("off", off);
    load.title = talk ? "the AI agent canvas has no canvas \u2014 the \u2318K switcher opens one"
               : up ? "come back out to the top level first"
               : "paste an HF repo; the model agent studies it and lands a Model box";
  }
  for (const id of ["bxtPalette", "bxtVram"]) {
    const btn = $(id);
    if (btn && btn.classList) btn.classList.toggle("off", talk);
  }
  if (off) {                                   // no toolbar menu survives either
    for (const id of ["bxtPalMenu", "bxtImportMenu", "bxtVramMenu"]) {
      const m = $(id);
      if (m) m.hidden = true;
    }
  }
  bxtRunRefresh();                             // Run follows the backend's state
  bxHeadRefresh();                             // the head: the canvas's name and device
  if (bxTalkOn()) bxTalkSync();                // the AI canvas repaints on every sync
}
function bxtInit() {
  const item = (text, title, fn) => {
    const it = mk("div", { class: "bxtmi", text, title });
    it.addEventListener("click", fn);
    return it;
  };
  const imenu = $("bxtImportMenu");
  if (imenu) {                                 // the one door to a whole model
    imenu.appendChild(item("GGUF model \u2026",
      "pick one .gguf from the backend machine \u2014 it lands as a nested box",
      () => { bxtDropsClose(); bxGGUFImport(); }));
    imenu.appendChild(item("Hugging Face model \u2026",
      "one repo \u2014 a model box lands with its text pipeline inside",
      () => { bxtDropsClose(); bxForm("hf", null, null, "loadhf"); }));
  }
  const wire = (id, toggle) => {
    const btn = $(id);
    if (btn && btn.addEventListener)
      btn.addEventListener("click", (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        toggle();
      });
  };
  bxtBackendLoad();                            // the remembered backend choice
  wire("bxtPalette", bxtPaletteToggle);
  wire("bxsCollapse", bxsToggle);              // the sidebar folds, and the choice is remembered
  wire("bxtHalfChat", () => { if (!bxViewIsChat()) bxChatGo(); });
  wire("bxtHalfStudio", () => { if (bxViewIsChat()) bxChatStudio(); });
  wire("bxrSearch", () => bxSwitchToggle());   // the search door: the switcher
  if (typeof navigator !== "undefined" &&
      !/Mac|iPhone|iPad/.test(String(navigator.platform || ""))) {
    const kbd = $("bxrSearch") && $("bxrSearch").children ? $("bxrSearch").children[2] : null;
    if (kbd && kbd.textContent === "\u2318K") kbd.textContent = "Ctrl K";   // off-mac, the key is Ctrl
  }
  const th = $("bxtTheme");                    // the Salon theme, remembered
  if (th && th.addEventListener) th.addEventListener("click", bxThemeToggle);
  bxThemeApply();
  const rnew = $("bxrNew"), rcanvas = $("bxrCanvas"), ragent = $("bxrAgent");
  if (rnew && rnew.addEventListener)
    rnew.addEventListener("click", () => {
      bxtDropsClose();
      if (bxViewIsChat()) bxChatNew(); else bxNewStudioSession();
    });
  if (ragent && ragent.addEventListener)
    ragent.addEventListener("click", () => { bxtDropsClose(); bxTabNewAI(); });
  if (rcanvas && rcanvas.addEventListener)
    rcanvas.addEventListener("click", () => {   // the rail's canvas: fit, or back to it
      const p = bxProject();
      if (bxTalkOn() || (p && p.kind === "ai")) {
        const last = (BX.projects || []).filter(x => x.kind !== "ai").pop();
        if (last) bxTabSelect(last.id);
        return;
      }
      bxFit();
    });
  bxHeadRefresh();
  wire("bxtLoad", bxModelLoad);
  wire("bxtImport", bxtImportToggle);
  wire("bxtBackend", bxtBackendToggle);
  wire("bxtVram", bxtVramToggle);
  wire("bxtAccount", bxtAccountToggle);
  wire("bxtSettings", () => { bxtDropsClose(); bxShellSettings(); });
  document.addEventListener("mousedown", (ev) => {   // a click outside closes them all
    const t = ev.target;
    if (t && t.closest && (t.closest(".bxtdrop") || t.closest(".bxtbtn") ||
                           t.closest(".bxuser") || t.closest("#bxrNew") ||
                           t.closest("#bxrSearch"))) return;
    bxtDropsClose();
  });
  bxtDropsClose();                             // all menus start closed
  const sback = $("bxswitchBack");             // the switcher's own wiring
  if (sback && sback.addEventListener)
    sback.addEventListener("mousedown", (ev) => {
      if (ev.target === sback) bxSwitchClose();
    });
  const sq = $("bxswitchQuery");
  if (sq && sq.addEventListener) {
    sq.addEventListener("input", () => {
      if (BXTAB.view === "main") bxSwitchBuild();
    });
    sq.addEventListener("keydown", (ev) => {   // the switcher's keyboard: the chat's
      const k = String(ev.key || "");
      if (k === "Escape") {
        if (ev.preventDefault) ev.preventDefault();
        bxSwitchClose();
        return;
      }
      const lis = $("bxswitchList") ? $("bxswitchList").children : [];
      if (k === "ArrowDown" || k === "ArrowUp") {
        if (ev.preventDefault) ev.preventDefault();
        if (!lis.length) return;
        BXTAB.cursor = (BXTAB.cursor + (k === "ArrowDown" ? 1 : -1) + lis.length) % lis.length;
        for (let i = 0; i < lis.length; i++)
          if (lis[i].classList) lis[i].classList.toggle("sel", i === BXTAB.cursor);
        return;
      }
      if (k === "Enter" && lis[BXTAB.cursor] && lis[BXTAB.cursor].click)
        lis[BXTAB.cursor].click();
    });
  }
  bxtRefresh();
  bxAccountSync();                             // the tool strip already says guest
  bxShellInit();                               // both mains, one shell: the view from the URL
  bxSplash(bxSessionHint() || bxAtDoor(),      // a live session — or the door,
           "opening your canvases \u2026");      // which may land elsewhere —
  bxAccountLoad();                             // and the server says who it is
  if (typeof setTimeout === "function")        // bring saved tabs back: hold the veil,
    setTimeout(() => bxSplash(false), 6000);   // but never longer than a breath
  fetchBackend();                              // who is connected right now
  if (typeof setInterval === "function") setInterval(fetchBackend, 5000);
}

