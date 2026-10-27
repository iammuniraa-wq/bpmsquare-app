import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";
import { messyWorkbook } from "@/lib/tender/boq/testing/workbooks";

// GCC tender deals, redesign 2026-10-27: what the Bill of quantities table and its row panel need from the server. The quantity and the
// description of one row (PATCH boq/lines/[boqId]), a manual rate that keeps the source it replaced, and the workspace's default
// markup in the state. Run against the real routes and an in-memory database.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  tenantId: "t1",
  features: {} as Record<string, boolean>,
  view: true,
  edit: true,
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "u1", email: "me@t1.test" },
}));

const T1 = "t1";
const T2 = "t2";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth, storage: state.db.storage }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: state.tenantId, userId: state.user.id, role: "member", supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({ resolvePermissions: async () => ({}), canViewWorkcenter: () => state.view, canEditWorkcenter: () => state.edit }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-10-26", tenantTimezone: async () => "Asia/Riyadh" }));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: () => [], diffLineItems: () => [],
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));

import { NextRequest } from "next/server";
import { GET as boqGet, POST as boqPost } from "./[id]/boq/route";
import { POST as pricePost } from "./[id]/boq/price/route";
import { PATCH as linePatch } from "./[id]/boq/lines/[boqId]/route";

const url = () => new URL("http://internal.invalid/x");
const ctx = (id = OPP) => ({ params: Promise.resolve({ id }) });
const lctx = (boqId: string, id = OPP) => ({ params: Promise.resolve({ id, boqId }) });
const json = (method: "POST" | "PATCH", body: unknown) => new NextRequest(url(), { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = () => new NextRequest(url(), { method: "GET" });
const upload = (buf: Buffer) => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(buf)], "ARB BOQ.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return new NextRequest(url(), { method: "POST", body: form });
};

const boqRows = () => state.db.rows("tender_boq_lines").filter((l) => l.opportunity_id === OPP);
const boqByItem = (item: string) => boqRows().find((b) => b.item_no === item)!;
const lineOf = (item: string) => state.db.rows("opportunity_lines").find((l) => l.id === boqByItem(item).line_id)!;
const patch = (item: string, body: unknown, id = OPP) => linePatch(json("PATCH", body), lctx(String(boqByItem(item).id), id));
const price = (item: string, body: Record<string, unknown>) => pricePost(json("POST", { line: boqByItem(item).id, ...body }), ctx());

beforeEach(async () => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, config: {} }, { id: T2, config: {} }],
    opportunities: [
      { id: OPP, tenant_id: T1, ref: "OPP-2", title: "Pipes for Plant 4", account_id: "acc", stage: "estimating", outcome: "open", owner_id: "u1", team: [], amount: 0, probability: 25 },
      { id: OPP_T2, tenant_id: T2, ref: "OPP-3", title: "Other tenant tender", account_id: "acc", stage: "estimating", outcome: "open", owner_id: "x", team: [], amount: 0 },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { opportunity_id: OPP_T2, tenant_id: T2, tender_no: "T2-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
    ],
  });
  state.tenantId = T1;
  state.features = { pipeline: true, gcc_tender: true };
  state.view = true; state.edit = true; state.changes = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await boqPost(upload(await messyWorkbook()), ctx())).status).toBe(200);
});

describe("the quantity and the description of a row", () => {
  it("changes the deal line, works the amount out again on the new quantity, and leaves what the client's file said alone", async () => {
    await price("A.1", { source: "manual", rate: 20 });
    expect((await patch("A.1", { qty: 100 })).status).toBe(200);
    expect(Number(lineOf("A.1").qty)).toBe(100);
    expect(Number(lineOf("A.1").rate)).toBe(20);
    expect(Number(lineOf("A.1").amount)).toBe(2000);
    expect(Number(boqByItem("A.1").file_qty)).toBe(1200);
    expect(boqByItem("A.1").file_description).toBe("Excavation in ordinary soil");

    const res = await patch("A.1", { description: "Excavation (our wording)" });
    expect(res.status).toBe(200);
    expect(lineOf("A.1").description).toBe("Excavation (our wording)");
    expect(boqByItem("A.1").file_description).toBe("Excavation in ordinary soil");
    expect(boqByItem("A.1").item_no).toBe("A.1");
  });

  it("the deal amount follows, and the change is logged with the item number", async () => {
    await price("A.1", { source: "manual", rate: 20 });
    state.changes = [];
    await patch("A.1", { qty: 10, description: "Excavation, rock" });
    const fields = state.changes.flatMap((c) => c.changes ?? []).map((c) => [c.field, c.from, c.to]);
    expect(fields).toContainEqual(["BOQ quantity A.1", 1200, 10]);
    expect(fields).toContainEqual(["BOQ description A.1", "Excavation in ordinary soil", "Excavation, rock"]);
    expect(Number(state.db.rows("opportunities").find((o) => o.id === OPP)!.amount)).toBeGreaterThan(0);
  });

  it("an unchanged value writes and logs nothing", async () => {
    state.changes = [];
    expect((await patch("A.1", { qty: 1200, description: "Excavation in ordinary soil" })).status).toBe(200);
    expect(state.changes).toEqual([]);
  });

  it("refuses a negative or non-numeric quantity and an empty or oversized description, and changes nothing", async () => {
    const before = JSON.stringify(state.db.rows("opportunity_lines"));
    for (const body of [{ qty: -1 }, { qty: "abc" }, { qty: null }, { qty: 1e12 }, { description: "   " }, { description: 5 }, { description: "x".repeat(1001) }]) {
      expect((await patch("A.1", body)).status, JSON.stringify(body).slice(0, 40)).toBe(422);
    }
    expect((await linePatch(new NextRequest(url(), { method: "PATCH", headers: { "content-type": "application/json" }, body: "not json" }), lctx(String(boqByItem("A.1").id)))).status).toBe(400);
    expect(JSON.stringify(state.db.rows("opportunity_lines"))).toBe(before);
  });

  it("a quantity of zero is allowed (an item the client leaves out)", async () => {
    expect((await patch("A.2", { qty: 0 })).status).toBe(200);
    expect(Number(lineOf("A.2").qty)).toBe(0);
  });

  it("is a write: a view-only user gets 403, the flag off or a bad id gets 404, and another workspace cannot reach the row", async () => {
    const id = String(boqByItem("A.1").id);
    state.edit = false;
    expect((await linePatch(json("PATCH", { qty: 5 }), lctx(id))).status).toBe(403);
    state.edit = true;
    expect((await linePatch(json("PATCH", { qty: 5 }), lctx("not-a-uuid"))).status).toBe(404);
    expect((await linePatch(json("PATCH", { qty: 5 }), lctx("dddddddd-dddd-4ddd-8ddd-dddddddddddd"))).status).toBe(404);
    state.tenantId = T2;
    expect((await linePatch(json("PATCH", { qty: 5 }), lctx(id))).status).toBe(404);
    expect((await linePatch(json("PATCH", { qty: 5 }), lctx(id, OPP_T2))).status).toBe(404);
    state.tenantId = T1; state.features = { pipeline: true };
    expect((await linePatch(json("PATCH", { qty: 5 }), lctx(id))).status).toBe(404);
    expect(Number(lineOf("A.1").qty)).toBe(1200);
  });
});

