import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

let db: ReturnType<typeof fakeDb>;
let client: SupabaseClient;
let columnsPresent = true;
const logged: { objectType: string; objectId: string; changes?: { field: string; to: unknown }[] }[] = [];

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: client, tenantId: "t1", userId: "u1", role: "admin" }),
  createAdminSupabase: () => client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); } };
});
vi.mock("@/lib/events/emitters", () => ({ emitInvoiceSent: async () => {}, emitInvoiceOverdue: async () => {} }));

const credit = await import("./[id]/credit-note/route");
const invoiceRoute = await import("./[id]/route");
const listRoute = await import("./route");
const einvoiceRoute = await import("./[id]/einvoice/route");
const lineRoute = await import("./[id]/lines/[lineId]/route");

const VAT = "300000000000003";
const BUYER_VAT = "310122393500003";
const entity = {
  id: "e1", name: "Acme Co", short_name: "A", address: "", is_default: true,
  vat_number: VAT, crn: "1010000000", name_ar: "شركة أكمي", building_number: "1234", street: "King Fahd Rd", district: "Olaya", city: "Riyadh", postal_code: "12214", country: "SA",
};
const account = { id: "a1", tenant_id: "t1", name: "Buyer Co", name_ar: "شركة المشتري", vat_number: BUYER_VAT, address_line1: "Main St", address_building: "4321", address_district: "Rawdah", city: "Jeddah", postal_code: "21442", country: "SA" };
const inv = (over: Row = {}): Row => ({
  id: "i1", tenant_id: "t1", ref: "INV-2026-0001", account_id: "a1", contact_id: null, entity_id: "e1", status: "sent", total: 200,
  paid_amount: 0, discount_type: "pct", discount_pct: 0, discount_fixed: 0, issued_at: "2026-10-20T08:00:00Z", einvoice_doc_type: "standard",
  einvoice_uuid: "u-1", einvoice_seq: 1, original_invoice_id: null, credit_reason: null, supply_date: "2026-10-20", ...over,
});
const line = (id: string, over: Row = {}): Row => ({
  id, tenant_id: "t1", invoice_id: "i1", sl_no: id, description: `Item ${id}`, uom: "ea", qty: 1, rate: 100, amount: 100, vat_category: "S", vat_rate: 15, vat_exemption_reason: null, ...over,
});

type TenantRow = { id: string; features: Record<string, boolean>; config: Record<string, unknown> };
const tenant = (over: Partial<TenantRow> = {}): TenantRow => ({
  id: "t1", features: { invoices: true, einvoicing_ksa: true }, config: { entities: [entity], currency: "SAR" }, ...over,
});

function seed(rows: { tenants?: TenantRow[]; invoices?: Row[]; invoice_lines?: Row[]; accounts?: Row[] } = {}, copyReads = false) {
  db = fakeDb({
    tenants: rows.tenants ?? [tenant()],
    invoices: rows.invoices ?? [inv()],
    invoice_lines: rows.invoice_lines ?? [line("l1"), line("l2", { vat_category: "Z", vat_rate: 0, vat_exemption_reason: "Export" })],
    accounts: rows.accounts ?? [account],
  }, { copyReads });
  // A database without migration 0219 answers the column probe with "column does not exist".
  const base = db.client;
  const from = (t: string) => {
    const q = base.from(t) as unknown as Record<string, unknown>;
    if (t === "invoices") {
      const select = q.select as (c?: string) => unknown;
      q.select = (cols?: string) => {
        if (cols === "einvoice_uuid" && !columnsPresent) {
          const b: Record<string, unknown> = { limit: () => b, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "42703", message: 'column "einvoice_uuid" does not exist' } }).then(res) };
          return b;
        }
        return select.call(q, cols);
      };
    }
    return q;
  };
  // The counter function lives in the database; here it is the same contract on the in-memory rows.
  const counters = new Map<string, number>();
  client = {
    from,
    rpc: async (fn: string, a: { p_tenant: string; p_invoice: string; p_seller_key: string }) => {
      if (fn !== "allocate_einvoice_seq") return { data: null, error: { code: "42883", message: "no such function" } };
      const { data } = await db.client.from("invoices").select("*").eq("id", a.p_invoice).eq("tenant_id", a.p_tenant).maybeSingle();
      const row = data as Row | null;
      if (!row) return { data: null, error: { code: "P0002", message: "invoice not found" } };
      if (row.einvoice_seq != null) return { data: row.einvoice_seq, error: null };
      const key = `${a.p_tenant}|${a.p_seller_key}`;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      row.einvoice_seq = next; row.einvoice_unit = a.p_seller_key;
      return { data: next, error: null };
    },
  } as unknown as SupabaseClient;
}
const table = (name: string) => (db as unknown as { client: SupabaseClient }).client.from(name);
const rows = async (name: string) => ((await table(name).select("*")) as unknown as { data: Row[] }).data;
const json = (body: unknown, method = "POST") =>
  new Request("http://x", { method, headers: { "content-type": "application/json" }, ...(method === "GET" || method === "DELETE" ? {} : { body: JSON.stringify(body) }) }) as never;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  logged.length = 0;
  columnsPresent = true;
  seed();
});

