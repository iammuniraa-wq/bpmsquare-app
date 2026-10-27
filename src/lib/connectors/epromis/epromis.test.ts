import { describe, it, expect, vi } from "vitest";

// Sealing is replaced by a visible stand-in so a test can tell "stored sealed" from "stored in the clear".
vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string | null) => (v ? `enc:${v}` : v),
  decrypt: (v: string | null) => (v && v.startsWith("enc:") ? v.slice(4) : v),
  sealSecret: (v: string | null | undefined) => (v ? (v.startsWith("enc:") ? v : `enc:${v}`) : undefined),
  unsealSecret: (v: string | null | undefined) => (v ? (v.startsWith("enc:") ? v.slice(4) : v) : undefined),
}));

import { fakeAdmin } from "@/lib/middleware/testHarness";
import { applyTemplate, getPath, parsePath, placeholdersOf, setPath } from "./jsonPath";
import { cleanEndpointMap, configuredOperations } from "./endpointMap";
import { redactSecrets, vendorMessage } from "./redact";
import { createProject, getProject, pullMasters, sendBudget, testConnection } from "./operations";
import { FAKE_BASE, FAKE_ENDPOINTS, createFakeEpromis, fakeConfig, type FakeAuth } from "./fakeEpromis";
import { EPROMIS_OPERATIONS, MASTER_KINDS, type BudgetPayload, type EpromisConfig, type ProjectPayload } from "./types";
import {
  disconnectEpromis, epromisAdapter, loadEpromis, normalizeBaseUrl, publicState, saveEpromisConnection, testEpromis, EpromisSaveError,
  pullEpromisMasters, createEpromisProject,
} from "./server";

const KEY: FakeAuth = { type: "api_key", header: "X-Api-Key", secret: "sk-live-9f8e7d6c5b4a" };
const BEARER: FakeAuth = { type: "bearer", secret: "tok_abcdef0123456789" };
const BASIC: FakeAuth = { type: "basic", username: "kamco.api", secret: "P@ssw0rd-very-secret" };
const noSleep = async () => {};
const T = "t-1";

const conn = (auth: FakeAuth, over: Partial<EpromisConfig> = {}) => ({ cfg: fakeConfig(auth, over), creds: { secret: auth.secret } });
const bareCfg = (auth: FakeAuth): EpromisConfig => fakeConfig(auth, { endpoints: {} });

const project: ProjectPayload = { code: "PRJ-77", name: "Warehouse precast", client_name: "KAMCO", contract_value: 1250000.5, source_ref: "OPP-0042" };
const budget: BudgetPayload = {
  project_code: "PRJ-77", revision_no: 0, mode: "create", justification_code: "VAR", currency: "SAR", total: 1000,
  lines: [
    { line_no: 1, resource_code: "11", cost_code: "0010", amount: 600, qty: 12, unit: "m3" },
    { line_no: 2, resource_code: "31", cost_code: "0010", amount: 400 },
  ],
};

