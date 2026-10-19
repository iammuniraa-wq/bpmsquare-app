import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { buildClientAssertion, validDirectory, tokenUrl, checkCertificatePair } from "./jwt";
import { mapPullRow, fingerprint, renderPushTemplate, buildPushBody, odataString, modifiedSinceFilter, buildTargetRecord } from "./mapping";
import { D365Client, D365Error, retryDelayMs, idFromEntityIdHeader } from "./odata";
import { entityConfig, apiBase, allowedHost, resourceFor, sovereignHost, D365_DEFAULTS } from "./catalog";

describe("certificate client assertion", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const der = Buffer.from("not-really-a-cert");
  const jwt = buildClientAssertion({ clientId: "app-1", tokenUrl: tokenUrl("contoso.com"), certDer: der, privateKeyPem: keyPem, nowSec: 1_800_000_000, jti: "j1" });
  const [h, p, s] = jwt.split(".");

  it("carries both thumbprints and the right claims", () => {
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(header).toMatchObject({ alg: "PS256", typ: "JWT" });
    expect(header.x5t).toBe(crypto.createHash("sha1").update(der).digest("base64url"));
    expect(header["x5t#S256"]).toBe(crypto.createHash("sha256").update(der).digest("base64url"));
    expect(payload).toMatchObject({ aud: "https://login.microsoftonline.com/contoso.com/oauth2/v2.0/token", iss: "app-1", sub: "app-1", jti: "j1", nbf: 1_799_999_970, exp: 1_800_000_300 });
  });

  it("is signed with the private key", () => {
    const ok = crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });

  it("only accepts a GUID or a domain as the directory", () => {
    expect(validDirectory("72f988bf-86f1-41af-91ab-2d7cd011db47")).toBe(true);
    expect(validDirectory("contoso.onmicrosoft.com")).toBe(true);
    for (const bad of ["", "contoso", "../common", "a/b.com", undefined]) expect(validDirectory(bad as string | undefined)).toBe(false);
  });
});

