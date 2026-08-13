import { describe, it, expect, beforeEach, vi } from "vitest";

// offlineQueue uses IndexedDB and fetch, neither of which exists in the node
// test env. A tiny in-memory object store stands in for IndexedDB so the real
// flushQueue logic runs unchanged -- the point under test is the DECISION per
// HTTP status, which is exactly where the silent-drop bug lived.
const store = new Map<string, unknown>();

vi.stubGlobal("indexedDB", {
  open() {
    const req: {
      result: unknown; onsuccess: (() => void) | null;
      onerror: (() => void) | null; onupgradeneeded: (() => void) | null;
    } = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    const db = {
      close() {},
      createObjectStore() {},
      transaction() {
        return {
          objectStore() {
            return {
              put(v: { id: string }) { store.set(v.id, v); },
              delete(id: string) { store.delete(id); },
              getAll() {
                const r: { result: unknown[]; onsuccess: (() => void) | null; onerror: null } =
                  { result: [...store.values()], onsuccess: null, onerror: null };
                queueMicrotask(() => r.onsuccess?.());
                return r;
              },
            };
          },
          set oncomplete(fn: () => void) { queueMicrotask(fn); },
          set onerror(_fn: () => void) {},
        };
      },
    };
    req.result = db;
    queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
    return req;
  },
});

const { enqueuePunch, flushQueue, listQueuedPunches, listRejectedPunches } = await import("./offlineQueue");

const punch = (id: string, ts = "2026-08-12T09:00:00.000Z") => ({
  id, kind: "check_in" as const, ts, geo: null, selfie: null, queuedAt: ts,
});

beforeEach(() => { store.clear(); vi.restoreAllMocks(); });

describe("flushQueue outcome per HTTP status", () => {
  it("syncs and removes a 2xx punch", async () => {
    await enqueuePunch(punch("a"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const r = await flushQueue();
    expect(r).toMatchObject({ synced: 1, rejected: 0, remaining: 0 });
    expect(await listQueuedPunches()).toHaveLength(0);
  });

  it("KEEPS a 4xx punch, marked rejected, instead of silently dropping it", async () => {
    // The exact bug: a punch the server refuses (e.g. ts older than 7 days)
    // must NOT be counted as synced and deleted.
    await enqueuePunch(punch("old"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: "ts out of acceptable range" }),
    }));
    const r = await flushQueue();
    expect(r.synced).toBe(0);
    expect(r.rejected).toBe(1);

    const rejected = await listRejectedPunches();
    expect(rejected).toHaveLength(1);
    expect(rejected[0].rejected?.reason).toBe("ts out of acceptable range");
    // Not re-attempted on the next flush.
    expect(r.remaining).toBe(0);
  });

  it("stops on a 5xx and leaves the punch queued to retry", async () => {
    await enqueuePunch(punch("b"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const r = await flushQueue();
    expect(r).toMatchObject({ synced: 0, rejected: 0, remaining: 1 });
  });

  it("stops at the first transient failure without reordering the rest", async () => {
    await enqueuePunch(punch("1", "2026-08-12T09:00:00.000Z"));
    await enqueuePunch(punch("2", "2026-08-12T09:05:00.000Z"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })   // 1 syncs
      .mockResolvedValueOnce({ ok: false, status: 500 }); // 2 fails transiently
    vi.stubGlobal("fetch", fetchMock);
    const r = await flushQueue();
    expect(r.synced).toBe(1);
    expect(r.remaining).toBe(1); // punch 2 still there, still first in line
  });

  it("does not re-send a punch already marked rejected", async () => {
    await enqueuePunch({ ...punch("done"), rejected: { at: "x", status: 400, reason: "old" } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await flushQueue();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.synced).toBe(0);
  });
});
