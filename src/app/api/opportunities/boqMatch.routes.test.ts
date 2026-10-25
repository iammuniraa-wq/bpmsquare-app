import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";
import { messyWorkbook } from "@/lib/tender/boq/testing/workbooks";

// GCC tender deals: "Match to products" on the BOQ Prices tab. BOQ lines are created as free text; these routes list the lines with
// no catalog product, rank up to three products for each, and link the one a person (or an unambiguous strong match) picks.
// Run against the real routes and an in-memory database.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  tenantId: "t1",
  features: {} as Record<string, boolean>,
  user: { id: "u1", email: "me@t1.test" },
  canEdit: true,
}));

const T1 = "t1";
const T2 = "t2";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_STD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OPP_OTHER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const P_GATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const P_GATE50 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const P_PIPE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const P_OLD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04";
const P_FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth, storage: state.db.storage }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: state.tenantId, userId: state.user.id, role: "member", supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({ resolvePermissions: async () => ({}), canViewWorkcenter: () => true, canEditWorkcenter: () => state.canEdit }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-10-26", tenantTimezone: async () => "Asia/Riyadh" }));
vi.mock("@/lib/changeLog", () => ({ diffForLog: () => [], diffLineItems: () => [], logChange: async () => {} }));

import { NextRequest } from "next/server";
import { GET as matchGet, POST as matchPost } from "./[id]/boq/match/route";
import { GET as boqGet, POST as boqPost } from "./[id]/boq/route";
import { POST as pricePost } from "./[id]/boq/price/route";
import { PUT as linesPut } from "./[id]/lines/route";
import { linesVersion } from "@/lib/sales/dealLines";

const url = () => new URL("http://internal.invalid/x");
const ctx = (id = OPP) => ({ params: Promise.resolve({ id }) });
const get = (q = "") => new NextRequest(new URL(`http://internal.invalid/x${q}`), { method: "GET" });
const json = (method: "POST" | "PUT", body: unknown) => new NextRequest(url(), { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const upload = (buf: Buffer) => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(buf)], "client boq.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return new NextRequest(url(), { method: "POST", body: form });
};

const dealLines = (opp = OPP) => state.db.rows("opportunity_lines").filter((l) => l.opportunity_id === opp);
const lineOf = (desc: string) => dealLines().find((l) => l.description === desc)!;
const boqRowOf = (item: string) => state.db.rows("tender_boq_lines").find((b) => b.opportunity_id === OPP && b.item_no === item)!;
const snapshot = () => JSON.stringify([dealLines(), state.db.rows("tender_boq_lines")]);

async function loadMatch() {
  const res = await matchGet(get(), ctx());
  expect(res.status).toBe(200);
  return res.json() as Promise<{ enabled: boolean; lines_version: string; strong: number; rows: { boq_id: string; item_no: string; description: string; suggestions: { product_id: string; name: string; sku: string | null; uom: string | null; score: number; band: string }[] }[] }>;
}

beforeEach(async () => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, config: {} }, { id: T2, config: {} }],
    opportunities: [
      { id: OPP_STD, tenant_id: T1, ref: "OPP-1", title: "Standard deal", account_id: "acc", stage: "qualify", outcome: "open", owner_id: "u1", team: [], amount: 0 },
      { id: OPP, tenant_id: T1, ref: "OPP-2", title: "Valves for Plant 4", account_id: "acc", stage: "estimating", outcome: "open", owner_id: "u1", team: [], amount: 0, probability: 25 },
      { id: OPP_OTHER, tenant_id: T2, ref: "OPP-9", title: "Someone else's tender", account_id: "acc2", stage: "estimating", outcome: "open", owner_id: "u9", team: [], amount: 0 },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { opportunity_id: OPP_OTHER, tenant_id: T2, tender_no: "ZZ-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
    ],
    opportunity_lines: [
      { id: "std-1", tenant_id: T1, opportunity_id: OPP_STD, sl_no: "1", description: "Gate valve 100mm DN100", uom: "Nos", qty: 1, rate: 100, discount_pct: 0, amount: 100, product_id: null },
    ],
    products: [
      { id: P_GATE, tenant_id: T1, name: "Gate valve 100mm DN100", sku: "GV-100", uom: "Nos", cost_price: 412, list_price: 600, status: "active" },
      { id: P_GATE50, tenant_id: T1, name: "Gate valve 50mm DN50", sku: "GV-050", uom: "Nos", cost_price: 190, list_price: 280, status: "active" },
      { id: P_PIPE, tenant_id: T1, name: "HDPE pipe PN10 110mm", sku: "HD-110", uom: "Mtr", cost_price: 31, list_price: 45, status: "active" },
      { id: P_OLD, tenant_id: T1, name: "Gate valve 100mm DN100 old model", sku: "GV-OLD", uom: "Nos", cost_price: 300, status: "inactive" },
      { id: P_FOREIGN, tenant_id: T2, name: "Gate valve 100mm DN100", sku: "GV-100", uom: "Nos", cost_price: 1, status: "active" },
    ],
  });
  state.tenantId = T1;
  state.features = { pipeline: true, gcc_tender: true, products: true };
  state.canEdit = true;
  vi.spyOn(console, "error").mockImplementation(() => {});

  const file = await messyWorkbook({
    rows: [
      ["1.1", "Supply and install gate valve 100mm DN100", "no", 4, "cc1"],
      ["1.2", "Gate valve 50mm DN50", "no", 2, "GV-050"],
      ["1.3", "HDPE pipe 110mm, laid in trench", "m", 120, "cc3"],
      ["1.4", "Mobilisation", "lot", 1, "cc4"],
    ],
  });
  expect((await boqPost(upload(file), ctx())).status).toBe(200);
});

