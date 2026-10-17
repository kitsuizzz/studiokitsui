/**
 * The link between the two halves of the one app: one session is a Chat
 * conversation and the NN Studio canvas it is bound to.
 *
 * The binding lives in encrypted store records. The conversation carries a
 * `canvasId`; the canvas record (owned by the canvas half) carries a
 * `session` field — the conversation's id — plus the design. Both halves
 * derive the same AES key from the same access key, and the canvas half
 * seals its records with the record id as AAD (`canvas|<id>`,
 * `session|current`), so this half can read those records — and it is the
 * one writer of the binding: it creates the canvas record a session binds
 * to (and deletes it when the session dies), and it appends or drops the
 * canvas's tab in the shared open-tabs record the canvas half restores from.
 * The canvas half owns the design itself; the user edits it there.
 */
import { decryptJson, encryptJson } from "./crypto";
import { fetchStore, syncStore } from "./cloud";
import type { ChatToolDef, Conversation } from "../types";

/** The canvas half's record ids double as its AAD. */
const CANVAS_AAD = (id: string) => "canvas|" + id;
const SESSION_AAD = "session|current";

// ---- the canvas half's records, as it writes them -------------------------

/** A canvas's design, as the canvas half seals it (the record's `design`). */
export interface CanvasDesign {
  type: string;
  version: number;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  model?: unknown;
  weights?: unknown;
}

/** One box on the canvas, as the canvas half exports it. The kind-specific
    settings ride on the node itself; the index signature is their union. */
export interface CanvasNode {
  id: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  [param: string]: unknown;
}

/** A wire between two boxes; `from`/`to` are node ids, ports 0 = the plain one. */
export interface CanvasEdge {
  from: string;
  to: string;
  fromPort: number;
  toPort: number;
}

/** The canvas half's canvas record: what it writes when the user hits Save. */
export interface CanvasRecord {
  id: string;
  name: string;
  design: CanvasDesign | null;
  /** The conversation (this half's id) the canvas is bound to; null = a
      standalone canvas the user made on the canvas side, bound to nothing. */
  session: string | null;
}

/** The shared `session|current` record: the canvas half's open tabs. */
export interface CanvasSession {
  tabs: { id: string; name: string }[];
  active: string | null;
}

// ---- the binding ------------------------------------------------------------

/** A fresh canvas id, exactly the shape the canvas half mints (`c_` + 8 hex). */
export function mintCanvasId(): string {
  const raw = new Uint8Array(8);
  crypto.getRandomValues(raw);
  let hex = "";
  for (const b of raw) hex += b.toString(16).padStart(2, "0");
  return "c_" + hex;
}

/** An empty canvas, in the exact shape the canvas half writes (version 1). */
export function blankCanvas(): CanvasDesign {
  return { type: "canvas", version: 1, nodes: [], edges: [] };
}

/** Open one canvas record's blob — the AAD-bound decrypt, on a blob the
    caller already has: the boot heal reads the whole store once, then opens
    each linked canvas from the snapshot instead of refetching per canvas. */
export async function openCanvasBlob(key: CryptoKey, canvasId: string, blob: string): Promise<CanvasRecord | null> {
  try {
    const v = await decryptJson<{ name?: unknown; design?: CanvasDesign | null; session?: unknown }>(key, blob, CANVAS_AAD(canvasId));
    if (!v || typeof v !== "object") return null;
    return {
      id: canvasId,
      name: typeof v.name === "string" && v.name ? v.name : "canvas",
      design: v.design ?? null,
      session: typeof v.session === "string" ? v.session : null,
    };
  } catch {
    return null;
  }
}

/** The canvas record `canvas|<id>`, opened with the account key, or null when
    the store is unreachable or the record has no such id. */
export async function readCanvasRecord(key: CryptoKey, canvasId: string): Promise<CanvasRecord | null> {
  const store = await fetchStore();
  if (!store) return null;
  const row = store.canvases.find((r) => r.id === CANVAS_AAD(canvasId));
  if (!row) return null;
  return openCanvasBlob(key, canvasId, row.blob);
}

/** The shared open-tabs record, or null when there is none or it won't open. */
export async function readCanvasSession(key: CryptoKey): Promise<CanvasSession | null> {
  const store = await fetchStore();
  if (!store) return null;
  const row = store.session.find((r) => r.id === SESSION_AAD);
  if (!row) return null;
  try {
    const v = await decryptJson<CanvasSession>(key, row.blob, SESSION_AAD);
    if (!v || !Array.isArray(v.tabs)) return null;
    return { tabs: v.tabs, active: typeof v.active === "string" ? v.active : null };
  } catch {
    return null;
  }
}

