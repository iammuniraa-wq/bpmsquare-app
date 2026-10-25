import { describe, it, expect, vi, afterEach } from "vitest";

// The real SSRF guard (no mock of safeHost): the base URL is typed by a tenant admin and fetched by OUR server.
vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string | null) => v,
  decrypt: (v: string | null) => v,
  sealSecret: (v: string | null | undefined) => (v ? `enc:${v}` : undefined),
  unsealSecret: (v: string | null | undefined) => (v ? v.replace(/^enc:/, "") : undefined),
}));

import { fakeAdmin } from "@/lib/middleware/testHarness";
import { FAKE_ENDPOINTS } from "./fakeEpromis";
import { createEpromisProject, pullEpromisMasters, sendEpromisBudget, testEpromis } from "./server";
import { pullMasters } from "./operations";
import type { EpromisConfig } from "./types";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const T = "t-1";
const SECRET = "sk-live-ssrf-0123456789";
const cfg = (base: string, over: Partial<EpromisConfig> = {}): EpromisConfig => ({
  base_url: base, auth_type: "api_key", key_header: "X-Api-Key", username: "", company_name: "", company_value: "", company_in: "header", endpoints: FAKE_ENDPOINTS, ...over,
});
const seed = (base: string, over: Partial<EpromisConfig> = {}) => fakeAdmin({
  tenant_connectors: [{ tenant_id: T, connector_id: "epromis", status: "connected", last_error: null, config: cfg(base, over), credentials: { secret: `enc:${SECRET}` } }],
}).client;
const payload = { code: "P1", name: "n" };
const budget = { project_code: "P1", revision_no: 0, mode: "create" as const, total: 1, lines: [] };

describe("a request to a private or internal address is never sent", () => {
  it.each([
    "https://10.0.0.5/api", "https://192.168.1.10/api", "https://169.254.169.254/latest", "https://127.0.0.1/api", "https://localhost/api",
    "https://[::1]/api", "https://[::ffff:127.0.0.1]/api", "https://box.internal/api", "https://erp.local/api", "https://100.64.0.1/api",
  ])("%s: reads, writes and the test all refuse it", async (base) => {
    const f = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", f);
    const admin = seed(base);
    for (const r of [
      await pullEpromisMasters(admin, T, "resources", { sleep: async () => {} }),
      await createEpromisProject(admin, T, payload, { sleep: async () => {} }),
      await sendEpromisBudget(admin, T, budget, { sleep: async () => {} }),
    ]) {
      expect(r).toMatchObject({ ok: false, state: "error", message: expect.stringMatching(/private or internal network/) });
      expect(JSON.stringify(r)).not.toContain(SECRET);
    }
    const t = await testEpromis(admin, T, { sleep: async () => {} });
    expect(t).toMatchObject({ ok: false, status: 400 });
    expect(t.line).toMatch(/private or internal network/);
    expect(f).not.toHaveBeenCalled();
  });

  it("plain http is refused before anything is sent, even for a public address", async () => {
    const f = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", f);
    const r = await pullEpromisMasters(seed("http://8.8.8.8/api"), T, "resources");
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/must use https/) });
    expect(f).not.toHaveBeenCalled();
  });

  it("a path in the endpoint map can not reach another host (checked on use, not only on save)", async () => {
    const f = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", f);
    const c = { cfg: cfg("https://8.8.8.8/api", { endpoints: { list_tenders: { path: "//evil.example/x", fields: { code: "c" } } } }), creds: { secret: SECRET } };
    await pullMasters(c, "tenders");
    const target = String((f.mock.calls as unknown as [string][])[0]?.[0] ?? "");
    expect(target === "" || target.startsWith("https://8.8.8.8/")).toBe(true);
  });
});

describe("redirects are refused, never followed", () => {
  it("a redirect to the metadata address is not followed and not retried", async () => {
    const f = vi.fn(async (_u: string | URL, _i?: RequestInit) => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    vi.stubGlobal("fetch", f);
    const r = await pullEpromisMasters(seed("https://8.8.8.8/api"), T, "resources", { sleep: async () => {} });
    expect(r).toMatchObject({ ok: false, state: "error", message: expect.stringMatching(/redirected/) });
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain("8.8.8.8");
  });

  it("a redirect to another public host does not carry the key there", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL, init: RequestInit) => {
      seen.push(String(u));
      expect(new Headers(init.headers).get("x-api-key")).toBe(SECRET);
      return new Response(null, { status: 307, headers: { location: "https://1.1.1.1/steal" } });
    }));
    const r = await pullEpromisMasters(seed("https://8.8.8.8/api"), T, "resources", { sleep: async () => {} });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/redirected/) });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("8.8.8.8");
  });

  it("a write redirected to another host is not re-sent", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => { seen.push(String(u)); return new Response(null, { status: 307, headers: { location: "https://1.1.1.1/x" } }); }));
    const r = await createEpromisProject(seed("https://8.8.8.8/api"), T, payload, { sleep: async () => {} });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/redirected/) });
    expect(seen).toHaveLength(1);
  });

  it("every request goes to the configured host and carries the credential only there", async () => {
    const seen: { url: string; key: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL, init: RequestInit) => {
      seen.push({ url: String(u), key: new Headers(init.headers).get("x-api-key") });
      return new Response(JSON.stringify({ data: { items: [{ Code: "A", Name: "a" }] } }), { status: 200 });
    }));
    const r = await pullEpromisMasters(seed("https://8.8.8.8/api"), T, "resources", { sleep: async () => {} });
    expect(r.ok).toBe(true);
    expect(seen.every((s) => s.url.startsWith("https://8.8.8.8/api/") && s.key === SECRET)).toBe(true);
  });
});
