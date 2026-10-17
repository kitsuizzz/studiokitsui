#!/usr/bin/env node
/**
 * The account, end to end, against the running app.
 *
 * Signs up over HTTP (the robot check's test token), seals a canvas with the
 * page's own crypto, puts it in the shared store, reads it back, opens it,
 * and signs out — the whole path a browser takes, minus the DOM. Needs the
 * app on :8124 (tests/run.sh --live) and MariaDB.
 *
 * The seal/open round trip is the interesting half: the ciphertext is
 * produced by the same helpers the Studio half runs, bound to its record id,
 * and the wrong id must refuse it.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
const APP = process.env.NNSTUDIO_APP || "http://localhost:8124";

const HTML = fs.readFileSync(path.join(ROOT, "ui", "index.html"), "utf8");
function grab(start, end) {
  const i = HTML.indexOf(start);
  const j = i < 0 ? -1 : HTML.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error("the UI script moved: no " + start);
  return HTML.slice(i, j);
}
const ui = new Function(
  grab("const BX_E2E = {", "const BX_CANVAS_MAX") +
    grab("function bxCryptoReady()", "// the shared key cache") +
    "; return { bxNewKey, bxHandle, bxCredential, bxDataKey, bxSealRecord, bxOpenRecord };",
)();

let cookie = "";
async function call(url, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(APP + url, Object.assign({}, opts, { headers }));
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const value = String(c).split(";")[0];
    if (value.indexOf("aistudio.account=") === 0) {
      cookie = value.endsWith('=""') ? "" : value;   // the sign-out clears it
    }
  }
  return res;
}

const failed = [];
async function check(name, fn) {
  try {
    await fn();
    console.log("  ok   " + name);
  } catch (e) {
    failed.push(name);
    console.log("  FAIL " + name + " — " + (e && e.message));
  }
}
function need(cond, msg) {
  if (!cond) throw new Error(msg);
}

let key = "";
let recordKey = null;
const id = "c_" + crypto.randomBytes(8).toString("hex");
const design = {
  type: "canvas",
  version: 1,
  nodes: [{ id: "n1", kind: "input", name: "live in", x: 0, y: 0, dout: 4 }],
  edges: [],
};

async function main() {
await check("the config answers (and says whether the robot check is on)", async () => {
  const res = await call("/chat/auth/config");
  need(res.status === 200, "config: " + res.status);
  const cfg = await res.json();
  need(typeof cfg.captcha === "boolean", "captcha flag");
  need(typeof cfg.session_days === "number", "session_days");
  global.captchaOn = cfg.captcha;
});

await check("sign-up mints the account and sets the HttpOnly session cookie", async () => {
  key = ui.bxNewKey();
  const res = await call("/chat/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      credential: await ui.bxCredential(key),
      handle: ui.bxHandle(key),
      captcha: "XXXX.DUMMY.TOKEN.XXXX",
    }),
  });
  if (res.status !== 201) {
    const text = await res.text();
    if (global.captchaOn && res.status === 400) {
      console.log("  ok   (the robot check is live — the sign-up is skipped)");
      return;
    }
    throw new Error("signup: " + res.status + " " + text);
  }
  need(cookie.indexOf("aistudio.account=") === 0, "the cookie was set");
  const body = await res.json();
  need(body.user && body.user.id, "the account came back");
});

await check("the store starts empty for a fresh account", async () => {
  const res = await call("/chat/auth/store");
  need(res.status === 200, "store: " + res.status);
  const store = await res.json();
  need(Array.isArray(store.canvases) && store.canvases.length === 0, "no canvases yet");
});

await check("a canvas seals, syncs, and opens with the same key", async () => {
  recordKey = await ui.bxDataKey(key);
  const blob = await ui.bxSealRecord(recordKey, "canvas|" + id, {
    name: "live canvas",
    design: design,
  });
  const res = await call("/chat/auth/store/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ canvases: { upserts: [{ id: id, blob: blob }], deletes: [] } }),
  });
  need(res.status === 200, "sync: " + res.status);

  const store = await (await call("/chat/auth/store")).json();
  const row = (store.canvases || []).find((r) => r.id === id);
  need(row, "the record is in the store");
  need(String(row.blob).indexOf("live canvas") < 0, "the server holds ciphertext");
  const back = await ui.bxOpenRecord(recordKey, "canvas|" + id, row.blob);
  need(back.name === "live canvas", "the name came back");
  need((back.design.nodes || []).length === 1, "the design came back");
  let refused = false;
  try {
    await ui.bxOpenRecord(recordKey, "canvas|other", row.blob);
  } catch (e) {
    refused = true;
  }
  need(refused, "the record is bound to its id");
});

await check("sign-out drops the session, and the store refuses a guest", async () => {
  const out = await call("/chat/auth/signout", { method: "POST" });
  need(out.status === 200, "signout: " + out.status);
  need(cookie === "", "the cookie was cleared");
  const res = await call("/chat/auth/store");
  need(res.status === 401, "the store after signout: " + res.status);
  const v1 = await call("/chat/v1/models");
  need(v1.status === 401, "/v1 after signout: " + v1.status);
});

}

main().then(() => {
  if (failed.length) {
    console.log("live_account_test: " + failed.length + " failure(s): " + failed.join(", "));
    process.exit(1);
  }
  console.log("live_account_test: all assertions passed");
});
