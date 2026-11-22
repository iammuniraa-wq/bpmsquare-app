import { describe, expect, it } from "vitest";
import { controlPlanePrivateKey, generateControlPlaneKeys } from "./crypto";
import { isMissingRelation, listInstances, refreshInstance, registerInstance, validateRegistration, type InstanceRow } from "./registry";

const base = { name: "KAMCO", slug: "kamco", base_url: "https://8.8.8.8", status: "active" };

describe("validateRegistration (the SSRF guard on register)", () => {
  it("refuses http", async () => {
    const r = await validateRegistration({ ...base, base_url: "http://8.8.8.8" });
    expect(r).toEqual({ ok: false, error: "The URL must use https" });
  });

  it("refuses private, loopback, link-local and internal hosts", async () => {
    for (const u of ["https://127.0.0.1", "https://10.0.0.5", "https://192.168.1.10", "https://169.254.169.254", "https://localhost", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://db.internal"]) {
      const r = await validateRegistration({ ...base, base_url: u });
      expect(r.ok, u).toBe(false);
    }
  });

  it("refuses credentials in the URL, a bad slug, a bad status, and a missing name", async () => {
    expect((await validateRegistration({ ...base, base_url: "https://user:pw@8.8.8.8" })).ok).toBe(false);
    expect((await validateRegistration({ ...base, slug: "Bad Slug!" })).ok).toBe(false);
    expect((await validateRegistration({ ...base, status: "live" })).ok).toBe(false);
    expect((await validateRegistration({ ...base, name: " " })).ok).toBe(false);
  });

  it("stores the bare origin, lowercase slug and trimmed optional fields", async () => {
    const r = await validateRegistration({ ...base, slug: "KAMCO", base_url: "https://8.8.8.8/some/path?x=1", region: " me-central-1 ", notes: "" });
    expect(r).toEqual({
      ok: true,
      value: { slug: "kamco", name: "KAMCO", base_url: "https://8.8.8.8", status: "active", region: "me-central-1", db_host: null, branch: null, notes: null },
    });
  });
});

describe("registry degrades while migration 0247 is pending", () => {
  const missing = { code: "42P01", message: 'relation "platform_instances" does not exist' };
  const admin = {
    from: () => ({
      select: () => ({ order: async () => ({ data: null, error: missing }) }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: missing }) }) }),
    }),
  } as never;

  it("reads a missing relation as pending with an empty list", async () => {
    expect(isMissingRelation(missing)).toBe(true);
    expect(isMissingRelation({ code: "PGRST205" })).toBe(true);
    expect(isMissingRelation({ code: "23505" })).toBe(false);
    expect(await listInstances(admin)).toEqual({ rows: [], pending: true });
  });

  it("registering says a database update is needed instead of crashing", async () => {
    const r = await registerInstance(admin, base, "owner@x.test");
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
});

describe("refreshInstance", () => {
  const priv = controlPlanePrivateKey(generateControlPlaneKeys().privateKeyEnv)!;
  const row = { id: "i1", slug: "kamco", base_url: "https://8.8.8.8", status: "active", last_summary: null } as unknown as InstanceRow;
  const summary = {
    instance: { slug: "kamco", name: "KAMCO", build: "abc12345", region: "fra1", now: "2026-11-22T10:00:00Z" },
    tenants: [], health: { db: true, ai_configured: true, email_configured: true },
  };
  const store = () => {
    const updates: Record<string, unknown>[] = [];
    const admin = { from: () => ({ update: (u: Record<string, unknown>) => { updates.push(u); return { eq: async () => ({ error: null }) }; } }) } as never;
    return { admin, updates };
  };
  const respond = (status: number, body?: unknown) => (async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as never;

  it("signs the request, stores the summary and the time", async () => {
    const { admin, updates } = store();
    let seen: { url: string; headers: Headers } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => { seen = { url, headers: new Headers(init.headers) }; return new Response(JSON.stringify(summary)); }) as never;
    expect(await refreshInstance(admin, row, priv, fetcher)).toEqual({ ok: true });
    expect(seen!.url).toBe("https://8.8.8.8/api/platform/summary");
    expect(seen!.headers.get("x-cp-sig")).toBeTruthy();
    expect(updates[0].last_summary).toEqual(summary);
    expect(typeof updates[0].last_seen_at).toBe("string");
  });

  it("a 404 means the instance did not opt in; the failure is stored, the old summary kept", async () => {
    const { admin, updates } = store();
    const r = await refreshInstance(admin, { ...row, last_summary: summary as never }, priv, respond(404, { error: "x" }));
    expect(r.ok).toBe(false);
    expect(updates[0].last_summary).toMatchObject({ instance: summary.instance, fetch_error: expect.stringContaining("does not answer") });
    expect(updates[0]).not.toHaveProperty("last_seen_at");
  });

  it("a summary that names a different slug is refused", async () => {
    const { admin } = store();
    const r = await refreshInstance(admin, row, priv, respond(200, { ...summary, instance: { ...summary.instance, slug: "other" } }));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("different slug") });
  });

  it("a network failure is a stored message, not a throw", async () => {
    const { admin } = store();
    const r = await refreshInstance(admin, row, priv, (async () => { throw new Error("The address redirected too many times"); }) as never);
    expect(r).toEqual({ ok: false, error: "The address redirected too many times" });
  });
});
