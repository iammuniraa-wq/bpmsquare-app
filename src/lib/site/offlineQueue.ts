// The site capture queue: a receipt or an expense typed on a phone with no signal is kept in IndexedDB with its photos and uploaded when the
// phone is back online. Same shape as the WFM punch queue (src/lib/wfm/offlineQueue.ts): the client id is the server's idempotency key, the
// capture time is kept, entries go oldest first, no service worker or background sync (iOS Safari has none), and an entry the server REJECTS
// stays in the queue marked with the reason so the person is told the truth instead of a false "saved".
// Not offline, on purpose: approving, editing an expense that already synced, and reading a photo with AI (the person types, or it is read later).

export type CaptureKind = "expense" | "receipt";

export type QueuedCapture = {
  /** The client id: also the server's idempotency key (`client_id`), so a re-send never makes a second record. */
  id: string;
  kind: CaptureKind;
  /** The data as the route reads it (never includes the photos). */
  payload: Record<string, unknown>;
  photos: Blob[];
  signature: Blob | null;
  /** What the person sees in the waiting list: "Crane hire 412.85", "DN-24817". */
  label: string;
  queuedAt: string;
  /** Set when the server REJECTED the entry (a 4xx): it stays, the person reads why and fixes it by entering it again. */
  rejected?: { at: string; status: number; reason: string };
};

const DB_NAME = "site-offline-queue";
const STORE = "captures";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueCapture(entry: QueuedCapture): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listCaptures(): Promise<QueuedCapture[]> {
  const db = await openDb();
  const result = await new Promise<QueuedCapture[]>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedCapture[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function removeCapture(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export const endpointFor = (kind: CaptureKind): string => (kind === "expense" ? "/api/site-expenses" : "/api/site-receipts");

/** One request holds the data and the files, so an upload is atomic: either the record and its photos exist, or the same request is sent again. */
export function buildForm(payload: Record<string, unknown>, photos: readonly Blob[], signature: Blob | null): FormData {
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  photos.forEach((p, i) => form.append("photos", p, `photo-${i + 1}.jpg`));
  if (signature) form.append("signature", signature, "signature.png");
  return form;
}

export type StatusClass = "synced" | "rejected" | "retry";
/**
 * What an answer means for a queued entry:
 *  - 2xx (a 200 is the server saying it already has this client id): synced, removed.
 *  - 401, 5xx and 503 (a pending database update): the same entry will succeed later, so it keeps its place and the flush stops.
 *  - any other 4xx: the server will keep refusing it (a closed project, a bad amount, a module switched off): kept, marked rejected, with the reason.
 */
export function classifyStatus(status: number): StatusClass {
  if (status >= 200 && status < 300) return "synced";
  if (status === 401 || status === 408 || status === 429 || status >= 500) return "retry";
  return "rejected";
}

export async function flushQueue(): Promise<{ synced: number; rejected: number; remaining: number }> {
  const queued = (await listCaptures()).filter((e) => !e.rejected);
  let synced = 0;
  let rejected = 0;
  for (const entry of queued) {
    try {
      const res = await fetch(endpointFor(entry.kind), { method: "POST", body: buildForm(entry.payload, entry.photos, entry.signature) });
      const kind = classifyStatus(res.status);
      if (kind === "retry") break;
      if (kind === "rejected") {
        let reason = "This could not be recorded.";
        try { reason = (await res.json())?.error ?? reason; } catch { /* keep the default */ }
        await enqueueCapture({ ...entry, rejected: { at: new Date().toISOString(), status: res.status, reason } });
        rejected++;
        continue;
      }
      await removeCapture(entry.id);
      synced++;
    } catch {
      break; // still offline
    }
  }
  const all = await listCaptures();
  return { synced, rejected, remaining: all.filter((e) => !e.rejected).length };
}

/** The entries the server refused, kept so the screen can list them with the reason. */
export async function listRejected(): Promise<QueuedCapture[]> {
  return (await listCaptures()).filter((e) => !!e.rejected);
}

/** Discard a rejected entry once the person has read it. */
export async function discardRejected(id: string): Promise<void> {
  await removeCapture(id);
}

/**
 * Send one capture now when online; keep it for later when there is no signal or the server is having a problem. A refusal (4xx) is returned to
 * the person at once and nothing is queued, so a mistake is fixed on the spot instead of being found later.
 */
export async function submitOrQueue(entry: QueuedCapture): Promise<{ state: "saved" | "queued" | "refused"; error?: string }> {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (!offline) {
    try {
      const res = await fetch(endpointFor(entry.kind), { method: "POST", body: buildForm(entry.payload, entry.photos, entry.signature) });
      const kind = classifyStatus(res.status);
      if (kind === "synced") return { state: "saved" };
      if (kind === "rejected") {
        let reason = "This could not be recorded.";
        try { reason = (await res.json())?.error ?? reason; } catch { /* keep the default */ }
        return { state: "refused", error: reason };
      }
    } catch { /* no signal: fall through to the queue */ }
  }
  await enqueueCapture(entry);
  return { state: "queued" };
}