/** Resolve `p`'s outcome, or `false` when it is still pending after `ms` —
    the click that triggers a link navigates right after, and a slow network
    must not hold the door. */
const bounded = (p: Promise<boolean>, ms?: number): Promise<boolean> => {
  if (ms == null) return p;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (v: boolean) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    setTimeout(() => settle(false), ms);
    p.then(settle, () => settle(false));
  });
};

/** How a link that navigates away right after (the Studio door) syncs. */
export interface LinkOptions {
  /** Let the sync request outlive the page (the click navigates after it). */
  keepalive?: boolean;
  /** Stop waiting for the sync after this many ms (then cross over anyway). */
  timeoutMs?: number;
}

/**
 * Bind a session to a canvas: seal a fresh blank canvas record under the new
 * (or given) id, point it at the conversation, and make sure the shared
 * open-tabs record has a tab for it, so the canvas side opens it.
 * Best-effort — returns the canvas id, or null when the store is unreachable.
 */
export async function linkSessionCanvas(
  key: CryptoKey,
  conversationId: string,
  canvasName: string,
  canvasId?: string,
  opts?: LinkOptions,
): Promise<string | null> {
  const id = canvasId || mintCanvasId();
  const aad = CANVAS_AAD(id);
  const canvasBlob = await encryptJson(key, { name: canvasName, design: blankCanvas(), session: conversationId }, aad);
  const session = (await readCanvasSession(key)) || { tabs: [], active: null };
  if (!session.tabs.some((t) => t.id === id)) session.tabs.push({ id, name: canvasName });
  if (session.active == null) session.active = id;
  const sessionBlob = await encryptJson(key, session, SESSION_AAD);
  const ok = await bounded(
    syncStore(
      {
        canvases: { upserts: [{ id: aad, blob: canvasBlob }], deletes: [] },
        session: { upserts: [{ id: SESSION_AAD, blob: sessionBlob }], deletes: [] },
      },
      opts?.keepalive,
    ),
    opts?.timeoutMs,
  );
  return ok ? id : null;
}

/**
 * Unbind: drop the canvas's tab from the shared open-tabs record and delete
 * the canvas record. A no-op when the session has no canvas; deleting a
 * record that is already gone is not an error.
 */
export async function unlinkSessionCanvas(key: CryptoKey, canvasId: string | null): Promise<void> {
  if (!canvasId) return;
  const session = (await readCanvasSession(key)) || { tabs: [], active: null };
  const tabs = session.tabs.filter((t) => t.id !== canvasId);
  const active = session.active === canvasId ? null : session.active;
  const sessionBlob = await encryptJson(key, { tabs, active }, SESSION_AAD);
  await syncStore({
    canvases: { upserts: [], deletes: [CANVAS_AAD(canvasId)] },
    session: { upserts: [{ id: SESSION_AAD, blob: sessionBlob }], deletes: [] },
  });
}

// ---- the digest: what the chat agent reads ----------------------------------

const fmt = (v: unknown): string => (Array.isArray(v) ? v.map((x) => String(x)).join("/") : String(v));