describe("listing the lines that have no product", () => {
  it("lists every BOQ line without a product with up to three ranked suggestions, newest information only: name, SKU and unit", async () => {
    const m = await loadMatch();
    expect(m.enabled).toBe(true);
    expect(m.rows.map((r) => r.item_no)).toEqual(["1.1", "1.2", "1.3", "1.4"]);
    const first = m.rows[0].suggestions;
    expect(first[0].product_id).toBe(P_GATE);
    expect(first[0].band).toBe("strong");
    expect(first.length).toBeLessThanOrEqual(3);
    // The cost code that is a SKU wins outright.
    expect(m.rows[1].suggestions[0]).toMatchObject({ product_id: P_GATE50, score: 100 });
    // Nothing close for "Mobilisation".
    expect(m.rows[3].suggestions).toEqual([]);
    expect(m.strong).toBe(2);
  });

  it("never carries a cost or list price, and never offers an inactive product or another workspace's", async () => {
    const res = await matchGet(get(), ctx());
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/cost_price|list_price|"cost"|412|300/);
    expect(text).not.toContain(P_OLD);
    expect(text).not.toContain(P_FOREIGN);
    for (const s of (await loadMatch()).rows.flatMap((r) => r.suggestions)) expect(Object.keys(s).sort()).toEqual(["band", "name", "product_id", "reason", "score", "sku", "uom"]);
  });

  it("the BOQ state counts the lines without a product, and the count falls as lines are linked", async () => {
    const before = await (await boqGet(get(), ctx())).json();
    expect(before.totals.no_product).toBe(4);
    expect(typeof before.lines_version).toBe("string");
    const m = await loadMatch();
    expect((await matchPost(json("POST", { base_version: m.lines_version, links: [{ line: m.rows[0].boq_id, product_id: P_GATE }] }), ctx())).status).toBe(200);
    expect((await (await boqGet(get(), ctx())).json()).totals.no_product).toBe(3);
  });

  it("a workspace without the Products module is told so and gets nothing, and cannot link", async () => {
    state.features.products = false;
    const m = await (await matchGet(get(), ctx())).json();
    expect(m).toMatchObject({ enabled: false, rows: [] });
    const before = snapshot();
    const res = await matchPost(json("POST", { base_version: "x", links: [] }), ctx());
    expect(res.status).toBe(404);
    expect(snapshot()).toBe(before);
  });
});

