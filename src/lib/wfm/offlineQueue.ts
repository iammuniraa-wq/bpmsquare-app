// Offline punch queue — plain IndexedDB (no library needed for one small
// object store). Spec §4.1: "if network fails, queue the punch (photo +
// ts + geo) in IndexedDB and sync on reconnect. Punch is timestamped at
// capture, not at sync." No Service Worker / Background Sync API is used —
// iOS Safari doesn't support it, and the requirements explicitly call for
// "no reliance on background sync." Flushing happens on the `online` event
// and whenever the punch screen mounts/becomes visible, which is enough
// for an app the worker actually reopens.

import type { PresenceKind } from "@/lib/wfm/types";

const DB_NAME = "wfm-offline-queue";
const STORE = "punches";

export type QueuedPunch = {
  id: string; // client-generated punch id -- also the server idempotency key
  kind: PresenceKind;
  ts: string;
  geo: { lat: number; lng: number; accuracy_m: number } | null;
  selfie: Blob | null;
  queuedAt: string;
  /** Set when the server REJECTED this punch (a 4xx: ts outside the accepted
   * window, consent not recorded, transition no longer valid). The entry
   * stays in the queue so the employee is told the truth rather than a false
   * "synced", and the punch screen can surface it for a manual fix. */
  rejected?: { at: string; status: number; reason: string };
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueuePunch(entry: QueuedPunch): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listQueuedPunches(): Promise<QueuedPunch[]> {
  const db = await openDb();
  const result = await new Promise<QueuedPunch[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedPunch[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function dequeuePunch(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Push every queued punch to the server, oldest first (order matters -- the
 * state machine validates each transition against the last one).
 *
 * Three outcomes per entry:
 *  - 2xx (or a duplicate the server already has): synced, removed.
 *  - 4xx: the server REJECTED it -- ts too old, consent missing, transition
 *    no longer valid. It will never succeed on retry, so it is not dropped
 *    silently (the old behaviour, which counted it as "synced" and deleted
 *    it, telling the worker their punch was saved when it was thrown away).
 *    It stays in the queue marked `rejected` so the punch screen can show it.
 *  - 5xx / network error: transient -- stop here, the rest keep their place
 *    and retry next flush.
 */
export async function flushQueue(): Promise<{ synced: number; rejected: number; remaining: number }> {
  const queued = (await listQueuedPunches()).filter((e) => !e.rejected);
  let synced = 0;
  let rejected = 0;
  for (const entry of queued) {
    try {
      const res = await fetch("/api/wfm/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, kind: entry.kind, ts: entry.ts, geo: entry.geo }),
      });

      if (res.status >= 500) break; // transient server problem -- try again later

      if (!res.ok) {
        // A 4xx the server will keep rejecting. Mark it, don't discard it:
        // the worker needs to know this punch did NOT record.
        let reason = "This punch could not be recorded.";
        try { reason = (await res.json())?.error ?? reason; } catch { /* keep default */ }
        await enqueuePunch({
          ...entry,
          rejected: { at: new Date().toISOString(), status: res.status, reason },
        });
        rejected++;
        continue;
      }

      if (entry.selfie) {
        const form = new FormData();
        form.append("event_id", entry.id);
        form.append("file", entry.selfie, "selfie.jpg");
        await fetch("/api/wfm/punch/selfie", { method: "POST", body: form }).catch(() => {});
      }
      await dequeuePunch(entry.id);
      synced++;
    } catch {
      break; // still offline
    }
  }
  const all = await listQueuedPunches();
  return { synced, rejected, remaining: all.filter((e) => !e.rejected).length };
}

/** Punches the server refused, kept so the UI can list them for a manual fix. */
export async function listRejectedPunches(): Promise<QueuedPunch[]> {
  return (await listQueuedPunches()).filter((e) => !!e.rejected);
}

/** Discard a rejected punch once the employee has acknowledged it (e.g. filed
 * a correction instead). */
export async function discardRejectedPunch(id: string): Promise<void> {
  await dequeuePunch(id);
}