describe("json paths", () => {
  it("reads dotted names and indexes, with or without a leading $", () => {
    const v = { data: { items: [{ code: "A" }, { code: "B" }] } };
    expect(getPath(v, "data.items[1].code")).toBe("B");
    expect(getPath(v, "$.data.items[0].code")).toBe("A");
    expect(getPath(v, "$")).toBe(v);
    expect(getPath(v, "data.nope.x")).toBeUndefined();
    expect(getPath(v, "data.items[9].code")).toBeUndefined();
  });
  it("never reads an inherited property and refuses prototype segments", () => {
    expect(getPath({}, "constructor")).toBeUndefined();
    expect(parsePath("__proto__.x")).toBeNull();
    expect(parsePath("a.constructor")).toBeNull();
    expect(parsePath("a..b")).toBeNull();
    expect(parsePath("a b")).toBeNull();
    expect(setPath({}, "__proto__.polluted", 1)).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("sets nested objects and arrays", () => {
    const o: Record<string, unknown> = {};
    setPath(o, "a.b.c", 1);
    setPath(o, "list[1].x", "y");
    expect(o).toEqual({ a: { b: { c: 1 } }, list: [undefined, { x: "y" }] });
  });
  it("templates keep a lone placeholder's type and leave out a missing value", () => {
    expect(applyTemplate("{total}", { total: 12.5 })).toBe(12.5);
    expect(applyTemplate("BPM-{ref}", { ref: "X1" })).toBe("BPM-X1");
    expect(applyTemplate("{total}", { total: null })).toBeUndefined();
    expect(applyTemplate("BPM-{ref}", {})).toBeUndefined();
    expect(applyTemplate("fixed", {})).toBe("fixed");
    expect(placeholdersOf("{a}-{b_2}")).toEqual(["a", "b_2"]);
  });
});

describe("endpoint map validation", () => {
  it("keeps a valid map and drops empty entries", () => {
    const { map, problem } = cleanEndpointMap({ ping: { path: "/ping" }, list_tenders: { path: "", fields: { code: "" } }, ...FAKE_ENDPOINTS });
    expect(problem).toBeNull();
    expect(Object.keys(map).sort()).toEqual([...EPROMIS_OPERATIONS].sort());
    expect(configuredOperations({})).toEqual([]);
    expect(cleanEndpointMap({ ping: { path: "" } }).map).toEqual({});
    expect(cleanEndpointMap(undefined)).toEqual({ map: {}, problem: null });
  });
  it.each([
    ["an absolute address", { ping: { path: "https://evil.example/x" } }],
    ["a protocol-relative address", { ping: { path: "//evil.example/x" } }],
    ["a path without a leading slash", { ping: { path: "ping" } }],
    ["a parent segment", { ping: { path: "/a/../b" } }],
    ["a backslash", { ping: { path: "/a\\b" } }],
    ["an unknown operation", { drop_tables: { path: "/x" } }],
    ["an unknown setting", { ping: { path: "/x", headers: { a: "b" } } }],
    ["an unknown path placeholder", { get_project: { path: "/p/{secret}" } }],
    ["a placeholder the operation does not have", { create_project: { path: "/p/{project_id}" } }],
    ["a bad JSON path", { list_tenders: { path: "/t", rows_path: "a..b" } }],
    ["a prototype path", { list_tenders: { path: "/t", fields: { code: "__proto__.x" } } }],
    ["an unknown field", { list_tenders: { path: "/t", fields: { colour: "c" } } }],
    ["a bad method", { create_project: { path: "/p", method: "DELETE" } }],
    ["a body on a read", { list_tenders: { path: "/t", body: { a: "{x}" } } }],
    ["a body placeholder from another operation", { create_project: { path: "/p", body: { a: "{total}" } } }],
    ["a map that is not an object", [1, 2]],
  ])("refuses %s", (_label, raw) => {
    const r = cleanEndpointMap(raw);
    expect(r.problem).toBeTruthy();
    expect(r.map).toEqual({});
  });
});

describe("every operation answers 'Not configured' when its address is not set", () => {
  it("never calls out and never throws", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    const c = { cfg: bareCfg(KEY), creds: { secret: KEY.secret } };
    const deps = { fetch: fake.fetch, sleep: noSleep };
    for (const kind of MASTER_KINDS) {
      const r = await pullMasters(c, kind, deps);
      expect(r).toMatchObject({ ok: false, state: "not_configured" });
      expect(!r.ok && r.message).toMatch(/Not configured/);
    }
    expect(await getProject(c, "P1", deps)).toMatchObject({ ok: false, state: "not_configured" });
    expect(await createProject(c, project, deps)).toMatchObject({ ok: false, state: "not_configured" });
    expect(await sendBudget(c, budget, deps)).toMatchObject({ ok: false, state: "not_configured" });
    expect(await sendBudget(c, { ...budget, mode: "replace" }, deps)).toMatchObject({ ok: false, state: "not_configured" });
    expect(fake.calls).toHaveLength(0);
  });

  it("says what is missing when an address is set but the code field is not mapped", async () => {
    const c = { cfg: fakeConfig(KEY, { endpoints: { list_resources: { path: "/resources", rows_path: "data.items" } } }), creds: { secret: KEY.secret } };
    const r = await pullMasters(c, "resources", { fetch: createFakeEpromis({ auth: KEY }).fetch });
    expect(r).toMatchObject({ ok: false, state: "not_configured" });
    expect(!r.ok && r.message).toMatch(/code/);
  });

  it("a create with an address but no body is not sent", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    const c = { cfg: fakeConfig(KEY, { endpoints: { create_project: { path: "/projects" } } }), creds: { secret: KEY.secret } };
    expect(await createProject(c, project, { fetch: fake.fetch })).toMatchObject({ ok: false, state: "not_configured" });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("test connection", () => {
  it("calls the ping path when one is set", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    const r = await testConnection(conn(KEY), { fetch: fake.fetch });
    expect(r).toMatchObject({ ok: true, verified: true });
    expect(r.line).toMatch(/test address \(200\)/);
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /ping"]);
  });

  it("without a ping path makes an authenticated HEAD of the base address", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    const r = await testConnection({ cfg: bareCfg(KEY), creds: { secret: KEY.secret } }, { fetch: fake.fetch });
    expect(r).toMatchObject({ ok: true, verified: true });
    expect(r.line).toMatch(/base address \(200\)/);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ method: "HEAD", url: FAKE_BASE });
    expect(fake.calls[0].headers["x-api-key"]).toBe(KEY.secret);
  });

  it("a front page that answers 404 is reached but not verified", async () => {
    const fake = createFakeEpromis({ auth: KEY, rootStatus: 404 });
    const r = await testConnection({ cfg: bareCfg(KEY), creds: { secret: KEY.secret } }, { fetch: fake.fetch });
    expect(r).toMatchObject({ ok: true, verified: false });
    expect(r.line).toMatch(/Reached ePROMIS/);
    expect(r.line).not.toMatch(/^Connected/);
  });

  it("says in plain words when the credential is refused", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    const r = await testConnection({ cfg: fakeConfig(KEY), creds: { secret: "wrong-wrong-wrong" } }, { fetch: fake.fetch });
    expect(r.ok).toBe(false);
    expect(r.line).toMatch(/refused the sign-in \(401\)/);
    expect(r.failures[0].fix).toContain("401");
    expect(JSON.stringify(r)).not.toContain("wrong-wrong-wrong");
  });

  it("reports an unreachable host without a stack or a secret", async () => {
    const r = await testConnection(conn(KEY), { fetch: async () => { throw new TypeError(`getaddrinfo ENOTFOUND ${KEY.secret}`); }, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(r.line).toMatch(/Could not reach api\.fake-epromis\.example/);
    expect(JSON.stringify(r)).not.toContain(KEY.secret);
  });
});

describe("sign-in types", () => {
  it.each([KEY, BEARER, BASIC])("$type: the right header goes out and only the right credential works", async (auth) => {
    const fake = createFakeEpromis({ auth });
    const ok = await pullMasters(conn(auth), "justifications", { fetch: fake.fetch });
    expect(ok).toMatchObject({ ok: true });
    const h = fake.calls[0].headers;
    if (auth.type === "api_key") expect(h["x-api-key"]).toBe(auth.secret);
    if (auth.type === "bearer") expect(h.authorization).toBe(`Bearer ${auth.secret}`);
    if (auth.type === "basic") expect(h.authorization).toBe(`Basic ${Buffer.from(`${auth.username}:${auth.secret}`).toString("base64")}`);
    if (auth.type !== "api_key") expect(h["x-api-key"]).toBeUndefined();

    const bad = await pullMasters({ cfg: fakeConfig(auth), creds: { secret: "not-the-credential" } }, "justifications", { fetch: fake.fetch });
    expect(bad).toMatchObject({ ok: false, state: "error", status: 401 });
  });

  it("a missing credential or header name is a message, not a request", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    expect(await pullMasters({ cfg: fakeConfig(KEY), creds: {} }, "tenders", { fetch: fake.fetch })).toMatchObject({ ok: false, message: expect.stringMatching(/credential is missing/) });
    expect(await pullMasters({ cfg: fakeConfig(KEY, { key_header: "" }), creds: { secret: KEY.secret } }, "tenders", { fetch: fake.fetch })).toMatchObject({ ok: false, message: expect.stringMatching(/header name/) });
    expect(fake.calls).toHaveLength(0);
  });

  it("sends the company code as a header or as a query value, under the configured name", async () => {
    const asHeader = createFakeEpromis({ auth: KEY, company: { name: "X-Company", value: "KAMCO01", in: "header" } });
    const cfgH = fakeConfig(KEY, { company_name: "X-Company", company_value: "KAMCO01", company_in: "header" });
    expect(await pullMasters({ cfg: cfgH, creds: { secret: KEY.secret } }, "tenders", { fetch: asHeader.fetch })).toMatchObject({ ok: true });
    expect(asHeader.calls[0].headers["x-company"]).toBe("KAMCO01");

    const asQuery = createFakeEpromis({ auth: KEY, company: { name: "db", value: "KAMCO01", in: "query" }, pageSize: 1 });
    const cfgQ = fakeConfig(KEY, { company_name: "db", company_value: "KAMCO01", company_in: "query" });
    const r = await pullMasters({ cfg: cfgQ, creds: { secret: KEY.secret } }, "tenders", { fetch: asQuery.fetch });
    expect(r).toMatchObject({ ok: true, data: { pages: 2 } });
    // The next-page link is followed with the code too, or a server that requires it would refuse page 2.
    expect(asQuery.calls.map((c) => c.query.db)).toEqual(["KAMCO01", "KAMCO01"]);
    expect(asQuery.calls[0].headers["x-company"]).toBeUndefined();

    const missing = await pullMasters({ cfg: fakeConfig(KEY), creds: { secret: KEY.secret } }, "tenders", { fetch: createFakeEpromis({ auth: KEY, company: { name: "db", value: "KAMCO01", in: "query" } }).fetch });
    expect(missing).toMatchObject({ ok: false, status: 401 });
  });
});