/** The key settings of one box, per kind — the rest of a design is noise. */
function summarizeNode(n: CanvasNode): string[] {
  const bits: string[] = [];
  const put = (label: string, value: unknown) => {
    if (value != null && value !== "" && value !== false) bits.push(label + "=" + fmt(value));
  };
  switch (n.kind) {
    case "embed":
      if (n.vocab != null && n.vocab !== "") bits.push("vocab set");
      put("din", n.din);
      put("dout", n.dout);
      put("scale", n.embed_scale);
      break;
    case "input":
      put("dout", n.dout);
      put("mode", n.input_mode);
      put("file", n.file);
      break;
    case "output":
      put("din", n.din);
      if (n.train) bits.push("trains");
      break;
    case "heatmap":
      put("din", n.din);
      break;
    case "layer":
      put("din", n.din);
      put("dout", n.dout);
      break;
    case "conv":
      put("din", n.din);
      put("dout", n.dout);
      put("k", n.k);
      put("stride", n.stride);
      put("pad", n.pad);
      put("groups", n.groups);
      break;
    case "act":
      put("act", n.act);
      put("gain", n.gain);
      if (n.causal) bits.push("causal");
      break;
    case "op":
      put("op", n.op);
      for (const k of ["dims", "axes", "repeats", "dim", "factor", "theta", "width", "mode", "window", "axis", "index", "start", "stop", "din", "dout"]) put(k, n[k]);
      break;
    case "norm":
      put("norm", n.norm);
      put("eps", n.eps);
      if (n.zc) bits.push("zero-centered");
      put("size", n.size);
      put("groups", n.groups);
      break;
    case "script":
      bits.push("script (" + String(n.script || "").split("\n").length + " lines)");
      break;
    case "tokenize":
      put("repo", n.repo);
      if (n.vocab != null && n.vocab !== "") bits.push("vocab set");
      break;
    case "detokenize":
      put("repo", n.repo);
      if (n.vocab != null && n.vocab !== "") bits.push("vocab set");
      break;
    case "hf":
      put("repo", n.repo);
      put("temperature", n.temperature);
      break;
    case "sample":
      put("temperature", n.temperature);
      put("seed", n.sample_seed);
      break;
    case "agent":
      put("task", n.task_id);
      break;
    case "train":
    case "config":
    case "training":
      for (const k of ["steps", "epochs", "bs", "lr", "iters", "val_every", "patience", "seed", "dataset"]) put(k, n[k]);
      break;
    case "select":
      put("dataset", n.dataset);
      put("cols", n.cols);
      break;
    case "dataset":
      put("repo", n.repo);
      put("file", n.file);
      put("rows", n.rows);
      put("format", n.format);
      break;
    case "reward":
      put("reward", n.reward);
      put("expr", n.expr);
      put("pattern", n.pattern);
      break;
    case "loss":
      put("loss", n.loss);
      break;
    case "custom": {
      const inner = n.inner as { nodes?: CanvasNode[] } | undefined;
      if (inner && Array.isArray(inner.nodes) && inner.nodes.length) bits.push(inner.nodes.length + " inner boxes");
      put("repo", n.repo);
      if (n.model) bits.push("the model");
      break;
    }
    case "vision":
      put("din", n.din);
      put("dout", n.dout);
      put("projector", n.projector);
      for (const k of ["d_model", "heads", "blocks", "patch", "merge", "image_size"]) put(k, n[k]);
      break;
    default:
      break;
  }
  // the settings every box can carry, on top of its kind
  put("dtype", n.dtype);
  put("file", n.file);
  if (n.frozen) bits.push("frozen");
  if (n.off) bits.push("off");
  if (n.place) bits.push("place=" + fmt(n.place));
  put("params", n.params);
  return bits;
}

/**
 * A plain-language digest of a canvas design, for the chat agent: every box
 * with its kind and key settings, then the wiring between them, by name.
 * Capped at `cap` characters — past that the tail is dropped with a note.
 */
export function summarizeCanvas(design: CanvasDesign | null, cap = 4000): string {
  const nodes = (design && design.nodes) || [];
  const edges = (design && design.edges) || [];
  if (!nodes.length && !edges.length) return "The canvas is empty — no boxes yet.";
  const byId = new Map<string, CanvasNode>();
  for (const n of nodes) if (n && typeof n.id === "string") byId.set(n.id, n);
  const label = (id: string) => byId.get(id)?.name || id;
  const lines: string[] = ["Boxes:"];
  for (const n of nodes) {
    if (!n || !n.kind) continue;
    const bits = summarizeNode(n);
    lines.push("  " + (n.name || n.kind) + " (" + n.kind + (bits.length ? ") " + bits.join(", ") : ")"));
  }
  if (edges.length) {
    lines.push("Wiring:");
    for (const e of edges) {
      if (!e || typeof e.from !== "string" || typeof e.to !== "string") continue;
      const ports = e.fromPort || e.toPort ? " [" + e.fromPort + "→" + e.toPort + "]" : "";
      lines.push("  " + label(e.from) + " → " + label(e.to) + ports);
    }
  }
  let out = lines.join("\n");
  if (out.length > cap) out = out.slice(0, cap).trimEnd() + "\n… (truncated — the canvas is larger than " + cap + " characters)";
  return out;
}

// ---- the tool -----------------------------------------------------------------

/** The tool the chat agent gets while a session is bound to a canvas. */
export const READ_CANVAS_TOOL: ChatToolDef = {
  type: "function",
  function: {
    name: "read_canvas",
    description:
      "Read the NN Studio canvas this session is bound to: every box with its kind and key settings, and the wiring between them. It is read-only — you cannot change the canvas from here; if the user wants an edit, describe what to change instead.",
    parameters: { type: "object", properties: {} },
  },
};

/** What `read_canvas` answers with: the canvas's digest, or a short note. */
export async function readCanvas(key: CryptoKey, conversation: Pick<Conversation, "canvasId">): Promise<string> {
  const id = conversation.canvasId;
  if (!id) return "This session is not bound to a canvas.";
  const record = await readCanvasRecord(key, id);
  if (!record) return "This session's canvas has no saved record — it is empty, or it was deleted.";
  return record.name + ":\n" + summarizeCanvas(record.design);
}