describe("POST /api/invoices/[id]/credit-note", () => {
  it("creates a draft credit note: same lines and VAT, positive, linked to the original, with the reason and its own UUID", async () => {
    const res = await credit.POST(json({ reason: "Goods returned" }), ctx("i1"));
    expect(res.status).toBe(201);
    const { id, ref } = await res.json();
    expect(ref).toMatch(/^INV-/);
    const note = (await rows("invoices")).find((r) => r.id === id)!;
    expect(note).toMatchObject({
      tenant_id: "t1", status: "draft", account_id: "a1", einvoice_doc_type: "credit_note", original_invoice_id: "i1", credit_reason: "Goods returned", total: 200,
    });
    expect(note.einvoice_uuid).toBeTruthy();
    expect(note.einvoice_uuid).not.toBe("u-1");
    expect(note.einvoice_seq).toBeUndefined(); // the number is taken when it is sent, never at creation
    const noteLines = (await rows("invoice_lines")).filter((l) => l.invoice_id === id);
    expect(noteLines).toHaveLength(2);
    expect(noteLines.every((l) => (l.amount as number) > 0 && l.tenant_id === "t1")).toBe(true);
    expect(noteLines.find((l) => l.vat_category === "Z")).toMatchObject({ vat_rate: 0, vat_exemption_reason: "Export" });
    expect(logged.find((l) => l.objectId === id)!.changes!.map((c) => c.field)).toContain("original_invoice_id");
  });

  it("another workspace's invoice id is not found, and nothing is created", async () => {
    seed({ invoices: [inv({ id: "theirs", tenant_id: "t2", ref: "INV-X" })], invoice_lines: [line("lx", { invoice_id: "theirs", tenant_id: "t2" })] });
    const res = await credit.POST(json({ reason: "Because" }), ctx("theirs"));
    expect(res.status).toBe(404);
    expect(await rows("invoices")).toHaveLength(1);
  });

  it("a workspace without e-invoicing does not have the route", async () => {
    seed({ tenants: [tenant({ features: { invoices: true } })] });
    expect((await credit.POST(json({ reason: "x" }), ctx("i1"))).status).toBe(404);
    seed({ tenants: [tenant({ config: { entities: [entity], einvoicing: { scheme: null } } })] });
    expect((await credit.POST(json({ reason: "x" }), ctx("i1"))).status).toBe(404);
  });

  it("needs a reason", async () => {
    expect((await credit.POST(json({ reason: "  " }), ctx("i1"))).status).toBe(400);
    expect((await credit.POST(json({}), ctx("i1"))).status).toBe(400);
  });

  it("refuses a draft, a cancelled invoice and a note", async () => {
    for (const over of [{ status: "draft" }, { status: "cancelled" }, { einvoice_doc_type: "credit_note" }, { einvoice_doc_type: "debit_note" }]) {
      seed({ invoices: [inv(over)] });
      expect((await credit.POST(json({ reason: "x" }), ctx("i1"))).status, JSON.stringify(over)).toBe(409);
    }
  });

  it("does not credit the same invoice twice", async () => {
    expect((await credit.POST(json({ reason: "first" }), ctx("i1"))).status).toBe(201);
    const second = await credit.POST(json({ reason: "again" }), ctx("i1"));
    expect(second.status).toBe(409);
    expect((await second.json()).error).toMatch(/already exists/);
  });

  it("while migration 0219 is pending it says so instead of failing", async () => {
    columnsPresent = false;
    const res = await credit.POST(json({ reason: "x" }), ctx("i1"));
    expect(res.status).toBe(503);
    expect((await res.json()).needsDatabaseUpdate).toBe(true);
  });
});

