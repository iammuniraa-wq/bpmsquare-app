import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

let current: ReturnType<typeof fakeDb>;
let features: Record<string, boolean> = { sales_orders: true };
const logged: { objectType: string; objectId: string; tenantId: string; changes?: { field: string; from?: unknown; to: unknown }[] }[] = [];
const storage = {
  uploads: [] as { path: string; type?: string }[],
  removed: [] as string[],
  upload: vi.fn(async (path: string, _b: Buffer, opts: { contentType?: string }) => { storage.uploads.push({ path, type: opts.contentType }); return { error: null }; }),
  remove: vi.fn(async (paths: string[]) => { storage.removed.push(...paths); return { error: null }; }),
  createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}` }, error: null })),
};

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: current.client, tenantId: "t1", userId: "u1", role: "member" }),
  createAdminSupabase: () => ({
    from: (t: string) => current.client.from(t),
    storage: { from: () => storage },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "rep@x.test", user_metadata: { full_name: "Rita Rep" } } } }) } },
  }),
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
const one = await import("./[aid]/route");

const order = (over: Row = {}): Row => ({ id: "so1", tenant_id: "t1", ref: "SO-0001", origin: "bpmsquare", status: "draft", account_id: "a1", ...over });
const att = (over: Row = {}): Row => ({ id: "at1", tenant_id: "t1", order_id: "so1", kind: "customer_po", type: "file", name: "po.pdf", ref: "t1/so1/abc.pdf", size_bytes: 10, created_by: "u1", created_at: "2026-06-01", ...over });
const erpLink = (): Row => ({ id: "l1", tenant_id: "t1", object_type: "sales_orders", object_id: "so1", external_id: "X" });

function seed(o: Row = order(), attachments: Row[] = [], extra: Record<string, Row[]> = {}) {
  current = fakeDb({ sales_orders: [o], sales_order_attachments: attachments, connector_links: [], ...extra }, { copyReads: true });
}
const ctx = { params: Promise.resolve({ id: "so1" }) };
const one_ctx = (aid: string) => ({ params: Promise.resolve({ id: "so1", aid }) });
const list = () => collection.GET(new Request("http://x") as never, ctx);
const link = (body: unknown) => collection.POST(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never, ctx);
const upload = (name: string, size = 100, extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(size)], name, { type: "application/pdf" }));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return collection.POST(new Request("http://x", { method: "POST", body: form }) as never, ctx);
};
const rows = () => current.tables.sales_order_attachments;

beforeEach(() => {
  logged.length = 0;
  storage.uploads.length = 0;
  storage.removed.length = 0;
  features = { sales_orders: true };
  seed();
});

describe("POST /api/sales-orders/[id]/attachments -- links", () => {
  it("adds an https link, typed, with who added it, and writes history", async () => {
    const res = await link({ type: "link", url: "https://drive.example.com/folder/po-7781", name: "PO folder", kind: "customer_po" });
    expect(res.status).toBe(201);
    expect(rows()[0]).toMatchObject({ tenant_id: "t1", order_id: "so1", type: "link", kind: "customer_po", name: "PO folder", ref: "https://drive.example.com/folder/po-7781", created_by: "u1" });
    expect(logged[0].changes?.[0]).toMatchObject({ field: "Link added", to: "PO folder (link)" });
  });

  it("names a link after its host when no name is given, and an unknown kind becomes other", async () => {
    await link({ type: "link", url: "https://files.example.com/x.pdf", kind: "hax" });
    expect(rows()[0]).toMatchObject({ name: "files.example.com", kind: "other" });
  });

  it.each([
    ["http", "http://example.com/x"],
    ["javascript:", "javascript:alert(1)"],
    ["credentials in the address", "https://u:p@example.com/x"],
    ["a non-address", "hello"],
    ["nothing", ""],
  ])("refuses a link with %s", async (_n, url) => {
    const res = await link({ type: "link", url });
    expect(res.status).toBe(400);
    expect(rows()).toHaveLength(0);
  });
});

describe("POST /api/sales-orders/[id]/attachments -- files", () => {
  it("stores a file in the tenant's own folder of the private bucket and records it", async () => {
    const res = await upload("PO-7781.pdf", 500, { kind: "customer_po" });
    expect(res.status).toBe(201);
    expect(storage.uploads).toHaveLength(1);
    expect(storage.uploads[0].path).toMatch(/^t1\/so1\/[0-9a-f-]{36}\.pdf$/);
    expect(rows()[0]).toMatchObject({ type: "file", kind: "customer_po", name: "PO-7781.pdf", size_bytes: 500, ref: storage.uploads[0].path });
    const j = await res.json();
    expect(j).toMatchObject({ type: "file", ref: "", href: `/api/sales-orders/so1/attachments/${rows()[0].id}` });
  });

  it("refuses a file type that isn't accepted, an empty file and an oversized one; nothing is stored", async () => {
    expect((await upload("logo.svg")).status).toBe(400);
    expect((await upload("empty.pdf", 0)).status).toBe(400);
    expect((await upload("huge.pdf", 16 * 1024 * 1024)).status).toBe(400);
    expect(storage.uploads).toHaveLength(0);
    expect(rows()).toHaveLength(0);
  });

  it("the path comes from the validated extension, never from the client's file name", async () => {
    await upload("../../etc/passwd.pdf");
    expect(storage.uploads[0].path).toMatch(/^t1\/so1\/[0-9a-f-]{36}\.pdf$/);
  });
});

describe("attachments follow the edit rule", () => {
  it("stay open on a confirmed order made here, closed on a cancelled one and on one made by the ERP", async () => {
    seed(order({ status: "confirmed" }));
    expect((await link({ type: "link", url: "https://x.example.com/a" })).status).toBe(201);
    seed(order({ status: "cancelled" }));
    const res = await link({ type: "link", url: "https://x.example.com/a" });
    expect(res.status).toBe(409);
    expect((await res.json()).lock_reason).toMatch(/Cancelled/);
    seed(order({ origin: "erp", status: "confirmed" }));
    expect((await upload("po.pdf")).status).toBe(409);
    expect(rows()).toHaveLength(0);
    expect(storage.uploads).toHaveLength(0);
  });

  it("an ERP-accepted draft still takes files and links", async () => {
    seed(order(), [], { connector_links: [erpLink()] });
    expect((await link({ type: "link", url: "https://x.example.com/a" })).status).toBe(201);
  });
});

describe("tenant isolation", () => {
  it("another tenant's order is a 404 for list, add and remove", async () => {
    seed(order({ tenant_id: "t2" }), [att({ tenant_id: "t2" })]);
    expect((await list()).status).toBe(404);
    expect((await link({ type: "link", url: "https://x.example.com/a" })).status).toBe(404);
    expect((await one.DELETE(new Request("http://x", { method: "DELETE" }) as never, one_ctx("at1"))).status).toBe(404);
    expect(rows()).toHaveLength(1);
    expect(storage.removed).toEqual([]);
  });

  it("the list shows only this order's own attachments, with the person's name", async () => {
    seed(order(), [att(), att({ id: "at2", order_id: "other" }), att({ id: "at3", tenant_id: "t2" })]);
    const j = await (await list()).json();
    expect(j.map((a: Row) => a.id)).toEqual(["at1"]);
    expect(j[0]).toMatchObject({ created_by_name: "Rita Rep", href: "/api/sales-orders/so1/attachments/at1", ref: "" });
  });

  it("an attachment of another order or tenant can't be reached through this order's URL", async () => {
    seed(order(), [att({ id: "at2", order_id: "other" }), att({ id: "at3", tenant_id: "t2" })]);
    for (const aid of ["at2", "at3"]) {
      expect((await one.GET(new Request("http://x") as never, one_ctx(aid))).status).toBe(404);
      expect((await one.DELETE(new Request("http://x", { method: "DELETE" }) as never, one_ctx(aid))).status).toBe(404);
    }
    expect(rows()).toHaveLength(2);
  });
});

describe("GET / DELETE /api/sales-orders/[id]/attachments/[aid]", () => {
  it("a file downloads through a short-lived signed link; a link answers its address", async () => {
    seed(order(), [att(), att({ id: "at2", type: "link", ref: "https://x.example.com/a", name: "A" })]);
    const f = await one.GET(new Request("http://x") as never, one_ctx("at1"));
    expect(f.status).toBe(302);
    expect(f.headers.get("location")).toBe("https://signed.example/t1/so1/abc.pdf");
    expect(storage.createSignedUrl).toHaveBeenCalledWith("t1/so1/abc.pdf", 300, { download: "po.pdf" });
    expect(await (await one.GET(new Request("http://x") as never, one_ctx("at2"))).json()).toEqual({ url: "https://x.example.com/a" });
  });

  it("never signs a stored path outside this order's own folder", async () => {
    seed(order(), [att({ ref: "t2/so9/stolen.pdf" })]);
    expect((await one.GET(new Request("http://x") as never, one_ctx("at1"))).status).toBe(404);
    expect(storage.createSignedUrl).not.toHaveBeenCalledWith("t2/so9/stolen.pdf", expect.anything(), expect.anything());
  });

  it("removes the row and the stored file, with history; and won't on a cancelled order", async () => {
    seed(order(), [att()]);
    expect((await one.DELETE(new Request("http://x", { method: "DELETE" }) as never, one_ctx("at1"))).status).toBe(200);
    expect(rows()).toHaveLength(0);
    expect(storage.removed).toEqual(["t1/so1/abc.pdf"]);
    expect(logged[0].changes?.[0]).toMatchObject({ field: "File removed", from: "po.pdf" });
    seed(order({ status: "cancelled" }), [att()]);
    expect((await one.DELETE(new Request("http://x", { method: "DELETE" }) as never, one_ctx("at1"))).status).toBe(409);
    expect(rows()).toHaveLength(1);
  });
});
