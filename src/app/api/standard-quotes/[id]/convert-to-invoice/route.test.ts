import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import { buildInvoiceFromQuote } from "@/lib/sales/standardQuoteInvoice";

let current: ReturnType<typeof fakeDb>;
let client: SupabaseClient;
let features: Record<string, boolean> = { standard_quotes: true, invoices: true };
const logged: { objectType: string; objectId: string; tenantId: string; changes?: { field: string; to: unknown }[] }[] = [];

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: client, tenantId: "t1", userId: "u1", role: "admin" }),
  createAdminSupabase: () => client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async (_s: unknown, _t: string, key: string) => features[key] === true }));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); } };
});

const route = await import("./route");

const quote = (over: Row = {}): Row => ({
  id: "sq1", tenant_id: "t1", ref: "SQ-2026-0001", status: "accepted", account_id: "a1", contact_id: "c1", terms: "Net 30",
  subtotal: 1000, header_discount_pct: 10, tax_pct: 18, shipping_amount: 50, total: 1121, ...over,
});
const line = (id: string, over: Row = {}): Row => ({ id, tenant_id: "t1", standard_quote_id: "sq1", sl_no: id, description: `Item ${id}`, uom: "ea", qty: 2, rate: 250, discount_pct: 0, amount: 500, is_selected: true, ...over });

const MISSING = { code: "42703", message: 'column "standard_quote_id" of relation "invoices" does not exist' };

/** Wraps the fake so any query on invoices that names standard_quote_id fails like a database without migration 0209. */
function withoutColumn(db: ReturnType<typeof fakeDb>): SupabaseClient {
  type Chain = Record<string | symbol, unknown>;
  const guard = (target: Chain): Chain => {
    let bad = false;
    const proxy: Chain = new Proxy(target, {
      get: (t, p) => {
        if (p === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            (bad ? Promise.resolve({ data: null, error: MISSING }) : (t.then as (a: unknown, b: unknown) => Promise<unknown>)(res, rej)).then(res, rej);
        }
        const v = t[p];
        if (typeof v !== "function") return v;
        return (...args: unknown[]) => {
          if ((p === "eq" || p === "insert") && (args[0] === "standard_quote_id" || (typeof args[0] === "object" && args[0] !== null && "standard_quote_id" in (args[0] as Row)))) bad = true;
          const r = (v as (...a: unknown[]) => unknown).apply(t, args);
          return r === t ? proxy : r;
        };
      },
    });
    return proxy;
  };
  return { from: (table: string) => (table === "invoices" ? guard(db.client.from(table) as unknown as Chain) : db.client.from(table)) } as unknown as SupabaseClient;
}

function seed(q: Row = quote(), lines: Row[] = [line("1"), line("2", { amount: 500 })], extra: Record<string, Row[]> = {}) {
  current = fakeDb({ standard_quotes: [q], standard_quote_lines: lines, invoices: [], invoice_lines: [], ...extra }, { copyReads: true });
  client = current.client;
}
const post = () => route.POST(new Request("http://x", { method: "POST" }) as never, { params: Promise.resolve({ id: "sq1" }) });

beforeEach(() => {
  logged.length = 0;
  features = { standard_quotes: true, invoices: true };
});

