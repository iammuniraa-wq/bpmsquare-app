import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => (v ? `enc(${v})` : v), decrypt: (v: string | null) => (v?.startsWith("enc(") ? v.slice(4, -1) : v) }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u) }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {} }));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: async () => ({ data: null, error: null }) }));

import { cleanOutbound, cleanEntities, saveConnection, SaveError } from "./save";
import { fakeAdmin, seedMiddleware, T1, type Row } from "@/lib/middleware/testHarness";

// The fake has no upsert; the connection row is replaced in place.
function db() {
  const d = fakeAdmin(seedMiddleware());
  const real = d.client as unknown as { from: (t: string) => Record<string, unknown> };
  const from = real.from.bind(real);
  real.from = (t: string) => {
    const q = from(t);
    if (t === "tenant_connectors") {
      q.upsert = (row: Row) => { Object.assign(d.tables.tenant_connectors[0], row); return Promise.resolve({ error: null }); };
    }
    return q;
  };
  return d;
}
const body = (config: Record<string, unknown>, secrets?: Record<string, string>) => ({ config: { product: "dataverse", auth_mode: "client_secret", environment_url: "https://org.crm.dynamics.com", directory_id: "contoso.com", client_id: "00000000-0000-0000-0000-000000000000", ...config }, secrets }) as never;

describe("outbound maps are checked on save", () => {
  it("accepts offered placeholders", () => {
    expect(cleanOutbound({ quote: { field_map: { description: "{ref} · {description}" } } })).toEqual({ quote: { field_map: { description: "{ref} · {description}" } } });
  });
  it("rejects an unknown placeholder and a bad field name, naming it", () => {
    expect(() => cleanOutbound({ quote: { field_map: { description: "{nope}" } } })).toThrow(/Quote mapping: description: Unknown placeholder/);
    expect(() => cleanOutbound({ quote_line: { field_map: { "bad field": "{qty}" } } })).toThrow(SaveError);
    expect(() => cleanOutbound({ quote_line: { field_map: { uomid: "{uom}" } } })).toThrow(/unit of measure/);
  });
  it("keeps task and bill-of-materials targets, drops junk", () => {
    expect(cleanOutbound({ project: { tasks: { entity_set: "ProjectTasks", link_field: "ProjectID" }, bom: { entity_set: "bad set!" } } })).toEqual({ project: { tasks: { entity_set: "ProjectTasks", link_field: "ProjectID" } } });
  });
  it("null or nothing means no custom maps", () => {
    expect(cleanOutbound(null)).toBeUndefined();
    expect(cleanOutbound({})).toBeUndefined();
  });
});

describe("per-entity schedule survives a save that does not know about it", () => {
  it("keeps the stored schedule when the incoming entity has none", () => {
    const prev = { customers: { enabled: true, entity_set: "accounts", id_field: "accountid", field_map: {}, schedule: "hourly" as const } };
    const out = cleanEntities({ customers: { enabled: true, entity_set: "accounts", id_field: "accountid", field_map: { name: "name" } } }, prev);
    expect(out.customers?.schedule).toBe("hourly");
    expect(cleanEntities({ customers: { enabled: true, entity_set: "accounts", id_field: "accountid", field_map: {}, schedule: "daily" } }, prev).customers?.schedule).toBe("daily");
    expect(cleanEntities({ customers: { enabled: true, entity_set: "accounts", id_field: "accountid", field_map: {} } }).customers?.schedule).toBeUndefined();
  });
});

describe("saving a connection", () => {
  it("a setting the sender did not mention is kept", async () => {
    const d = db();
    const s1 = await saveConnection(d.client, T1, "u-1", body({ secret_expires_on: "2027-04-19" }));
    expect(s1.config?.secret_expires_on).toBe("2027-04-19");
    expect(s1.config?.price_list_id).toBe("pl-0001"); // not mentioned: kept as stored
  });

  it("picks must be GUIDs from the pick-list, dates must be dates", async () => {
    const d = db();
    await expect(saveConnection(d.client, T1, "u-1", body({ price_list_id: "Standard" }))).rejects.toThrow(/Choose the price list from the list/);
    await expect(saveConnection(d.client, T1, "u-1", body({ secret_expires_on: "soon" }))).rejects.toThrow(/date/);
    const ok = await saveConnection(d.client, T1, "u-1", body({ price_list_id: "0f8fad5b-d9cb-469f-a165-70867728950e", currency_id: "1f8fad5b-d9cb-469f-a165-70867728950e" }));
    expect(ok.config?.price_list_id).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    const kept = await saveConnection(d.client, T1, "u-1", body({}));
    expect(kept.config?.price_list_id).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    const cleared = await saveConnection(d.client, T1, "u-1", body({ price_list_id: null }));
    expect(cleared.config?.price_list_id).toBeUndefined();
    expect(cleared.config?.currency_id).toBe("1f8fad5b-d9cb-469f-a165-70867728950e");
  });

  it("outbound: null is Reset to standard; left out keeps the custom maps", async () => {
    const d = db();
    await saveConnection(d.client, T1, "u-1", body({ outbound: { quote: { field_map: { description: "{ref}" } } } }));
    expect((await saveConnection(d.client, T1, "u-1", body({}))).config?.outbound?.quote?.field_map).toEqual({ description: "{ref}" });
    expect((await saveConnection(d.client, T1, "u-1", body({ outbound: null }))).config?.outbound).toBeUndefined();
  });

  it("secrets are write-only: stored sealed, never in the answer, blank means unchanged", async () => {
    const d = db();
    const state = await saveConnection(d.client, T1, "u-1", body({}, { client_secret: "s3cr3t-value" }));
    expect(JSON.stringify(state)).not.toContain("s3cr3t-value");
    expect(state.secrets.client_secret).toBe(true);
    expect((d.tables.tenant_connectors[0].credentials as Record<string, string>).client_secret).toBe("enc(s3cr3t-value)");
    await saveConnection(d.client, T1, "u-1", body({}, { client_secret: "   " }));
    expect((d.tables.tenant_connectors[0].credentials as Record<string, string>).client_secret).toBe("enc(s3cr3t-value)");
  });
});
