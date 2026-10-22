// ─── nnstudio shell · 125 · tasks ──────────────────────────────────────────
// task lookup/labels/progress, the task list API, start/stop, and logs.
// Order is load-bearing: this slice is concatenated after the one before it.

function bxTask(id) { return (id && BXTASKS.byId[id]) || null; }
function bxTaskLabel(t) {
  const type = (t && BX_TASK_TYPES[t.type]) || null;
  const base = (type && type.label) || (t && t.type) || "task";
  const params = (t && t.params) || {};
  const who = params.repo || params.prompt || params.name || "";
  return who ? base + " \u00b7 " + bxClip(String(who), 42) : base;
}
function bxTaskChip(t) {
  const word = { running: "In-Progress", paused: "Paused",
                 done: "Done", cancelled: "Cancelled" }[t && t.status] || "?";
  if (!t || t.status !== "done") return word;
  return word + " \u00b7 " + (t.outcome === "exact" ? "exact"
    : t.outcome === "approximate" ? "still approximate"
    : t.outcome === "failed" ? "failed" : "finished");
}
function bxTaskProgress(t) {
  const items = (t && t.todo) || [];
  const done = items.filter(x => x.state === "done").length;
  const act = (items.find(x => x.state === "active") || {}).title;
  if (items.length) return done + "/" + items.length + (act ? " \u00b7 " + act : "");
  return t && t.phase && t.phase !== "done" && t.phase !== "queued" ? t.phase : "";
}
function bxAgentShape(n) {                     // the card's bottom line
  const t = bxTask(n.task_id);
  return t ? bxClip(bxTaskChip(t), 24) : "no task";
}
function bxTaskFraction(t) {                   // the ring: how far the task got
  if (!t) return 0;
  const items = t.todo || [];
  if (items.length) return items.filter(x => x.state === "done").length / items.length;
  return t.status === "done" ? 1 : 0;
}
function bxArcPath(cx, cy, r, frac) {          // an arc from 12 o'clock, clockwise
  if (!(frac > 0.001)) return "";
  if (frac >= 0.999) return "M " + cx + " " + (cy - r) + " A " + r + " " + r +
    " 0 1 1 " + (cx - 0.01) + " " + (cy - r);
  const a = frac * 2 * Math.PI - Math.PI / 2;
  const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
  return "M " + cx + " " + (cy - r) + " A " + r + " " + r + " 0 " +
    (frac > 0.5 ? 1 : 0) + " 1 " + x.toFixed(2) + " " + y.toFixed(2);
}
function bxTaskSupersede(n, cb) {              // a new task takes over the old one
  const old = bxTask(n.task_id);
  const start = () => bxTaskStart(old.type, old.params, (task, why) => {
    if (!task) { if (cb) cb(null, why); return; }
    n.task_id = task.id;
    bxAgentSync();
    if (cb) cb(task);
  });
  if (!old) { start(); return; }
  bxTaskCmd(old.id, "cancel", { reason: "superseded" }, start);   // free the ask first
}
function bxAgentShort(n) {
  const t = bxTask(n.task_id);
  return t ? bxClip(bxTaskProgress(t) || bxTaskChip(t), 24) : "";
}
function bxTaskSeconds(t) {
  if (!t) return 0;
  const end = t.finished || Date.now() / 1000;
  return Math.max(0, Math.round(end - (t.started || t.created || end)));
}