describe("reference lists", () => {
  it("reads the Resource Master as {code, name, parent_code, flags}", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    const r = await pullMasters(conn(KEY), "resources", { fetch: fake.fetch });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows).toHaveLength(5);
    expect(r.data.rows[2]).toEqual({
      code: "110510", name: "Slotted Channel Framing", parent_code: "1105", flags: { link_to_inventory: true, budget_validation: true },
    });
    expect(r.data.rows[0].parent_code).toBeNull();
    expect(r.data).toMatchObject({ skipped: 0, pages: 1, truncated: false });
  });

  it("follows the next-page link until it ends", async () => {
    const fake = createFakeEpromis({ auth: KEY, pageSize: 2 });
    const r = await pullMasters(conn(KEY), "resources", { fetch: fake.fetch });
    expect(r).toMatchObject({ ok: true, data: { pages: 3 } });
    expect(r.ok && r.data.rows.map((x) => x.code)).toEqual(["11", "1105", "110510", "31", "41"]);
    expect(fake.calls.map((c) => c.query.page)).toEqual([undefined, "2", "3"]);
  });

  it("reads cost codes, tenders and justifications through their own addresses", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    const cc = await pullMasters(conn(KEY), "cost_codes", { fetch: fake.fetch });
    expect(cc.ok && cc.data.rows.map((x) => `${x.code}<${x.parent_code}`)).toEqual(["00<null", "0010<00", "0041<00"]);
    expect((await pullMasters(conn(KEY), "tenders", { fetch: fake.fetch })).ok).toBe(true);
    const j = await pullMasters(conn(KEY), "justifications", { fetch: fake.fetch });
    expect(j.ok && j.data.rows).toEqual([{ code: "VAR", name: "Client variation", parent_code: null, flags: {} }, { code: "SCOPE", name: "Scope change", parent_code: null, flags: {} }]);
  });

  it("skips a row with no code and says how many", async () => {
    const f = async () => new Response(JSON.stringify({ data: { items: [{ Code: "A", Name: "a" }, { Name: "no code" }, { Code: "", Name: "blank" }, { Code: 7, Name: 7 }] } }), { status: 200 });
    const r = await pullMasters(conn(KEY), "justifications", { fetch: f });
    expect(r.ok && r.data.rows.map((x) => x.code)).toEqual(["A", "7"]);
    expect(r.ok && r.data.skipped).toBe(2);
  });

  it("an answer that is not the expected shape is an empty list, not a crash", async () => {
    for (const body of ['{"data":"nope"}', "not json", "[]", "null"]) {
      const r = await pullMasters(conn(KEY), "tenders", { fetch: async () => new Response(body, { status: 200 }) });
      expect(r).toMatchObject({ ok: true, data: { rows: [] } });
    }
  });

  it("stops at the page cap and the row cap and says the list was cut", async () => {
    const fake = createFakeEpromis({ auth: KEY, pageSize: 1 });
    const pages = await pullMasters(conn(KEY), "resources", { fetch: fake.fetch, maxPages: 2 });
    expect(pages).toMatchObject({ ok: true, data: { pages: 2, truncated: true } });
    const rows = await pullMasters(conn(KEY), "resources", { fetch: createFakeEpromis({ auth: KEY, pageSize: 2 }).fetch, maxRows: 3 });
    expect(rows.ok && rows.data.rows).toHaveLength(3);
    expect(rows.ok && rows.data.truncated).toBe(true);
  });

  it("does not follow a next-page link to another host, and does not loop on the same link", async () => {
    const seen: string[] = [];
    const evil = async (u: string) => { seen.push(u); return new Response(JSON.stringify({ data: { items: [{ Code: "A", Name: "a" }], next: "https://evil.example/steal" } }), { status: 200 }); };
    const r = await pullMasters(conn(KEY), "tenders", { fetch: evil });
    expect(r).toMatchObject({ ok: false, state: "error", message: expect.stringMatching(/another address/) });
    expect(seen).toEqual([`${FAKE_BASE}/tenders`]);

    let n = 0;
    const loop = async () => { n++; return new Response(JSON.stringify({ data: { items: [{ Code: `A${n}` }], next: "/v1/tenders?page=2" } }), { status: 200 }); };
    const l = await pullMasters(conn(KEY), "tenders", { fetch: loop });
    expect(l.ok).toBe(true);
    expect(n).toBeLessThanOrEqual(3);
  });
});

