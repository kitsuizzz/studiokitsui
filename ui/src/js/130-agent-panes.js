// ─── nnstudio shell · 130 · agent panes ─────────────────────────────────────
// the agent/select/config/training panes, pane fill, vision, and the agent tick.
// Order is load-bearing: this slice is concatenated after the one before it.

// ---- the agent box's display: the content lives inside the box -------------
// The box is as big as its display; the corner grip resizes it in the canvas
// and the size travels with the design (`box.w/h`). The pane is HTML inside a
// foreignObject, so the stream scrolls and the buttons work while the box
// itself keeps its place among the other boxes.
function bxBehaveInside(pane) {               // the canvas must not steal the pane
  if (pane._behaved) return;                  // one set of stops per pane, however
  pane._behaved = true;                       // many times its content is refilled
  const stop = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
  pane.addEventListener("mousedown", (e) => { stop(e); });
  pane.addEventListener("wheel", (e) => { stop(e); });
  pane.addEventListener("dblclick", (e) => { stop(e); });
  pane.addEventListener("click", (e) => { stop(e); });
}
/**
 * Set a display box's size (snapped and clamped).
 * @param {boolean} [live] paint this card only (a grip drag), not the canvas.
 */
function bxAgentResize(n, w, h, live) {
  const p = n.box || (n.box = {});
  const io = n.kind === "input" || n.kind === "output";    // the i/o windows may go
  if (w != null && isFinite(Number(w)))                    // smaller than a display
    p.w = bxSnapTo(Math.max(io ? 240 : 320, Number(w)));
  if (h != null && isFinite(Number(h)))
    p.h = bxSnapTo(Math.max(io ? 120 : 160, Number(h)));
  if (live) {
    if (!bxResizePaint(n)) bxRender();         // the one-card path, with a fallback
  } else {
    bxRender();
  }
  return n.box;
}
function bxAgentGrip(ev, n) {                  // drag the corner: the box grows
  if (ev.preventDefault) ev.preventDefault();
  if (ev.stopPropagation) ev.stopPropagation();
  const sx = ev.clientX || 0, sy = ev.clientY || 0;
  const w0 = bxNodeW(n), h0 = bxNodeH(n);
  const move = (e) => {
    bxAgentResize(n, w0 + ((e.clientX || 0) - sx), h0 + ((e.clientY || 0) - sy), true);
  };
  const up = () => {
    if (typeof window !== "undefined" && window.removeEventListener) {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    bxCommit(true);                            // one step: the new size (the run's
                                               // marks are untouched by a resize)
    bxRender();                                // settle ports, marks and the full card
  };
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
}
function bxAgentLogRows(body, t, p) {           // the task's log, in the pane
  body.innerHTML = "";
  const st = bxLogState(t.id);
  for (const it of st.items.slice(-(Number(p.lines) || 200))) {
    const row = mk("div", { class: "bxpitem " + it.kind });
    if (it.kind === "do") {
      row.appendChild(mk("span", { class: "bxpdo", text: it.text }));
      if (p.debug && it.detail)
        row.appendChild(mk("pre", { class: "bxpraw", text: it.detail }));
    } else if (it.kind === "step") {
      row.appendChild(mk("span", { class: "bxpstep", text: it.text }));
    } else if (it.kind === "error") {
      row.appendChild(mk("span", { class: "bxperr", text: it.text }));
    } else {
      row.appendChild(mk("span", { class: "bxpsay", text: it.text }));
    }
    if (p.debug && it.raw && it.kind !== "do")
      row.appendChild(mk("pre", { class: "bxpraw", text: it.raw }));
    body.appendChild(row);
  }
  if (!st.items.length) {
    const why = (t.meta && (t.meta.error || t.meta.detail)) || "";
    body.appendChild(mk("div", { class: why ? "bxperr" : "bxbhint",
                                 text: why || "waiting for the agent\u2026" }));
  }
}
function bxAgentFoot(el, t) {                   // the one status line under the log
  el.textContent = [bxTaskChip(t), bxTaskProgress(t),
                    bxTaskSeconds(t) + "s"].filter(Boolean).join(" \u00b7 ");
}
function bxAgentLogRefresh(pane, n) {           // a log batch: update the body, not
  if (!pane || !n) return false;                // the head, the buttons or the grip
  const t = bxTask(n.task_id);
  if (!t) return false;
  const p = n.panel || (n.panel = {});
  const body = pane.querySelector ? pane.querySelector(".bxpbody") : null;
  const foot = pane.querySelector ? pane.querySelector(".bxpfoot") : null;
  if (!body || !foot) return false;
  // The head's chip and buttons follow the task's state; a status/phase change
  // needs the whole pane. A token append does not.
  const key = [t.status, t.outcome, t.phase, p.debug, p.expand, p.lines].join("|");
  if (pane._taskKey !== key) return false;
  const keepTop = body.scrollTop;
  bxAgentLogRows(body, t, p);
  bxAgentFoot(foot, t);
  if (p.autoscroll !== false) body.scrollTop = body.scrollHeight;
  else body.scrollTop = keepTop;
  return true;
}
function bxAgentFill(pane, n) {                // fill one box's pane from the state
  if (!pane) return;
  const p = n.panel || (n.panel = {});
  const scroller = pane.querySelector ? pane.querySelector(".bxpbody") : null;
  const keepTop = (scroller && scroller.scrollTop) || p._scroll || null;
  if (pane.children) pane.children.length = 0; // refill from scratch
  pane.innerHTML = "";
  bxBehaveInside(pane);
  const t = bxTask(n.task_id);
  const head = mk("div", { class: "bxphead" });
  head.appendChild(mk("span", { class: "bxptitle",
                                text: t ? bxTaskLabel(t) : "AI agent" }));
  head.appendChild(mk("span", { class: "bxchip " + ((t && t.status) || "none"),
                                text: t ? bxTaskChip(t) : "no task" }));
  const btn = (label, fn, title) => {
    const b = mk("span", { class: "bxbbtn", text: label });
    if (title) b.title = title;
    b.addEventListener("mousedown", (e) => {   // never start a canvas drag
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
    });
    b.addEventListener("click", (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      fn();
    });
    return b;
  };
  if (t) {
    if (t.status === "running")
      head.appendChild(btn("pause", () => bxTaskCmd(t.id, "pause", null, bxAgentSync)));
    if (t.status === "paused")
      head.appendChild(btn("resume", () => bxTaskCmd(t.id, "resume", null, bxAgentSync)));
    if (t.status === "running" || t.status === "paused")
      head.appendChild(btn("stop", () => bxTaskCmd(t.id, "cancel",
                                                   { reason: "stopped by you" }, bxAgentSync)));
    if (t.status === "done" || t.status === "cancelled")
      head.appendChild(btn("restart", () => bxTaskCmd(t.id, "restart", null, bxAgentSync)));
    head.appendChild(btn("supersede", () => bxTaskSupersede(n, (task, why) => {
      if (!task) bxtRunMsg(why || "the new task could not start");
      else bxAgentSync();
    }), "a new task takes over this one"));
  }
  head.appendChild(btn("tasks", () => { delete n.task_id; bxAgentSync(); },
                       "back to the task list"));
  head.appendChild(btn(p.debug ? "plain" : "debug", () => {
    p.debug = !p.debug;
    bxAgentSync();
  }, "the raw agent events"));
  head.appendChild(btn(p.expand ? "\u2013 expand" : "\u25a1 expand", () => {
    p.expand = !p.expand;                      // the king size, in place
    n.box = p.expand ? { w: 800, h: 480 } : { w: 480, h: 320 };
    bxRender();
  }, "expand / shrink the display"));
  pane.appendChild(head);

  if (!t) {                                    // the list + the new-task form
    delete pane._taskKey;
    const list = mk("div", { class: "bxpbody" });
    if (!BXTASKS.list.length)
      list.appendChild(mk("div", { class: "bxbhint", text: "no tasks yet \u2014 start one below" }));
    for (const row of BXTASKS.list) {
      const r = mk("div", { class: "bxprow" });
      r.appendChild(mk("span", { class: "bxptitle", text: bxTaskLabel(row) }));
      r.appendChild(mk("span", { class: "bxchip " + (row.status || "none"),
                                 text: bxTaskChip(row) }));
      r.appendChild(mk("span", { class: "bxbhint",
                                 text: bxTaskProgress(row) || (bxTaskSeconds(row) + "s") }));
      r.appendChild(btn("open", () => { n.task_id = row.id; bxAgentSync(); }));
      if (row.status === "done" || row.status === "cancelled")
        r.appendChild(btn("delete", () => bxTaskCmd(row.id, "delete", { purge: false },
                                                    bxAgentSync)));
      list.appendChild(r);
    }
    pane.appendChild(list);
    const form = mk("div", { class: "bxpform" });
    form.appendChild(mk("div", { class: "mhead", text: "new task" }));
    const typeSel = mk("select", { class: "bxsel" });
    for (const key of Object.keys(BX_TASK_TYPES))
      typeSel.appendChild(mk("option", { value: key, text: BX_TASK_TYPES[key].label }));
    form.appendChild(typeSel);
    const fields = mk("div", {});
    const inputs = {};
    const drawFields = () => {
      if (fields.children) fields.children.length = 0;
      fields.innerHTML = "";
      const spec = BX_TASK_TYPES[typeSel.value] || BX_TASK_TYPES[Object.keys(BX_TASK_TYPES)[0]];
      for (const f of spec.fields) {
        const lab = mk("label", { class: "rf" });
        lab.appendChild(mk("span", { text: f.label }));
        const inp = mk("input", { class: "bxbin", type: "text", placeholder: f.ph || "" });
        inputs[f.key] = inp;
        lab.appendChild(inp);
        fields.appendChild(lab);
      }
    };
    typeSel.addEventListener("change", drawFields);
    drawFields();
    form.appendChild(fields);
    form.appendChild(btn("start", () => {
      const spec = BX_TASK_TYPES[typeSel.value] || BX_TASK_TYPES[Object.keys(BX_TASK_TYPES)[0]];
      const params = {};
      for (const f of spec.fields)
        params[f.key] = String((inputs[f.key] || {}).value || "").trim();
      const missing = spec.fields.find(f => !params[f.key]);
      if (missing) { bxtRunMsg(missing.label + " is required"); return; }
      bxTaskStart(typeSel.value, params, (task, why, joined) => {
        if (!task) { n._err = why || "the task could not start"; bxAgentSync(); return; }
        delete n._err;                         // it started: the error is gone
        n.task_id = task.id;
        if (joined) BXTASKS.byId[task.id] = task;
        bxAgentSync();
      });
    }));
    if (n._err) form.appendChild(mk("div", { class: "bxperr", text: n._err }));
    pane.appendChild(form);
  } else {                                     // the task: live, token by token
    const body = mk("div", { class: "bxpbody" });
    bxAgentLogRows(body, t, p);
    body.addEventListener("scroll", () => { p._scroll = body.scrollTop; });
    pane.appendChild(body);
    const foot = mk("div", { class: "bxpfoot" });
    bxAgentFoot(foot, t);
    pane.appendChild(foot);
    if (p.autoscroll !== false && body.scrollTop != null)
      body.scrollTop = body.scrollHeight;      // stick to the newest line
    else if (keepTop && body.scrollTop != null)
      body.scrollTop = keepTop;                // otherwise stay where the user was
    pane._taskKey = [t.status, t.outcome, t.phase, p.debug, p.expand, p.lines].join("|");
  }
  const grip = mk("div", { class: "bxgrip", title: "drag to resize the display" });
  grip.addEventListener("mousedown", (ev) => bxAgentGrip(ev, n));
  pane.appendChild(grip);
}
function bxPaneErr(pane, n) {                  // the run's blame, shown inside the
  if (!bxRunErr || !bxRunErr.ids || !bxRunErr.ids.has(n.id)) return;   // window
  pane.appendChild(mk("div", { class: "bxbhint runbad",
    text: "\u26a0 " + (bxRunErr.here === n.id
                        ? String(bxRunErr.msg).replace(/^[^:]{1,80}:\s*/, "")
                        : "failed inside this box") }));
}
function bxSelectFill(pane, n) {              // a matrix: the sheet's columns
  pane.innerHTML = "";
  bxBehaveInside(pane);
  const pick = mk("select", { class: "bxsel",
                              title: "the dataset whose columns it hands out" });
  pick.appendChild(mk("option", { value: "", text: "\u2014" }));
  bxEveryBox(x => {
    if (x.kind !== "dataset") return;
    pick.appendChild(mk("option", { value: x.id, text: x.name || x.id }));
  });
  pick.value = n.dataset || "";
  pick.addEventListener("change", () => bxConfigure(n.id, { dataset: pick.value }));
  const row = mk("label", { class: "rf" });
  row.appendChild(mk("span", { text: "dataset" }));
  row.appendChild(pick);
  pane.appendChild(row);
  const c = mk("label", { class: "rf" });
  c.appendChild(mk("span", { text: "columns" }));
  const inp = mk("input", { type: "text", value: n.cols || "",
      title: "the columns it selects \u2014 names from the sheet's header, or "
           + "letters like A; blank = every column. A sequence is a vector: "
           + "x0 x1 x2" });
  inp.addEventListener("change", () => bxConfigure(n.id, { cols: inp.value }));
  c.appendChild(inp);
  pane.appendChild(c);
  const tell = bxMatrixTell(n);
  const line = mk("div", { class: "panehint" });
  if (!tell || !tell.ds) line.textContent = "no dataset \u2014 wire one in, or bind one here";
  else if (tell.bad) line.textContent = tell.bad;
  else if (tell.file) {
    line.textContent = (tell.rows != null ? tell.rows + " rows" : "rows")
      + (tell.count ? " \u00b7 " + tell.count
                       + (tell.count === 1 ? " column" : " columns") : "")
      + " \u2014 the sheet is on the backend, read at the run";
  } else {
    const names = (tell.names || []);
    const shown = (tell.cols || []).map(i => names[i] || ("col " + (i + 1)));
    line.textContent = (tell.rows != null ? tell.rows + " rows" : "rows")
      + " \u00b7 " + (tell.cols || []).length
      + (shown.length ? " (" + bxClip(shown.join(" "), 30) + ")" : "")
      + " \u2192 matrix" + (tell.rows != null ? " [" + tell.rows + " \u00d7 "
                                                + (tell.cols || []).length + "]" : "");
  }
  pane.appendChild(line);
  pane.appendChild(mk("div", { class: "bxhint2",
    text: "wire this into the input's data dot (the second one, training on) "
        + "\u2014 the columns it selects become the rows the model reads" }));
}
function bxConfigFill(pane, n) {               // the train config: every setting
  // of the run \u2014 paradigm, cadence, knobs; the data rides the input's own dots
  pane.innerHTML = "";
  bxBehaveInside(pane);
  const boxesOf = (kind) => {                  // "dataset" means either shape:
    const out = [];                            // the box, or an input reading as
    bxEveryBox(x => {                          // one
      if (kind === "dataset" ? bxIsDataset(x) : x.kind === kind) out.push(x);
    });
    return out;
  };
  const pick = (key, value, nodes, title) => {
    const sel = mk("select", { class: "bxsel", title: title || "" });
    sel.appendChild(mk("option", { value: "", text: "\u2014" }));
    for (const x of nodes)
      sel.appendChild(mk("option", { value: x.id, text: x.name || x.id }));
    sel.value = value || "";
    sel.addEventListener("change", () => bxConfigure(n.id, { [key]: sel.value }));
    return sel;
  };
  const num = (key, value, title) => {
    const inp = mk("input", { type: "text", value: value == null ? "" : String(value),
                              title: title || "" });
    inp.addEventListener("change", () => bxConfigure(n.id, { [key]: inp.value }));
    return inp;
  };
  const body = mk("div", { class: "bxinputbody" });
  pane.appendChild(body);
  const field = (label, el) => {                // an empty label: the row stands
    const l = mk("label", { class: "rf" });       // bare \u2014 a Training box
    if (label) l.appendChild(mk("span", { text: label }));   // claims them already
    l.appendChild(el);
    body.appendChild(l);
    return l;
  };
  const wired = bxTrainWired();
  const mine = wired.cfg && wired.cfg.id === n.id;
  const par = mk("select", { class: "bxsel" });
  par.appendChild(mk("option", { value: "supervised", text: "supervised" }));
  par.appendChild(mk("option", { value: "unsupervised", text: "unsupervised" }));
  par.appendChild(mk("option", { value: "rl", text: "rl \u2014 scored by a reward box" }));
  par.value = n.paradigm || "supervised";
  par.addEventListener("change", () => bxConfigure(n.id, { paradigm: par.value }));
  const rl = (n.paradigm || "supervised") === "rl";
  const unsup = (n.paradigm || "supervised") === "unsupervised";
  const to = mk("div", { class: "panehint" });
  if (n.model)
    to.textContent = "names " + ((bxFindBox(n.model) || {}).name || "a model off "
                                 + "the canvas");
  else if (mine && wired.input)
    to.textContent = "wired into " + (wired.input.name || wired.input.id);
  else if (bxAnyModel())
    to.textContent = "pick the model it trains above";
  else {
    to.textContent = "older shape: not wired in \u2014 wire this into the "
      + "input's first dot";
    const fix = mk("span", { class: "bxlink", text: " wire it now" });
    fix.addEventListener("mousedown", (ev) => { if (ev.stopPropagation) ev.stopPropagation(); });
    fix.addEventListener("click", () => bxTrainWireConfig(n));
    to.appendChild(fix);
  }
  if (n.kind !== "training")                   // a Training box reads its model
    body.appendChild(to);                      // off the slot and its card \u2014 no
  // the model world: the config names the box whose architecture trains
  const models = [];
  bxEveryBox(x => {
    if (x.kind === "custom" && bxBoundary(x, "out").length) models.push(x);
  });
  if (n.kind !== "training") {                 // a Training box names neither:
    if (models.length)                         // the slot claims the model and the
      field("model", pick("model", n.model, models,   // box claims the training
        "the nested model this config trains — the batch enters its first "
        + "input and its first output is scored"));
    else {
      const outside = (BX.nodes || []).filter(x => bxWeightsBox(x));
      const h = mk("div", { class: "panehint",
        text: "no model on the canvas — drop a Model box (palette → "
            + "models) and build the architecture inside it" });
      if (outside.length) {
        const fix = mk("span", { class: "bxlink",
                                 text: " — or wrap what is here into one" });
        fix.addEventListener("mousedown", (ev) => {
          if (ev.stopPropagation) ev.stopPropagation();
        });
        fix.addEventListener("click", () => {
          const m2 = bxWrapModel();
          if (m2) bxConfigure(n.id, { model: m2.id });
        });
        h.appendChild(fix);
      }
      body.appendChild(h);
    }
    field("training", par);
  }
  // the data: the matrix on the data dot, detected here \u2014 its columns are
  // what x col / y col pick from
  const at = bxAttached();
  const dline = mk("div", { class: "panehint" });
  if (!at.node)
    dline.textContent = "no data \u2014 wire a dataset (or a select col box) "
      + "into the input's second dot";
  else if (at.bad || !at.ds)
    dline.textContent = "the data matrix: " + (at.bad || "not a dataset box");
  else {
    const bits = [at.node.name || at.node.id];
    if (at.ds !== at.node) bits.push("reads " + (at.ds.name || at.ds.id));
    if (at.rows != null) bits.push(at.rows + " rows");
    const names = (at.file ? [] : (at.vnames || []).map((nm, k) =>
      nm || bxColLetter(at.cols ? at.cols[k] : k)));
    if (names.length) bits.push("columns: " + bxClip(names.join(" "), 44));
    else if (at.file) bits.push("its columns are read on the backend");
    dline.textContent = "data \u00b7 " + bits.join(" \u00b7 ");
  }
  body.appendChild(dline);
  const colField = (key, dflt, title) => {
    const inp = mk("input", { type: "text",
                              value: n[key] != null ? n[key] : dflt,
                              title: title || "" });
    inp.addEventListener("change", () => bxConfigure(n.id, { [key]: inp.value }));
    return inp;
  };
  field("x col", colField("x_col", "A",
    "the input column(s) \u2014 a name from the matrix's columns, or a letter; "
    + "a sequence like x0 x1 x2 is a vector"));
  if (!rl && !unsup) {
    field("y col", colField("y_col", "B",
      "the target column(s) \u2014 what the model is scored on"));
    const yrow = mk("label", { class: "rf" });
    const yck = mk("input", { type: "checkbox", class: "bxtick",
        title: "y's values are the labels to pick \u2014 the column itself names "
             + "the classes, and accuracy comes with it" });
    yck.checked = !!(n.y_class || (n.classes && n.classes.length));
    yck.addEventListener("change", () => bxConfigure(n.id, { y_class: yck.checked }));
    yrow.appendChild(yck);
    yrow.appendChild(mk("span", { text: "y is a class label" }));
    body.appendChild(yrow);
  }
  if (n.kind !== "training") {                 // a Training box takes its splits
    field("test data", pick("test_dataset", n.test_dataset, boxesOf("dataset"),
      "scored after every eval — never trained on"));      // on the dots —
    field("validation", pick("val_dataset", n.val_dataset, boxesOf("dataset"),
      "a second hold-out — scored beside the test split"));   // no pickers here
  }
  if (rl)
    field("reward", pick("reward", n.reward, boxesOf("reward"),
      "scores every sample \u2014 the signal in rl"));
  const opt = mk("select", { class: "bxsel" });
  for (const o of ["adamw", "sgd"]) opt.appendChild(mk("option", { value: o, text: o }));
  opt.value = n.optimizer === "sgd" ? "sgd" : "adamw";
  opt.addEventListener("change", () => bxConfigure(n.id, { optimizer: opt.value }));
  field("optimizer", opt);
  field("learning rate", num("lr", n.lr != null ? n.lr : 0.0003));
  field("weight decay", num("weight_decay", n.weight_decay != null ? n.weight_decay : 0.01));
  field("batch", num("batch", n.batch != null ? n.batch : 4));
  field("steps", num("steps", n.steps, "blank = until detach"));
  field("grad clip", num("clip", n.clip != null ? n.clip : 1));
  field("save every", num("save_every", n.save_every != null ? n.save_every : 50));
  field("eval every", num("eval_every", n.eval_every != null ? n.eval_every : 50));
  if (rl) {
    field("temperature (rl)", num("temperature", n.temperature != null ? n.temperature : 1));
    field("max tokens (rl)", num("max_tokens", n.max_tokens != null ? n.max_tokens : 16));
    field("n samples (rl)", num("n_samples", n.n_samples != null ? n.n_samples : 4));
  }
  if (n.model) bxTrainPlan(body, n, n.kind === "training");   // the experiment's
}                                              // own readout
function bxTrainingFill(pane, n) {             // the Training box's window: the
  bxConfigFill(pane, n);                       // config's knobs, and the slot's
  const m = n.model ? bxFindBox(n.model) : null;   // state \u2014 the shape of
  pane.appendChild(mk("div", { class: "panehint", text: m   // the box on canvas
    ? "slot: " + (m.name || m.id) + " \u2014 the architecture this trains"
    : "the slot is empty \u2014 drop a model box into the notch above" }));
  pane.appendChild(mk("div", { class: "panehint",
    text: "its dots: train / test / validation \u2014 wire datasets in" }));
  if (m) {                                   // the pair travels together: this
    const un = mk("div", { class: "panehint",   // is how it separates
                          text: "\u2715 undock the model" });
    un.style.cursor = "pointer";
    un.addEventListener("click", () => bxUndockModel(n.id));
    pane.appendChild(un);
  }
  pane.appendChild(bxTrainFoot(n));            // the start button, in a footer of
}                                              // its own at the window's bottom left

function bxTrainFoot(n) {                      // \u2026like the input's run button:
  const foot = mk("div", { class: "runfoot" });   // where the run is, the way to
  const runbar = mk("div", { class: "rrow" });    // start it
  const sum = bxTrainSummary(n);
  const t = n.task_id ? bxTask(n.task_id) : null;
  const st = (BXRUN.trainState || {})[n.id] || {};
  const live = !!n.task_id && !st.error && (!t || t.status === "running");
  const slotted = !!(n.model && bxFindBox(n.model));
  const why = live ? "the task is live \u2014 save, hold or detach it above"
        : !bxtRunEnabled() ? "connect a backend first \u2014 Backend \u25be"
        : !slotted ? "the slot is empty \u2014 drop a model box into the notch"
        : sum.missing.length ? "fix before starting: " + sum.missing[0]
        : null;
  const go = mk("span", { class: "chip tiny play" + (why ? " off" : ""),
                          text: live ? "training\u2026" : "\u25b6 start training" });
  go.title = why || "the whole run, on the backend";
  go.addEventListener("click", () => {
    if (why) { bxTrainNote(n, why); return; }
    bxTrainStart(n);
  });
  runbar.appendChild(go);
  foot.appendChild(runbar);
  return foot;
}
function bxTrainWireConfig(cfg) {              // one click: into the input's first dot
  let input = null;
  bxEveryBox(x => { if (x.kind === "input" && !input) input = x; });
  const host = bxTrainHost() || cfg;
  if (!input) { bxTrainNote(host, "no input box to wire the training into"); return; }
  let trainOn = false;
  bxEveryBox(x => { if (x.kind === "output" && x.train) trainOn = true; });
  if (!trainOn) {
    bxTrainNote(host, "an output box must carry its training switch first "
                + "(the older designs' field) — that is what opens the "
                + "input's dots");
    return;
  }
  const err = bxConnect(cfg.id, input.id, 0, 0);
  if (err) bxTrainNote(host, err);
  else bxTrainNote(host, "wired into " + (input.name || input.id)
                   + " \u2014 wire the X (and Y) matrices into its dots");
}
function bxTrainAddConfig(h) {                 // one click: a config box, wired in
  const m = bxAnyModel();
  if (m && bxBoundary(m, "out").length) {      // the model world: the config names
    const cfg = bxAdd("config", m.x + bxNodeW(m) + 60, m.y + 40, {});  // the box
    if (!cfg) return;
    bxConfigure(cfg.id, { model: m.id, paradigm: "supervised" });
    bxTrainNote(h, "the train config names " + (m.name || m.id)
              + " \u2014 wire a dataset (or a select col box) into the config's "
              + "data dot, and name the columns there");
    return;
  }
  let input = null;
  bxEveryBox(x => { if (x.kind === "input" && !input) input = x; });
  if (!input) { bxTrainNote(h, "no input box to wire the training into"); return; }
  const cfg = bxAdd("config", input.x + bxNodeW(input) + 60, input.y + 24, {});
  if (!cfg) return;
  bxConfigure(cfg.id, {
    paradigm: h.paradigm || "supervised", test_dataset: h.test_dataset,
    reward: h.reward, y_class: !!h.y_class, classes: h.classes,
    optimizer: h.optimizer, lr: h.lr, weight_decay: h.weight_decay,
    batch: h.batch, steps: h.steps, clip: h.clip,
    save_every: h.save_every, eval_every: h.eval_every,
    temperature: h.temperature, max_tokens: h.max_tokens, n_samples: h.n_samples });
  const err = bxConnect(cfg.id, input.id, 0, 0);
  if (err) bxTrainNote(h, err);
  else bxTrainNote(h, "the train config is wired into " + (input.name || input.id)
                   + " \u2014 wire a dataset (or a select col box) into its "
                   + "data dot, and name the columns in the config");
}
function bxPaneFill(pane, n) {                 // one pane, filled by its kind —
  if (n.kind === "dataset") bxDatasetFill(pane, n);   // every renderer goes through
  else if (n.kind === "select") bxSelectFill(pane, n);
  else if (n.kind === "config") bxConfigFill(pane, n);
  else if (n.kind === "training") bxTrainingFill(pane, n);
  else if (n.kind === "train") bxTrainFill(pane, n);
  else if (n.kind === "input") bxInputFill(pane, n);
  else if (n.kind === "output") bxOutputFill(pane, n);
  else if (n.kind === "heatmap") bxHeatFill(pane, n);
  else if (n.kind === "vision") bxVisionFill(pane, n);
  else bxAgentFill(pane, n);
  bxPaneErr(pane, n);
  if (n.kind === "input" || n.kind === "output" || n.kind === "heatmap") {
    // the display windows are the user's to size: drag the corner, the gesture
    // the agent's display takes
    const grip = mk("div", { class: "bxgrip", title: "drag to resize the box" });
    grip.addEventListener("mousedown", (ev) => bxAgentGrip(ev, n));
    pane.appendChild(grip);
  }
  // the reader's place, wherever a window is rebuilt: saved live as they scroll,
  // and picked back up here when the pane is already on screen (the live
  // repaints — bxTrainRefresh, a poll's tick — rebuild in place, outside
  // bxRender; the card's own build happens detached, and bxPaneScrollRestore
  // restores that one once the render attaches it)
  const sc = (n.kind === "agent" || n.kind === "train") ? null
           : (pane.querySelector
              ? (pane.querySelector(".bxpbody") || pane.querySelector(".bxinputbody"))
              : null);   // a sheet scrolls in .bxpbody — the rest, in .bxinputbody
  if (sc) {
    sc.addEventListener("scroll", () => {
      (n._scroll = n._scroll || {}).top = sc.scrollTop;
    });
    const want = Number((n._scroll || {}).top) || 0;
    if (want && sc.scrollTop !== undefined && sc.isConnected !== false) {
      if (sc.getBoundingClientRect) sc.getBoundingClientRect();   // layout first
      sc.scrollTop = want;
    }
  }
}
function bxVisionFill(pane, n) {               // the tower's facts, in its window
  pane.innerHTML = "";
  bxBehaveInside(pane);
  const head = mk("div", { class: "bxlogrow" });
  head.appendChild(mk("b", { text: n.name || "vision tower" }));
  pane.appendChild(head);
  const rows = [
    ["projector", n.projector || "?"],
    ["image", (n.image_size || "?") + " px \u00b7 " + (n.patch || 16) + " px patches"],
    ["norm", (n.image_mean || "0.5 0.5 0.5") + " \u00b7 \u03c3 "
             + (n.image_std || "0.5 0.5 0.5")],
    ["blocks", n.blocks == null ? "?" : String(n.blocks) + " \u00b7 " + (n.heads || "?") + " heads"],
    ["output", n.proj_dim == null ? "?" : n.proj_dim + " wide"],
    ["weights", (n.dtype || "?") + (n.params ? " \u00b7 " + bxBig(n.params) + " params" : "")],
    ["file", bxClip(String(n.file || "?").split("/").pop(), 40)],
  ];
  for (const [k, v] of rows) {
    const row = mk("div", { class: "bxlogrow" });
    row.appendChild(mk("span", { class: "bxbhint", text: k + ": " + v }));
    pane.appendChild(row);
  }
  pane.appendChild(mk("div", { class: "bxbhint",
    text: "an mmproj vision tower \u2014 wire an image input into it" }));
}
/**
 * Refill the panes that carry live task/training state.
 * @param {string} [taskId] a log poll names one task; only its panes refill.
 */
function bxAgentSync(taskId) {
  if (typeof taskId !== "string") taskId = "";   // a command callback may pass a record
  const root = bxHost() && bxHost().querySelector ? bxHost().querySelector(".bxsvg") : null;
  if (root && root.querySelectorAll) {
    for (const pane of root.querySelectorAll(".bxlogpane")) {
      const id = pane.getAttribute ? pane.getAttribute("data-agent") : null;
      const n = id ? bxNode(id) : null;
      if (!n) continue;
      // Only the panes that carry live task/training state need a refill on a
      // poll. The input, dataset and readout editors are rebuilt by a full
      // render when their own data changes; rebuilding them here every 300 ms
      // was the most expensive part of an otherwise idle canvas.
      if (n.kind !== "agent" && !bxTraining(n)) continue;
      if (taskId && n.kind === "agent" && n.task_id !== taskId) continue;
      if (taskId && n.kind === "agent" && bxAgentLogRefresh(pane, n)) continue;
      bxPaneFill(pane, n);
    }
  }
  bxAgentTick();
  const sig = JSON.stringify(BXTASKS.list.map(t =>
    [t.id, t.status, t.outcome, t.phase, (t.todo || []).map(x => x.state).join("")]));
  if (sig !== BXTASKS.sig) {
    BXTASKS.sig = sig;
    if (typeof bxRender === "function" && BX.nodes && BX.nodes.length) bxRender();
  }
}
function bxAgentTick(now) {                    // one log poll for every live box
  const any = (BX.nodes || []).some(n => {
    if (n.kind !== "agent" && !bxTraining(n)) return false;
    if (!n.task_id) return bxTraining(n);       // a host with no task still wants the list
    const t = bxTask(n.task_id);
    if (!t) return bxTraining(n);               // unknown task: the box knows best
    return t.status === "running" || t.status === "paused";
  }) || !!bxTalkCurrent();                     // the AI canvas's running turn
  const pullLogs = () => {
    for (const n of BX.nodes || [])
      if (n.kind === "agent" && n.task_id) bxTaskLogFetch(n.task_id, bxAgentSync);
    const talk = bxTalkCurrent();
    if (talk && talk.id) bxTaskLogFetch(talk.id, bxTalkSync);
  };
  const pullList = () => bxTasksFetch(bxTalkOn() ? bxTalkSync : bxAgentSync);
  if (now) { pullList(); pullLogs(); }
  if (!BXTASKS.timer && any) {
    BXTASKS.timer = setInterval(pullLogs, 300);  // token by token, as it writes
    BXTASKS.timer2 = setInterval(pullList, 2000); // the list: state, not tokens
  }
  if (BXTASKS.timer && !any) {
    clearInterval(BXTASKS.timer);
    clearInterval(BXTASKS.timer2);
    BXTASKS.timer = BXTASKS.timer2 = null;
  }
}
function bxRefreshCanvas(boxId, repo, audit) {
  if (!repo || typeof fetch !== "function") return;
  fetch("/api/gguf/canvas", { method: "POST", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ repo }) })
    .then(r => r.json())
    .then(d => {
      if (!d || !d.canvas || bxNode(boxId) == null) return;
      bxGGUFLoad(boxId, d.canvas, null);       // the exact inside, same box
      bxMarkAudit(audit || (d.canvas.model && d.canvas.model.audit));
      bxRender();
    })
    .catch(() => {});
}

// ---- a model box must know where its tensors live -------------------------
// A design can outlive the browser session that loaded it; boxes remember the
// file now, but one saved before that (or one whose file was cleared) can be
// bound back from its own name — the app lists the models, one name wins.
let bxModels = null;                           // /api/models, fetched once
let bxRunFixing = false;

