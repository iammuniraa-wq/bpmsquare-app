import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { buildClientAssertion, validDirectory, tokenUrl } from "./jwt";
import { mapPullRow, fingerprint, renderPushTemplate, buildPushBody, odataString, modifiedSinceFilter, buildTargetRecord } from "./mapping";
import { D365Client, D365Error } from "./odata";
import { entityConfig, apiBase, allowedHost, resourceFor } from "./catalog";

describe("certificate client assertion", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const der = Buffer.from("not-really-a-cert");
  const jwt = buildClientAssertion({ clientId: "app-1", tokenUrl: tokenUrl("contoso.com"), certDer: der, privateKeyPem: keyPem, nowSec: 1_800_000_000, jti: "j1" });
  const [h, p, s] = jwt.split(".");

  it("carries both thumbprints and the right claims", () => {
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(header).toMatchObject({ alg: "RS256", typ: "JWT" });
    expect(header.x5t).toBe(crypto.createHash("sha1").update(der).digest("base64url"));
    expect(header["x5t#S256"]).toBe(crypto.createHash("sha256").update(der).digest("base64url"));
    expect(payload).toMatchObject({ aud: "https://login.microsoftonline.com/contoso.com/oauth2/v2.0/token", iss: "app-1", sub: "app-1", jti: "j1", exp: 1_800_000_600 });
  });

  it("is signed with the private key", () => {
    const ok = crypto.verify("sha256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"));
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
    expect(r).toEqual({ externalId: "A1", externalKey: "C-9", accountExternalId: null, values: { name: "Contoso", email: "info@contoso.com", phone: null } });
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
    expect(modifiedSinceFilter("modifiedon", "2026-10-01T00:00:00Z", "statecode eq 0")).toBe("(statecode eq 0) and modifiedon gt 2026-10-01T00:00:00Z");
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
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: r.headers });
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