describe("projects and budgets", () => {
  it("reads a project, and a missing one is null rather than an error", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    expect(await getProject(conn(KEY), "NOPE", { fetch: fake.fetch })).toEqual({ ok: true, data: null });
    await createProject(conn(KEY), project, { fetch: fake.fetch });
    const r = await getProject(conn(KEY), "PRJ-77", { fetch: fake.fetch });
    expect(r).toEqual({ ok: true, data: { code: "PRJ-77", name: "Warehouse precast", flags: {}, id: "P101" } });
    expect(fake.calls.at(-1)?.path).toBe("/projects/PRJ-77");
  });

  it("encodes a code placed in the path", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    await getProject(conn(KEY), "A/B ../C", { fetch: fake.fetch });
    expect(fake.calls[0].url).toBe(`${FAKE_BASE}/projects/A%2FB%20..%2FC`);
  });

  it("creates a project: nested paths, literal mixes, typed numbers, missing values left out, id returned", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    const r = await createProject(conn(KEY), project, { fetch: fake.fetch });
    expect(r).toEqual({ ok: true, data: { external_id: "P101" } });
    expect(fake.calls[0].body).toEqual({ ProjectCode: "PRJ-77", ProjectName: "Warehouse precast", Client: { Name: "KAMCO" }, ContractValue: 1250000.5, Ref: "BPM-OPP-0042" });
    expect(fake.calls[0].headers["content-type"]).toBe("application/json");
    const bare = await createProject(conn(KEY), { code: "PRJ-78", name: "Bare" }, { fetch: fake.fetch });
    expect(bare.ok).toBe(true);
    expect(fake.projects.get("PRJ-78")?.body).toEqual({ ProjectCode: "PRJ-78", ProjectName: "Bare" });
  });

  it("shows the vendor's refusal of a duplicate in words", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    await createProject(conn(KEY), project, { fetch: fake.fetch });
    const dup = await createProject(conn(KEY), project, { fetch: fake.fetch });
    expect(dup).toMatchObject({ ok: false, status: 409 });
    expect(!dup.ok && dup.message).toContain("Project already exists");
  });

  it("sends a budget with its lines, then replaces it", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    await createProject(conn(KEY), project, { fetch: fake.fetch });
    const first = await sendBudget(conn(KEY), budget, { fetch: fake.fetch });
    expect(first.ok && first.data.external_id).toMatch(/^B/);
    expect(fake.budgets.get("PRJ-77")).toEqual({
      ProjectCode: "PRJ-77", Rev: 0, Total: 1000, Reason: "VAR",
      Lines: [{ No: 1, Resource: "11", CostCode: "0010", Amount: 600, Qty: 12 }, { No: 2, Resource: "31", CostCode: "0010", Amount: 400 }],
    });
    const again = await sendBudget(conn(KEY), budget, { fetch: fake.fetch });
    expect(again).toMatchObject({ ok: false, status: 409 });

    const replaced = await sendBudget(conn(KEY), { ...budget, mode: "replace", revision_no: 1, total: 700, lines: [budget.lines[0]] }, { fetch: fake.fetch });
    expect(replaced.ok).toBe(true);
    expect(fake.calls.at(-1)).toMatchObject({ method: "PUT", path: "/projects/PRJ-77/budget" });
    expect(fake.budgets.get("PRJ-77")).toMatchObject({ Rev: 1, Total: 700, Lines: [{ No: 1 }] });
  });
});

