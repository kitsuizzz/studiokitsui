// ─── nnstudio shell · 45 · the dataset sheet ─────────────────────────────────────
// row/CSV parsing, the editable table, media attachment, and the dataset box pane.
// Order is load-bearing: this slice is concatenated after the one before it.

// ---- the dataset sheet: its rows as a little spreadsheet --------------------
// Rows round-trip exactly: TSV lines stay TSV (`prompt<TAB>completion`), JSONL
// lines stay JSON — their extra keys travel untouched. The sheet edits the two
// columns the trainer reads: prompt and completion.
function bxRowsParse(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    if (line === "" || line === "\r") continue;
    const s = line.trim();
    if (!s && line.indexOf("\t") < 0) continue;
    if (s.charAt(0) === "{") {
      let o = null;
      try { o = JSON.parse(s); } catch (e) { o = null; }
      if (o && typeof o === "object") {
        const extra = {};
        for (const k of Object.keys(o))
          if (k !== "prompt" && k !== "completion" && k !== "output") extra[k] = o[k];
        rows.push({ p: String(o.prompt == null ? "" : o.prompt),
                    c: String(o.completion != null ? o.completion
                             : (o.output != null ? o.output : "")),
                    ck: o.output != null && o.completion == null ? "output" : "completion",
                    k: "j", x: Object.keys(extra).length ? extra : null });
        continue;
      }
    }
    const i = line.indexOf("\t");
    rows.push(i < 0 ? { p: line, c: "", k: "t", x: null }
                    : { p: line.slice(0, i), c: line.slice(i + 1), k: "t", x: null });
  }
  return rows;
}
function bxRowsText(rows) {                    // back into the design's rows field
  return (rows || []).map(r => {
    if (r.k === "j") {
      const o = { prompt: r.p };
      o[r.ck || "completion"] = r.c;
      if (r.x) for (const k of Object.keys(r.x)) if (!(k in o)) o[k] = r.x[k];
      return JSON.stringify(o);
    }
    return r.p + "\t" + r.c;
  }).join("\n");
}
function bxRowsFormat(rows) {                  // what the sheet is holding
  return (rows || []).some(r => r.k === "j") ? "jsonl" : "tsv";
}
function bxDatasetExpand(n) {                  // the sheet, small or big
  const p = n.panel || (n.panel = {});
  p.expand = !p.expand;
  n.box = p.expand ? { w: 860, h: 520 } : { w: 440, h: 300 };
}
function bxInputExpand(n) {                    // the input's editor: compact or roomy
  const p = n.panel || (n.panel = {});
  const compact = bxNodeW(n) <= 300 && bxNodeH(n) <= 170;
  p.expand = compact;                          // the choice travels with the design
  n.box = compact ? { w: 420, h: 280 } : { w: 300, h: 170 };
}
function bxOutputExpand(n) {                   // the output's readout: compact or roomy
  const p = n.panel || (n.panel = {});
  const compact = bxNodeW(n) <= 300 && bxNodeH(n) <= 170;
  p.expand = compact;
  n.box = compact ? { w: 420, h: 280 } : { w: 300, h: 170 };
}
function bxCsvParse(text) {                   // RFC 4180-ish: quotes and commas
  const rows = [];
  let row = [], field = "", q = false;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; continue; }
        q = false;
        continue;
      }
      field += ch;
      continue;
    }
    if (ch === '"') { q = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function bxCsvWrite(rows) {
  return (rows || []).map(r => (r || []).map(c => {
    const v = String(c == null ? "" : c);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(",")).join("\n");
}
// a media cell holds a reference, never the bytes: blob:<sha256>.<ext>
function bxIsBlob(v) {
  const m = /^blob:([0-9a-f]{8,64}\.[a-z0-9]{2,5})$/i.exec(String(v == null ? "" : v).trim());
  return m ? m[1] : null;
}
function bxBlobIsVideo(id) {
  return ["mp4", "webm", "ogv", "mov", "m4v"]
    .indexOf(String(id).split(".").pop().toLowerCase()) >= 0;
}
function bxColLetter(i) {                     // 0 -> A … 26 -> AA, like a sheet
  let s = "";
  i = Math.max(0, Number(i) || 0);
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}
function bxDtypeInfer(values) {               // pandas' read_csv guess, roughly
  let n = 0, num = 0, intg = 0, bool = 0, img = 0, vid = 0;
  for (const v of values || []) {
    const s = String(v == null ? "" : v).trim();
    if (!s) continue;
    n++;
    const id = bxIsBlob(s);
    if (id) { if (bxBlobIsVideo(id)) vid++; else img++; continue; }
    if (/^(true|false)$/i.test(s)) { bool++; continue; }
    if (/^-?\d+$/.test(s)) { num++; intg++; continue; }
    if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) { num++; continue; }
  }
  if (!n) return "object";
  if (img + vid > 0) return vid > img ? "video" : "image";
  if (bool === n) return "bool";
  if (num === n) return intg === n ? "int64" : "float64";
  return "object";
}
function bxTableRead(n) { // the box's rows as {cols, rows, format}
  const text = String(n.text || "");
  let fmt = n.format;
  if (fmt !== "csv" && fmt !== "jsonl" && fmt !== "tsv") fmt = null;
  if (!fmt) {                                  // legacy rows: jsonl or tab pairs
    const first = (text.split("\n").filter(l => l.trim())[0] || "").trim();
    fmt = first.charAt(0) === "{" ? "jsonl" : "tsv";
  }
  if (fmt === "csv") {
    const grid = bxCsvParse(text);
    // a column's default name is its letter: an unnamed column is A, B, …
    const cols = (grid.shift() || []).map((c, i) => String(c) || bxColLetter(i));
    return { cols, rows: grid.map(r => cols.map((_, i) => (r[i] != null ? r[i] : ""))),
             format: "csv" };
  }
  if (fmt === "jsonl") {                       // every key becomes a column
    const objs = [], seen = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let o = null;
      try { o = JSON.parse(line); } catch (e) { o = null; }
      if (!o || typeof o !== "object") continue;
      objs.push(o);
      for (const k of Object.keys(o)) if (seen.indexOf(k) < 0) seen.push(k);
    }
    return { cols: seen,
             rows: objs.map(o => seen.map(k => String(o[k] == null ? "" : o[k]))),
             format: "jsonl" };
  }
  const rows = bxRowsParse(text);
  return { cols: ["prompt", "completion"],
           rows: rows.map(r => [r.p, r.c]), format: "tsv" };
}
function bxTableWrite(n, t) { // the table lands back in the design as CSV
  const cols = (t.cols || []).map(c => String(c == null ? "" : c));
  const rows = (t.rows || []).map(r => cols.map((_, i) => (r && r[i] != null) ? r[i] : ""));
  n.text = bxCsvWrite([cols].concat(rows));
  n.format = "csv";
  const w = (n.colw || []).slice(0, cols.length);       // bookkeeping keeps step
  while (w.length < cols.length) w.push(0);
  n.colw = w.some(x => x) ? w : null;
  const ty = (n.colt || []).slice(0, cols.length);
  while (ty.length < cols.length) ty.push("");
  n.colt = ty.some(x => x) ? ty : null;
}
function bxTableType(n, i, t) {               // the override, else the guess
  const o = (n.colt && n.colt[i]) || "";
  if (o && o !== "auto") return o;
  t = t || bxTableRead(n);
  return bxDtypeInfer((t.rows || []).map(r => r[i]));
}
function bxTableSetCell(n, r, c, v) {
  const t = bxTableRead(n);
  while (t.rows.length <= r) t.rows.push(t.cols.map(() => ""));
  if (!t.rows[r]) t.rows[r] = t.cols.map(() => "");
  t.rows[r][c] = String(v == null ? "" : v);
  bxTableWrite(n, t);
}
function bxTableRenameCol(n, i, name) {
  const t = bxTableRead(n);
  if (!t.cols.length) return;
  // an emptied name goes back to its letter: a column always has a name
  t.cols[i] = String(name == null ? "" : name) || bxColLetter(i);
  bxTableWrite(n, t);
}
function bxTableInsertCol(n, i) {
  const t = bxTableRead(n);
  i = Math.max(0, Math.min(t.cols.length, Number(i) || 0));
  t.cols.splice(i, 0, bxColLetter(i));            // a new column takes its letter
  for (const r of t.rows) r.splice(i, 0, "");
  bxTableWrite(n, t);
}
function bxTableDeleteCol(n, i) {
  const t = bxTableRead(n);
  if (t.cols.length <= 1) return;              // a table keeps at least one column
  t.cols.splice(Number(i) || 0, 1);
  for (const r of t.rows) r.splice(Number(i) || 0, 1);
  bxTableWrite(n, t);
}
function bxTableAddRow(n) {
  const t = bxTableRead(n);
  t.rows.push(t.cols.map(() => ""));
  bxTableWrite(n, t);
}
function bxTableDeleteRow(n, i) {
  const t = bxTableRead(n);
  t.rows.splice(Number(i) || 0, 1);
  bxTableWrite(n, t);
}
function bxTableAttach(n, r, c, file, done) { // the bytes go to the store …
  if (!file || typeof fetch !== "function") return;      // … the cell gets an id
  const name = String((file && file.name) || "data.bin");
  fetch("/api/blob?name=" + encodeURIComponent(name), { method: "POST", body: file })
    .then(r => r.json())
    .then(d => {
      if (!(d && d.ok)) return;
      bxTableSetCell(n, r, c, "blob:" + d.id);
      bxCommit();
      bxRender();
      if (done) done(d.id);
    })
    .catch(() => {});
}
function bxLightbox(url, isVideo) {
  if (typeof document === "undefined" || !document.body) return;
  const back = mk("div", { class: "bxlight" });
  back.addEventListener("click", () => back.remove());
  back.appendChild(isVideo ? mk("video", { src: url, controls: true, autoplay: true })
                           : mk("img", { src: url, alt: "" }));
  document.body.appendChild(back);
}
/**
 * Render the dataset sheet into a box pane: header names, type chips, cells,
 * media thumbnails, and the add/remove controls. Cell edits write back through
 * bxConfigure/bxTable*; the pane is rebuilt on every canvas render.
 */
function bxDatasetFill(pane, n) {              // the table: lines and text
  if (!pane) return;
  pane.innerHTML = "";
  bxBehaveInside(pane);
  if (pane.classList) pane.classList.add("bxflat");   // no pane look at all
  const stopEv = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
  };
  const file = String(n.file || "").trim();
  let t = null, readOnly = false, note = null;
  if (file) {                                  // rows live in a file: preview it
    const cache = BX.dsCache || (BX.dsCache = {});
    const hit = cache[file];
    if (!hit) {
      note = "reading " + file + " \u2026";
      if (typeof fetch === "function")
        fetch("/api/dataset?path=" + encodeURIComponent(file))
          .then(r => r.json())
          .then(d => { cache[file] = (d && d.ok) ? d : { ok: false }; bxRender(); })
          .catch(() => { cache[file] = { ok: false }; bxRender(); });
    } else if (!hit.ok) {
      note = "cannot read " + file;
    } else {
      t = { cols: (hit.cols || []).map((c, i) => String(c == null ? "" : c) || bxColLetter(i)),
            rows: hit.rows || [], format: hit.format || "csv" };
      note = "rows come from " + file
             + (hit.more ? " \u2014 showing the first " + t.rows.length : "");
    }
    if (!t) t = { cols: [], rows: [], format: "csv" };
    readOnly = true;
  } else {
    t = bxTableRead(n);
  }
  const cols = t.cols, rows = t.rows;
  const dtypes = cols.map((_, i) => ((n.colt && n.colt[i]) || "") ||
                                    bxDtypeInfer(rows.map(r => r[i])));
  const CAP = 200;
  const scroll = mk("div", { class: "bxpbody bxsheet" });
  const table = mk("table", { class: "bxdf" });
  const cg = mk("colgroup", {});
  cg.appendChild(mk("col", { style: "width:34px" }));
  cols.forEach((_, i) => {
    const cw = (n.colw && Number(n.colw[i])) || 0;
    cg.appendChild(mk("col", { class: "bxcol" + i,
                               style: cw ? ("width:" + Math.round(cw) + "px") : "" }));
  });
  cg.appendChild(mk("col", { style: "width:22px" }));
  table.appendChild(cg);
  const thead = mk("thead");
  const nr = mk("tr", { class: "bxnames" });
  nr.appendChild(mk("th", { class: "bxcorner" }));
  cols.forEach((c, i) => {
    const th = mk("th", { class: "bxname" });
    const host = mk("div", { class: "bxnamehost" });
    th.appendChild(host);
    const slot = mk("div", { class: "bxnameslot" });
    host.appendChild(slot);
    const showName = () => {
      slot.innerHTML = "";
      let name = c;                                  // the name at render time
      if (!readOnly)                                 // …or the latest, if it was renamed
        { const t2 = bxTableRead(n); if (t2.cols[i] != null) name = String(t2.cols[i]); }
      const val = mk("div", { class: "bxnameval" + (name ? "" : " bxdim"),
                              text: name || bxColLetter(i),
                              title: "the column's name \u2014 an emptied name goes "
                                     + "back to its letter" });
      val.addEventListener("mousedown", stopEv);
      val.addEventListener("click", editName);
      slot.appendChild(val);
    };
    const editName = () => {
      if (readOnly) return;
      slot.innerHTML = "";
      const t2 = bxTableRead(n);                    // the latest name, if renamed
      const now = (t2.cols[i] != null) ? String(t2.cols[i]) : c;
      const inp = mk("input", { class: "bxcolname", type: "text", value: now,
                                placeholder: bxColLetter(i) });
      inp.addEventListener("mousedown", stopEv);
      inp.addEventListener("change", () => {
        bxTableRenameCol(n, i, inp.value);
        bxCommit();
      });
      inp.addEventListener("blur", showName);
      inp.addEventListener("keydown", (e) => {
        if ((e && e.key) === "Escape") { stopEv(e); showName(); }
      });
      slot.appendChild(inp);
      if (inp.focus) inp.focus();
    };
    showName();
    if (!readOnly) {
      const ins = mk("span", { class: "bxcolbtn", text: "+",
                               title: "insert a column after this one" });
      ins.addEventListener("mousedown", stopEv);
      ins.addEventListener("click", () => {
        bxTableInsertCol(n, i + 1);
        bxCommit();
        bxRender();
      });
      const del = mk("span", { class: "bxcolbtn", text: "\u00d7",
                               title: "remove this column" });
      del.addEventListener("mousedown", stopEv);
      del.addEventListener("click", () => {
        bxTableDeleteCol(n, i);
        bxCommit();
        bxRender();
      });
      host.appendChild(ins);
      host.appendChild(del);
    }
    const dt = mk("span", { class: "bxdtype", text: dtypes[i],
                            title: "the column's type \u2014 click to change it" });
    if (!readOnly) {
      dt.addEventListener("mousedown", stopEv);
      dt.addEventListener("click", () => {
        const order = ["auto", "int64", "float64", "bool", "object", "image", "video"];
        const cur = ((n.colt && n.colt[i]) || "auto");
        const next = order[(order.indexOf(cur) + 1) % order.length];
        const ty = (n.colt || []).slice();
        while (ty.length <= i) ty.push("");
        ty[i] = next === "auto" ? "" : next;
        n.colt = ty.some(x => x) ? ty : null;
        bxCommit();
        bxRender();
      });
    }
    th.appendChild(dt);
    const grip = mk("span", { class: "bxcolgrip", title: "drag to resize the column" });
    grip.addEventListener("mousedown", (ev) => bxColResize(ev, n, i, table));
    th.appendChild(grip);
    nr.appendChild(th);
  });
  nr.appendChild(mk("th", { class: "bxcorner" }));
  thead.appendChild(nr);
  table.appendChild(thead);

  const tbody = mk("tbody");
  const tds = {};                              // cells by "row:col"
  let cur = { r: 0, c: 0 };
  const showCell = (td, ri, ci, v) => {        // text in the cell, nothing else
    td.innerHTML = "";
    const id = bxIsBlob(v);
    if (id) {
      const url = "/api/blob?id=" + encodeURIComponent(id);
      if (bxBlobIsVideo(id))
        td.appendChild(mk("div", { class: "bxfile",
                                   text: "\u25b6 " + String(id).split(".").pop() }));
      else
        td.appendChild(mk("img", { class: "bxthumb", src: url, alt: "" }));
      return;
    }
    const val = mk("div", { class: "bxval"
                            + (["int64", "float64"].indexOf(dtypes[ci]) >= 0 ? " bxnum" : "")
                            + (v ? "" : " bxdim"), text: v });
    td.appendChild(val);
  };
  const editCell = (td, ri, ci) => {           // the editor: only while typing
    if (readOnly) return;
    cur = { r: ri, c: ci };
    const t2 = bxTableRead(n);
    const v = (t2.rows[ri] && t2.rows[ri][ci] != null) ? String(t2.rows[ri][ci]) : "";
    td.innerHTML = "";
    const inp = mk("input", { class: "bxcell", type: "text", value: v });
    inp.addEventListener("mousedown", stopEv);
    inp.addEventListener("change", () => {
      bxTableSetCell(n, ri, ci, inp.value);
      bxCommit();
    });
    inp.addEventListener("blur", () => {
      const t3 = bxTableRead(n);
      showCell(td, ri, ci, (t3.rows[ri] && t3.rows[ri][ci] != null)
                           ? String(t3.rows[ri][ci]) : "");
    });
    inp.addEventListener("keydown", (e) => {
      const k = (e && e.key) || "";
      if (k === "Enter") {
        stopEv(e);
        bxTableSetCell(n, ri, ci, inp.value);
        bxCommit();
        const below = tds[(ri + (e.shiftKey ? -1 : 1)) + ":" + ci];
        if (below) editCell(below, ri + (e.shiftKey ? -1 : 1), ci);
      } else if (k === "Escape") {
        showCell(td, ri, ci, v);               // back to what the row held
      }
    });
    td.appendChild(inp);
    if (inp.focus) inp.focus();
  };
  rows.slice(0, CAP).forEach((r, ri) => {
    const tr = mk("tr");
    tr.appendChild(mk("th", { class: "bxrowno", text: String(ri + 1) }));
    cols.forEach((_, ci) => {
      const v = r[ci] != null ? String(r[ci]) : "";
      const td = mk("td", {});
      td._r = ri;
      td._c = ci;
      tds[ri + ":" + ci] = td;
      showCell(td, ri, ci, v);
      td.addEventListener("mousedown", stopEv);
      td.addEventListener("click", () => {
        const id = bxIsBlob(bxTableRead(n).rows[ri] ? bxTableRead(n).rows[ri][ci] : "");
        if (id) bxLightbox("/api/blob?id=" + encodeURIComponent(id), bxBlobIsVideo(id));
        else editCell(td, ri, ci);
      });
      tr.appendChild(td);
    });
    const del = mk("td", { class: "bxdel", text: "\u00d7" });
    if (!readOnly) {
      del.title = "remove this row";
      del.addEventListener("mousedown", stopEv);
      del.addEventListener("click", () => {
        bxTableDeleteRow(n, ri);
        bxCommit();
        bxRender();
      });
    }
    tr.appendChild(del);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  scroll.appendChild(table);
  if (!readOnly) {
    scroll.addEventListener("paste", (e) => {  // a block from excel lands at once
      const cd = e && e.clipboardData;
      const files = cd && cd.files;
      if (files && files.length) {
        stopEv(e);
        bxTableAttach(n, cur.r, cur.c, files[0]);
        return;
      }
      const txt = cd && cd.getData ? cd.getData("text/plain") : null;
      if (txt == null) return;
      stopEv(e);
      const t2 = bxTableRead(n);
      const lines = String(txt).replace(/\r/g, "").split("\n");
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      lines.forEach((line, i) => {
        const parts = line.split("\t");
        while (t2.rows.length <= cur.r + i) t2.rows.push(t2.cols.map(() => ""));
        parts.forEach((part, j) => {
          const col = cur.c + j;
          while (t2.cols.length <= col)
            t2.cols.push(bxColLetter(t2.cols.length));      // paste grows columns
          t2.rows[cur.r + i][col] = part;
        });
      });
      bxTableWrite(n, t2);
      bxCommit();
      bxRender();
    });
    scroll.addEventListener("dragover", stopEv);
    scroll.addEventListener("drop", (e) => {   // drop an image/video onto a cell
      stopEv(e);
      const dt2 = e && e.dataTransfer;
      const f = dt2 && dt2.files && dt2.files[0];
      const td = e && e.target && e.target.closest ? e.target.closest("td") : null;
      const r = td && td._r != null ? td._r : cur.r;
      const c = td && td._c != null ? td._c : cur.c;
      if (f) bxTableAttach(n, r, c, f);
    });
  }
  pane.appendChild(scroll);
  if (rows.length > CAP)
    pane.appendChild(mk("div", { class: "bxhint2",
                                text: "showing " + CAP + " of " + rows.length + " rows" }));
  const noTok = !(String(n.repo || "").trim() || String(n.vocab || "").length);
  const strip = mk("div", { class: "bxhint2" + (noTok ? " warn" : "") });
  strip.textContent = rows.length + " rows \u00d7 " + cols.length + " cols \u00b7 " + t.format
    + (n.repo ? " \u00b7 " + String(n.repo).split("/").pop()
      : n.vocab ? " \u00b7 vocab " + String(n.vocab).length
      : " \u00b7 no tokenizer");
  pane.appendChild(strip);
  if (!readOnly) {                             // plain text controls, no boxes
    const ctl = mk("div", { class: "bxhint2" });
    const link = (label, fn, title) => {
      const b = mk("span", { class: "bxlink", text: label });
      if (title) b.title = title;
      b.addEventListener("mousedown", stopEv);
      b.addEventListener("click", fn);
      return b;
    };
    ctl.appendChild(link("+ row", () => {
      bxTableAddRow(n);
      bxCommit();
      bxRender();
    }, "add a row at the bottom"));
    ctl.appendChild(link("expand \u2197", () => {
      bxDatasetExpand(n);
      bxRender();
    }, "expand / shrink the table"));
    pane.appendChild(ctl);
  }
  if (note) pane.appendChild(mk("div", { class: "bxhint2", text: note }));
  {                                     // which train box reads this data
    const users = [];
    bxEveryBox(x => {
      if (x.kind === "select" && (x.dataset === n.id
          || (bxSelectSource(x) || {}).id === n.id)) {
        users.push((x.name || x.id) + " \u00b7 matrix "
                   + (x.cols ? "(" + x.cols + ")" : "(every column)"));
        return;
      }
      if (!bxTraining(x)) return;
      if (x.dataset === n.id) users.push((x.name || x.id) + " \u00b7 training data");
      else if (x.test_dataset === n.id) users.push((x.name || x.id) + " \u00b7 test split");
    });
    if (users.length)
      pane.appendChild(mk("div", { class: "bxhint2",
        text: "training \u00b7 " + users.join("  ") }));
    else if ((BXRUN.mode || "inference") === "training") {
      let hasTrain = false;
      bxEveryBox(x => { if (bxTraining(x)) hasTrain = true; });
      if (hasTrain) pane.appendChild(mk("div", { class: "bxhint2",
        text: "training \u00b7 nothing reads this data" }));
    }
  }
  const grip = mk("div", { class: "bxgrip" });
  grip.addEventListener("mousedown", (ev) => bxAgentGrip(ev, n));
  pane.appendChild(grip);
}
function bxColResize(ev, n, i, table) {        // drag the header edge
  if (ev.preventDefault) ev.preventDefault();
  if (ev.stopPropagation) ev.stopPropagation();
  const x0 = ev.clientX || 0;
  const th = ev.target && ev.target.parentNode;
  let w = (n.colw && Number(n.colw[i])) || (th && th.offsetWidth) || 120;
  const w0 = w;
  const move = (e) => {
    w = Math.max(40, Math.round(w0 + ((e.clientX || 0) - x0)));
    const col = table && table.querySelectorAll
      ? table.querySelectorAll(".bxcol" + i)[0] : null;
    if (col && col.style) col.style.width = w + "px";
  };
  const up = () => {
    if (typeof window !== "undefined" && window.removeEventListener) {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    const cw = (n.colw || []).slice();
    while (cw.length <= i) cw.push(0);
    cw[i] = w;
    n.colw = cw.some(x => x) ? cw : null;
    bxCommit();
    bxRender();
  };
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
}
const TINT_TAG = { tsrc: "src", ttest: "test", tscored: "scored",
                    tpolicy: "policy", tscorer: "scorer" };

