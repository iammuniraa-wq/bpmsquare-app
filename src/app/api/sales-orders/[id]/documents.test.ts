import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

// PDF, public PDF, email and share link of one sales order.

let current: ReturnType<typeof fakeDb>;
let features: Record<string, boolean> = { sales_orders: true };
let tenantRow: Row = { id: "t1", slug: "acme", name: "Acme Trading", is_demo: false, config: { currency: "QAR" }, company_info: { email: "sales@acme.test" } };
const logged: { objectType: string; objectId: string; changes?: { field: string; to: unknown }[] }[] = [];
const sent: { to: string[]; subject: string; attachments: { filename: string }[] }[] = [];
const rendered: { url: string; cookie?: string }[] = [];

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: current.client, tenantId: "t1", userId: "u1", role: "admin" }),
  createAdminSupabase: () => current.client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => features[key] === true,
  getTenant: async () => tenantRow,
}));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); } };
});
vi.mock("@/lib/pdf/printUrlToPdf", () => ({
  printUrlToPdf: async (url: string, opts: { cookie?: string } = {}) => { rendered.push({ url, cookie: opts.cookie }); return { ok: true, pdf: Buffer.from("%PDF-test") }; },
}));
vi.mock("resend", () => ({
  Resend: class { emails = { send: async (m: (typeof sent)[number]) => { sent.push(m); return { error: null }; } }; },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "acme.example.com", "x-forwarded-proto": "https" }) }));
vi.mock("@/lib/encryption", () => ({ decryptAccount: (a: unknown) => a, decryptContact: (c: unknown) => c }));

const pdf = await import("./pdf/route");
const pdfPublic = await import("./pdf-public/[token]/route");
const email = await import("./email/route");
const share = await import("./share/route");
const { signOrderPublicToken } = await import("@/lib/salesOrderPublicLink");

const order = (over: Row = {}): Row => ({ id: "so1", tenant_id: "t1", ref: "SO-0001", type_id: null, origin: "bpmsquare", status: "confirmed", account_id: "a1", contact_id: "c1", currency: "QAR", total: 1890, ...over });
function seed(o: Row = order(), extra: Record<string, Row[]> = {}) {
  current = fakeDb({
    sales_orders: [o], sales_order_lines: [], sales_order_types: [],
    accounts: [{ id: "a1", tenant_id: "t1", name: "Acme Customer", email: "accounts@cust.test", phone: "+974 5555 1111" }],
    contacts: [{ id: "c1", tenant_id: "t1", name: "Sam", email: "sam@cust.test", phone: "+974 5555 2222" }],
    tenants: [{ id: "t1", features }],
    activities: [], email_log: [],
    ...extra,
  }, { copyReads: true });
}
const ctx = { params: Promise.resolve({ id: "so1" }) };
const req = (body?: unknown, headers: Record<string, string> = {}) => new Request("http://acme.example.com/api/x", { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }) as never;

const prevKey = process.env.RESEND_API_KEY;
const prevSecret = process.env.QUOTE_PUBLIC_LINK_SECRET;
beforeEach(() => {
  logged.length = 0; sent.length = 0; rendered.length = 0;
  features = { sales_orders: true };
  tenantRow = { id: "t1", slug: "acme", name: "Acme Trading", is_demo: false, config: { currency: "QAR" }, company_info: { email: "sales@acme.test" } };
  process.env.RESEND_API_KEY = "re_test";
  process.env.QUOTE_PUBLIC_LINK_SECRET = "doc-test-secret";
  seed();
});
afterEach(() => {
  if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
  if (prevSecret === undefined) delete process.env.QUOTE_PUBLIC_LINK_SECRET; else process.env.QUOTE_PUBLIC_LINK_SECRET = prevSecret;
});