describe("buildInvoiceFromQuote", () => {
  it("copies chosen lines at their net amount and follows with discount, tax and shipping so the total is what was accepted", () => {
    const b = buildInvoiceFromQuote(
      { header_discount_pct: 10, tax_pct: 18, shipping_amount: 50 },
      [
        { sl_no: "1", description: "A", qty: 2, rate: 250, discount_pct: 0, amount: 500 },
        { sl_no: "2", description: "B", qty: 2, rate: 300, discount_pct: 10, amount: 540 },
        { sl_no: "3", description: "Not chosen", qty: 1, rate: 99, amount: 99, is_selected: false },
      ],
    );
    expect(b.lines.map((l) => l.description)).toEqual(["A", "B", "Discount (10%)", "Tax (18%)", "Shipping"]);
    expect(b.lines[1]).toMatchObject({ qty: 2, rate: 270, amount: 540 });
    expect(b.lines[2].amount).toBe(-104);
    expect(b.lines[3].amount).toBe(168.48);
    expect(b.total).toBe(1154.48);
    expect(b.lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(b.total, 2);
  });

  it("adds no extra lines for a quote without discount, tax or shipping", () => {
    const b = buildInvoiceFromQuote({}, [{ description: "A", qty: 1, rate: 10, amount: 10 }]);
    expect(b.lines).toHaveLength(1);
    expect(b.total).toBe(10);
  });
});

describe("POST /api/standard-quotes/[id]/convert-to-invoice", () => {
  it("raises a DRAFT invoice from an accepted quote: lines, totals, link and change history", async () => {
    seed();
    const res = await post();
    expect(res.status).toBe(201);
    const j = await res.json();
    const inv = current.tables.invoices[0];
    expect(inv).toMatchObject({ id: j.id, tenant_id: "t1", account_id: "a1", contact_id: "c1", status: "draft", standard_quote_id: "sq1", terms: "Net 30" });
    expect(inv.total).toBe(1112);
    const lines = current.tables.invoice_lines;
    expect(lines.every((l) => l.tenant_id === "t1" && l.invoice_id === j.id)).toBe(true);
    expect(lines.map((l) => l.description)).toEqual(["Item 1", "Item 2", "Discount (10%)", "Tax (18%)", "Shipping"]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ objectType: "invoices", objectId: j.id, tenantId: "t1" });
    expect(logged[0].changes?.[0]).toEqual({ field: "Created from standard quote", from: null, to: "SQ-2026-0001" });
  });

  it("a second call returns 409 with the existing invoice and creates nothing", async () => {
    seed();
    const first = await (await post()).json();
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ id: first.id, ref: first.ref });
    expect(current.tables.invoices).toHaveLength(1);
  });

  it("a cancelled invoice does not block a new one", async () => {
    seed(quote(), [line("1")], { invoices: [{ id: "old", tenant_id: "t1", ref: "INV-OLD", status: "cancelled", standard_quote_id: "sq1" }] });
    expect((await post()).status).toBe(201);
    expect(current.tables.invoices).toHaveLength(2);
  });

  it("only an accepted quote converts", async () => {
    for (const status of ["draft", "sent", "rejected", "expired"]) {
      seed(quote({ status }));
      const res = await post();
      expect(res.status).toBe(400);
      expect(current.tables.invoices).toHaveLength(0);
    }
  });

  it("needs the invoices module, and the quote must be this tenant's", async () => {
    seed();
    features = { standard_quotes: true, invoices: false };
    expect((await post()).status).toBe(403);
    features = { standard_quotes: true, invoices: true };
    seed(quote({ tenant_id: "t2" }));
    expect((await post()).status).toBe(404);
    expect(current.tables.invoices).toHaveLength(0);
  });

  it("another tenant's invoice for the same quote id does not count as this tenant's", async () => {
    seed(quote(), [line("1")], { invoices: [{ id: "x", tenant_id: "t2", ref: "INV-X", status: "draft", standard_quote_id: "sq1" }] });
    expect((await post()).status).toBe(201);
  });

  it("while migration 0209 is pending the invoice is still made, linked through custom_data, and a repeat is still refused", async () => {
    seed();
    client = withoutColumn(current);
    const res = await post();
    expect(res.status).toBe(201);
    expect(current.tables.invoices[0]).toMatchObject({ status: "draft", custom_data: { source_standard_quote_id: "sq1" } });
    expect(current.tables.invoices[0]).not.toHaveProperty("standard_quote_id");
    expect(current.tables.invoice_lines.length).toBeGreaterThan(0);
    const again = await post();
    expect(again.status).toBe(409);
    expect(current.tables.invoices).toHaveLength(1);
  });
});
