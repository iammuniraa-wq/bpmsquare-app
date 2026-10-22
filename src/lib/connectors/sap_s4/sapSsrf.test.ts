import { describe, it, expect, vi, afterEach } from "vitest";

// The real SSRF guard (no mock of safeHost): the API host is typed by a tenant and fetched by OUR server.
vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {} }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: () => {} }));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: async () => ({ data: null, error: null }) }));

import { fakeAdmin } from "@/lib/middleware/testHarness";
import { fakeDb } from "@/lib/connectors/d365/syncHarness";
import { runSapPull, saveSapConnection, testSap } from "./server";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const T = "t-1";
const save = (host: string) => saveSapConnection(fakeAdmin({ tenant_connectors: [] }).client, T, "u-1", { config: { auth_mode: "basic", api_host: host, username: "U" }, secrets: { password: "p" } });

describe("saving: only https, only a public host", () => {
  it.each(["10.0.0.5", "192.168.1.10", "169.254.169.254", "127.0.0.1", "localhost", "[::1]", "[::ffff:127.0.0.1]", "intranet.internal", "box.local"])("refuses %s", async (host) => {
    await expect(save(host)).rejects.toThrow(/private or internal network/);
  });

  it("refuses http and a host with a path or a user", async () => {
    await expect(save("http://8.8.8.8")).rejects.toThrow(/https/);
    await expect(save("https://8.8.8.8/sap")).rejects.toThrow(/host only/);
    await expect(save("https://me:pw@8.8.8.8")).rejects.toThrow(/user name/);
  });

  it("accepts a public address", async () => {
    const state = await save("https://8.8.8.8");
    expect(state.config?.api_host).toBe("8.8.8.8");
  });
});

const seed = (host: string) => ({
  tenants: [{ id: T, features: { accounts: true, integration_middleware: true }, config: {} }],
  tenant_connectors: [{ tenant_id: T, connector_id: "sap_s4", status: "connected", last_error: null, config: { auth_mode: "basic", api_host: host, username: "U", schedule: "off", entities: {} }, credentials: { password: "pw" } }],
});

describe("calling out", () => {
  it("never sends a request when the stored host is private", async () => {
    const f = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", f);
    const db = fakeDb(seed("10.0.0.5"));
    const r = await runSapPull(db.client, T, "customers", { trigger: "manual", userId: null, sleep: async () => {} });
    expect(r.error).toMatch(/private or internal network/);
    expect(f).not.toHaveBeenCalled();
    const t = await testSap(fakeAdmin(seed("10.0.0.5")).client, T);
    expect(t.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("does not follow a redirect to a private address, and does not retry it", async () => {
    const f = vi.fn(async (_u: string | URL, _i?: RequestInit) => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    vi.stubGlobal("fetch", f);
    const db = fakeDb(seed("8.8.8.8"));
    const r = await runSapPull(db.client, T, "customers", { trigger: "manual", userId: null, sleep: async () => {} });
    expect(r.error).toMatch(/redirected/);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain("8.8.8.8");
    expect(JSON.stringify(r)).not.toContain("pw");
  });

  it("never follows a redirect between public hosts, so the login and an APIKey stay on the pinned host", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL, init: RequestInit) => {
      seen.push(String(u));
      expect(new Headers(init.headers).get("authorization")).toMatch(/^Basic /);
      return new Response(null, { status: 307, headers: { location: "https://1.1.1.1/x" } });
    }));
    const db = fakeDb(seed("8.8.8.8"));
    const r = await runSapPull(db.client, T, "customers", { trigger: "manual", userId: null, sleep: async () => {} });
    expect(r.error).toMatch(/redirected/);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("8.8.8.8");
  });
});
