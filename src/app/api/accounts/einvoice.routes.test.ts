import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);

let db: ReturnType<typeof fakeDb>;
let client: SupabaseClient;
const logged: { objectType: string; changes?: { field: string; from: unknown; to: unknown; redacted?: boolean }[] }[] = [];

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: client, tenantId: "t1", userId: "u1", role: "admin" }),
  createAdminSupabase: () => client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({ getTenant: async () => ({ features: {}, config: {} }) }));
vi.mock("@/lib/coverage/resolve", () => ({ applyAutoOwnership: async () => null }));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: (typeof logged)[number]) => { logged.push(e); } };
});

const idRoute = await import("./[id]/route");
const listRoute = await import("./route");
const { decrypt } = await import("@/lib/encryption");

const account = (over: Row = {}): Row => ({ id: "a1", tenant_id: "t1", name: "Buyer Co", type: "end_customer", created_at: "2026-01-01", ...over });
function seed(features: Record<string, boolean>, accounts: Row[] = [account()]) {
  db = fakeDb({ tenants: [{ id: "t1", features, config: {} }], accounts });
  client = db.client;
}
const rows = async () => ((await db.client.from("accounts").select("*")) as unknown as { data: Row[] }).data;
const req = (body: unknown, method = "PATCH") => new Request("http://x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never;
const patch = (body: Row) => idRoute.PATCH(req(body), { params: Promise.resolve({ id: "a1" }) });

beforeEach(() => { logged.length = 0; });

describe("buyer fields on an account", () => {
  it("are saved for a workspace with e-invoicing, cleaned; the individual's ID is stored encrypted and logged as redacted", async () => {
    seed({ accounts: true, einvoicing_ksa: true });
    const res = await patch({ vat_number: " 3101 2239 3500 003 ", crn: "1010000000", name_ar: "شركة", buyer_type: "individual", buyer_id_scheme: "IQA", buyer_id_number: "2123456789", address_building: "1234", address_district: "Olaya" });
    expect(res.status).toBe(200);
    const row = (await rows())[0];
    expect(row).toMatchObject({ vat_number: "310122393500003", crn: "1010000000", name_ar: "شركة", buyer_type: "individual", buyer_id_scheme: "IQA", address_building: "1234", address_district: "Olaya" });
    expect(row.buyer_id_number).not.toBe("2123456789");
    expect(String(row.buyer_id_number).startsWith("enc:v1:")).toBe(true);
    expect(decrypt(row.buyer_id_number as string)).toBe("2123456789");
    // the response a screen gets is decrypted
    expect((await res.json()).buyer_id_number).toBe("2123456789");
    // the change log never holds the personal ID
    const entry = logged[0].changes!.find((c) => c.field === "buyer_id_number")!;
    expect(entry).toMatchObject({ redacted: true, to: "[redacted]" });
    expect(JSON.stringify(logged)).not.toContain("2123456789");
  });

  it("are dropped silently for a workspace without e-invoicing", async () => {
    seed({ accounts: true });
    const res = await patch({ vat_number: "310122393500003", buyer_id_number: "2123456789", name: "Renamed" });
    expect(res.status).toBe(200);
    const row = (await rows())[0];
    expect(row.name).toBe("Renamed");
    for (const k of ["vat_number", "buyer_id_number", "crn", "name_ar", "buyer_type"]) expect(row[k], k).toBeUndefined();
  });

  it("are dropped when the workspace has switched the scheme off", async () => {
    db = fakeDb({ tenants: [{ id: "t1", features: { einvoicing_ksa: true }, config: { einvoicing: { scheme: null } } }], accounts: [account()] });
    client = db.client;
    await patch({ vat_number: "310122393500003" });
    expect((await rows())[0].vat_number).toBeUndefined();
  });

  it("only a changed field is logged, and a blank clears it", async () => {
    seed({ accounts: true, einvoicing_ksa: true }, [account({ vat_number: "310122393500003", crn: "1010000000" })]);
    await patch({ vat_number: "310122393500003", crn: "" });
    expect(logged[0].changes!.map((c) => c.field)).toEqual(["crn"]);
    expect((await rows())[0].crn).toBeNull();
  });

  it("a new account takes them at creation, an ordinary one does not", async () => {
    seed({ accounts: true, einvoicing_ksa: true }, []);
    expect((await listRoute.POST(req({ name: "New Co", type: "end_customer", vat_number: "310122393500003", buyer_id_number: "1" }, "POST"))).status).toBe(201);
    expect((await rows())[0]).toMatchObject({ vat_number: "310122393500003" });
    seed({ accounts: true }, []);
    expect((await listRoute.POST(req({ name: "New Co", type: "end_customer", vat_number: "310122393500003" }, "POST"))).status).toBe(201);
    expect((await rows())[0].vat_number).toBeUndefined();
  });
});