describe("mapping", () => {
  const cfg = { enabled: true, entity_set: "accounts", id_field: "accountid", key_field: "accountnumber", field_map: { name: "name", email: "emailaddress1", phone: "telephone1", status: "statecode" } };
  it("maps only the fields the target accepts and cleans them", () => {
    const r = mapPullRow("customers", cfg, { accountid: "A1", accountnumber: "C-9", name: "  Contoso  ", emailaddress1: "Info@Contoso.COM", telephone1: "", statecode: 0 });
    expect(r).toEqual({ externalId: "A1", rawId: "A1", area: null, externalKey: "C-9", accountExternalId: null, values: { name: "Contoso", email: "info@contoso.com", phone: null } });
  });
  it("drops an invalid email and falls back to the key for a missing name", () => {
    const r = mapPullRow("customers", cfg, { accountid: "A2", accountnumber: "C-10", name: null, emailaddress1: "not-an-email" });
    expect(r).toMatchObject({ values: { name: "C-10", email: null } });
  });
  it("refuses a row with no id", () => {
    expect(mapPullRow("customers", cfg, { name: "x" })).toEqual({ error: "no accountid" });
  });
  it("reads the account link for contacts and numbers for products", () => {
    const c = mapPullRow("contacts", { enabled: true, entity_set: "contacts", id_field: "contactid", field_map: { name: "fullname", account_external_id: "_parentcustomerid_value" } }, { contactid: "K1", fullname: "Ann", _parentcustomerid_value: "A1" });
    expect(c).toMatchObject({ accountExternalId: "A1" });
    const p = mapPullRow("products", { enabled: true, entity_set: "items", id_field: "id", field_map: { name: "displayName", list_price: "unitPrice" } }, { id: "I1", displayName: "Bolt", unitPrice: "1,234.567" });
    expect(p).toMatchObject({ values: { list_price: 1234.57 } });
  });
  it("fingerprints by content, not key order", () => {
    expect(fingerprint({ a: 1, b: "x" })).toBe(fingerprint({ b: "x", a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});

describe("push templates", () => {
  it("drops a field whose placeholder is empty", () => {
    expect(renderPushTemplate("{name}", { name: "Perimeter" })).toBe("Perimeter");
    expect(renderPushTemplate("/accounts({account_external_id})", { account_external_id: null })).toBeNull();
    expect(buildPushBody({ msdyn_subject: "{name}", "msdyn_customer_account@odata.bind": "/accounts({account_external_id})", "bad field": "{name}" }, { name: "Site A" }))
      .toEqual({ msdyn_subject: "Site A" });
  });
});

describe("odata helpers", () => {
  it("escapes string literals and builds incremental filters", () => {
    expect(odataString("O'Brien")).toBe("'O''Brien'");
    expect(modifiedSinceFilter("modifiedon", "2026-10-01T00:00:00Z", "statecode eq 0")).toBe("(statecode eq 0) and modifiedon ge 2026-10-01T00:00:00Z");
    expect(modifiedSinceFilter("modifiedon", "garbage")).toBeUndefined();
    expect(modifiedSinceFilter("bad field", "2026-10-01T00:00:00Z")).toBeUndefined();
  });
});

function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  };
  return { fn, calls };
}

describe("D365Client", () => {
  const auth = async () => "Bearer t";
  it("follows nextLink pages on the same host and stops at the cap", async () => {
    const f = fakeFetch([
      { status: 200, body: { value: [{ id: 1 }, { id: 2 }], "@odata.nextLink": "https://org.crm.dynamics.com/api/data/v9.2/accounts?$skiptoken=x" } },
      { status: 200, body: { value: [{ id: 3 }] } },
    ]);
    const c = new D365Client("https://org.crm.dynamics.com/api/data/v9.2", auth, { fetch: f.fn, sleep: async () => {} });
    const rows: Record<string, unknown>[] = [];
    for await (const r of c.list("accounts", { select: ["id"] })) rows.push(r);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(f.calls[0]).toContain("%24select=id");
  });
  it("refuses a nextLink to another host", async () => {
    const f = fakeFetch([{ status: 200, body: { value: [{ id: 1 }], "@odata.nextLink": "https://evil.example.com/steal" } }]);
    const c = new D365Client("https://org.crm.dynamics.com/api/data/v9.2", auth, { fetch: f.fn, sleep: async () => {} });
    const rows: Record<string, unknown>[] = [];
    await expect((async () => { for await (const r of c.list("accounts")) rows.push(r); })()).rejects.toThrow(/another host/);
    expect(rows).toHaveLength(1);
  });
  it("retries throttling and then succeeds", async () => {
    const f = fakeFetch([{ status: 429, headers: { "retry-after": "1" } }, { status: 503 }, { status: 200, body: { ok: true } }]);
    const c = new D365Client("https://org.crm.dynamics.com/api/data/v9.2", auth, { fetch: f.fn, sleep: async () => {} });
    expect(await c.get("WhoAmI")).toEqual({ ok: true });
    expect(f.calls).toHaveLength(3);
  });
  it("surfaces the OData error message", async () => {
    const f = fakeFetch([{ status: 400, body: { error: { code: "0x80040203", message: "Bad field" } } }]);
    const c = new D365Client("https://org.crm.dynamics.com/api/data/v9.2", auth, { fetch: f.fn, sleep: async () => {} });
    await expect(c.get("accounts")).rejects.toMatchObject({ message: "Bad field", status: 400 } as Partial<D365Error>);
  });
});

describe("catalog", () => {
  it("merges a tenant override over the product default, replacing the map whole", () => {
    const e = entityConfig({ product: "dataverse", entities: { customers: { enabled: true, entity_set: "accounts", id_field: "accountid", field_map: { name: "name" } } } }, "customers");
    expect(e?.field_map).toEqual({ name: "name" });
    expect(entityConfig({ product: "bc", entities: {} }, "products")?.entity_set).toBe("items");
  });
  it("builds the API base per product", () => {
    expect(apiBase({ product: "fo", environment_url: "https://contoso.operations.dynamics.com/", auth_mode: "client_secret" })).toBe("https://contoso.operations.dynamics.com/data");
    expect(apiBase({ product: "dataverse", environment_url: "https://org.crm4.dynamics.com", auth_mode: "client_secret" })).toBe("https://org.crm4.dynamics.com/api/data/v9.2");
    expect(apiBase({ product: "bc", environment_url: "Production", directory_id: "contoso.com", company: "c1", auth_mode: "client_secret" }))
      .toBe("https://api.businesscentral.dynamics.com/v2.0/contoso.com/Production/api/v2.0/companies(c1)");
    expect(resourceFor({ product: "bc", environment_url: "Production" })).toBe("https://api.businesscentral.dynamics.com");
  });
  it("holds online products to Microsoft hosts", () => {
    expect(allowedHost({ product: "dataverse", auth_mode: "client_secret" }, "org.crm4.dynamics.com")).toBe(true);
    expect(allowedHost({ product: "fo", auth_mode: "client_secret" }, "dynamics.com.evil.io")).toBe(false);
    expect(allowedHost({ product: "bc", auth_mode: "client_secret" }, "bc.contoso.com")).toBe(false);
    expect(allowedHost({ product: "bc", auth_mode: "basic" }, "bc.contoso.com")).toBe(true);
  });
});

describe("target records", () => {
  const enc = (v: string | null) => (v === null ? null : `enc:${v}`);
  it("never sets updated_at on a table without the column (suppliers, accounts, contacts)", () => {
    for (const t of ["suppliers", "accounts", "contacts"]) expect(buildTargetRecord(t, { name: "X" }, false, enc)).not.toHaveProperty("updated_at");
    expect(buildTargetRecord("products", { name: "X" }, false, enc, "2026-10-19T00:00:00Z")).toEqual({ name: "X", updated_at: "2026-10-19T00:00:00Z" });
  });
  it("encrypts PII on accounts/contacts only and never wipes on update", () => {
    expect(buildTargetRecord("accounts", { name: "A", email: "a@b.co", phone: null }, false, enc)).toEqual({ name: "A", email: "enc:a@b.co" });
    expect(buildTargetRecord("suppliers", { name: "S", email: "s@b.co" }, true, enc)).toEqual({ name: "S", email: "s@b.co", type: "vendor", status: "active" });
  });
});

describe("D365Client writes and auth", () => {
  const base = "https://org.crm.dynamics.com/api/data/v9.2";
  it("never repeats a create that may already have been applied (503/504/timeout)", async () => {
    for (const status of [503, 504]) {
      const f = fakeFetch([{ status }, { status: 201, body: { id: "dup" } }]);
      const c = new D365Client(base, async () => "Bearer t", { fetch: f.fn, sleep: async () => {} });
      await expect(c.create("msdyn_projects", { msdyn_subject: "x" })).rejects.toMatchObject({ status });
      expect(f.calls).toHaveLength(1);
    }
  });
  it("does retry a create that was throttled (429 = not processed)", async () => {
    const f = fakeFetch([{ status: 429, headers: { "retry-after": "2" } }, { status: 201, body: { id: "P1" } }]);
    const c = new D365Client(base, async () => "Bearer t", { fetch: f.fn, sleep: async () => {} });
    expect((await c.create("projects", { displayName: "x" })).row).toEqual({ id: "P1" });
  });
  it("takes the new id from OData-EntityId when Dataverse answers 204", async () => {
    const f = fakeFetch([{ status: 204, headers: { "OData-EntityId": `${base}/msdyn_projects(11111111-2222-3333-4444-555555555555)` } }]);
    const c = new D365Client(base, async () => "Bearer t", { fetch: f.fn, sleep: async () => {} });
    expect(await c.create("msdyn_projects", {})).toEqual({ row: {}, entityId: "11111111-2222-3333-4444-555555555555" });
    expect(idFromEntityIdHeader("https://x.operations.dynamics.com/data/Projects(dataAreaId='sa01',ProjectID='P-1')")).toBe("dataAreaId='sa01',ProjectID='P-1'");
    expect(idFromEntityIdHeader(null)).toBeNull();
  });
  it("on 401 drops the cached token once and retries with a fresh one", async () => {
    const f = fakeFetch([{ status: 401 }, { status: 200, body: { ok: 1 } }]);
    let token = "old";
    const c = new D365Client(base, async () => `Bearer ${token}`, { fetch: f.fn, sleep: async () => {}, onUnauthorized: async () => { token = "new"; } });
    expect(await c.get("WhoAmI")).toEqual({ ok: 1 });
    const f2 = fakeFetch([{ status: 401 }, { status: 401 }]);
    const c2 = new D365Client(base, async () => "Bearer x", { fetch: f2.fn, sleep: async () => {}, onUnauthorized: async () => {} });
    await expect(c2.get("WhoAmI")).rejects.toMatchObject({ status: 401 });
    expect(f2.calls).toHaveLength(2);
  });
  it("reads Retry-After as seconds or a date, capped", () => {
    expect(retryDelayMs("5", 0)).toBe(5000);
    expect(retryDelayMs("600", 0)).toBe(60_000);
    expect(retryDelayMs(new Date(1_000_010_000).toUTCString(), 0, 1_000_000_000)).toBe(10_000);
    expect(retryDelayMs(null, 2)).toBe(2000);
  });
  it("asks for $top when told (preview never depends on the server honouring maxpagesize)", async () => {
    const f = fakeFetch([{ status: 200, body: { value: [{ a: 1 }] } }]);
    const c = new D365Client("https://x.operations.dynamics.com/data", async () => "Bearer t", { fetch: f.fn, sleep: async () => {} });
    for await (const _ of c.list("CustomersV3", { top: 5, maxRows: 5 })) void _;
    expect(f.calls[0]).toContain("%24top=5");
  });
});

// A minimal self-signed X.509 (v1) built in the test, so no key material is
// checked into the repo.
function selfSigned(key: crypto.KeyObject, notBefore: string, notAfter: string): string {
  const len = (n: number) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
  const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
  const seq = (...p: Buffer[]) => tlv(0x30, Buffer.concat(p));
  const sigAlg = seq(Buffer.from("06092a864886f70d01010b", "hex"), Buffer.from("0500", "hex"));
  const name = seq(tlv(0x31, seq(Buffer.from("0603550403", "hex"), tlv(0x0c, Buffer.from("bpmsquare-test")))));
  const time = (t: string) => tlv(0x18, Buffer.from(t));
  const spki = crypto.createPublicKey(key).export({ type: "spki", format: "der" }) as Buffer;
  const tbs = seq(tlv(0x02, Buffer.from([1])), sigAlg, name, seq(time(notBefore), time(notAfter)), name, spki);
  const sig = crypto.sign("sha256", tbs, key);
  const der = seq(tbs, sigAlg, tlv(0x03, Buffer.concat([Buffer.from([0]), sig])));
  return `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
}

describe("certificate upload checks", () => {
  const a = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const b = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const keyA = a.export({ type: "pkcs8", format: "pem" }).toString();
  const keyB = b.export({ type: "pkcs8", format: "pem" }).toString();
  const cert = selfSigned(a, "20200101000000Z", "20991231000000Z");
  it("accepts a matching, in-date pair", () => {
    expect(checkCertificatePair(cert, keyA)).toBeNull();
    expect(checkCertificatePair(cert, undefined)).toBeNull();
  });
  it("refuses a key from another certificate, an expired one, garbage and an encrypted key", () => {
    expect(checkCertificatePair(cert, keyB)).toMatch(/doesn't belong/);
    expect(checkCertificatePair(selfSigned(a, "20200101000000Z", "20210101000000Z"), keyA)).toMatch(/expired/);
    expect(checkCertificatePair("nope", undefined)).toMatch(/valid PEM certificate/);
    expect(checkCertificatePair(undefined, "-----BEGIN ENCRYPTED PRIVATE KEY-----\nx\n-----END ENCRYPTED PRIVATE KEY-----")).toMatch(/password-protected/);
    const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(checkCertificatePair(undefined, ec)).toMatch(/RSA/);
  });
});

describe("catalog safety defaults", () => {
  it("never pushes into a customer's ERP without an explicit opt-in", () => {
    for (const p of ["fo", "dataverse", "bc"] as const) expect(D365_DEFAULTS[p].fence_projects?.enabled).toBe(false);
  });
  it("keeps online products on the commercial cloud and names sovereign hosts", () => {
    expect(allowedHost({ product: "fo", auth_mode: "client_secret" }, "pcbs-uat.sandbox.operations.dynamics.com")).toBe(true);
    for (const h of ["org.crm.dynamics.cn", "org.crm.microsoftdynamics.us", "org.crm.appsplatform.us"]) {
      expect(allowedHost({ product: "dataverse", auth_mode: "client_secret" }, h)).toBe(false);
      expect(sovereignHost(h)).toBe(true);
    }
    expect(sovereignHost("org.crm4.dynamics.com")).toBe(false);
  });
});
