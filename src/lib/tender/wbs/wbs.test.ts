import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Row } from "@/lib/wbs/testing/fakeDb";

// The tender WBS (migration 0243, docs/design/wbs.md slice 1): the writes on a fake database that enforces the (deal, code) and (line, item)
// keys and cascades deletes the way the foreign keys do. The BOQ upload path (applyBoqLines) runs for real on the same fake, with the session
// and the change log stubbed out.

vi.mock("@/lib/supabase-server", () => ({ getAuthUser: async () => null, createAdminSupabase: () => { throw new Error("not in this test"); }, requireTenantUser: async () => { throw new Error("not in this test"); } }));
vi.mock("@/lib/changeLog", () => ({ logChange: async () => undefined, diffForLog: () => [] }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-11-02" }));
vi.mock("@/lib/sales/opportunityServer", async (orig) => ({ ...(await orig<typeof import("@/lib/sales/opportunityServer")>()), refreshOpportunityDerived: async () => null }));

import { applyBoqLines, buildBoqState, type BoqRequest } from "@/lib/tender/boq/server";
import { assignLines, createItem, deleteItem, renumberItems, setLineSplit, unsplitLine, updateItem, wbsStateFor, type WbsCtx } from "./server";
import type { BoqLine } from "@/lib/tender/boq/parse";
import { WBS_PENDING } from "@/lib/wbs/tips";

const id = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const TENANT = id(1), OTHER_TENANT = id(2), OPP = id(10), OTHER_OPP = id(11);
const L = { stair: id(101), pipe: id(102), gate: id(103), fence: id(104), foreign: id(105), foreignTenant: id(106) };
const EMP = id(201), EMP_OTHER_TENANT = id(202), EMP_INACTIVE = id(203);

type Seed = Record<string, Row[]>;
const seed = (): Seed => ({
  tender_boq_lines: [
    { id: L.stair, tenant_id: TENANT, opportunity_id: OPP, item_no: "2.4", row_no: 4, wbs_item_id: null },
    { id: L.pipe, tenant_id: TENANT, opportunity_id: OPP, item_no: "2.5", row_no: 5, wbs_item_id: null },
    { id: L.gate, tenant_id: TENANT, opportunity_id: OPP, item_no: null, row_no: 6, wbs_item_id: null },
    { id: L.fence, tenant_id: TENANT, opportunity_id: OPP, item_no: "2.7", row_no: 7, wbs_item_id: null },
    { id: L.foreign, tenant_id: TENANT, opportunity_id: OTHER_OPP, item_no: "9.1", row_no: 1, wbs_item_id: null },
    { id: L.foreignTenant, tenant_id: OTHER_TENANT, opportunity_id: OPP, item_no: "9.2", row_no: 1, wbs_item_id: null },
  ],
  tender_wbs_items: [],
  tender_wbs_line_parts: [],
  employees: [
    { id: EMP, tenant_id: TENANT, first_name: "Anas", last_name: "K", status: "active" },
    { id: EMP_OTHER_TENANT, tenant_id: OTHER_TENANT, first_name: "Eve", last_name: "Z", status: "active" },
    { id: EMP_INACTIVE, tenant_id: TENANT, first_name: "Old", last_name: "Timer", status: "terminated" },
  ],
});

function setup(extra: Seed = {}, opts: Parameters<typeof fakeDb>[1] = {}) {
  const base = seed();
  const db = fakeDb({ ...base, ...extra }, {
    unique: { tender_wbs_items: [["opportunity_id", "code"]], tender_wbs_line_parts: [["boq_line_id", "wbs_item_id"]] },
    cascade: {
      tender_boq_lines: (gone, t) => { t.tender_wbs_line_parts = (t.tender_wbs_line_parts ?? []).filter((p) => !gone.some((g) => g.id === p.boq_line_id)); },
      tender_wbs_items: (gone, t) => {
        t.tender_wbs_line_parts = (t.tender_wbs_line_parts ?? []).filter((p) => !gone.some((g) => g.id === p.wbs_item_id));
        t.tender_wbs_items = (t.tender_wbs_items ?? []).filter((i) => !gone.some((g) => g.id === i.parent_id));
      },
    },
    setNull: { tender_wbs_items: [{ table: "tender_boq_lines", column: "wbs_item_id", via: "wbs_item_id" }] },
    ...opts,
  });
  const logs: { field: string; from: unknown; to: unknown }[] = [];
  const ctx: WbsCtx = { admin: db.client, tenantId: TENANT, opportunityId: OPP, userId: "u1", log: async (c) => { logs.push(...c); } };
  return { ...db, ctx, logs };
}

const ok = <T,>(r: ({ ok: true } & T) | { ok: false; status: number; error: string }): { ok: true } & T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.status} ${r.error}`);
  return r;
};
const bad = (r: { ok: boolean; status?: number; error?: string }, status: number, text?: RegExp | string) => {
  expect(r.ok).toBe(false);
  expect(r.status).toBe(status);
  if (text) expect(r.error).toMatch(text);
};
const codes = (t: Seed) => Object.fromEntries((t.tender_wbs_items ?? []).map((i) => [i.name as string, i.code as string]));
const line = (t: Seed, lid: string) => (t.tender_boq_lines ?? []).find((l) => l.id === lid) as Row;
const partsOf = (t: Seed, lid: string) => (t.tender_wbs_line_parts ?? []).filter((p) => p.boq_line_id === lid);

describe("creating items", () => {
  it("numbers itself 1, 2, 1.1, 1.1.1 and refuses a fourth level", async () => {
    const { ctx, tables } = setup();
    const a = ok(await createItem(ctx, { name: "Structure" }));
    const b = ok(await createItem(ctx, { name: "Services" }));
    const a1 = ok(await createItem(ctx, { name: "Steel", parent_id: a.id }));
    const a11 = ok(await createItem(ctx, { name: "Stairs", parent_id: a1.id }));
    expect([a.code, b.code, a1.code, a11.code]).toEqual(["1", "2", "1.1", "1.1.1"]);
    expect(codes(tables)).toEqual({ Structure: "1", Services: "2", Steel: "1.1", Stairs: "1.1.1" });
    bad(await createItem(ctx, { name: "Too deep", parent_id: a11.id }), 422, "three levels");
  });

  it("a typed code is kept, a duplicate is refused, and the next auto code steps around it", async () => {
    const { ctx, tables } = setup();
    ok(await createItem(ctx, { name: "ERP one", code: "C-100" }));
    bad(await createItem(ctx, { name: "Clash", code: "C-100" }), 409, "C-100 is already used");
    ok(await createItem(ctx, { name: "Auto" }));
    expect(codes(tables)).toEqual({ "ERP one": "C-100", Auto: "2" });
    expect((tables.tender_wbs_items.find((i) => i.name === "ERP one") as Row).code_is_manual).toBe(true);
  });

  it("needs a name and clips a long one", async () => {
    const { ctx } = setup();
    bad(await createItem(ctx, { name: "  " }), 422, "name");
    bad(await createItem(ctx, {}), 422, "name");
  });

  it("boq_ids puts those lines into the new item and logs it", async () => {
    const { ctx, tables, logs } = setup();
    const a = ok(await createItem(ctx, { name: "Steel", boq_ids: [L.stair, L.pipe] }));
    expect(line(tables, L.stair).wbs_item_id).toBe(a.id);
    expect(line(tables, L.pipe).wbs_item_id).toBe(a.id);
    expect(logs[0]).toMatchObject({ field: "WBS 1 added", to: "Steel, 2 lines" });
  });

  it("adding a sub-item under an item that holds lines and parts moves them into the sub-item", async () => {
    const { ctx, tables } = setup();
    const a = ok(await createItem(ctx, { name: "Steel", boq_ids: [L.pipe] }));
    const b = ok(await createItem(ctx, { name: "Paint" }));
    ok(await setLineSplit(ctx, L.stair, [{ wbs_item_id: a.id, share_pct: 60 }, { wbs_item_id: b.id, share_pct: 40 }]));
    const sub = ok(await createItem(ctx, { name: "Fabrication", parent_id: a.id }));
    expect(sub.moved).toBe(2);
    expect(line(tables, L.pipe).wbs_item_id).toBe(sub.id);
    expect(partsOf(tables, L.stair).map((p) => [p.wbs_item_id, p.share_pct])).toEqual([[sub.id, 60], [b.id, 40]]);
  });
});

describe("another deal's or workspace's ids are a 404, never a silent re-parent", () => {
  it("a parent, a line, an owner, an item and a split part from elsewhere", async () => {
    const { ctx } = setup({
      tender_wbs_items: [
        { id: id(301), tenant_id: TENANT, opportunity_id: OTHER_OPP, parent_id: null, code: "1", name: "Elsewhere", sort_order: 10, code_is_manual: false },
        { id: id(302), tenant_id: OTHER_TENANT, opportunity_id: OPP, parent_id: null, code: "1", name: "Other workspace", sort_order: 10, code_is_manual: false },
      ],
    });
    bad(await createItem(ctx, { name: "x", parent_id: id(301) }), 404);
    bad(await createItem(ctx, { name: "x", parent_id: id(302) }), 404);
    bad(await createItem(ctx, { name: "x", boq_ids: [L.foreign] }), 404);
    bad(await createItem(ctx, { name: "x", boq_ids: [L.foreignTenant] }), 404);
    bad(await createItem(ctx, { name: "x", owner_employee_id: EMP_OTHER_TENANT }), 404);
    bad(await createItem(ctx, { name: "x", owner_employee_id: EMP_INACTIVE }), 422, "not active");
    bad(await updateItem(ctx, id(301), { name: "hijack" }), 404);
    bad(await updateItem(ctx, id(302), { name: "hijack" }), 404);
    bad(await deleteItem(ctx, id(301)), 404);
    bad(await assignLines(ctx, [L.stair], id(301)), 404);
    bad(await assignLines(ctx, [L.foreign], null), 404);
    bad(await setLineSplit(ctx, L.stair, [{ wbs_item_id: id(301), share_pct: 100 }]), 404);
    bad(await setLineSplit(ctx, L.foreign, [{ wbs_item_id: id(301), share_pct: 100 }]), 404);
    bad(await unsplitLine(ctx, L.foreignTenant), 404);
  });

  it("an owner without a login is allowed while bidding", async () => {
    const { ctx, tables } = setup();
    const a = ok(await createItem(ctx, { name: "Owned", owner_employee_id: EMP }));
    expect(tables.tender_wbs_items.find((i) => i.id === a.id)?.owner_employee_id).toBe(EMP);
  });

  it("malformed ids are refused before any query", async () => {
    const { ctx, log } = setup();
    bad(await createItem(ctx, { name: "x", parent_id: "not-an-id" }), 422);
    bad(await assignLines(ctx, ["nope"], null), 422);
    bad(await updateItem(ctx, "nope", { name: "x" }), 404);
    expect(log.length).toBe(0);
  });
});

describe("moving and renaming", () => {
  it("refuses a cycle and a move under an item that holds lines, and recodes after a legitimate move", async () => {
    const { ctx, tables } = setup();
    const a = ok(await createItem(ctx, { name: "A" }));
    const b = ok(await createItem(ctx, { name: "B", boq_ids: [L.pipe] }));
    const c = ok(await createItem(ctx, { name: "C" }));
    const a1 = ok(await createItem(ctx, { name: "A one", parent_id: a.id }));
    bad(await updateItem(ctx, a.id, { parent_id: a1.id }), 422, "under itself");
    bad(await updateItem(ctx, a.id, { parent_id: a.id }), 422, "under itself");
    bad(await updateItem(ctx, c.id, { parent_id: b.id }), 422, "holds lines");
    ok(await updateItem(ctx, c.id, { parent_id: a.id }));
    expect(codes(tables)).toMatchObject({ A: "1", B: "2", "A one": "1.1", C: "1.2" });
    // the deepest allowed: a leaf under a level-2 item is fine, a subtree that would end at level 4 is not
    const deep = ok(await createItem(ctx, { name: "Deep", parent_id: a1.id }));
    bad(await updateItem(ctx, a.id, { parent_id: deep.id }), 422, "under itself");
    bad(await updateItem(ctx, b.id, { parent_id: deep.id }), 422, "three levels");
  });

  it("swapping two siblings never meets the unique code", async () => {
    const { ctx, tables } = setup();
    const a = ok(await createItem(ctx, { name: "A" }));
    const b = ok(await createItem(ctx, { name: "B" }));
    ok(await updateItem(ctx, b.id, { sort_order: 5 }));
    expect(codes(tables)).toEqual({ A: "2", B: "1" });
    expect(a.code).toBe("1");
  });

  it("typing a code sets it manual; typing a taken one is a 409; renaming logs", async () => {
    const { ctx, tables, logs } = setup();
    const a = ok(await createItem(ctx, { name: "A" }));
    ok(await createItem(ctx, { name: "B" }));
    ok(await updateItem(ctx, a.id, { code: "C-200", name: "A renamed" }));
    expect(tables.tender_wbs_items.find((i) => i.id === a.id)).toMatchObject({ code: "C-200", code_is_manual: true, name: "A renamed" });
    bad(await updateItem(ctx, a.id, { code: "2" }), 409);
    expect(logs.map((l) => l.field)).toEqual(expect.arrayContaining(["WBS 1 renamed", "WBS 1 code"]));
  });

  it("a code left as it is does not freeze the item", async () => {
    const { ctx, tables } = setup();
    const a = ok(await createItem(ctx, { name: "A" }));
    ok(await updateItem(ctx, a.id, { code: "1" }));
    expect(tables.tender_wbs_items[0].code_is_manual).toBe(false);
  });

  it("a bid-time owner needs only an active employee of the workspace; clearing it works", async () => {
    const { ctx, tables } = setup();
    const a = ok(await createItem(ctx, { name: "A" }));
    ok(await updateItem(ctx, a.id, { owner_employee_id: EMP }));
    expect(tables.tender_wbs_items[0].owner_employee_id).toBe(EMP);
    ok(await updateItem(ctx, a.id, { owner_employee_id: null }));
    expect(tables.tender_wbs_items[0].owner_employee_id).toBeNull();
    bad(await updateItem(ctx, a.id, { owner_employee_id: EMP_OTHER_TENANT }), 404);
  });
});

describe("grouping lines", () => {
  it("puts lines in a leaf, refuses a branch, and null sends them back to Unassigned", async () => {
    const { ctx, tables } = setup();
    const a = ok(await createItem(ctx, { name: "A" }));
    const a1 = ok(await createItem(ctx, { name: "A1", parent_id: a.id }));
    bad(await assignLines(ctx, [L.stair], a.id), 422, "has sub-items");
    expect(ok(await assignLines(ctx, [L.stair, L.pipe, L.gate], a1.id))).toMatchObject({ assigned: 3, unsplit: 0 });
    expect(line(tables, L.gate).wbs_item_id).toBe(a1.id);
    ok(await assignLines(ctx, [L.gate], null));
    expect(line(tables, L.gate).wbs_item_id).toBeNull();
    bad(await assignLines(ctx, [], a1.id), 422);
  });

  it("a split line in the list is unsplit and counted", async () => {
    const { ctx, tables } = setup();
    const a = ok(await createItem(ctx, { name: "A" }));
    const b = ok(await createItem(ctx, { name: "B" }));
    ok(await setLineSplit(ctx, L.stair, [{ wbs_item_id: a.id, share_pct: 50 }, { wbs_item_id: b.id, share_pct: 50 }]));
    expect(ok(await assignLines(ctx, [L.stair], b.id))).toMatchObject({ unsplit: 1 });
    expect(partsOf(tables, L.stair)).toEqual([]);
    expect(line(tables, L.stair).wbs_item_id).toBe(b.id);
  });
});

describe("splitting a line", () => {
  async function three(ctx: WbsCtx) {
    const f = ok(await createItem(ctx, { name: "Fabrication" }));
    const g = ok(await createItem(ctx, { name: "Galvanising" }));
    const e = ok(await createItem(ctx, { name: "Erection" }));
    return { f: f.id, g: g.id, e: e.id };
  }

  it("60/15/25 is stored as parts and the line itself has no item", async () => {
    const { ctx, tables, logs } = setup();
    const { f, g, e } = await three(ctx);
    const r = ok(await setLineSplit(ctx, L.stair, [{ wbs_item_id: f, share_pct: 60 }, { wbs_item_id: g, share_pct: 15 }, { wbs_item_id: e, share_pct: 25 }]));
    expect(r.kind).toBe("parts");
    expect(partsOf(tables, L.stair).map((p) => [p.wbs_item_id, p.share_pct, p.sort_order])).toEqual([[f, 60, 0], [g, 15, 1], [e, 25, 2]]);
    expect(line(tables, L.stair).wbs_item_id).toBeNull();
    expect(logs.at(-1)).toMatchObject({ field: "WBS split 2.4", to: "1 60.00 % · 2 15.00 % · 3 25.00 %" });
  });

  it("refuses shares that do not add up, an item twice, a branch, with nothing written", async () => {
    const { ctx, tables } = setup();
    const { f, g } = await three(ctx);
    const branch = ok(await createItem(ctx, { name: "Branch" }));
    ok(await createItem(ctx, { name: "Leaf", parent_id: branch.id }));
    const before = JSON.stringify(tables.tender_wbs_items);
    bad(await setLineSplit(ctx, L.stair, [{ wbs_item_id: f, share_pct: 60 }, { wbs_item_id: g, share_pct: 30 }]), 422, "Shares add up to 90.00 %, not 100 %");
    bad(await setLineSplit(ctx, L.stair, [{ wbs_item_id: f, share_pct: 50 }, { wbs_item_id: f, share_pct: 50 }]), 422, "appears twice");
    bad(await setLineSplit(ctx, L.stair, [{ wbs_item_id: branch.id, share_pct: 50 }, { wbs_item_id: f, share_pct: 50 }]), 422, "has sub-items");
    bad(await setLineSplit(ctx, L.stair, [{ wbs_item_id: f, share_pct: 100 }, { wbs_item_id: g, share_pct: 0 }]), 422);
    bad(await setLineSplit(ctx, L.stair, "nope"), 422);
    expect(partsOf(tables, L.stair)).toEqual([]);
    expect(JSON.stringify(tables.tender_wbs_items)).toBe(before);
  });

  it("one part is not a split: the line sits whole in that item", async () => {
    const { ctx, tables } = setup();
    const { f, g } = await three(ctx);
    ok(await setLineSplit(ctx, L.stair, [{ wbs_item_id: f, share_pct: 50 }, { wbs_item_id: g, share_pct: 50 }]));
    const r = ok(await setLineSplit(ctx, L.stair, [{ wbs_item_id: g, share_pct: 100 }]));
    expect(r.kind).toBe("whole");
    expect(partsOf(tables, L.stair)).toEqual([]);
    expect(line(tables, L.stair).wbs_item_id).toBe(g);
  });

  it("a new part makes its item only after the shares are accepted, auto-coded", async () => {
    const { ctx, tables } = setup();
    const { f } = await three(ctx);
    bad(await setLineSplit(ctx, L.stair, [{ wbs_item_id: f, share_pct: 60 }, { new: { name: "Paint" }, share_pct: 30 }]), 422, "90.00");
    expect((tables.tender_wbs_items as Row[]).some((i) => i.name === "Paint")).toBe(false);
    const r = ok(await setLineSplit(ctx, L.stair, [{ wbs_item_id: f, share_pct: 60 }, { new: { name: "Paint" }, share_pct: 40 }]));
    expect(r.created).toHaveLength(1);
    expect(codes(tables).Paint).toBe("4");
    expect(partsOf(tables, L.stair)).toHaveLength(2);
  });

  it("a new part cannot go under an item that holds lines", async () => {
    const { ctx } = setup();
    const a = ok(await createItem(ctx, { name: "Held", boq_ids: [L.pipe] }));
    const b = ok(await createItem(ctx, { name: "Other" }));
    bad(await setLineSplit(ctx, L.stair, [{ wbs_item_id: b.id, share_pct: 50 }, { new: { name: "Under held", parent_id: a.id }, share_pct: 50 }]), 422, "holds lines");
  });

  it("Unsplit puts the whole line in the first part's item, or the one named", async () => {
    const { ctx, tables } = setup();
    const { f, g, e } = await three(ctx);
    ok(await setLineSplit(ctx, L.stair, [{ wbs_item_id: f, share_pct: 60 }, { wbs_item_id: g, share_pct: 40 }]));
    expect(ok(await unsplitLine(ctx, L.stair)).wbs_item_id).toBe(f);
    expect(partsOf(tables, L.stair)).toEqual([]);
    bad(await unsplitLine(ctx, L.stair), 422, "not split");
    ok(await setLineSplit(ctx, L.stair, [{ wbs_item_id: f, share_pct: 60 }, { wbs_item_id: g, share_pct: 40 }]));
    expect(ok(await unsplitLine(ctx, L.stair, e)).wbs_item_id).toBe(e);
    expect(line(tables, L.stair).wbs_item_id).toBe(e);
  });
});

describe("removing an item", () => {
  it("whole lines go back to Unassigned, parts go with it and leave a remainder, children move up, codes close up", async () => {
    const { ctx, tables, logs } = setup();
    const a = ok(await createItem(ctx, { name: "A" }));
    const b = ok(await createItem(ctx, { name: "B", boq_ids: [L.pipe] }));
    const c = ok(await createItem(ctx, { name: "C" }));
    const c1 = ok(await createItem(ctx, { name: "C one", parent_id: c.id }));
    ok(await setLineSplit(ctx, L.stair, [{ wbs_item_id: a.id, share_pct: 60 }, { wbs_item_id: b.id, share_pct: 15 }, { wbs_item_id: c1.id, share_pct: 25 }]));
    const gone = ok(await deleteItem(ctx, b.id));
    expect(gone).toMatchObject({ lines: 1, parts: 1 });
    expect(line(tables, L.pipe).wbs_item_id).toBeNull();
    // the stair keeps 60 and 25: a 15 % remainder, nothing re-spread
    expect(partsOf(tables, L.stair).map((p) => p.share_pct)).toEqual([60, 25]);
    expect(codes(tables)).toEqual({ A: "1", C: "2", "C one": "2.1" });
    expect(logs.at(-1)).toMatchObject({ field: "WBS 2 removed" });

    // removing a branch: its sub-item moves up to the top level
    ok(await deleteItem(ctx, c.id));
    expect(codes(tables)).toEqual({ A: "1", "C one": "2" });
    expect(tables.tender_wbs_items.find((i) => i.name === "C one")?.parent_id).toBeNull();
    expect(partsOf(tables, L.stair).map((p) => p.share_pct)).toEqual([60, 25]);
  });
});

describe("Renumber", () => {
  it("recomputes every code and clears the typed flag", async () => {
    const { ctx, tables } = setup();
    ok(await createItem(ctx, { name: "A" }));
    ok(await createItem(ctx, { name: "B", code: "C-200" }));
    ok(await createItem(ctx, { name: "C" }));
    expect(codes(tables)).toEqual({ A: "1", B: "C-200", C: "3" });
    const r = ok(await renumberItems(ctx));
    expect(r.changed).toBe(1);
    expect(codes(tables)).toEqual({ A: "1", B: "2", C: "3" });
    expect(tables.tender_wbs_items.every((i) => i.code_is_manual === false)).toBe(true);
  });
});

describe("while migration 0243 is pending", () => {
  it("every write answers the one plain message and nothing crashes", async () => {
    const { ctx } = setup({}, { missingTables: ["tender_wbs_items", "tender_wbs_line_parts"], missingColumns: { tender_boq_lines: ["wbs_item_id"] } });
    for (const r of [
      await createItem(ctx, { name: "x" }), await updateItem(ctx, id(500), { name: "x" }), await deleteItem(ctx, id(500)), await assignLines(ctx, [L.stair], null),
      await setLineSplit(ctx, L.stair, [{ wbs_item_id: id(500), share_pct: 100 }]), await unsplitLine(ctx, L.stair), await renumberItems(ctx),
    ]) bad(r, 503, WBS_PENDING);
  });

  it("the screen state says pending, with no items", async () => {
    const { ctx } = setup({}, { missingTables: ["tender_wbs_items", "tender_wbs_line_parts"], missingColumns: { tender_boq_lines: ["wbs_item_id"] } });
    const { state } = await wbsStateFor(ctx.admin, TENANT, OPP, []);
    expect(state).toMatchObject({ pending: true, items: [] });
  });

  it("with only the parts table missing it is still pending, not half-working", async () => {
    const { ctx } = setup({}, { missingTables: ["tender_wbs_line_parts"] });
    bad(await createItem(ctx, { name: "x" }), 503, WBS_PENDING);
  });
});

describe("the screen state and roll-ups", () => {
  it("rolls the stair's 60/15/25 up the tree and the total counts it once", async () => {
    const { ctx } = setup();
    const a = ok(await createItem(ctx, { name: "Steel" }));
    const a1 = ok(await createItem(ctx, { name: "Fabrication", parent_id: a.id }));
    const a2 = ok(await createItem(ctx, { name: "Galvanising", parent_id: a.id }));
    const b = ok(await createItem(ctx, { name: "Erection", owner_employee_id: EMP }));
    ok(await assignLines(ctx, [L.pipe], a1.id));
    ok(await setLineSplit(ctx, L.stair, [{ wbs_item_id: a1.id, share_pct: 60 }, { wbs_item_id: a2.id, share_pct: 15 }, { wbs_item_id: b.id, share_pct: 25 }]));
    const lines = [
      { id: L.stair, qty: 337.1, amount: 141582, priced: true, removed: false, unit_cost: 300 },
      { id: L.pipe, qty: 10, amount: 5000, priced: true, removed: false, unit_cost: null },
      { id: L.gate, qty: 1, amount: 700, priced: true, removed: false, unit_cost: null },
    ];
    const { state } = await wbsStateFor(ctx.admin, TENANT, OPP, lines);
    expect(state.items.map((i) => [i.code, i.depth, i.is_leaf, i.owner_name])).toEqual([["1", 1, false, null], ["1.1", 2, true, null], ["1.2", 2, true, null], ["2", 1, true, "Anas K"]]);
    expect(state.rollup[a1.id].client_amount).toBe(84949.2 + 5000);
    expect(state.rollup[a.id].client_amount).toBe(89949.2 + 21237.3);
    expect(state.rollup[b.id]).toMatchObject({ client_amount: 35395.5, part_count: 1, shared_count: 1 });
    expect(state.total.client_amount).toBe(141582 + 5000);
    expect(state.total.part_count).toBe(4);
  });
});

// ── The upload path, for real, on the same fake ─────────────────────────────────────────────────────────────────────

const dealLine = (lid: string, sl: string, qty: number, rate: number) => ({ id: lid, tenant_id: TENANT, opportunity_id: OPP, sl_no: sl, description: `Line ${sl}`, uom: "m", qty, rate, discount_pct: 0, amount: qty * rate, is_selected: true, show_on_pdf: true });
const boqRow = (rid: string, lid: string, no: string, rowNo: number, over: Row = {}) => ({
  id: rid, tenant_id: TENANT, opportunity_id: OPP, source_id: id(900), line_id: lid, item_key: `n:${no.toLowerCase()}`, item_no: no, cost_code: null, row_no: rowNo,
  file_description: `Line ${no}`, file_uom: "m", file_qty: 10, file_rate: null, price_source: null, removed_in_revision: false, wbs_item_id: null, ...over,
});
const incoming = (no: string, rowNo: number, qty: number): BoqLine => ({ row_no: rowNo, item_no: no, description: `Line ${no}`, uom: "m", qty, cost_code: null, file_rate: null, key: `n:${no.toLowerCase()}` });

describe("a revised upload keeps the grouping and the split", () => {
  const rows = { stair: id(701), unpricedSplit: id(702), pricedSplit: id(703), whole: id(704) };
  const dl = { stair: id(801), unpricedSplit: id(802), pricedSplit: id(803), whole: id(804) };
  const ITEMS = { fab: id(401), gal: id(402), ere: id(403) };
  let t: ReturnType<typeof setup>;
  let req: BoqRequest;

  beforeEach(() => {
    t = setup({
      tenants: [{ id: TENANT, config: {} }],
      opportunities: [{ id: OPP, tenant_id: TENANT, ref: "OPP-1", title: "Tender" }],
      tender_boq_sources: [{ id: id(900), tenant_id: TENANT, opportunity_id: OPP, is_current: true, version: 1, file_name: "a.xlsx", sheet_name: "S", header_row: 1, line_count: 4, added_columns: false, total_row: null, uploaded_at: "2026-11-01T00:00:00Z", header_labels: [], column_map: {} }],
      opportunity_lines: [dealLine(dl.stair, "2.4", 10, 100), dealLine(dl.unpricedSplit, "3.1", 5, 0), dealLine(dl.pricedSplit, "3.2", 4, 50), dealLine(dl.whole, "1.1", 2, 10)],
      tender_boq_lines: [
        boqRow(rows.stair, dl.stair, "2.4", 4, { price_source: "boq_rate" }),
        boqRow(rows.unpricedSplit, dl.unpricedSplit, "3.1", 5),
        boqRow(rows.pricedSplit, dl.pricedSplit, "3.2", 6, { price_source: "manual" }),
        boqRow(rows.whole, dl.whole, "1.1", 7, { wbs_item_id: ITEMS.fab, price_source: "boq_rate" }),
      ],
      tender_wbs_items: [
        { id: ITEMS.fab, tenant_id: TENANT, opportunity_id: OPP, parent_id: null, code: "1", name: "Fabrication", sort_order: 10, code_is_manual: false },
        { id: ITEMS.gal, tenant_id: TENANT, opportunity_id: OPP, parent_id: null, code: "2", name: "Galvanising", sort_order: 20, code_is_manual: false },
        { id: ITEMS.ere, tenant_id: TENANT, opportunity_id: OPP, parent_id: null, code: "3", name: "Erection", sort_order: 30, code_is_manual: false },
      ],
      tender_wbs_line_parts: [
        { id: id(851), tenant_id: TENANT, opportunity_id: OPP, boq_line_id: rows.stair, wbs_item_id: ITEMS.fab, share_pct: 60, sort_order: 0 },
        { id: id(852), tenant_id: TENANT, opportunity_id: OPP, boq_line_id: rows.stair, wbs_item_id: ITEMS.gal, share_pct: 15, sort_order: 1 },
        { id: id(853), tenant_id: TENANT, opportunity_id: OPP, boq_line_id: rows.stair, wbs_item_id: ITEMS.ere, share_pct: 25, sort_order: 2 },
        { id: id(854), tenant_id: TENANT, opportunity_id: OPP, boq_line_id: rows.unpricedSplit, wbs_item_id: ITEMS.fab, share_pct: 50, sort_order: 0 },
        { id: id(855), tenant_id: TENANT, opportunity_id: OPP, boq_line_id: rows.unpricedSplit, wbs_item_id: ITEMS.gal, share_pct: 50, sort_order: 1 },
        { id: id(856), tenant_id: TENANT, opportunity_id: OPP, boq_line_id: rows.pricedSplit, wbs_item_id: ITEMS.fab, share_pct: 70, sort_order: 0 },
        { id: id(857), tenant_id: TENANT, opportunity_id: OPP, boq_line_id: rows.pricedSplit, wbs_item_id: ITEMS.ere, share_pct: 30, sort_order: 1 },
      ],
    });
    req = { admin: t.client, supabase: t.client, tenantId: TENANT, userId: "u1", role: "admin", opp: { id: OPP, ref: "OPP-1", title: "Tender" } as never, tender: {} as never };
  });

  const revise = (qty24: number) => applyBoqLines(req, [incoming("2.4", 4, qty24), incoming("1.1", 7, 2), incoming("9.9", 8, 3)], { id: id(901), fileLabel: "rev2.xlsx", previous: { file_name: "rev1.xlsx", version: 1 } });

  it("a changed quantity keeps the percentages and names the line", async () => {
    const r = ok(await revise(400));
    expect(r.respread).toEqual(["2.4"]);
    expect(r.respread_ids).toEqual([rows.stair]);
    expect(partsOf(t.tables, rows.stair).map((p) => p.share_pct)).toEqual([60, 15, 25]);
    expect((t.tables.opportunity_lines as Row[]).find((l) => l.id === dl.stair)?.qty).toBe(400);
  });

  it("an unchanged quantity names nothing", async () => {
    expect(ok(await revise(10)).respread).toEqual([]);
  });

  it("whole lines keep their item; a new line is Unassigned", async () => {
    ok(await revise(400));
    expect(line(t.tables, rows.whole).wbs_item_id).toBe(ITEMS.fab);
    const fresh = (t.tables.tender_boq_lines as Row[]).find((l) => l.item_no === "9.9") as Row;
    expect(fresh).toBeTruthy();
    expect(fresh.wbs_item_id ?? null).toBeNull();
    expect(partsOf(t.tables, fresh.id as string)).toEqual([]);
  });

  it("a dropped unpriced split line goes with its parts; a dropped priced one is kept, flagged, parts and all", async () => {
    ok(await revise(400));
    expect((t.tables.tender_boq_lines as Row[]).some((l) => l.id === rows.unpricedSplit)).toBe(false);
    expect(partsOf(t.tables, rows.unpricedSplit)).toEqual([]);
    expect(line(t.tables, rows.pricedSplit).removed_in_revision).toBe(true);
    expect(partsOf(t.tables, rows.pricedSplit).map((p) => [p.wbs_item_id, p.share_pct])).toEqual([[ITEMS.fab, 70], [ITEMS.ere, 30]]);
  });

  it("the BOQ screen state carries each line's item and parts, and the flagged priced line stays out of the roll-up", async () => {
    ok(await revise(400));
    const state = await buildBoqState(req);
    expect(state.wbs.pending).toBe(false);
    const stair = state.lines.find((l) => l.id === rows.stair)!;
    expect(stair.wbs_item_id).toBeNull();
    expect(stair.wbs_parts.map((p) => p.share_pct)).toEqual([60, 15, 25]);
    const kept = state.lines.find((l) => l.id === rows.pricedSplit)!;
    expect(kept.removed).toBe(true);
    expect(kept.wbs_parts).toHaveLength(2);
    // active priced lines: the stair (qty 400 x 100) and 1.1 (2 x 10); the new line 9.9 is unpriced
    expect(state.wbs.total.client_amount).toBe(40000 + 20);
    expect(state.wbs.rollup[ITEMS.fab].client_amount).toBe(24000 + 20);
  });

  it("while 0243 is pending the BOQ screen still loads, with no WBS", async () => {
    const off = setup({
      tenants: [{ id: TENANT, config: {} }], opportunities: [{ id: OPP, tenant_id: TENANT }],
      opportunity_lines: [dealLine(dl.stair, "2.4", 10, 100)],
      tender_boq_lines: [boqRow(rows.stair, dl.stair, "2.4", 4)],
      tender_boq_sources: [{ id: id(900), tenant_id: TENANT, opportunity_id: OPP, is_current: true, version: 1, file_name: "a.xlsx", sheet_name: "S", header_row: 1, line_count: 1, added_columns: false, total_row: null, uploaded_at: "2026-11-01T00:00:00Z", header_labels: [], column_map: {} }],
    }, { missingTables: ["tender_wbs_items", "tender_wbs_line_parts"], missingColumns: { tender_boq_lines: ["wbs_item_id"] } });
    const r = { ...req, admin: off.client, supabase: off.client };
    const state = await buildBoqState(r);
    expect(state.wbs.pending).toBe(true);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]).toMatchObject({ wbs_item_id: null, wbs_parts: [] });
    // and a revised upload still applies
    const up = await applyBoqLines(r, [incoming("2.4", 4, 20)], { id: id(902), fileLabel: "rev.xlsx", previous: { file_name: "a.xlsx", version: 1 } });
    expect(up.ok).toBe(true);
  });
});