describe("a manual rate keeps the source it replaced", () => {
  const sourceOf = (item: string) => ({ source: boqByItem(item).price_source, ref: boqByItem(item).price_source_ref });

  it("over a supplier's price: the row is Manual and remembers 'was Supplier · RFQ-0012 · Gulf Pipes'", async () => {
    Object.assign(boqByItem("B.1"), { price_source: "supplier", price_source_ref: "RFQ-0012 · Gulf Pipes", price_as_of: "2026-10-01", unit_cost: 100, markup_pct: 15 });
    state.changes = [];
    expect((await price("B.1", { source: "manual", rate: 130 })).status).toBe(200);
    expect(sourceOf("B.1")).toEqual({ source: "manual", ref: "was Supplier · RFQ-0012 · Gulf Pipes" });
    const shown = await (await boqGet(get(), ctx())).json();
    expect(shown.lines.find((l: { item_no: string }) => l.item_no === "B.1")).toMatchObject({ price_source: "manual", price_source_ref: "was Supplier · RFQ-0012 · Gulf Pipes", rate: 130 });
    // The change log names both the old and the new source.
    expect(state.changes.flatMap((c) => c.changes ?? [])).toContainEqual({ field: "BOQ rate source", from: "supplier", to: "manual" });
  });

  it("a second manual edit does not lose the first source", async () => {
    Object.assign(boqByItem("B.1"), { price_source: "estimate", price_source_ref: "EST-0016" });
    await price("B.1", { source: "manual", rate: 130 });
    await price("B.1", { source: "manual", rate: 140 });
    expect(sourceOf("B.1")).toEqual({ source: "manual", ref: "was Tender estimate · EST-0016" });
    expect(Number(lineOf("B.1").rate)).toBe(140);
  });

  it("over a row that had no price, nothing is recorded", async () => {
    await price("B.2", { source: "manual", rate: 900 });
    expect(sourceOf("B.2")).toEqual({ source: "manual", ref: null });
  });

  it("the file's own rate replaced by a manual one is remembered as the client's rate", async () => {
    // A.2 came with 18.5 in the client's file.
    expect(boqByItem("A.2").price_source).toBe("boq_rate");
    await price("A.2", { source: "manual", rate: 25 });
    expect(sourceOf("A.2").ref).toMatch(/^was Client's rate/);
  });
});

describe("the state the table reads", () => {
  it("carries the workspace's default markup: 15 unless the workspace set another", async () => {
    expect((await (await boqGet(get(), ctx())).json()).default_markup_pct).toBe(15);
    state.db.rows("tenants").find((t) => t.id === T1)!.config = { tender: { default_markup_pct: 22.5 } };
    expect((await (await boqGet(get(), ctx())).json()).default_markup_pct).toBe(22.5);
  });

  it("price all uses the markup it is sent on cost sources, and the rows keep the cost and markup apart", async () => {
    const res = await pricePost(json("POST", { all: true, markup_pct: 15 }), ctx());
    expect(res.status).toBe(200);
    const shown = await (await boqGet(get(), ctx())).json();
    for (const l of shown.lines as { unit_cost: number | null; markup_pct: number | null; rate: number }[]) {
      if (l.unit_cost != null) expect(l.rate).toBeCloseTo(l.unit_cost * (1 + (l.markup_pct ?? 0) / 100), 2);
    }
  });
});