// ---- the API: the task list, its stream, its controls ----------------------
function bxTasksFetch(cb) {
  if (typeof fetch !== "function") { if (cb) cb(null); return; }
  fetch("/api/tasks", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      const changed = bxTasksApply((d && d.tasks) || []);
      for (const t of BXTASKS.list) {         // a landed task refreshes its model
        if (t.status === "done" && t.outcome === "exact"
            && t.params && t.params.repo && !BXTASKS.refreshed) {
          BXTASKS.refreshed = BXTASKS.refreshed || {};
          if (!BXTASKS.refreshed[t.id]) {
            BXTASKS.refreshed[t.id] = true;
            for (const n of BX.nodes || []) {
              if (n.kind === "custom" && n.repo === t.params.repo
                  && typeof bxRefreshCanvas === "function")
                bxRefreshCanvas(n.id, t.params.repo, null);
            }
          }
        }
      }
      // A list poll that changed nothing has nothing to repaint. When it did
      // change, the callback (the pane sync in every current caller) is the
      // one sweep; a no-callback caller still gets one.
      if (changed) {
        if (cb) cb(d);
        else bxAgentSync();
      }
    })
    .catch(() => {});                          // a failed list poll retries next tick
}
function bxTasksApply(tasks) {                 // the list, as the app knows it
  const next = tasks || [];
  const changed = JSON.stringify(next) !== JSON.stringify(BXTASKS.list);
  BXTASKS.list = next;
  BXTASKS.byId = {};
  for (const t of next) BXTASKS.byId[t.id] = t;
  return changed;
}
function bxTaskStart(type, params, cb) {
  if (typeof fetch !== "function") { if (cb) cb(null, "no app connected"); return; }
  fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ type: type, params: params }) })
    .then(r => r.json().then(d => ({ ok: r.ok, d })))
    .then(res => {
      const t = res.d && res.d.task;
      if (!res.ok || !res.d || !res.d.ok) {
        if (cb) cb(null, (res.d && res.d.error) || "the task could not start");
        return;
      }
      if (t) { BXTASKS.byId[t.id] = t; BXTASKS.list.unshift(t); }
      if (cb) cb(t, null, res.d.joined);
    })
    .catch(() => { if (cb) cb(null, "the app did not answer"); });
}
function bxTaskCmd(id, cmd, extra, cb) {
  if (typeof fetch !== "function") { if (cb) cb(null); return; }
  fetch("/api/tasks/cmd", { method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(Object.assign({ task: id, cmd: cmd },
                                                               extra || {})) })
    .then(r => r.json().then(d => ({ ok: r.ok, d })))
    .then(res => {
      const t = res.d && res.d.task;
      if (t) BXTASKS.byId[t.id] = t;
      if (res.d && res.d.deleted) {
        delete BXTASKS.byId[res.d.deleted];
        delete BXTASKS.log[res.d.deleted];
        BXTASKS.list = BXTASKS.list.filter(x => x.id !== res.d.deleted);
        for (const n of BX.nodes)
          if (n.kind === "agent" && n.task_id === res.d.deleted) delete n.task_id;
      }
      bxAgentSync();
      if (cb && cb !== bxAgentSync) cb(res.d);
    })
    .catch(() => { if (cb) cb(null); });
}
function bxLogState(id) {
  return BXTASKS.log[id] || (BXTASKS.log[id] = { pos: 0, items: [], by: {} });
}
function bxLogApply(id, items) {               // the stream folds: a growing part
  const st = bxLogState(id);                   // updates in place, token by token
  for (const it of items || []) {
    const i = st.by[it.id];
    if (i != null && it.append) {
      st.items[i] = { id: it.id, kind: it.kind, raw: it.raw,
                      text: (st.items[i].text || "") + it.text };
    } else if (i != null) {
      st.items[i] = it;
    } else {
      st.by[it.id] = st.items.length;
      st.items.push(it);
    }
  }
  if (st.items.length > 2000) {                // the scrollback has a cap
    st.items = st.items.slice(-2000);
    st.by = {};
    st.items.forEach((it, i) => { st.by[it.id] = i; });
  }
  return st;
}
/** Pull new log items for one task; `cb(id)` runs only when items arrived. */
function bxTaskLogFetch(id, cb) {
  const st = bxLogState(id);
  if (typeof fetch !== "function") { if (cb) cb(); return; }
  fetch("/api/tasks/log?task=" + encodeURIComponent(id) + "&pos=" + st.pos,
        { cache: "no-store" })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d || !d.ok) return;                 // the next list poll carries status
      st.pos = d.pos || st.pos;
      const items = d.items || [];
      bxLogApply(id, items);
      // Idle polls (no new tokens) must not repaint a pane. The 2 s list poll
      // still carries status changes; this stream is for the words.
      if (cb && items.length) cb(id);
    })
    .catch(() => {});                          // a failed pull is retried next tick
}