describe("failures are words, never a throw", () => {
  it("a timeout says so, once, and does not repeat the call", async () => {
    const fake = createFakeEpromis({ auth: KEY, hang: true });
    const r = await pullMasters(conn(KEY), "tenders", { fetch: fake.fetch, timeoutMs: 15, sleep: noSleep });
    expect(r).toMatchObject({ ok: false, state: "error", message: "ePROMIS did not answer in time." });
    expect(fake.calls).toHaveLength(1);
  });

  it("a network error is retried once for a read and the read then succeeds", async () => {
    const fake = createFakeEpromis({ auth: KEY, networkErrorOnce: true });
    const r = await pullMasters(conn(KEY), "tenders", { fetch: fake.fetch, sleep: noSleep });
    expect(r.ok).toBe(true);
    expect(fake.calls).toHaveLength(2);
  });

  it("a network error is retried only once, then reported", async () => {
    let n = 0;
    const r = await pullMasters(conn(KEY), "tenders", { fetch: async () => { n++; throw new TypeError("fetch failed"); }, sleep: noSleep });
    expect(r).toMatchObject({ ok: false, state: "error", message: expect.stringMatching(/Could not reach/) });
    expect(n).toBe(2);
  });

  it("a write is never repeated after a network error (it may already have been made)", async () => {
    let n = 0;
    const r = await createProject(conn(KEY), project, { fetch: async () => { n++; throw new TypeError("fetch failed"); }, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(n).toBe(1);
  });

  it("a 4xx and a 5xx are not retried", async () => {
    for (const status of [401, 404, 429, 500, 503]) {
      let n = 0;
      const r = await pullMasters(conn(KEY), "tenders", { fetch: async () => { n++; return new Response("{}", { status }); }, sleep: noSleep });
      expect(r).toMatchObject({ ok: false, status });
      expect(n).toBe(1);
    }
  });

  it("a 500 whose page echoes the request does not leak the credential, in any form", async () => {
    for (const auth of [KEY, BEARER, BASIC]) {
      const fake = createFakeEpromis({ auth, fail: { status: 500, body: JSON.stringify({ message: `Server error. Authorization: Bearer ${auth.secret}; key=${auth.secret}` }) }, echoHeaders: true });
      const r = await pullMasters(conn(auth), "tenders", { fetch: fake.fetch });
      expect(r).toMatchObject({ ok: false, status: 500 });
      const text = JSON.stringify(r);
      expect(text).not.toContain(auth.secret);
      expect(text).not.toContain(Buffer.from(`${auth.type === "basic" ? auth.username : ""}:${auth.secret}`).toString("base64"));
      expect(!r.ok && r.message).toContain("ePROMIS reported an error (500)");
    }
  });

  it("an HTML error page is reported as one, not reproduced", async () => {
    const r = await pullMasters(conn(KEY), "tenders", { fetch: async () => new Response(`<html><body><script>alert(1)</script>${KEY.secret}</body></html>`, { status: 502 }) });
    expect(!r.ok && r.message).toContain("an HTML page");
    expect(JSON.stringify(r)).not.toContain("alert(1)");
    expect(JSON.stringify(r)).not.toContain(KEY.secret);
  });

  it("a 3xx from a fetch that did not follow is reported, never followed", async () => {
    const fake = createFakeEpromis({ auth: KEY, redirectTo: "https://evil.example/x" });
    const r = await pullMasters(conn(KEY), "tenders", { fetch: fake.fetch });
    expect(r).toMatchObject({ ok: false, status: 302 });
    expect(fake.calls).toHaveLength(1);
  });

  it("an answer over the size cap is refused with a message", async () => {
    const r = await pullMasters(conn(KEY), "tenders", { fetch: createFakeEpromis({ auth: KEY, hugeBody: true }).fetch });
    expect(r).toMatchObject({ ok: false, state: "error", message: expect.stringMatching(/more data than one request/) });
  });
});

describe("redaction", () => {
  it("removes the secrets, bearer and basic tokens, and key=value credentials", () => {
    const out = redactSecrets(`sent Bearer abcdef123456 and Basic dXNlcjpwdw== and api_key=zzzz9999 "password": "hunter2hunter2" plus ${"S3CR3T-value"}`, ["S3CR3T-value"]);
    expect(out).not.toMatch(/abcdef123456|dXNlcjpwdw|zzzz9999|hunter2|S3CR3T/);
  });
  it("removes a base64 form and a user:secret form of the secret", () => {
    const b64 = Buffer.from("bob:pw-pw-pw-pw").toString("base64");
    expect(redactSecrets(`got ${b64} and bob:pw-pw-pw-pw`, ["bob:pw-pw-pw-pw"])).not.toMatch(/pw-pw|Ym9iO/);
  });
  it("takes the message out of a JSON error and truncates", () => {
    expect(vendorMessage('{"error":{"message":"Cost code 99 is not valid"}}', [])).toBe("Cost code 99 is not valid");
    expect(vendorMessage('{"title":"Bad"}', [])).toBe("Bad");
    expect(vendorMessage("plain text", [])).toBe("plain text");
    expect(vendorMessage("x".repeat(1000), [])?.length).toBe(240);
    expect(vendorMessage("", [])).toBeNull();
  });
});

// ── Stored connection ──────────────────────────────────────────────────────

const seed = (over: Record<string, unknown> = {}) => ({
  tenant_connectors: [{
    tenant_id: T, connector_id: "epromis", status: "connected", last_error: null,
    config: { ...fakeConfig(KEY), ...over }, credentials: { secret: `enc:${KEY.secret}` },
  }],
});

const save = (admin: ReturnType<typeof fakeAdmin>, config: Record<string, unknown>, secrets: Record<string, unknown> = { secret: "k-123456" }) =>
  saveEpromisConnection(admin.client, T, "u-1", { config: { base_url: "https://8.8.8.8/api", auth_type: "api_key", key_header: "X-Api-Key", ...config }, secrets });

describe("saving the connection", () => {
  it("seals the credential, never returns it, and marks the connection untested", async () => {
    const admin = fakeAdmin({ tenant_connectors: [] });
    const state = await save(admin, { company_value: "C1", company_name: "X-Company" });
    expect(JSON.stringify(state)).not.toContain("k-123456");
    expect(state).toMatchObject({ secret_stored: true, status: "error", last_error: expect.stringMatching(/Not tested/), config: { base_url: "https://8.8.8.8/api", auth_type: "api_key", key_header: "X-Api-Key", company_value: "C1" } });
    const row = admin.tables.tenant_connectors.find((r) => r.tenant_id === T) as Record<string, unknown>;
    expect((row.credentials as Record<string, string>).secret).toBe("enc:k-123456");
    expect(JSON.stringify(row.config)).not.toContain("k-123456");
    expect(row.tenant_id).toBe(T);
  });

  it("a blank credential keeps the stored one while the address and sign-in stay", async () => {
    const admin = fakeAdmin(seed({ base_url: "https://8.8.8.8/api" }));
    const state = await save(admin, { company_value: "" }, {});
    expect(state.secret_stored).toBe(true);
    expect((await loadEpromis(admin.client, T))?.creds.secret).toBe(KEY.secret);
  });

  it("repointing the address, or changing the sign-in type, needs the credential again", async () => {
    const admin = fakeAdmin(seed({ base_url: "https://8.8.8.8/api" }));
    await expect(save(admin, { base_url: "https://1.1.1.1/api" }, {})).rejects.toThrow(/Enter the credential again/);
    await expect(save(admin, { base_url: "https://8.8.8.8/api", auth_type: "bearer" }, {})).rejects.toThrow(/Enter the credential again/);
    const ok = await save(admin, { base_url: "https://1.1.1.1/api" }, { secret: "new-secret-1" });
    expect(ok.config?.base_url).toBe("https://1.1.1.1/api");
    expect((await loadEpromis(admin.client, T))?.creds.secret).toBe("new-secret-1");
  });

  it("a save without a credential and without a stored one is refused", async () => {
    await expect(save(fakeAdmin({ tenant_connectors: [] }), {}, {})).rejects.toThrow(/Enter the credential/);
  });

  it("refuses http, private and internal addresses, a path-bearing user, and a bad header name", async () => {
    const a = () => fakeAdmin({ tenant_connectors: [] });
    await expect(save(a(), { base_url: "http://8.8.8.8" })).rejects.toThrow(/https/);
    for (const h of ["10.0.0.5", "127.0.0.1", "localhost", "169.254.169.254", "[::1]", "box.internal"]) {
      await expect(save(a(), { base_url: `https://${h}/api` })).rejects.toThrow(/private or internal network/);
    }
    await expect(save(a(), { base_url: "https://me:pw@8.8.8.8" })).rejects.toThrow(/user name/);
    await expect(save(a(), { base_url: "https://8.8.8.8/api?x=1" })).rejects.toThrow(/query/);
    await expect(save(a(), { key_header: "Host" })).rejects.toThrow(/header name/);
    await expect(save(a(), { key_header: "X Key" })).rejects.toThrow(/header name/);
    await expect(save(a(), { key_header: "" })).rejects.toThrow(/header that carries/);
    await expect(save(a(), { auth_type: "basic", username: "" })).rejects.toThrow(/user name/);
    await expect(save(a(), { auth_type: "magic" })).rejects.toThrow(/sign/);
    await expect(save(a(), { company_value: "C1", company_name: "" })).rejects.toThrow(/company code/);
    await expect(save(a(), { company_value: "C1", company_name: "bad name", company_in: "query" })).rejects.toThrow(/query parameter name/);
    await expect(save(a(), {}, { secret: "line\r\nbreak" })).rejects.toThrow(/line breaks/);
  });

  it("cleans the endpoint map and refuses a bad one with the reason", async () => {
    const admin = fakeAdmin({ tenant_connectors: [] });
    await expect(save(admin, { endpoints: { ping: { path: "https://evil.example" } } })).rejects.toBeInstanceOf(EpromisSaveError);
    const ok = await save(admin, { endpoints: FAKE_ENDPOINTS });
    expect(Object.keys(ok.config?.endpoints ?? {})).toHaveLength(EPROMIS_OPERATIONS.length);
    const kept = await saveEpromisConnection(admin.client, T, "u-1", { config: { base_url: "https://8.8.8.8/api", auth_type: "api_key", key_header: "X-Api-Key" } });
    expect(Object.keys(kept.config?.endpoints ?? {})).toHaveLength(EPROMIS_OPERATIONS.length);
  });

  it("normalises the base url", () => {
    expect(normalizeBaseUrl("Erp.Example.com/api/")).toBe("https://erp.example.com/api");
    expect(normalizeBaseUrl("https://erp.example.com:8443/")).toBe("https://erp.example.com:8443");
    expect(() => normalizeBaseUrl("")).toThrow();
  });

  it("public state carries whether a credential is stored, never the credential", async () => {
    const admin = fakeAdmin(seed());
    const s = publicState(await loadEpromis(admin.client, T));
    expect(s.secret_stored).toBe(true);
    expect(JSON.stringify(s)).not.toContain(KEY.secret);
    expect(JSON.stringify(s)).not.toContain("enc:");
    expect(publicState(null)).toEqual({ config: null, secret_stored: false, status: "not_connected", last_error: null });
  });

  it("reads a damaged stored config as not connected, and a bad stored map as empty", async () => {
    expect(await loadEpromis(fakeAdmin({ tenant_connectors: [{ tenant_id: T, connector_id: "epromis", status: "connected", config: { nope: 1 }, credentials: {} }] }).client, T)).toBeNull();
    const r = await loadEpromis(fakeAdmin(seed({ endpoints: { ping: { path: "https://evil.example" } } })).client, T);
    expect(r?.cfg.endpoints).toEqual({});
  });

  it("disconnect removes this tenant's row and no other", async () => {
    const admin = fakeAdmin({ tenant_connectors: [...seed().tenant_connectors, { tenant_id: "t-2", connector_id: "epromis", status: "connected", config: fakeConfig(KEY), credentials: { secret: "enc:x" } }] });
    await disconnectEpromis(admin.client, T);
    expect(await loadEpromis(admin.client, T)).toBeNull();
    expect(await loadEpromis(admin.client, "t-2")).not.toBeNull();
  });
});

describe("testing and using the stored connection", () => {
  it("test updates the status either way", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    const admin = fakeAdmin(seed());
    const ok = await testEpromis(admin.client, T, { fetch: fake.fetch });
    expect(ok).toMatchObject({ ok: true, status: 200 });
    const bad = fakeAdmin({ tenant_connectors: [{ ...seed().tenant_connectors[0], credentials: { secret: "enc:wrong-wrong-1" }, status: "connected" }] });
    const fail = await testEpromis(bad.client, T, { fetch: fake.fetch });
    expect(fail).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/401/) });
    expect(bad.tables.tenant_connectors.find((r) => r.tenant_id === T)?.status).toBe("error");
    expect(JSON.stringify(fail)).not.toContain("wrong-wrong-1");
    expect(await testEpromis(fakeAdmin({ tenant_connectors: [] }).client, T)).toMatchObject({ ok: false, status: 400 });
  });

  it("the server helpers say 'not connected' when there is no connection", async () => {
    const admin = fakeAdmin({ tenant_connectors: [] });
    expect(await pullEpromisMasters(admin.client, T, "resources")).toMatchObject({ ok: false, state: "not_connected" });
    expect(await createEpromisProject(admin.client, T, project)).toMatchObject({ ok: false, state: "not_connected" });
  });

  it("another tenant's connection is never used", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    const admin = fakeAdmin(seed());
    expect(await pullEpromisMasters(admin.client, "t-other", "resources", { fetch: fake.fetch })).toMatchObject({ state: "not_connected" });
    expect(fake.calls).toHaveLength(0);
    expect(await pullEpromisMasters(admin.client, T, "resources", { fetch: fake.fetch })).toMatchObject({ ok: true });
  });
});

