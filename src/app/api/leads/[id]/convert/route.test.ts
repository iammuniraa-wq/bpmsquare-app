import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";

let current: ReturnType<typeof fakeDb>;
let client: SupabaseClient;

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: client, tenantId: "t1", userId: "u1", role: "admin" }),
  createAdminSupabase: () => client,
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async () => true,
  getTenant: async () => ({ config: {} }),
}));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async () => {} };
});

const route = await import("./route");

const CONTACT = "11111111-1111-4111-8111-111111111111";
const lead = (over: Row = {}): Row => ({ id: "l1", tenant_id: "t1", title: "Pump upgrade", account_id: "a1", source: "form", source_campaign_id: null, status: "new", contact_id: CONTACT, ...over });
const contact = (over: Row = {}): Row => ({ id: CONTACT, tenant_id: "t1", account_id: "a1", ...over });

function seed(l: Row = lead(), contacts: Row[] = [contact()]) {
  current = fakeDb({ leads: [l], contacts, opportunities: [] }, { copyReads: true });
  client = current.client;
}
const post = () => route.POST(new Request("http://x", { method: "POST" }) as never, { params: Promise.resolve({ id: "l1" }) });

beforeEach(() => seed());

describe("POST /api/leads/[id]/convert -- the deal's contact", () => {
  it("sets the new deal's contact from the lead when the contact is this tenant's and the lead's account's", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(current.tables.opportunities[0]).toMatchObject({ tenant_id: "t1", account_id: "a1", lead_id: "l1", contact_id: CONTACT });
    expect(current.tables.leads[0].status).toBe("converted");
  });

  it("emits opportunity.created carrying that contact, once", async () => {
    await post();
    const created = (current.tables.domain_event ?? []).filter((e) => e.name === "opportunity.created");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ tenant_id: "t1", contact_id: CONTACT, lead_id: "l1" });
  });

  it("leaves the contact empty for a lead that has none", async () => {
    seed(lead({ contact_id: null }));
    await post();
    expect(current.tables.opportunities[0].contact_id).toBeNull();
  });

  it("does not use a contact from another tenant", async () => {
    seed(lead(), [contact({ tenant_id: "t2" })]);
    expect((await post()).status).toBe(201);
    expect(current.tables.opportunities[0].contact_id).toBeNull();
  });

  it("does not use a contact of a different account than the lead's", async () => {
    seed(lead(), [contact({ account_id: "a2" })]);
    expect((await post()).status).toBe(201);
    expect(current.tables.opportunities[0].contact_id).toBeNull();
  });

  it("a second conversion returns the existing deal and adds nothing", async () => {
    const first = await (await post()).json();
    const again = await (await post()).json();
    expect(again).toMatchObject({ id: first.id, already: true });
    expect(current.tables.opportunities).toHaveLength(1);
  });

  it("another tenant's lead is not found", async () => {
    seed(lead({ tenant_id: "t2" }));
    expect((await post()).status).toBe(404);
    expect(current.tables.opportunities).toHaveLength(0);
  });

  it("while migration 0140 (leads.contact_id) is pending the lead still converts, without a contact", async () => {
    seed();
    const real = current.client;
    client = {
      from: (table: string) => {
        const q = real.from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
        if (table !== "leads") return q;
        return new Proxy(q, {
          get: (t, p) => p === "select"
            ? (cols: string) => cols.includes("contact_id")
              ? { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "42703", message: "column leads.contact_id does not exist" } }) }) }) }
              : { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: (({ contact_id: _c, ...rest }) => rest)(current.tables.leads[0] as { contact_id?: string }), error: null }) }) }) }
            : t[p as string],
        });
      },
    } as unknown as SupabaseClient;
    const res = await post();
    expect(res.status).toBe(201);
    expect(current.tables.opportunities[0].contact_id).toBeNull();
  });
});
