import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every host resolves to a public address here, so the real SSRF guard (no mock of safeHost) runs without touching the network.
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "20.190.1.1", family: 4 }] }));

import { authParts, callConnection, fetchToken, joinUrl, tokenFresh, tokenRequest, type LiveConnection, type Token, type TokenStore } from "./request";
import { runConnectionTest } from "./test";
import { describeHttpFailure, describeNetworkError, describeTokenFailure } from "./plain";
import { defaultScope, entraTokenUrl, parseConnectionInput, type ConnectionConfig, type ConnectionSecrets } from "./spec";

const SECRET = "s3cr3t-value-0123456789";

const live = (config: Partial<ConnectionConfig>, secrets: ConnectionSecrets = {}, family: "rest" | "odata" = "rest"): LiveConnection & { family: "rest" | "odata" } => ({
  id: "c-1", tenantId: "t-1", family, secrets, config: { base_url: "https://8.8.8.8/api", auth: "none", ...config },
});

const memoryStore = (): TokenStore & { value: Token | null; sets: number } => {
  const s = {
    value: null as Token | null, sets: 0,
    async get() { return s.value; },
    async set(t: Token) { s.value = t; s.sets++; },
    async clear() { s.value = null; },
  };
  return s;
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls as unknown as [string | URL, RequestInit][];
const urlOf = (c: [string | URL, RequestInit]) => String(c[0]);
const headerOf = (c: [string | URL, RequestInit], name: string) => new Headers(c[1].headers).get(name);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("parseConnectionInput: the few fields each type needs", () => {
  const base = { name: "Sales API", family: "rest", config: { base_url: "https://api.example.com/v1/", auth: "none" } };

  it("a REST connection with no sign-in needs a name, an https address and nothing else", () => {
    const r = parseConnectionInput(base);
    expect(r).toMatchObject({ ok: true, name: "Sales API", family: "rest", config: { base_url: "https://api.example.com/v1", auth: "none" }, secrets: {} });
  });

  it.each([
    ["api_key", { auth: "api_key", key_name: "X-Key", key_in: "query" }, { api_key: SECRET }, "api_key"],
    ["basic", { auth: "basic", username: "svc" }, { password: SECRET }, "password"],
    ["bearer", { auth: "bearer" }, { token: SECRET }, "token"],
    ["oauth2_cc custom", { auth: "oauth2_cc", oauth_provider: "custom", token_url: "https://idp.example.com/token", client_id: "cid" }, { client_secret: SECRET }, "client_secret"],
    ["oauth2_cc entra", { auth: "oauth2_cc", oauth_provider: "entra", directory_id: "contoso.onmicrosoft.com", client_id: "cid" }, { client_secret: SECRET }, "client_secret"],
  ])("%s asks for exactly its own secret", (_n, cfg, secrets, key) => {
    const r = parseConnectionInput({ ...base, config: { ...base.config, ...cfg }, secrets });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.secrets)).toEqual([key]);
    const missing = parseConnectionInput({ ...base, config: { ...base.config, ...cfg } });
    expect(missing.ok).toBe(false);
  });

  it("a blank secret on an edit keeps the stored one; a changed sign-in type asks for the new secret", () => {
    const stored = { config: { base_url: "https://api.example.com/v1", auth: "bearer" as const }, has: { token: true } };
    expect(parseConnectionInput({ ...base, config: { ...base.config, auth: "bearer" } }, stored)).toMatchObject({ ok: true, secrets: {} });
    const changed = parseConnectionInput({ ...base, config: { ...base.config, auth: "api_key" } }, stored);
    expect(changed.ok).toBe(false);
  });

  it.each([
    ["http://api.example.com", /https/],
    ["ftp://api.example.com", /https/],
    ["https://user:pw@api.example.com", /user name or password/],
    ["https://api.example.com/v1?key=abc", /key=value/],
    ["not a url", /web address/],
    ["", /required/],
  ])("the address %s is refused in words", (addr, re) => {
    const r = parseConnectionInput({ ...base, config: { base_url: addr, auth: "none" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.find((e) => e.field === "base_url")?.message).toMatch(re);
  });

  it("the check path can not leave the server", () => {
    for (const p of ["//evil.example/x", "/a/../b", "health", "/a b"]) {
      expect(parseConnectionInput({ ...base, config: { ...base.config, test_path: p } }).ok, p).toBe(false);
    }
    expect(parseConnectionInput({ ...base, config: { ...base.config, test_path: "/health" } }).ok).toBe(true);
  });

  it("a key can not be sent under a header the connection owns, and no credential may hold a line break", () => {
    const withKey = (key_name: string, key_in = "header", api_key = SECRET) => parseConnectionInput({ ...base, config: { ...base.config, auth: "api_key", key_name, key_in }, secrets: { api_key } });
    for (const h of ["Host", "content-length", "Transfer-Encoding", "Connection", "Cookie", "Content-Type", "Proxy-Authorization", "X-BPMSquare-Signature"]) expect(withKey(h).ok, h).toBe(false);
    expect(withKey("Host", "query").ok).toBe(true);
    expect(withKey("Authorization").ok).toBe(true);
    expect(withKey("X-Key", "header", "abc\r\nX-Evil: 1").ok).toBe(false);
    const basic = (username: string, password = "p") => parseConnectionInput({ ...base, config: { ...base.config, auth: "basic", username }, secrets: { password } });
    expect(basic("a:b").ok).toBe(false);
    expect(basic("svc", "pw\nx").ok).toBe(false);
    expect(basic("svc").ok).toBe(true);
  });

  it("the Microsoft directory must look like a directory id", () => {
    const r = parseConnectionInput({ ...base, config: { ...base.config, auth: "oauth2_cc", oauth_provider: "entra", directory_id: "nope", client_id: "c" }, secrets: { client_secret: SECRET } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].field).toBe("directory_id");
    const ok = parseConnectionInput({ ...base, config: { ...base.config, auth: "oauth2_cc", oauth_provider: "entra", directory_id: "11111111-2222-4333-8444-555555555555", client_id: "c" }, secrets: { client_secret: SECRET } });
    expect(ok.ok).toBe(true);
  });
});

describe("requests are built right", () => {
  it("joinUrl keeps every request on the connection's own server", () => {
    expect(joinUrl("https://api.example.com/v1", "/health")).toBe("https://api.example.com/v1/health");
    expect(joinUrl("https://api.example.com/v1", "")).toBe("https://api.example.com/v1");
    expect(joinUrl("https://api.example.com/data", "Customers?$top=1")).toBe("https://api.example.com/data/Customers?$top=1");
    for (const p of ["https://evil.example/x", "//evil.example/x", "\\\\evil", "javascript:alert(1)"]) expect(() => joinUrl("https://api.example.com/v1", p), p).toThrow();
    expect(() => joinUrl("https://api.example.com/v1", "/../admin")).toThrow();
  });

  it("API key goes in the header or the query as chosen; basic and bearer in Authorization", () => {
    expect(authParts(live({ auth: "api_key", key_name: "X-Key", key_in: "header" }, { api_key: "K" }), null)).toEqual({ headers: { "X-Key": "K" }, query: {} });
    expect(authParts(live({ auth: "api_key", key_name: "api_key", key_in: "query" }, { api_key: "K" }), null)).toEqual({ headers: {}, query: { api_key: "K" } });
    expect(authParts(live({ auth: "basic", username: "u" }, { password: "p" }), null).headers.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
    expect(authParts(live({ auth: "bearer" }, { token: "T" }), null).headers.Authorization).toBe("Bearer T");
    expect(authParts(live({ auth: "oauth2_cc" }, { client_secret: "x" }), "ACCESS").headers.Authorization).toBe("Bearer ACCESS");
    expect(authParts(live({ auth: "none" }), null)).toEqual({ headers: {}, query: {} });
  });

  it("an API key in the query is on the request that is sent, a bearer token is on its header", async () => {
    const f = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", f);
    await callConnection(live({ auth: "api_key", key_name: "k", key_in: "query" }, { api_key: "ABC" }), { path: "/ping" });
    expect(urlOf(calls(f)[0])).toBe("https://8.8.8.8/api/ping?k=ABC");
    await callConnection(live({ auth: "bearer" }, { token: "TTT" }), { path: "/ping" });
    expect(headerOf(calls(f)[1], "authorization")).toBe("Bearer TTT");
  });

  it("the Microsoft token request names the directory and asks for the system's /.default scope", () => {
    const c = live({ auth: "oauth2_cc", oauth_provider: "entra", directory_id: "contoso.onmicrosoft.com", client_id: "cid", base_url: "https://x.operations.dynamics.com/data" }, { client_secret: SECRET });
    const { url, body } = tokenRequest(c);
    expect(url).toBe(entraTokenUrl("contoso.onmicrosoft.com"));
    expect(url).toBe("https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token");
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe(SECRET);
    expect(body.get("scope")).toBe("https://x.operations.dynamics.com/.default");
    expect(defaultScope("https://x.operations.dynamics.com/data")).toBe("https://x.operations.dynamics.com/.default");
  });

  it("a server on the older token address is asked for a resource, any other for a scope", () => {
    const v1 = tokenRequest(live({ auth: "oauth2_cc", oauth_provider: "custom", token_url: "https://login.microsoftonline.com/t/oauth2/token", client_id: "c", scope: "https://x.crm.dynamics.com/.default" }, { client_secret: "s" }));
    expect(v1.body.get("resource")).toBe("https://x.crm.dynamics.com");
    expect(v1.body.get("scope")).toBeNull();
    const other = tokenRequest(live({ auth: "oauth2_cc", oauth_provider: "custom", token_url: "https://idp.example.com/oauth/token", client_id: "c", scope: "read" }, { client_secret: "s" }));
    expect(other.body.get("scope")).toBe("read");
    const none = tokenRequest(live({ auth: "oauth2_cc", oauth_provider: "custom", token_url: "https://idp.example.com/oauth/token", client_id: "c" }, { client_secret: "s" }));
    expect(none.body.has("scope")).toBe(false);
  });
});

describe("OAuth 2 client credentials: the token is fetched once and kept until it expires", () => {
  const cc = (over: Partial<ConnectionConfig> = {}) => live({ auth: "oauth2_cc", oauth_provider: "custom", token_url: "https://8.8.8.8/token", client_id: "cid", ...over }, { client_secret: SECRET });
  const fetcher = (tokenExpiresIn = 3600) => vi.fn(async (url: string | URL) => (String(url).endsWith("/token") ? json({ access_token: `tok-${Math.random()}`, expires_in: tokenExpiresIn }) : json({ value: [] })));

  it("two calls make one token request", async () => {
    const f = fetcher();
    vi.stubGlobal("fetch", f);
    const store = memoryStore();
    const c = cc();
    const a = await callConnection(c, { path: "/items" }, store);
    const b = await callConnection(c, { path: "/items" }, store);
    expect(a.ok && b.ok).toBe(true);
    const tokenCalls = calls(f).filter((x) => urlOf(x).endsWith("/token"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0][1].method).toBe("POST");
    expect(String(tokenCalls[0][1].body)).toContain("grant_type=client_credentials");
    const apiCalls = calls(f).filter((x) => !urlOf(x).endsWith("/token"));
    expect(headerOf(apiCalls[0], "authorization")).toBe(headerOf(apiCalls[1], "authorization"));
    expect(store.sets).toBe(1);
  });

  it("an expired token is replaced", async () => {
    const f = fetcher();
    vi.stubGlobal("fetch", f);
    const store = memoryStore();
    store.value = { token: "old", exp: Date.now() - 1000 };
    await callConnection(cc(), { path: "/items" }, store);
    expect(calls(f).filter((x) => urlOf(x).endsWith("/token"))).toHaveLength(1);
    expect(store.value?.token).not.toBe("old");
  });

  it("tokenFresh keeps a one-minute margin", () => {
    const now = 1_000_000;
    expect(tokenFresh({ token: "t", exp: now + 120_000 }, now)).toBe(true);
    expect(tokenFresh({ token: "t", exp: now + 30_000 }, now)).toBe(false);
    expect(tokenFresh(null, now)).toBe(false);
  });

  it("a 401 on a cached token drops it, asks for a new one and tries once more", async () => {
    let apiHits = 0;
    const f = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/token")) return json({ access_token: "fresh", expires_in: 3600 });
      apiHits++;
      return new Headers(init?.headers).get("authorization") === "Bearer stale" ? json({}, 401) : json({ ok: 1 });
    });
    vi.stubGlobal("fetch", f);
    const store = memoryStore();
    store.value = { token: "stale", exp: Date.now() + 3_600_000 };
    const r = await callConnection(cc(), { path: "/items" }, store);
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(apiHits).toBe(2);
    expect(store.value?.token).toBe("fresh");
  });

  it("a refused secret is said in words, with the Microsoft code as the reference only", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_client", error_description: "AADSTS7000222: The provided client secret keys are expired. Trace ID: 0000 Correlation ID: 1111" }, 401)));
    const r = await fetchToken(cc());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.result.message).toBe("The client secret has expired.");
      expect(r.result.reference).toBe("AADSTS7000222");
      expect(r.result.fix).toMatch(/Certificates and secrets/);
      expect(JSON.stringify(r.result)).not.toMatch(/Trace ID|Correlation/);
    }
  });
});

