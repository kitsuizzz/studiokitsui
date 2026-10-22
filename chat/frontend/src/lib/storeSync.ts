import type { ReadingSpot } from "../components/readingSpot";
import { syncStore, type StoreRecord } from "./cloud";
import { decryptJson, encryptJson } from "./crypto";
import type { Conversation } from "../types";

/** Decrypt a batch of server records; one bad record is skipped, not fatal. */
export async function decryptAll<T>(key: CryptoKey, records: StoreRecord[]): Promise<T[]> {
  const out: T[] = [];
  for (const rec of records) {
    try {
      out.push(await decryptJson<T>(key, rec.blob));
    } catch {
      // Wrong key or tampered ciphertext: leave it out of the loaded set.
    }
  }
  return out;
}

/** The reading spots, for the conversations that are still there; an unreadable record is left out. */
export async function decryptViews(
  key: CryptoKey,
  records: StoreRecord[],
  conversations: Conversation[]
): Promise<Map<number, ReadingSpot>> {
  const live = new Set(conversations.map((c) => String(c.id)));
  const out = new Map<number, ReadingSpot>();
  for (const rec of records) {
    if (!live.has(rec.id)) continue;
    try {
      out.set(Number(rec.id), await decryptJson<ReadingSpot>(key, rec.blob));
    } catch {
      // Wrong key or tampered ciphertext: leave it out.
    }
  }
  return out;
}

/** Upload the reading spots that changed since the last sync (only those records; a removed spot is deleted). */
export async function syncReadingSpots(
  cloud: { key: CryptoKey },
  spotsRef: { current: Map<number, ReadingSpot> },
  syncedRef: { current: { views: Map<string, string> } },
  keepalive = false
): Promise<void> {
  const synced = syncedRef.current.views;
  const upserts: { id: string; blob: string }[] = [];
  const signatures = new Map<string, string>();
  for (const [id, spot] of spotsRef.current) {
    const signature = JSON.stringify(spot);
    if (synced.get(String(id)) === signature) continue;
    upserts.push({ id: String(id), blob: await encryptJson(cloud.key, spot) });
    signatures.set(String(id), signature);
  }
  const deletes = [...synced.keys()].filter((id) => !spotsRef.current.has(Number(id)));
  if (!upserts.length && !deletes.length) return;
  const ok = await syncStore(
    {
      conversations: { upserts: [], deletes: [] },
      studios: { upserts: [], deletes: [] },
      views: { upserts, deletes },
    },
    keepalive
  );
  if (!ok) return; // retried on the next change
  for (const [id, signature] of signatures) synced.set(id, signature);
  for (const id of deletes) synced.delete(id);
}

/** The conversation the account was last in, or null when unknown. */
export async function decryptLast(key: CryptoKey, records: StoreRecord[]): Promise<number | null> {
  const rec = records.find((r) => r.id === "current");
  if (!rec) return null;
  try {
    const value = await decryptJson<{ conversationId?: number }>(key, rec.blob);
    return typeof value.conversationId === "number" ? value.conversationId : null;
  } catch {
    // Wrong key or tampered ciphertext: no pointer.
    return null;
  }
}

/** Upload the last-session pointer when it changed (the account's one record). */
export async function syncLastSession(
  cloud: { key: CryptoKey },
  lastRef: { current: number | null },
  syncedRef: { current: { last: Map<string, string> } },
  keepalive = false
): Promise<void> {
  const synced = syncedRef.current.last;
  const id = lastRef.current;
  if (id == null) {
    if (!synced.has("current")) return;
    const ok = await syncStore(
      {
        conversations: { upserts: [], deletes: [] },
        studios: { upserts: [], deletes: [] },
        last: { upserts: [], deletes: ["current"] },
      },
      keepalive
    );
    if (ok) synced.delete("current");
    return;
  }
  const signature = JSON.stringify({ conversationId: id });
  if (synced.get("current") === signature) return;
  const ok = await syncStore(
    {
      conversations: { upserts: [], deletes: [] },
      studios: { upserts: [], deletes: [] },
      last: { upserts: [{ id: "current", blob: await encryptJson(cloud.key, { conversationId: id }) }], deletes: [] },
    },
    keepalive
  );
  if (ok) synced.set("current", signature);
}

/** What changed since the last sync: re-encrypted upserts + removed ids. */
export async function diffRecords(
  current: { id: string; value: unknown }[],
  synced: Map<string, string>,
  key: CryptoKey,
): Promise<{ upserts: { id: string; blob: string }[]; deletes: string[] }> {
  const upserts: { id: string; blob: string }[] = [];
  const deletes: string[] = [];
  const seen = new Set<string>();
  for (const { id, value } of current) {
    seen.add(id);
    const signature = JSON.stringify(value);
    if (synced.get(id) === signature) continue;
    upserts.push({ id, blob: await encryptJson(key, value) });
  }
  for (const id of synced.keys()) if (!seen.has(id)) deletes.push(id);
  return { upserts, deletes };
}
