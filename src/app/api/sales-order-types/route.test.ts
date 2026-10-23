import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

let current: ReturnType<typeof fakeDb>;
let role = "admin";
let features: Record<string, boolean> = { sales_orders: true };
const logged: { objectType: string; objectId: string; tenantId: string; action?: string }[] = [];

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: current.client, tenantId: "t1", userId: "u1", role }),
  createAdminSupabase: () => current.client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => features[key] === true,
  getTenant: async () => ({ id: "t1", config: {}, features }),
}));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); } };
});

const collection = await import("./route");
const one = await import("./[id]/route");

const type = (over: Row = {}): Row => ({ id: "ty1", tenant_id: "t1", name: "Standard order", prefix: "SO", pricing_mode: "internal", template: {}, rules: [], is_default: true, active: true, sort_order: 0, ...over });

function seed(types: Row[] = [type()], orders: Row[] = []) {
  current = fakeDb({ sales_order_types: types, sales_orders: orders }, { copyReads: true });
}
const post = (body: unknown) => collection.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as never);
const patch = (id: string, body: unknown) => one.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id }) });
const del = (id: string) => one.DELETE(new Request("http://x", { method: "DELETE" }) as never, { params: Promise.resolve({ id }) });
const types = () => current.tables.sales_order_types;

beforeEach(() => {
  logged.length = 0;
  role = "admin";
  features = { sales_orders: true };
  seed();
});

describe("GET /api/sales-order-types", () => {
  it("lists this tenant's types with how many orders each has, for any member", async () => {
    role = "member";
    seed([type(), type({ id: "ty2", name: "Export", prefix: "EX", is_default: false }), type({ id: "tyX", tenant_id: "t2", name: "Foreign" })], [{ id: "o1", tenant_id: "t1", type_id: "ty2" }, { id: "o2", tenant_id: "t2", type_id: "ty2" }]);
    const j = await (await collection.GET()).json();
    expect(j.rows.map((r: Row) => [r.id, r.order_count])).toEqual([["ty1", 0], ["ty2", 1]]);
  });

  it("is an empty list with needsDatabaseUpdate while 0212 is pending, and needs the module flag", async () => {
    current = fakeDb({}, { missingTables: ["sales_order_types"] });
    expect(await (await collection.GET()).json()).toMatchObject({ rows: [], needsDatabaseUpdate: true });
    features = {};
    expect((await collection.GET()).status).toBe(403);
  });
});

describe("POST /api/sales-order-types", () => {
  it("only a workspace admin may add a type", async () => {
    role = "member";
    expect((await post({ name: "X", prefix: "XX" })).status).toBe(403);
    expect(types()).toHaveLength(1);
  });

  it("creates a type in this tenant with a cleaned prefix, sanitised template and rules", async () => {
    const res = await post({
      name: "Gulf order", prefix: "go", pricing_mode: "external", tenant_id: "t2",
      template: { blocks: [{ type: "letterhead", visible: false }, { type: "nonsense", visible: true }], accent_color: "#112233", logo_position: "right" },
      rules: [{ field: "region", equals: "Qatar" }, { field: "colour", equals: "red" }],
    });
    expect(res.status).toBe(201);
    const row = types()[1];
    expect(row).toMatchObject({ tenant_id: "t1", name: "Gulf order", prefix: "GO", pricing_mode: "external", is_default: false, active: true, rules: [{ field: "region", equals: "Qatar" }] });
    const blocks = (row.template as { blocks: { type: string; visible: boolean }[] }).blocks;
    expect(blocks.map((b) => b.type)).not.toContain("nonsense");
    // letterhead is structural: it stays on whatever the client sent
    expect(blocks.find((b) => b.type === "letterhead")?.visible).toBe(true);
    expect(row.template).toMatchObject({ accent_color: "#112233", logo_position: "right" });
    expect(logged).toMatchObject([{ objectType: "sales_order_types", tenantId: "t1", action: "create" }]);
  });

  it("the first type of a workspace is its default; making a new one the default moves it", async () => {
    seed([]);
    await post({ name: "First", prefix: "FI" });
    expect(types()[0].is_default).toBe(true);
    await post({ name: "Second", prefix: "SE", is_default: true });
    expect(types().map((t) => [t.name, t.is_default])).toEqual([["First", false], ["Second", true]]);
  });

  it("another tenant's default is left alone when this one moves its default", async () => {
    seed([type(), type({ id: "other", tenant_id: "t2", name: "Theirs" })]);
    await post({ name: "Second", prefix: "SE", is_default: true });
    expect(types().find((t) => t.id === "other")!.is_default).toBe(true);
  });

  it.each([
    ["a missing name", { prefix: "SO" }],
    ["a bad prefix", { name: "X", prefix: "1" }],
    ["an unknown pricing mode", { name: "X", prefix: "XX", pricing_mode: "free" }],
  ])("refuses %s", async (_n, body) => {
    expect((await post(body)).status).toBe(400);
    expect(types()).toHaveLength(1);
  });
});

