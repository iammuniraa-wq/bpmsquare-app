import { beforeEach, describe, expect, it, vi } from "vitest";

// IndexedDB and fetch do not exist in the node test env: a tiny in-memory store stands in so the REAL flush logic runs. The point under test is
// the decision per HTTP status and the idempotent client id, which is where a silent loss of a site entry would come from.
const store = new Map<string, unknown>();

vi.stubGlobal("indexedDB", {
  open() {
    const req: { result: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null; onupgradeneeded: (() => void) | null } = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
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
                const r: { result: unknown[]; onsuccess: (() => void) | null; onerror: null } = { result: [...store.values()], onsuccess: null, onerror: null };
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

const { classifyStatus, enqueueCapture, flushQueue, listCaptures, listRejected, submitOrQueue, buildForm, endpointFor } = await import("./offlineQueue");

const entry = (id: string, queuedAt = "2026-11-23T09:00:00.000Z", kind: "expense" | "receipt" = "expense") => ({
  id, kind, payload: { client_id: id, project_id: "p", amount: 10 }, photos: [] as Blob[], signature: null, label: id, queuedAt,
});
const answer = (status: number, body: unknown = {}) => ({ ok: status < 300, status, json: async () => body });

beforeEach(() => { store.clear(); vi.restoreAllMocks(); });

describe("classifyStatus", () => {
  it("2xx is synced, a server problem or an expired login is retried later, any other 4xx is a refusal", () => {
    expect(classifyStatus(201)).toBe("synced");
    expect(classifyStatus(200)).toBe("synced");
    for (const s of [401, 408, 429, 500, 502, 503]) expect(classifyStatus(s), String(s)).toBe("retry");
    for (const s of [400, 403, 404, 409, 422]) expect(classifyStatus(s), String(s)).toBe("rejected");
  });
});

describe("flushQueue", () => {
  it("sends the oldest first, as one multipart request each, and removes what synced", async () => {
    await enqueueCapture(entry("b", "2026-11-23T10:00:00.000Z"));
    await enqueueCapture(entry("a", "2026-11-23T09:00:00.000Z", "receipt"));
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: FormData }) => { seen.push(`${url}:${JSON.parse(init.body.get("payload") as string).client_id}`); return answer(201); }));
    expect(await flushQueue()).toEqual({ synced: 2, rejected: 0, remaining: 0 });
    expect(seen).toEqual(["/api/site-receipts:a", "/api/site-expenses:b"]);
    expect(await listCaptures()).toHaveLength(0);
  });
  it("a 200 (the server already has that client id) counts as synced, not as a second record", async () => {
    await enqueueCapture(entry("a"));
    vi.stubGlobal("fetch", vi.fn(async () => answer(200, { duplicate_request: true })));
    expect(await flushQueue()).toMatchObject({ synced: 1, remaining: 0 });
  });
  it("KEEPS a 4xx entry, marked rejected with the reason, instead of silently dropping it", async () => {
    await enqueueCapture(entry("a"));
    vi.stubGlobal("fetch", vi.fn(async () => answer(422, { error: "Choose an active project that takes site entries" })));
    expect(await flushQueue()).toEqual({ synced: 0, rejected: 1, remaining: 0 });
    const rejected = await listRejected();
    expect(rejected).toHaveLength(1);
    expect(rejected[0].rejected).toMatchObject({ status: 422, reason: "Choose an active project that takes site entries" });
  });
  it("does not resend a rejected entry on the next flush", async () => {
    await enqueueCapture({ ...entry("a"), rejected: { at: "x", status: 422, reason: "no" } });
    const f = vi.fn(async () => answer(201));
    vi.stubGlobal("fetch", f);
    await flushQueue();
    expect(f).not.toHaveBeenCalled();
  });
  it("stops on a server problem and keeps the rest in their place", async () => {
    await enqueueCapture(entry("a", "2026-11-23T09:00:00.000Z"));
    await enqueueCapture(entry("b", "2026-11-23T10:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn(async () => answer(503)));
    expect(await flushQueue()).toEqual({ synced: 0, rejected: 0, remaining: 2 });
  });
  it("stops when still offline (fetch throws)", async () => {
    await enqueueCapture(entry("a"));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    expect(await flushQueue()).toEqual({ synced: 0, rejected: 0, remaining: 1 });
  });
});

describe("submitOrQueue", () => {
  it("saves at once when online and accepted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(201)));
    expect(await submitOrQueue(entry("a"))).toEqual({ state: "saved" });
    expect(await listCaptures()).toHaveLength(0);
  });
  it("queues with no signal, with the capture time kept", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    expect(await submitOrQueue(entry("a", "2026-11-23T08:30:00.000Z"))).toEqual({ state: "queued" });
    expect((await listCaptures())[0]).toMatchObject({ id: "a", queuedAt: "2026-11-23T08:30:00.000Z" });
  });
  it("hands a refusal straight back and queues nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(422, { error: "Enter the amount" })));
    expect(await submitOrQueue(entry("a"))).toEqual({ state: "refused", error: "Enter the amount" });
    expect(await listCaptures()).toHaveLength(0);
  });
  it("queues on a server problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(500)));
    expect(await submitOrQueue(entry("a"))).toEqual({ state: "queued" });
  });
});

describe("the request", () => {
  it("holds the data as one JSON field and the photos as files", () => {
    const form = buildForm({ client_id: "x" }, [new Blob(["a"], { type: "image/jpeg" })], new Blob(["s"], { type: "image/png" }));
    expect(JSON.parse(form.get("payload") as string)).toEqual({ client_id: "x" });
    expect(form.getAll("photos")).toHaveLength(1);
    expect(form.get("signature")).toBeTruthy();
    expect(endpointFor("receipt")).toBe("/api/site-receipts");
  });
});
