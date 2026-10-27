import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

let current: ReturnType<typeof fakeDb>;
const sent: unknown[] = [];

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => current.client,
  requireTenantUser: async () => { throw new Error("not used"); },
  getAuthUser: async () => null,
}));
vi.mock("resend", () => ({ Resend: class { emails = { send: async (m: unknown) => { sent.push(m); return { data: { id: "mail-1" }, error: null }; } }; } }));
vi.mock("@/lib/emailLog", () => ({ logEmail: async () => {} }));
vi.mock("@/lib/changeLog", () => ({ logChange: async () => {}, diffForLog: () => [] }));
vi.mock("@/lib/rfq/sheet", () => ({ buildReplySheet: async () => Buffer.from("sheet") }));
vi.mock("@/lib/pdf/htmlToPdf", () => ({ htmlToPdf: async () => Buffer.from("pdf") }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-10-23" }));

const { sendToSupplier, saveResponses, awardLine } = await import("./server");

beforeAll(() => {
  process.env.RFQ_LINK_SECRET = "test-secret-for-rfq";
  process.env.RESEND_API_KEY = "re_test";
});

const events = () => current.tables.domain_event ?? [];
const names = () => events().map((e) => e.name);

const tenant = { id: "t1", slug: "acme", name: "Acme", custom_domain: null, is_demo: false, config: {}, company_info: { email: "buy@acme.test" } } as never;
const rfq = { id: "r1", ref: "RFQ-0001", title: "Pumps", status: "sent", respond_by: "2026-11-30", required_by: null, delivery_terms: null, notes_to_supplier: null, buyer_id: null, requested_by: null } as never;
const lines = [{ id: "l1", sl_no: "1", description: "Pump", spec: null, uom: "ea", qty: 2, required_by: null, status: "open" }] as never;
const rs = (over: Row = {}) => ({ id: "s1", rfq_id: "r1", supplier_id: "sup1", status: "pending", email_to: "sales@sup.test", contact_name: null, token_nonce: "n1", reminder_count: 0, currency: null, suppliers: { id: "sup1", name: "Sup", email: "sales@sup.test", ref: null, phone: null }, ...over }) as never;

beforeEach(() => {
  sent.length = 0;
  current = fakeDb({
    rfqs: [{ id: "r1", tenant_id: "t1", status: "sent" }],
    rfq_suppliers: [{ id: "s1", tenant_id: "t1", rfq_id: "r1", status: "sent" }],
    rfq_lines: [{ id: "l1", tenant_id: "t1", rfq_id: "r1", sl_no: "1", status: "open", product_id: null }],
    rfq_responses: [{ id: "x1", tenant_id: "t1", rfq_supplier_id: "s1", rfq_line_id: "l1", status: "quoted", unit_price: 10, fx_rate: null, currency: "INR" }],
  });
});

describe("rfq.sent", () => {
  const send = (kind: "request" | "reminder" | "message") => sendToSupplier(current.client, {
    tenant, bundle: { rfq, lines, suppliers: [], responses: [], messages: [] } as never, rs: rs(), kind, message: "hello", actor: { id: "u1", email: "u@x.test" },
  });

  it("fires once per supplier when the request goes out, tenant-scoped, with ids only", async () => {
    const r = await send("request");
    expect(r.ok).toBe(true);
    expect(names()).toEqual(["rfq.sent"]);
    expect(events()[0]).toMatchObject({ tenant_id: "t1", object_type: "rfq", object_id: "r1" });
    expect(events()[0].payload).toEqual({ ref: "RFQ-0001", rfq_supplier_id: "s1", supplier_id: "sup1", redirected: false });
    expect(JSON.stringify(events()[0])).not.toMatch(/sup\.test|buy@acme/);
    await send("request");
    expect(names()).toEqual(["rfq.sent"]);
  });

  it("a reminder or a free message is not an rfq.sent", async () => {
    await send("reminder");
    await send("message");
    expect(names()).toEqual([]);
  });
});

describe("rfq.replied", () => {
  const row = { rfq_line_id: "l1", status: "quoted", unit_price: 12, currency: null, lead_time_days: null, moq: null, offered_description: null, valid_until: null, note: null } as never;

  it("fires on a supplier's first answer, not on an edit of it", async () => {
    await saveResponses(current.client, { tenantId: "t1", rfqId: "r1", rs: { id: "s1", status: "sent", currency: null }, rows: [row], source: "link" });
    expect(names()).toEqual(["rfq.replied"]);
    expect(events()[0]).toMatchObject({ tenant_id: "t1", object_id: "r1" });
    expect(events()[0].payload).toEqual({ rfq_supplier_id: "s1", source: "link", declined: false, lines: 1 });
    await saveResponses(current.client, { tenantId: "t1", rfqId: "r1", rs: { id: "s1", status: "replied", currency: null }, rows: [row], source: "buyer" });
    await saveResponses(current.client, { tenantId: "t1", rfqId: "r1", rs: { id: "s1", status: "sent", currency: null }, rows: [row], source: "link" });
    expect(names()).toEqual(["rfq.replied"]);
  });

  it("a decline is a reply too, flagged declined", async () => {
    await saveResponses(current.client, { tenantId: "t1", rfqId: "r1", rs: { id: "s1", status: "sent", currency: null }, rows: [], source: "link", declined: true });
    expect(events()[0].payload).toMatchObject({ declined: true, lines: 0 });
  });

  it("saving nothing is not a reply", async () => {
    await saveResponses(current.client, { tenantId: "t1", rfqId: "r1", rs: { id: "s1", status: "sent", currency: null }, rows: [], source: "link" });
    expect(names()).toEqual([]);
  });
});

describe("rfq.awarded", () => {
  const ctx = { tenantId: "t1", userId: "u1", email: "u@x.test" };
  const award = (responseId: string | null) => awardLine(current.client, ctx, { rfq: { id: "r1", ref: "RFQ-0001" } as never, lineId: "l1", responseId });

  beforeEach(() => {
    current.tables.rfq_responses[0].rfq_suppliers = { id: "s1", supplier_id: "sup1", suppliers: { name: "Sup" } };
  });

  it("fires once for an awarded line, with ids and the cost, tenant-scoped; re-awarding the same answer adds nothing", async () => {
    const r = await award("x1");
    expect(r.status).toBe("awarded");
    await award("x1");
    expect(names()).toEqual(["rfq.awarded"]);
    expect(events()[0]).toMatchObject({ tenant_id: "t1", object_type: "rfq", object_id: "r1" });
    expect(events()[0].payload).toEqual({ ref: "RFQ-0001", line_id: "l1", response_id: "x1", supplier_id: "sup1", unit_cost: 10 });
  });

  it("marking a line no-award is not an award", async () => {
    await award(null);
    expect(names()).toEqual([]);
  });

  it("an answer from another tenant's RFQ cannot be awarded and emits nothing", async () => {
    current.tables.rfq_suppliers[0].tenant_id = "t2";
    current.tables.rfq_responses[0].tenant_id = "t2";
    await expect(award("x1")).rejects.toMatchObject({ status: 404 });
    expect(names()).toEqual([]);
  });
});