describe("sending a draft (PATCH status = sent)", () => {
  const draft = (over: Row = {}) => inv({ status: "draft", einvoice_doc_type: null, einvoice_uuid: null, einvoice_seq: null, issued_at: null, supply_date: null, ...over });
  const send = () => invoiceRoute.PATCH(json({ status: "sent" }, "PATCH"), ctx("i1"));

  it("a ready draft is sent: it gets its UUID, type, issue time, supply date and counter number", async () => {
    seed({ invoices: [draft({ total: 200 })] });
    const res = await send();
    expect(res.status).toBe(200);
    const row = (await rows("invoices"))[0];
    expect(row).toMatchObject({ status: "sent", einvoice_doc_type: "standard", einvoice_seq: 1, einvoice_unit: "e1" });
    expect(row.einvoice_uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof row.issued_at).toBe("string");
    expect(row.supply_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("a draft that is not ready is not sent: 422 with exactly what is missing, and nothing is stamped", async () => {
    seed({ invoices: [draft({ total: 100 })], invoice_lines: [line("l1", { vat_category: null, vat_rate: null })], tenants: [tenant({ config: { currency: "SAR", entities: [{ ...entity, crn: "", building_number: "12" }] } })] });
    const res = await send();
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/not ready/);
    expect(body.issues.map((i: { field: string }) => i.field).sort()).toEqual(["lines.vat_category", "seller.building_number", "seller.crn"]);
    const row = (await rows("invoices"))[0];
    expect(row.status).toBe("draft");
    expect(row.einvoice_seq).toBeNull();
    expect(row.einvoice_uuid).toBeNull();
  });

  it("sending twice does not take a second number", async () => {
    seed({ invoices: [draft()] });
    await send();
    await send();
    expect((await rows("invoices"))[0].einvoice_seq).toBe(1);
  });

  it("two invoices from one seller unit are numbered 1 and 2", async () => {
    seed({ invoices: [draft({ total: 100 }), draft({ id: "i2", ref: "INV-2026-0002", total: 100 })], invoice_lines: [line("l1"), line("l9", { invoice_id: "i2" })] });
    await send();
    await invoiceRoute.PATCH(json({ status: "sent" }, "PATCH"), ctx("i2"));
    const all = await rows("invoices");
    expect(all.map((r) => r.einvoice_seq)).toEqual([1, 2]);
  });

  it("a workspace without e-invoicing sends exactly as before: no check, nothing stamped", async () => {
    seed({ tenants: [tenant({ features: { invoices: true } })], invoices: [draft()], invoice_lines: [line("l1", { vat_category: null })] });
    const res = await send();
    expect(res.status).toBe(200);
    const row = (await rows("invoices"))[0];
    expect(row.status).toBe("sent");
    expect(row.einvoice_seq).toBeNull();
    expect(row.einvoice_uuid).toBeNull();
  });

  it("while migration 0219 is pending the send goes through unchecked", async () => {
    columnsPresent = false;
    seed({ invoices: [draft()], invoice_lines: [line("l1", { vat_category: null })] });
    expect((await send()).status).toBe(200);
  });
});

describe("what an invoice PATCH may set for e-invoicing", () => {
  it("the supply date, a note's reason and standard/simplified; never the UUID, counter or original", async () => {
    seed({ invoices: [inv({ status: "draft", einvoice_doc_type: "standard" })] });
    const res = await invoiceRoute.PATCH(json({ supply_date: "2026-11-01", einvoice_doc_type: "simplified", einvoice_uuid: "evil", einvoice_seq: 99, original_invoice_id: "x", notes: "n" }, "PATCH"), ctx("i1"));
    expect(res.status).toBe(200);
    expect((await rows("invoices"))[0]).toMatchObject({ supply_date: "2026-11-01", einvoice_doc_type: "simplified", einvoice_uuid: "u-1", einvoice_seq: 1, original_invoice_id: null });
  });
  it("is ignored entirely for a workspace without e-invoicing", async () => {
    seed({ tenants: [tenant({ features: { invoices: true } })], invoices: [inv({ status: "draft", einvoice_doc_type: null, supply_date: null })] });
    await invoiceRoute.PATCH(json({ supply_date: "2026-11-01", einvoice_doc_type: "simplified" }, "PATCH"), ctx("i1"));
    expect((await rows("invoices"))[0]).toMatchObject({ supply_date: null, einvoice_doc_type: null });
  });
});

describe("line VAT through the line route", () => {
  const patch = (body: Row) => lineRoute.PATCH(json(body, "PATCH"), { params: Promise.resolve({ id: "i1", lineId: "l1" }) });
  it("sets category, forces 0% on an exempt line and logs the change", async () => {
    seed({ invoices: [inv({ status: "draft" })] }, true);
    const res = await patch({ vat_category: "E", vat_rate: 15, vat_exemption_reason: "Financial service" });
    expect(res.status).toBe(200);
    expect((await rows("invoice_lines")).find((l) => l.id === "l1")).toMatchObject({ vat_category: "E", vat_rate: 0, vat_exemption_reason: "Financial service" });
    expect(logged[0].changes!.map((c) => c.field)).toEqual(expect.arrayContaining(["Line Item l1: vat_category", "Line Item l1: vat_rate"]));
  });
  it("is ignored for a workspace without e-invoicing", async () => {
    seed({ tenants: [tenant({ features: { invoices: true } })], invoices: [inv({ status: "draft" })] });
    await patch({ vat_category: "E", qty: 3 });
    const l = (await rows("invoice_lines")).find((x) => x.id === "l1")!;
    expect(l.vat_category).toBe("S");
    expect(l.qty).toBe(3);
  });
});

describe("the readiness endpoint", () => {
  it("reports ready / not ready with the list, and the totals by rate", async () => {
    const res = await einvoiceRoute.GET(json(null, "GET"), ctx("i1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ doc_type: "standard", ready: true, issues: [], uuid: "u-1", seq: 1 });
    expect(body.totals).toMatchObject({ subtotal: 200, taxable: 200, vat: 15, grand_total: 215 });
    expect(body.totals.by_rate).toHaveLength(2);
  });
  it("is 404 for a workspace without e-invoicing and 503 while the migration is pending", async () => {
    seed({ tenants: [tenant({ features: { invoices: true } })] });
    expect((await einvoiceRoute.GET(json(null, "GET"), ctx("i1"))).status).toBe(404);
    seed();
    columnsPresent = false;
    const res = await einvoiceRoute.GET(json(null, "GET"), ctx("i1"));
    expect(res.status).toBe(503);
  });
  it("'apply_default_vat' tags only the untagged lines of a draft", async () => {
    seed({ invoices: [inv({ status: "draft" })], invoice_lines: [line("l1", { vat_category: null, vat_rate: null }), line("l2", { vat_category: "Z", vat_rate: 0, vat_exemption_reason: "Export" })] });
    const res = await einvoiceRoute.POST(json({ action: "apply_default_vat" }), ctx("i1"));
    expect(res.status).toBe(200);
    const ls = await rows("invoice_lines");
    expect(ls.find((l) => l.id === "l1")).toMatchObject({ vat_category: "S", vat_rate: 15 });
    expect(ls.find((l) => l.id === "l2")).toMatchObject({ vat_category: "Z", vat_rate: 0 });
  });
  it("won't change the lines of an invoice that is no longer a draft", async () => {
    seed({ invoice_lines: [line("l1", { vat_category: null })] });
    expect((await einvoiceRoute.POST(json({ action: "apply_default_vat" }), ctx("i1"))).status).toBe(409);
  });
  it("another workspace's invoice is not found", async () => {
    seed({ invoices: [inv({ tenant_id: "t2" })] });
    expect((await einvoiceRoute.GET(json(null, "GET"), ctx("i1"))).status).toBe(404);
  });
});

describe("responses for a workspace without e-invoicing carry none of the new keys", () => {
  it("GET one invoice and GET the list", async () => {
    seed({ tenants: [tenant({ features: { invoices: true } })] });
    const one = await (await invoiceRoute.GET(json(null, "GET"), ctx("i1"))).json();
    expect(Object.keys(one).filter((k) => /einvoice|original_invoice|credit_reason|supply_date/.test(k))).toEqual([]);
    expect(Object.keys(one.lines[0]).filter((k) => /^vat_/.test(k))).toEqual([]);
    const list = await (await listRoute.GET(json(null, "GET"))).json();
    expect(Object.keys(list[0]).filter((k) => /einvoice|original_invoice|credit_reason|supply_date/.test(k))).toEqual([]);
  });
  it("and for a workspace with it, they are there", async () => {
    const one = await (await invoiceRoute.GET(json(null, "GET"), ctx("i1"))).json();
    expect(one.einvoice_uuid).toBe("u-1");
    expect(one.lines[0].vat_category).toBe("S");
  });
});

describe("creating an invoice", () => {
  const body = (lines: Row[] = [{ description: "Work", qty: 2, rate: 50 }]) => ({ account_id: "a1", lines });
  const fresh = () => seed({ invoices: [], invoice_lines: [] });

  it("a Saudi workspace's invoice gets a UUID and every line the standard VAT category", async () => {
    fresh();
    const res = await listRoute.POST(json(body([{ description: "A", qty: 1, rate: 10 }, { description: "B", qty: 1, rate: 20, vat_category: "Z", vat_exemption_reason: "Export" }])));
    expect(res.status).toBe(201);
    const inv1 = (await rows("invoices"))[0];
    expect(inv1.einvoice_uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(inv1.einvoice_seq).toBeUndefined();
    const ls = await rows("invoice_lines");
    expect(ls.find((l) => l.description === "A")).toMatchObject({ vat_category: "S", vat_rate: 15 });
    expect(ls.find((l) => l.description === "B")).toMatchObject({ vat_category: "Z", vat_rate: 0, vat_exemption_reason: "Export" });
  });

  it("any other workspace's invoice is inserted with exactly the columns it always had", async () => {
    seed({ tenants: [tenant({ features: { invoices: true } })], invoices: [], invoice_lines: [] });
    const res = await listRoute.POST(json(body()));
    expect(res.status).toBe(201);
    const row = (await rows("invoices"))[0];
    expect(Object.keys(row).filter((k) => /einvoice|original_invoice|credit_reason|supply_date/.test(k))).toEqual([]);
    expect(Object.keys((await rows("invoice_lines"))[0]).filter((k) => /^vat_/.test(k))).toEqual([]);
  });

  it("while migration 0219 is pending the invoice is still made, without the e-invoice columns", async () => {
    fresh();
    const base = db.client;
    const pending = {
      from: (t: string) => {
        const q = base.from(t) as unknown as Record<string, unknown>;
        if (t !== "invoices" && t !== "invoice_lines") return q;
        const insert = q.insert as (r: Row | Row[]) => unknown;
        q.insert = (r: Row | Row[]) => {
          const first = Array.isArray(r) ? r[0] : r;
          if (first && ("einvoice_uuid" in first || "vat_category" in first)) {
            const err = { data: null, error: { code: "42703", message: 'column "einvoice_uuid" of relation "invoices" does not exist' } };
            const b: Record<string, unknown> = { select: () => b, single: () => b, then: (res: (v: unknown) => unknown) => Promise.resolve(err).then(res) };
            return b;
          }
          return insert.call(q, r);
        };
        return q;
      },
    };
    client = { ...pending, rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;
    const res = await listRoute.POST(json(body()));
    expect(res.status).toBe(201);
    const row = (await rows("invoices"))[0];
    expect(row.einvoice_uuid).toBeUndefined();
    expect((await rows("invoice_lines"))[0].vat_category).toBeUndefined();
  });
});

describe("deleting", () => {
  it("an invoice that holds a counter number is cancelled, not deleted", async () => {
    seed({ invoices: [inv({ status: "draft", einvoice_seq: 5 })] });
    const res = await invoiceRoute.DELETE(json(null, "DELETE"), ctx("i1"));
    expect(res.status).toBe(409);
    expect(await rows("invoices")).toHaveLength(1);
  });
  it("a plain draft is still deleted", async () => {
    seed({ invoices: [inv({ status: "draft", einvoice_seq: null })] });
    expect((await invoiceRoute.DELETE(json(null, "DELETE"), ctx("i1"))).status).toBe(204);
  });
});