describe("Test: what each failure says to do", () => {
  const rest = (over: Partial<ConnectionConfig> = {}, secrets: ConnectionSecrets = {}) => live(over, secrets, "rest");

  it("a REST system that answers is connected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "up" })));
    expect(await runConnectionTest(rest())).toMatchObject({ ok: true, message: "Connected." });
  });

  it("a 204 is connected, a 200 with nothing in it is connected with a note, a web page is not data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    expect(await runConnectionTest(rest())).toMatchObject({ ok: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    expect(await runConnectionTest(rest())).toMatchObject({ ok: true, note: "empty body" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } })));
    expect(await runConnectionTest(rest())).toMatchObject({ ok: false, message: expect.stringMatching(/web page, not data/) });
  });

  it("401 says the sign-in was refused and what to check", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "nope" }, 401)));
    const r = await runConnectionTest(rest({ auth: "bearer" }, { token: SECRET }));
    expect(r).toMatchObject({ ok: false, httpStatus: 401, message: expect.stringMatching(/refused the sign-in \(401\)/), fix: expect.stringMatching(/expired|key/) });
  });

  it("403 names the missing permission when the system does", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { message: "Principal user (Id=1) is missing prvReadAccount privilege" } }, 403)));
    const r = await runConnectionTest(rest());
    expect(r).toMatchObject({ ok: false, httpStatus: 403, reference: "prvReadAccount", message: expect.stringMatching(/missing the permission prvReadAccount/) });
    expect(r.fix).toMatch(/role/);
  });

  it("404, 429 and 503 each say what is wrong", () => {
    expect(describeHttpFailure(404, "").message).toMatch(/nothing is at this path/);
    expect(describeHttpFailure(404, "", "odata").message).toMatch(/not an OData service/);
    expect(describeHttpFailure(429, "").message).toMatch(/too many requests/);
    expect(describeHttpFailure(503, "boom stack trace").message).toBe("The system had an error (HTTP 503).");
    expect(JSON.stringify(describeHttpFailure(503, "boom stack trace"))).not.toContain("boom");
  });

  it("DNS, timeout, refused, TLS and the address guard are said in words and never leak the exception text", () => {
    const dns = describeNetworkError(Object.assign(new TypeError("fetch failed: secret-host-detail"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND erp.example.com"), { code: "ENOTFOUND" }) }));
    expect(dns.message).toBe("The address could not be found.");
    const timeout = describeNetworkError(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    expect(timeout.message).toMatch(/did not answer within 15 seconds/);
    const refused = describeNetworkError(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 8.8.8.8:443"), { code: "ECONNREFUSED" }) }));
    expect(refused.message).toMatch(/Nothing is listening/);
    const tls = describeNetworkError(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("unable to verify the first certificate"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }) }));
    expect(tls.message).toMatch(/secure connection could not be made/);
    expect(tls.fix).toMatch(/certificate/);
    const guard = describeNetworkError(new Error("That address points at a private or internal network"));
    expect(guard.message).toMatch(/private or internal network/);
    for (const r of [dns, timeout, refused, tls, guard]) {
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/secret-host-detail|ECONN|getaddrinfo|TypeError|fetch failed|UNABLE_TO/);
    }
    expect(describeNetworkError(new Error("weird")).message).toBe("The system could not be reached.");
  });

  it("a timeout from the real call is said as a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }));
    expect(await runConnectionTest(rest())).toMatchObject({ ok: false, message: expect.stringMatching(/did not answer/) });
  });

  it("a wrong Microsoft directory id and an expired secret are named", () => {
    expect(describeTokenFailure(400, JSON.stringify({ error: "invalid_request", error_description: "AADSTS90002: Tenant 'x' not found." })).message).toMatch(/could not find that directory/);
    expect(describeTokenFailure(401, JSON.stringify({ error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." })).message).toBe("The client secret is wrong.");
    expect(describeTokenFailure(400, JSON.stringify({ error: "invalid_client" })).message).toMatch(/client ID or secret/);
    expect(describeTokenFailure(400, "<html>not json</html>").message).toMatch(/refused the client ID and secret/);
  });

  it("an OData service is checked on $metadata and the entity sets are counted", async () => {
    const xml = `<?xml version="1.0"?><edmx:Edmx Version="4.0"><edmx:DataServices><Schema Namespace="N"><EntityType Name="Customer"><Key><PropertyRef Name="Id"/></Key><Property Name="Id" Type="Edm.String"/></EntityType><EntityContainer Name="C"><EntitySet Name="Customers" EntityType="N.Customer"/><EntitySet Name="Vendors" EntityType="N.Customer"/></EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`;
    const f = vi.fn(async () => new Response(xml, { status: 200, headers: { "content-type": "application/xml" } }));
    vi.stubGlobal("fetch", f);
    const r = await runConnectionTest(live({ base_url: "https://8.8.8.8/data" }, {}, "odata"));
    expect(r).toMatchObject({ ok: true, message: "Connected. The service offers 2 entity sets." });
    expect(urlOf(calls(f)[0])).toBe("https://8.8.8.8/data/$metadata");
  });

  it("an OData address that returns a website, nothing, or JSON is not mistaken for a service", async () => {
    const odata = live({ base_url: "https://8.8.8.8/data" }, {}, "odata");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html><body>Welcome</body></html>", { status: 200, headers: { "content-type": "text/html" } })));
    expect(await runConnectionTest(odata)).toMatchObject({ ok: false, message: expect.stringMatching(/web page/) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    expect(await runConnectionTest(odata)).toMatchObject({ ok: false, message: expect.stringMatching(/nothing in it/) });
    vi.stubGlobal("fetch", vi.fn(async () => json({ hello: "world" })));
    expect(await runConnectionTest(odata)).toMatchObject({ ok: false, message: expect.stringMatching(/not with an OData description/) });
  });
});

describe("the address guard: a private address or a redirect never gets a request", () => {
  it.each([
    "https://10.0.0.5/api", "https://192.168.1.10/api", "https://169.254.169.254/latest", "https://127.0.0.1/api", "https://localhost/api",
    "https://[::1]/api", "https://[::ffff:127.0.0.1]/api", "https://box.internal/api", "https://erp.local/api",
  ])("%s is refused before anything is sent, for the test and for a call", async (base) => {
    const f = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", f);
    const t = await runConnectionTest(live({ base_url: base, auth: "bearer" }, { token: SECRET }));
    expect(t).toMatchObject({ ok: false, message: expect.stringMatching(/private or internal network/) });
    const c = await callConnection(live({ base_url: base, auth: "bearer" }, { token: SECRET }), { path: "/x" });
    expect(c.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(JSON.stringify([t, c])).not.toContain(SECRET);
  });

  it("a token address on a private network is refused too", async () => {
    const f = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", f);
    const t = await runConnectionTest(live({ auth: "oauth2_cc", oauth_provider: "custom", token_url: "https://10.0.0.9/token", client_id: "c" }, { client_secret: SECRET }));
    expect(t).toMatchObject({ ok: false, message: expect.stringMatching(/private or internal network/) });
    expect(f).not.toHaveBeenCalled();
  });

  it("plain http is refused", async () => {
    const f = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", f);
    const r = await runConnectionTest(live({ base_url: "http://8.8.8.8/api" }));
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("a redirect is refused, never followed, and the credentials are not sent on", async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://8.8.4.4/stolen" } }));
    vi.stubGlobal("fetch", f);
    const r = await runConnectionTest(live({ auth: "bearer" }, { token: SECRET }));
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/sends visitors somewhere else/) });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
});
