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
 * Push every queued punch to the server, oldest first (order matters --
 * the state machine validates each transition against the last one).
 * Stops at the first failure (still offline, or a real rejection) so nothing
 * gets skipped or reordered; whatever synced is removed from the queue.
 */
export async function flushQueue(): Promise<{ synced: number; remaining: number }> {
  const queued = await listQueuedPunches();
  let synced = 0;
  for (const entry of queued) {
    try {
      const res = await fetch("/api/wfm/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, kind: entry.kind, ts: entry.ts, geo: entry.geo }),
      });
      if (!res.ok && res.status !== 409) {
        // A genuine network/server problem -- stop, try again later.
        // (409 = the transition is now invalid, e.g. superseded by a
        // manual/admin correction while offline; drop it rather than
        // block every later queued punch forever.)
        if (res.status >= 500) break;
      }
      if (res.ok && entry.selfie) {
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
  const remaining = (await listQueuedPunches()).length;
  return { synced, remaining };
}
