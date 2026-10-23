import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

let current: ReturnType<typeof fakeDb>;
let features: Record<string, boolean> = { standard_quotes: true };
const logged: { objectType: string; objectId: string; changes?: { field: string; to: unknown }[] }[] = [];

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: current.client, tenantId: "t1", userId: "u1", role: "admin" }),
  createAdminSupabase: () => current.client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async (_s: unknown, _t: string, key: string) => features[key] === true }));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); } };
});

const route = await import("./route");

const CONTACT = "11111111-1111-4111-8111-111111111111";
const quotation = (over: Row = {}): Row => ({
  id: "q1", tenant_id: "t1", ref: "QT-2026-0001", account_id: "a1", contact_id: CONTACT, status: "sent", outcome: "open", superseded_by: null,
  notes: "Deliver in two lots", terms: "50% advance", valid_until: "2026-12-31", inquiry_date: "2026-10-01",
  discount_type: "pct", discount_pct: 10, discount_fixed: 0, gst_rate: 18, total: 1000, opportunity_id: "o1", ...over,
});
const qline = (id: string, over: Row = {}): Row => ({ id, tenant_id: "t1", quote_id: "q1", sl_no: id, description: `Item ${id}`, uom: "ea", qty: 2, rate: 250, discount_pct: 0, amount: 500, is_selected: true, ...over });

function seed(q: Row = quotation(), lines: Row[] = [qline("1"), qline("2")], extra: Record<string, Row[]> = {}) {
  current = fakeDb({
    quotes: [q], quote_lines: lines, contacts: [{ id: CONTACT, tenant_id: "t1", account_id: "a1" }],
    standard_quotes: [], standard_quote_lines: [], standard_quote_templates: [{ id: "tpl1", tenant_id: "t1", is_default: true }], ...extra,
  }, { copyReads: true });
}
const post = () => route.POST(new Request("http://x", { method: "POST" }) as never, { params: Promise.resolve({ id: "q1" }) });
const names = () => (current.tables.domain_event ?? []).map((e) => e.name);

beforeEach(() => {
  logged.length = 0;
  features = { standard_quotes: true };
});

describe("POST /api/quotes/[id]/convert-to-standard-quote", () => {
  it("makes a DRAFT standard quote with the same account and contact, the lines, discount and tax, and the source in its notes", async () => {
    seed();
    const res = await post();
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.lines).toBe(2);
    const sq = current.tables.standard_quotes[0];
    expect(sq).toMatchObject({
      id: j.id, tenant_id: "t1", status: "draft", account_id: "a1", contact_id: CONTACT, header_discount_pct: 10, tax_pct: 18,
      subtotal: 1000, total: 1062, terms: "50% advance", template_id: "tpl1", opportunity_id: null,
    });
    expect(String(sq.notes).split("\n")).toEqual(["Source quotation: QT-2026-0001.", "Deliver in two lots"]);
    const lines = current.tables.standard_quote_lines;
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.tenant_id === "t1" && l.standard_quote_id === j.id)).toBe(true);
    expect(lines.map((l) => [l.description, l.qty, l.rate, l.amount])).toEqual([["Item 1", 2, 250, 500], ["Item 2", 2, 250, 500]]);
    expect(logged[0]).toMatchObject({ objectType: "standard_quotes", objectId: j.id });
  });

  it("leaves the Quotation exactly as it was", async () => {
    seed();
    const before = JSON.stringify([current.tables.quotes, current.tables.quote_lines]);
    await post();
    expect(JSON.stringify([current.tables.quotes, current.tables.quote_lines])).toBe(before);
  });

  it("emits quote.created for the new standard quote, once", async () => {
    seed();
    await post();
    const created = (current.tables.domain_event ?? []).filter((e) => e.name === "quote.created");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ tenant_id: "t1", object_type: "standard_quote", account_id: "a1" });
    expect(created[0].payload).toMatchObject({ from: "QT-2026-0001" });
  });

  it("a second call returns 409 with the standard quote already made, and creates nothing", async () => {
    seed();
    const first = await (await post()).json();
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ id: first.id, ref: first.ref });
    expect(current.tables.standard_quotes).toHaveLength(1);
    expect(names().filter((n) => n === "quote.created")).toHaveLength(1);
  });

  it("carries a fixed discount as the equivalent percentage, and drops lines that are not chosen", async () => {
    seed(quotation({ discount_type: "fixed", discount_fixed: 100, gst_rate: null }), [qline("1"), qline("2"), qline("3", { is_selected: false, amount: 900, rate: 450 })]);
    await post();
    const sq = current.tables.standard_quotes[0];
    expect(sq).toMatchObject({ header_discount_pct: 10, tax_pct: 0, subtotal: 1000, total: 900 });
  });

  it("a contact that is not this tenant's is not carried over", async () => {
    seed(quotation(), [qline("1")], { contacts: [{ id: CONTACT, tenant_id: "t2", account_id: "a1" }] });
    await post();
    expect(current.tables.standard_quotes[0].contact_id).toBeNull();
  });

  it("refuses another tenant's quotation, a superseded version, and a workspace without Standard Quotes", async () => {
    seed(quotation({ tenant_id: "t2" }));
    expect((await post()).status).toBe(404);
    seed(quotation({ superseded_by: "q9" }));
    expect((await post()).status).toBe(409);
    seed();
    features = { standard_quotes: false };
    expect((await post()).status).toBe(403);
    expect(current.tables.standard_quotes).toHaveLength(0);
  });
});
