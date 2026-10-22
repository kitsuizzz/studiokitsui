// ─── nnstudio shell · 199 · the boot block ─────────────────────────────────────
// attach the canvas listeners, the keyboard/clipboard doors, clear retired keys, draw, and start the toolbar. This block must stay last.
// Order is load-bearing: this slice is concatenated after the one before it.

// the canvas: add by right-click, move, wire, pan, zoom
{
  const host = $("bxcanvas");
  host.addEventListener("mousedown", bxDown);
  host.addEventListener("mousemove", bxHotMove);
  bxRenderPalette();
  bxUndoLock++;
  bxSeedBlank();                           // a blank NN: input → output
  bxFlowRestore();                         // the backend's last marks, if any
  bxTasksFetch(bxAgentSync);               // a running task keeps streaming
  bxUndoLock--;
  bxUndoStack = [bxSnapshotNow()];         // the skeleton is where undo stops
  bxUndoLast = JSON.stringify(bxUndoStack[0]);
  BX.projects = [{ id: bxId(), name: "New Project " + (bxTabSeq++), dirty: false,
                   saved: false }];        // the blank canvas is its own tab
  BX.active = BX.projects[0].id;
  bxTabsRender();
  host.addEventListener("mouseleave", () => bxHotSet(null));
  window.addEventListener("mousemove", bxPalMove);
  window.addEventListener("mouseup", bxPalUp);
  host.addEventListener("dblclick", bxDblClick);
  host.addEventListener("contextmenu", bxMenu);
  host.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const f = bxWheelFactor(ev.deltaY, ev.deltaMode);
    if (f !== 1) bxZoomAt(ev, f);
  }, { passive: false });
  window.addEventListener("mousemove", bxMove);
  window.addEventListener("mouseup", bxUp);
  window.addEventListener("resize", () => {
    bxRender();
    bxtDropsClose();                           // a moved strip leaves its menus behind
  });
  document.addEventListener("mousedown", (ev) => {
    const m = $("bxmenu");
    if (!m || m.hidden) return;
    const t = ev.target;
    if (t && t.closest && (t.closest("#bxmenu") || t.closest("#bxcanvas"))) return;
    bxMenuClose();
  });
  window.addEventListener("mousemove", (ev) => {
    bxMouse = { x: ev.clientX || 0, y: ev.clientY || 0 };
  });
  document.addEventListener("copy", bxOnCopy);
  document.addEventListener("paste", bxOnPaste);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { bxMenuClose(); bxSelect(null); return; }
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey &&
        String(ev.key || "").toLowerCase() === "k") {
      ev.preventDefault();                     // the browser's search stays away
      bxSwitchToggle();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey &&
        String(ev.key || "").toLowerCase() === "s") {
      ev.preventDefault();                     // the browser's own save stays away
      bxTabSave();
      return;
    }
    const t = ev.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
                         t.tagName === "SELECT" || t.isContentEditable);
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !typing) {
      const k = String(ev.key || "").toLowerCase();
      if (k === "z") { ev.preventDefault(); if (ev.shiftKey) bxRedoStep(); else bxUndoStep(); return; }
      if (k === "y") { ev.preventDefault(); bxRedoStep(); return; }
    }
    if (ev.key !== "Delete" && ev.key !== "Backspace") return;
    if (typing) return;                // typing, not deleting
    if (bxDeleteSelection()) ev.preventDefault();
  });
  // the old flow documents have no home here: drop their leftovers
  try {
    localStorage.removeItem("ntdesigns");
    localStorage.removeItem("ntadapters");
    localStorage.removeItem("nttrain_tab");
  } catch (e) {}
  bxRender();                              // draw the empty canvas
  bxtInit();                               // the canvas toolbar
  // The first render can land before the canvas has its final size: the SVG
  // viewBox then carries the fallback aspect, and `slice` crops the design at
  // the edges. Re-render when the host itself changes size (the initial
  // layout, a sidebar fold); bursts coalesce into one frame.
  if (typeof ResizeObserver === "function") {
    const host = bxHost();
    let pending = null;
    if (host) {
      const repaint = () => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; bxRender(); }, 60);
      };
      try {
        host.__nnRO = new ResizeObserver(repaint);
        host.__nnRO.observe(host);
      } catch (e) {}
    }
  }
}