describe("GET /api/sales-orders/[id]/pdf", () => {
  it("prints the signed-in print page with the caller's session and names the file after the order", async () => {
    const res = await pdf.GET(new Request("http://acme.example.com/api/sales-orders/so1/pdf", { headers: { cookie: "sb=1" } }) as never, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("SO-0001.pdf");
    expect(rendered).toEqual([{ url: "http://acme.example.com/sales-orders/so1/print", cookie: "sb=1" }]);
  });

  it("renders nothing for another tenant's order or a workspace without the module", async () => {
    seed(order({ tenant_id: "t2" }));
    expect((await pdf.GET(new Request("http://x/api") as never, ctx)).status).toBe(404);
    seed();
    features = {};
    expect((await pdf.GET(new Request("http://x/api") as never, ctx)).status).toBe(403);
    expect(rendered).toHaveLength(0);
  });
});

describe("GET /api/sales-orders/[id]/pdf-public/[token]", () => {
  const call = (id: string, token: string) => pdfPublic.GET(new Request("http://acme.example.com/api/x") as never, { params: Promise.resolve({ id, token }) });

  it("prints the token-gated page without a session when the token is valid for that order", async () => {
    const token = signOrderPublicToken("so1")!;
    const res = await call("so1", token);
    expect(res.status).toBe(200);
    expect(rendered).toEqual([{ url: `http://acme.example.com/sales-orders/so1/print-public/${token}`, cookie: undefined }]);
  });

  it("refuses a token for another order, a tampered or expired one, and no secret", async () => {
    const token = signOrderPublicToken("so2")!;
    expect((await call("so1", token)).status).toBe(404);
    expect((await call("so1", "1.abc")).status).toBe(404);
    delete process.env.QUOTE_PUBLIC_LINK_SECRET;
    expect((await call("so1", token)).status).toBe(404);
    expect(rendered).toHaveLength(0);
  });

  it("a valid token still shows nothing when the workspace no longer has the module, or the order is gone", async () => {
    const token = signOrderPublicToken("so1")!;
    seed(order(), { tenants: [{ id: "t1", features: { sales_orders: false } }] });
    expect((await call("so1", token)).status).toBe(404);
    seed(order({ id: "other" }));
    expect((await call("so1", token)).status).toBe(404);
  });
});

describe("POST /api/sales-orders/[id]/email", () => {
  it("sends the PDF to the contact, logs it as kind order, stamps sent_at, adds an activity and emits order.sent", async () => {
    const res = await email.POST(req({}), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sentTo: "sam@cust.test", redirected: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ["sam@cust.test"], attachments: [{ filename: "SO-0001.pdf" }] });
    expect(sent[0].subject).toBe("Sales order SO-0001 from Acme Trading");
    expect(current.tables.email_log[0]).toMatchObject({ tenant_id: "t1", kind: "order", status: "sent", related_object_type: "sales_orders", related_object_id: "so1" });
    expect(current.tables.sales_orders[0].sent_at).toBeTruthy();
    expect(current.tables.activities[0]).toMatchObject({ tenant_id: "t1", account_id: "a1" });
    expect((current.tables.domain_event ?? []).map((e) => e.name)).toEqual(["order.sent"]);
  });

  it("a demo workspace is redirected: the customer never receives it", async () => {
    tenantRow = { ...tenantRow, is_demo: true, config: { currency: "QAR", email_output: { mode: "redirect", redirect_to: "owner@bpmsquare.test" } } };
    const j = await (await email.POST(req({}), ctx)).json();
    expect(j).toMatchObject({ redirected: true, intended: "sam@cust.test" });
    expect(sent[0].to).not.toContain("sam@cust.test");
  });

  it("falls back to the account's address, takes an override, and validates it", async () => {
    seed(order({ contact_id: null }));
    expect((await (await email.POST(req({}), ctx)).json()).intended).toBe("accounts@cust.test");
    expect((await (await email.POST(req({ email: "ap@other.test" }), ctx)).json()).intended).toBe("ap@other.test");
    expect((await email.POST(req({ email: "nonsense" }), ctx)).status).toBe(400);
    seed(order({ contact_id: null }), { accounts: [{ id: "a1", tenant_id: "t1", name: "No email" }] });
    expect((await email.POST(req({}), ctx)).status).toBe(400);
  });

  it("does not send a cancelled order, another tenant's order, or without the module", async () => {
    seed(order({ status: "cancelled" }));
    expect((await email.POST(req({}), ctx)).status).toBe(409);
    seed(order({ tenant_id: "t2" }));
    expect((await email.POST(req({}), ctx)).status).toBe(404);
    seed();
    features = {};
    expect((await email.POST(req({}), ctx)).status).toBe(403);
    expect(sent).toHaveLength(0);
  });
});

describe("GET /api/sales-orders/[id]/share", () => {
  it("returns a signed public link on this workspace's host and a wa.me link with the message", async () => {
    const j = await (await share.GET(new Request("http://acme.example.com/x") as never, ctx)).json();
    expect(j.pdf_url).toBe("/api/sales-orders/so1/pdf");
    expect(j.public_pdf_url).toMatch(/^https:\/\/acme\.example\.com\/api\/sales-orders\/so1\/pdf-public\/\d+\./);
    expect(j.public_print_url).toMatch(/^https:\/\/acme\.example\.com\/sales-orders\/so1\/print-public\//);
    expect(j.whatsapp_url).toMatch(/^https:\/\/wa\.me\/97455552222\?text=/);
    expect(j.whatsapp_message).toContain("SO-0001");
    expect(j.whatsapp_message).toContain(j.public_pdf_url);
    expect(j.whatsapp_note).toMatch(/not connected/);
  });

  it("without the link secret there is no public link and the message asks for the PDF to be attached", async () => {
    delete process.env.QUOTE_PUBLIC_LINK_SECRET;
    const j = await (await share.GET(new Request("http://x") as never, ctx)).json();
    expect(j.public_pdf_url).toBeNull();
    expect(j.whatsapp_message).toContain("emailed the PDF");
  });

  it("no number on file means no whatsapp_url; another tenant's order is a 404", async () => {
    seed(order(), { contacts: [{ id: "c1", tenant_id: "t1", name: "Sam" }], accounts: [{ id: "a1", tenant_id: "t1", name: "A" }] });
    expect((await (await share.GET(new Request("http://x") as never, ctx)).json()).whatsapp_url).toBeNull();
    seed(order({ tenant_id: "t2" }));
    expect((await share.GET(new Request("http://x") as never, ctx)).status).toBe(404);
  });
});