describe("linking a line to a product", () => {
  it("sets product_id on the deal line only: the client's wording, unit, quantity and BOQ link stay as they were", async () => {
    const m = await loadMatch();
    const line = lineOf("Supply and install gate valve 100mm DN100");
    const was = { ...line };
    const row = boqRowOf("1.1");
    const res = await matchPost(json("POST", { base_version: m.lines_version, links: [{ line: m.rows[0].boq_id, product_id: P_GATE }] }), ctx());
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ ok: true, linked: 1, skipped: 0 });
    expect(out.lines_version).toBe(linesVersion(dealLines() as never));
    const now = lineOf("Supply and install gate valve 100mm DN100");
    expect(now.id).toBe(was.id);
    expect(now.product_id).toBe(P_GATE);
    expect({ ...now, product_id: null }).toEqual({ ...was, product_id: null });
    expect(boqRowOf("1.1").line_id).toBe(was.id);
    expect(boqRowOf("1.1").file_description).toBe(row.file_description);
    // The other lines are untouched, and the linked line is no longer listed.
    expect(dealLines().filter((l) => l.product_id).length).toBe(1);
    expect((await loadMatch()).rows.map((r) => r.item_no)).toEqual(["1.2", "1.3", "1.4"]);
  });

  it("a product that is not this workspace's is a 404 and nothing is written, even next to a valid link", async () => {
    const m = await loadMatch();
    const before = snapshot();
    const res = await matchPost(json("POST", { base_version: m.lines_version, links: [{ line: m.rows[0].boq_id, product_id: P_GATE }, { line: m.rows[1].boq_id, product_id: P_FOREIGN }] }), ctx());
    expect(res.status).toBe(404);
    expect(snapshot()).toBe(before);
    // Nor an id that exists nowhere, nor one that is not an id.
    for (const bad of ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaff", "not-an-id"]) {
      expect((await matchPost(json("POST", { base_version: m.lines_version, links: [{ line: m.rows[0].boq_id, product_id: bad }] }), ctx())).status).toBe(404);
    }
    expect(snapshot()).toBe(before);
  });

  it("a BOQ line of another deal or workspace is a 404", async () => {
    const m = await loadMatch();
    state.db.rows("tender_boq_lines").push({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", tenant_id: T2, opportunity_id: OPP_OTHER, line_id: null, row_no: 1, item_no: "9", item_key: "9", file_description: "x", removed_in_revision: false });
    const before = snapshot();
    const res = await matchPost(json("POST", { base_version: m.lines_version, links: [{ line: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", product_id: P_GATE }] }), ctx());
    expect(res.status).toBe(404);
    expect(snapshot()).toBe(before);
  });

  it("is refused with 409 when the lines changed since the list was loaded, and changes nothing", async () => {
    const m = await loadMatch();
    // The BOQ tab prices a line while the match list is open.
    expect((await pricePost(json("POST", { line: m.rows[2].boq_id, source: "manual", rate: 40 }), ctx())).status).toBe(200);
    const before = snapshot();
    const res = await matchPost(json("POST", { base_version: m.lines_version, links: [{ line: m.rows[0].boq_id, product_id: P_GATE }] }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("lines_changed");
    expect(snapshot()).toBe(before);
    // With the fresh version the same request goes through.
    const fresh = await loadMatch();
    expect((await matchPost(json("POST", { base_version: fresh.lines_version, links: [{ line: m.rows[0].boq_id, product_id: P_GATE }] }), ctx())).status).toBe(200);
  });

  it("needs the version it was decided from", async () => {
    const m = await loadMatch();
    const before = snapshot();
    const res = await matchPost(json("POST", { links: [{ line: m.rows[0].boq_id, product_id: P_GATE }] }), ctx());
    expect(res.status).toBe(422);
    expect(snapshot()).toBe(before);
  });

  it("a line that already has a product is left alone and counted as skipped", async () => {
    const m = await loadMatch();
    await matchPost(json("POST", { base_version: m.lines_version, links: [{ line: m.rows[0].boq_id, product_id: P_GATE }] }), ctx());
    const m2 = await loadMatch();
    const res = await matchPost(json("POST", { base_version: m2.lines_version, links: [{ line: m.rows[0].boq_id, product_id: P_PIPE }] }), ctx());
    expect(await res.json()).toMatchObject({ ok: true, linked: 0, skipped: 1 });
    expect(lineOf("Supply and install gate valve 100mm DN100").product_id).toBe(P_GATE);
  });

  it("a person with view access only cannot link", async () => {
    const m = await loadMatch();
    state.canEdit = false;
    const before = snapshot();
    expect((await matchPost(json("POST", { base_version: m.lines_version, links: [{ line: m.rows[0].boq_id, product_id: P_GATE }] }), ctx())).status).toBe(403);
    expect(snapshot()).toBe(before);
    expect((await matchGet(get(), ctx())).status).toBe(200);
  });

  it("the Lines editor's copy goes stale when a product is linked, so its save cannot erase the link", async () => {
    const opened = dealLines().map((l) => ({ ...l }));
    const version = linesVersion(opened as never);
    const m = await loadMatch();
    await matchPost(json("POST", { base_version: m.lines_version, links: [{ line: m.rows[0].boq_id, product_id: P_GATE }] }), ctx());
    const editorBody = { base_version: version, lines: opened.map((l) => ({ local_id: l.id, description: l.description, uom: l.uom, qty: String(l.qty), rate: String(l.rate), discount_pct: "0" })) };
    const res = await linesPut(json("PUT", editorBody), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("lines_changed");
    expect(lineOf("Supply and install gate valve 100mm DN100").product_id).toBe(P_GATE);
  });
});

describe("accepting the strong matches", () => {
  it("links only strong, unambiguous matches; a possible match and a line with nothing close stay free text", async () => {
    const m = await loadMatch();
    const res = await matchPost(json("POST", { base_version: m.lines_version, accept_strong: true }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ linked: 2 });
    expect(lineOf("Supply and install gate valve 100mm DN100").product_id).toBe(P_GATE);
    expect(lineOf("Gate valve 50mm DN50").product_id).toBe(P_GATE50);
    // "HDPE pipe 110mm, laid in trench" is only a possible match to the pipe: not linked in bulk.
    expect(m.rows[2].suggestions[0]).toMatchObject({ product_id: P_PIPE, band: "possible" });
    expect(lineOf("HDPE pipe 110mm, laid in trench").product_id ?? null).toBeNull();
    expect(lineOf("Mobilisation").product_id ?? null).toBeNull();
  });

  it("never links a tie, and the request cannot name the products: the server picks them", async () => {
    state.db.rows("products").push({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09", tenant_id: T1, name: "Gate valve 100mm DN100", sku: null, uom: "Nos", status: "active" });
    const m = await loadMatch();
    const gate = m.rows[0];
    expect(gate.suggestions[0].score).toBe(gate.suggestions[1].score);
    const res = await matchPost(json("POST", { base_version: m.lines_version, accept_strong: true, links: [{ line: gate.boq_id, product_id: P_FOREIGN }] }), ctx());
    expect(res.status).toBe(200);
    expect(lineOf("Supply and install gate valve 100mm DN100").product_id ?? null).toBeNull();
    expect(lineOf("Gate valve 50mm DN50").product_id).toBe(P_GATE50);
  });
});

describe("searching for another product", () => {
  it("finds this workspace's active products by name or SKU and returns name, SKU and unit only", async () => {
    const res = await matchGet(get("?q=gate"), ctx());
    const { products } = await res.json();
    expect(products.map((p: { id: string }) => p.id).sort()).toEqual([P_GATE, P_GATE50].sort());
    for (const p of products) expect(Object.keys(p).sort()).toEqual(["id", "name", "sku", "uom"]);
    const bySku = (await (await matchGet(get("?q=HD-1"), ctx())).json()).products;
    expect(bySku.map((p: { id: string }) => p.id)).toEqual([P_PIPE]);
  });

  it("ignores a search that is too short, and punctuation that would break the filter", async () => {
    expect((await (await matchGet(get("?q=g"), ctx())).json()).products).toEqual([]);
    const res = await matchGet(get(`?q=${encodeURIComponent("gate,name.eq.x)(")}`), ctx());
    expect(res.status).toBe(200);
  });
});

describe("a standard deal and another workspace's deal are untouched", () => {
  it("a deal that is not a tender is a 404 on every verb, and its lines keep their products", async () => {
    const before = snapshot();
    expect((await matchGet(get(), ctx(OPP_STD))).status).toBe(404);
    expect((await matchGet(get("?q=gate"), ctx(OPP_STD))).status).toBe(404);
    expect((await matchPost(json("POST", { base_version: "x", accept_strong: true }), ctx(OPP_STD))).status).toBe(404);
    expect(snapshot()).toBe(before);
    expect(dealLines(OPP_STD)[0].product_id).toBeNull();
  });

  it("another workspace's tender is a 404, and a workspace without the tender flag sees nothing", async () => {
    expect((await matchGet(get(), ctx(OPP_OTHER))).status).toBe(404);
    state.features.gcc_tender = false;
    expect((await matchGet(get(), ctx())).status).toBe(404);
  });

  it("the standard lines editor's save of a standard deal does not care about the version, as before", async () => {
    const lines = dealLines(OPP_STD);
    const res = await linesPut(json("PUT", { base_version: "not-the-version", lines: lines.map((l) => ({ local_id: l.id, description: l.description, uom: "Nos", qty: "1", rate: "100", discount_pct: "0" })) }), ctx(OPP_STD));
    expect(res.status).toBe(200);
  });
});

describe("how the match is wired", () => {
  it("the route goes through the one BOQ gate, reads with view access and writes with edit access, and takes nothing about the workspace from the request", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("src/app/api/opportunities/[id]/boq/match/route.ts", "utf8");
    expect(route).toMatch(/openBoqRequest\(id, false\)/);
    expect(route).toMatch(/openBoqRequest\(id, true\)/);
    expect(route).not.toMatch(/requireTenantUser|createAdminSupabase|body\.(tenant_id|opportunity_id|user_id)/);
  });

  it("every query in the match server names the workspace, never selects a cost column, and does not log", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/tender/boq/matchServer.ts", "utf8");
    for (const m of src.matchAll(/\.from\("([a-z_]+)"\)[^;]*?;\n/g)) expect(m[0], m[0].slice(0, 90)).toMatch(/tenant_id|tenantId/);
    expect(src).toMatch(/fetchAllRows<ProductRow>\(r\.admin, "products", "id, name, sku, uom, status", r\.tenantId\)/);
    expect(src.replace(/\/\/[^\n]*/g, "")).not.toMatch(/cost_price|list_price|unit_cost|console\.log/);
    // The only column written on a deal line is product_id.
    expect(src).toMatch(/\.update\(\{ product_id: t\.productId \}\)\.eq\("id", .*\)\.eq\("tenant_id", tenantId\)\.eq\("opportunity_id", opp\.id\)/);
  });
});