describe("the adapter", () => {
  it("describes ePROMIS to the middleware frame", async () => {
    const a = epromisAdapter(fakeAdmin(seed()).client);
    expect(a).toMatchObject({ id: "epromis", label: "ePROMIS", authModes: ["api_key", "bearer", "basic"], capabilities: { pull: [...MASTER_KINDS], pushQuote: false, pushProject: true, pushOrder: false } });
    expect(a.readableKey("resources", { code: " 1105 " })).toBe("1105");
    expect(a.readableKey("resources", {})).toBeNull();
    expect(Object.keys(a.presets)).toEqual([...MASTER_KINDS]);
    const pulled = await a.pull(T, "resources", { trigger: "manual", userId: null });
    expect(pulled.error).toMatch(/contract-project/);
  });

  it("previews and lists fields from the vendor's first rows, and says Not configured otherwise", async () => {
    const fake = createFakeEpromis({ auth: KEY });
    const a = epromisAdapter(fakeAdmin(seed()).client, { fetch: fake.fetch });
    const p = await a.preview(T, "resources");
    expect("rows" in p && p.rows).toHaveLength(5);
    const m = await a.metadata(T, "resources");
    expect("fields" in m && m.fields.map((f) => f.name)).toEqual(expect.arrayContaining(["Code", "Name", "Parent"]));
    const bare = epromisAdapter(fakeAdmin(seed({ endpoints: {} })).client, { fetch: fake.fetch });
    expect(await bare.preview(T, "resources")).toMatchObject({ status: 422, error: expect.stringMatching(/Not configured/) });
    expect(await bare.preview(T, "nonsense")).toMatchObject({ status: 422 });
    expect(await a.testConnection(T)).toMatchObject({ ok: true });
  });
});
