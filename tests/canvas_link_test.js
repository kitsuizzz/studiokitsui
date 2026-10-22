#!/usr/bin/env node
/**
 * The session seam, read from the Chat half's side.
 *
 * One session is a conversation and the canvas it is bound to; the binding
 * lives in the encrypted store, sealed by the canvas half. This test closes
 * the circle tests/studio_crypto_test.js opens: the page's own sealer,
 * lifted out of ui/index.html as that test does, writes the rows, and the
 * Chat half's own lib/canvasLink.ts — bundled for Node — reads them back.
 * One webcrypto realm, so the key needs no re-derivation; what is pinned
 * here is the plumbing the byte test cannot reach: the row keys (the AADs),
 * the shapes that cross the seam, the digest, and the tool.
 *
 * The bundle is built by tests/run.sh. Standalone:
 *   cd <repo>
 *   chat/frontend/node_modules/.bin/esbuild chat/frontend/src/lib/canvasLink.ts \
 *     --bundle --platform=node --format=cjs --define:import.meta.env.BASE_URL='"/chat/"' \
 *     --outfile=/tmp/nnstudio_canvas_link_bundle.cjs
 *   node tests/canvas_link_test.js
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.dirname(__dirname);
const HTML = fs.readFileSync(path.join(ROOT, "ui", "index.html"), "utf8");

function grab(start, end) {
  const i = HTML.indexOf(start);
  const j = i < 0 ? -1 : HTML.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error("the UI script moved: no " + start);
  return HTML.slice(i, j);
}

// The page's sealer — the same lift the crypto test makes.
const consts = grab("const BX_E2E = {", "const BX_CANVAS_MAX");
const funcs = grab("function bxCryptoReady()", "// the shared key cache");
const aad = grab("function bxCanvasAad(id) {", "async function bxCanvases()");
const ui = new Function(
  consts + funcs + aad +
  "; return { bxDataKey, bxSealRecord, bxOpenRecord, bxCanvasAad };",
)();

const eql = (a, b, msg) => assert.deepStrictEqual(a, b, msg || JSON.stringify(a) + " != " + JSON.stringify(b));
const ok = (v, msg) => assert.ok(v, msg);
const failed = [];
// The checks run one at a time: they share the store snapshot below, so the
// harness awaits each before arming the next.
async function check(name, fn) {
  try {
    await fn();
    console.log("  ok   " + name);
  } catch (e) {
    failed.push(name);
    console.log("  FAIL " + name + " — " + (e && e.message));
  }
}

// The store, as the backend serves it: six collections of {id, blob} rows.
// Reassigned per check, and captured at fetch time, so one check can never
// observe another's store. Anything but the store read is a failure — the
// seam is read-only, and any write (link, unlink, sync) would surface here.
const emptyStore = () => ({ conversations: [], studios: [], views: [], last: [], canvases: [], session: [] });
const fetches = [];
let snapshot = emptyStore();
globalThis.fetch = async (url) => {
  fetches.push(String(url));
  if (!String(url).endsWith("/auth/store"))
    throw new Error("the seam made a request it should not: " + url);
  const store = snapshot;
  return { ok: true, status: 200, json: async () => store };
};

const BUNDLE = "/tmp/nnstudio_canvas_link_bundle.cjs";
if (!fs.existsSync(BUNDLE)) {
  console.log("canvas_link_test: " + BUNDLE + " is missing — tests/run.sh builds it; or:");
  console.log("  chat/frontend/node_modules/.bin/esbuild chat/frontend/src/lib/canvasLink.ts \\");
  console.log('    --bundle --platform=node --format=cjs --define:import.meta.env.BASE_URL=\'"/chat/"\' \\');
  console.log("    --outfile=" + BUNDLE);
  process.exit(1);
}
const link = require(BUNDLE);
if (fetches.length) {
  console.log("canvas_link_test: the bundle reached for the network at load: " + fetches.join(", "));
  process.exit(1);
}

const KEY = "ast_" + "a".repeat(43);

(async () => {
  let key;
  try {
    key = await ui.bxDataKey(KEY);
  } catch (e) {
    console.log("canvas_link_test: the page's key derivation failed under Node: " + (e && e.message));
    process.exit(1);
    return;
  }

  await check("a blank canvas is the seam's smallest payload", () => {
    eql(link.blankCanvas(), { type: "canvas", version: 1, nodes: [], edges: [] },
      "blankCanvas() drifted: " + JSON.stringify(link.blankCanvas()));
  });

  await check("a minted canvas id is c_ + eight random bytes", () => {
    const a = link.mintCanvasId();
    const b = link.mintCanvasId();
    ok(/^c_[0-9a-f]{16}$/.test(a), "the mint drifted: " + a);
    ok(a !== b, "two mints collided");
  });

  await check("the empty digest is the note the agent sees", () => {
    ok(link.summarizeCanvas(null) === "The canvas is empty — no boxes yet.",
      "a null digest drifted: " + JSON.stringify(link.summarizeCanvas(null)));
    ok(link.summarizeCanvas(link.blankCanvas()) === "The canvas is empty — no boxes yet.",
      "a blank digest drifted: " + JSON.stringify(link.summarizeCanvas(link.blankCanvas())));
  });

  // The design both the digest checks and the cross-half checks seal: one
  // vocabulary box feeding one trained output — small enough to pin exactly.
  const small = {
    type: "canvas", version: 1,
    nodes: [
      { id: "a", kind: "embed", name: "in", x: 0, y: 0, vocab: "w", din: 4 },
      { id: "b", kind: "output", name: "out", x: 0, y: 0, din: 4, train: true },
    ],
    edges: [{ from: "a", to: "b" }],
  };

  await check("the digest is the boxes with their key settings, then the wiring", () => {
    ok(link.summarizeCanvas(small) ===
      "Boxes:\n  in [a] (embed) vocab set, din=4\n  out [b] (output) din=4, trains\nWiring:\n  in → out",
      "the digest drifted: " + JSON.stringify(link.summarizeCanvas(small)));
  });

  await check("a canvas past the cap is cut, with a note saying so", () => {
    const big = {
      type: "canvas", version: 1,
      nodes: Array.from({ length: 12 }, (_, i) => ({
        id: "n" + i, kind: "input", name: "a fairly long input name number " + i, x: 0, y: 0, dout: 128,
      })),
      edges: [],
    };
    const full = link.summarizeCanvas(big);
    ok(full.length > 300, "the fixture no longer trips the cap: " + full.length + " chars");
    ok(link.summarizeCanvas(big, 300) === full.slice(0, 300).trimEnd() +
      "\n… (truncated — the canvas is larger than 300 characters)",
      "the cut or its note drifted: " + JSON.stringify(link.summarizeCanvas(big, 300)));
  });

  await check("the tools the agent gets: live read_canvas, approved edit_canvas", () => {
    const t = link.READ_CANVAS_TOOL;
    ok(t && t.type === "function" && t.function && t.function.name === "read_canvas",
      "the read tool's shape drifted: " + JSON.stringify(t));
    ok(/live/.test(t.function.description), "the read tool no longer says it reads the live canvas");
    eql(t.function.parameters, { type: "object", properties: {} },
      "the read tool takes no parameters: " + JSON.stringify(t.function.parameters));
    const e = link.EDIT_CANVAS_TOOL;
    ok(e && e.type === "function" && e.function && e.function.name === "edit_canvas",
      "the edit tool's shape drifted: " + JSON.stringify(e));
    ok(e.function.parameters && e.function.parameters.properties &&
       e.function.parameters.properties.ops,
      "the edit tool lost its ops: " + JSON.stringify(e.function.parameters));
  });

  await check("an unbound session answers with the note, and never reaches the store", async () => {
    fetches.length = 0;
    snapshot = emptyStore();
    const out = await link.readCanvas(key, {});
    ok(out === "This session is not bound to a canvas.",
      "the unbound note drifted: " + JSON.stringify(out));
    ok(fetches.length === 0, "the unbound path touched the network: " + fetches.join(", "));
  });

  await check("a bound session whose record is gone answers with the other note", async () => {
    fetches.length = 0;
    snapshot = emptyStore();
    const out = await link.readCanvas(key, { canvasId: "c_00112233" });
    ok(out === "This session's canvas has no saved record — it is empty, or it was deleted.",
      "the missing-record note drifted: " + JSON.stringify(out));
    ok(fetches.length === 1, "the missing-record path should read the store once: " + fetches.join(", "));
  });

  await check("a canvas row the page sealed under its AAD, the Chat half opens", async () => {
    snapshot = emptyStore();
    snapshot.canvases = [{
      id: "canvas|c_00112233",
      blob: await ui.bxSealRecord(key, ui.bxCanvasAad("c_00112233"), { name: "The seam", design: small, session: "9" }),
    }];
    const rec = await link.readCanvasRecord(key, "c_00112233");
    ok(rec, "the Chat half could not open the row the canvas half sealed");
    eql(rec, { id: "c_00112233", name: "The seam", design: small, session: "9" },
      "the record that crossed the seam is not what the page sealed: " + JSON.stringify(rec));
  });

  await check("the session row the Chat half reads is the AAD-keyed one", async () => {
    snapshot = emptyStore();
    snapshot.session = [{
      id: "session|current",
      blob: await ui.bxSealRecord(key, "session|current", { tabs: [{ id: "c_00112233", name: "The seam" }], active: "c_00112233" }),
    }];
    const s = await link.readCanvasSession(key);
    ok(s, "the Chat half found no session row under its key");
    eql(s, { tabs: [{ id: "c_00112233", name: "The seam" }], active: "c_00112233" },
      "the shared open-tabs record is not what the canvas half sealed: " + JSON.stringify(s));
  });

  await check("the pre-v2 row (bare current) is the page's to retire, not the Chat half's", async () => {
    const legacy = await ui.bxSealRecord(key, "current", { tabs: [{ id: "c_alpha", name: "alpha" }], active: "c_alpha" });
    snapshot = emptyStore();
    snapshot.session = [{ id: "current", blob: legacy }];
    ok(await ui.bxOpenRecord(key, "current", legacy),
      "the page's own reader no longer opens the legacy row — the boot migration would be dead");
    ok(await link.readCanvasSession(key) === null,
      "the Chat half read the legacy row — it must not; the page's boot retires it");
  });

  await check("read_canvas answers with the canvas's name and its digest", async () => {
    snapshot = emptyStore();
    snapshot.canvases = [{
      id: "canvas|c_00112233",
      blob: await ui.bxSealRecord(key, ui.bxCanvasAad("c_00112233"), { name: "The seam", design: small, session: "9" }),
    }];
    const out = await link.readCanvas(key, { canvasId: "c_00112233" });
    ok(out.startsWith("The seam:\n"), "the answer no longer opens with the canvas's name: " + JSON.stringify(out));
    ok(out.indexOf("in → out") !== -1, "the digest lost its wiring: " + JSON.stringify(out));
  });

  if (failed.length) {
    console.log("canvas_link_test: " + failed.length + " failure(s): " + failed.join(", "));
    process.exit(1);
  }
  console.log("canvas_link_test: all assertions passed");
})();