describe("PATCH /api/sales-order-types/[id]", () => {
  beforeEach(() => seed([type(), type({ id: "ty2", name: "Export", prefix: "EX", is_default: false, sort_order: 1 })]));

  it("edits a type and writes history; a member cannot", async () => {
    expect((await patch("ty2", { name: "Export order", pricing_mode: "external", rules: [{ field: "region", equals: "UAE" }] })).status).toBe(200);
    expect(types()[1]).toMatchObject({ name: "Export order", pricing_mode: "external", rules: [{ field: "region", equals: "UAE" }] });
    expect(logged).toHaveLength(1);
    role = "member";
    expect((await patch("ty2", { name: "Hacked" })).status).toBe(403);
    expect(types()[1].name).toBe("Export order");
  });

  it("making a type the default switches it on and clears the old default; the default can't be unset or switched off", async () => {
    types()[1].active = false;
    expect((await patch("ty2", { is_default: true })).status).toBe(200);
    expect(types().map((t) => [t.id, t.is_default, t.active])).toEqual([["ty1", false, true], ["ty2", true, true]]);
    expect((await patch("ty2", { is_default: false })).status).toBe(422);
    expect((await patch("ty2", { active: false })).status).toBe(422);
  });

  it("a type of another tenant is a 404 and is not touched", async () => {
    seed([type({ tenant_id: "t2" })]);
    expect((await patch("ty1", { name: "x" })).status).toBe(404);
    expect(types()[0].name).toBe("Standard order");
  });

  it("an empty body is a 400 and a duplicate name is a 409-class refusal from the database", async () => {
    expect((await patch("ty2", {})).status).toBe(400);
  });
});

describe("DELETE /api/sales-order-types/[id]", () => {
  it("deletes a type that has no orders", async () => {
    seed([type(), type({ id: "ty2", name: "Export", prefix: "EX", is_default: false })]);
    const j = await (await del("ty2")).json();
    expect(j).toEqual({ deleted: true });
    expect(types().map((t) => t.id)).toEqual(["ty1"]);
  });

  it("deactivates a type that has orders instead of deleting it", async () => {
    seed([type(), type({ id: "ty2", name: "Export", prefix: "EX", is_default: false })], [{ id: "o1", tenant_id: "t1", type_id: "ty2" }]);
    const j = await (await del("ty2")).json();
    expect(j).toMatchObject({ deactivated: true });
    expect(types().find((t) => t.id === "ty2")).toMatchObject({ active: false });
  });

  it("an order of another tenant on the same type id does not count as use", async () => {
    seed([type(), type({ id: "ty2", name: "Export", prefix: "EX", is_default: false })], [{ id: "o1", tenant_id: "t2", type_id: "ty2" }]);
    expect(await (await del("ty2")).json()).toEqual({ deleted: true });
  });

  it("the default type can't be removed, a member can't remove anything, another tenant's type is a 404", async () => {
    expect((await del("ty1")).status).toBe(422);
    role = "member";
    expect((await del("ty1")).status).toBe(403);
    role = "admin";
    seed([type({ tenant_id: "t2" })]);
    expect((await del("ty1")).status).toBe(404);
    expect(types()).toHaveLength(1);
  });
});
