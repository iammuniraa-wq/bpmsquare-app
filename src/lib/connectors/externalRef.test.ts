import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { externalRefsFor, externalRefsForOne, buildDeepLink, systemLabel, OBJECT_TABLES } from "./externalRef";
import { fakeDb, seedConnector, TENANT } from "./d365/syncHarness";
import { tipTextProblems } from "@/lib/infoTip";
import { EXTERNAL_RECORD_TIP } from "./externalRefTips";

const GUID = "6c1f0a52-3b7e-4c1a-9d3e-0a1b2c3d4e5f";
const OTHER_TENANT = "99999999-9999-9999-9999-999999999999";

function link(over: Record<string, unknown> = {}) {
  return {
    tenant_id: TENANT, connector_id: "dynamics365", entity: "customers", object_type: "accounts", object_id: "acc-1",
    external_id: GUID, external_key: null, direction: "pull", created_at: "2026-10-21T10:00:00Z", ...over,
  };
}
function db(links: Record<string, unknown>[], extra: Record<string, Record<string, unknown>[]> = {}, product = "dataverse") {
  return fakeDb({ ...seedConnector({ product }), connector_links: links, ...extra }).client as unknown as SupabaseClient;
}

describe("externalRefsFor: what the line reads", () => {
  it("prefers the link's business number over the record's own name", async () => {
    const admin = db([link({ external_key: "ACC-1001" })], { accounts: [{ id: "acc-1", tenant_id: TENANT, name: "Contoso" }] });
    const r = await externalRefsForOne(admin, TENANT, "accounts", "acc-1");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ system: "Dynamics 365", readable: "ACC-1001", direction: "pull", title: GUID });
  });

  it("falls back to the account name, contact name, product name or sku, quote ref", async () => {
    const admin = db(
      [
        link(),
        link({ object_type: "contacts", object_id: "c-1", external_id: "11111111-1111-1111-1111-111111111111" }),
        link({ object_type: "products", object_id: "p-1", external_id: "22222222-2222-2222-2222-222222222222" }),
        link({ object_type: "products", object_id: "p-2", external_id: "33333333-3333-3333-3333-333333333333" }),
        link({ object_type: "standard_quotes", object_id: "q-1", external_id: "44444444-4444-4444-4444-444444444444", direction: "push" }),
      ],
      {
        accounts: [{ id: "acc-1", tenant_id: TENANT, name: "Contoso" }],
        contacts: [{ id: "c-1", tenant_id: TENANT, name: "Ada Lovelace" }],
        products: [{ id: "p-1", tenant_id: TENANT, name: "Mesh roll", sku: "MR-1" }, { id: "p-2", tenant_id: TENANT, name: "", sku: "GATE-9" }],
        standard_quotes: [{ id: "q-1", tenant_id: TENANT, ref: "SQ-0007" }],
      },
    );
    expect((await externalRefsForOne(admin, TENANT, "accounts", "acc-1"))[0].readable).toBe("Contoso");
    expect((await externalRefsForOne(admin, TENANT, "contacts", "c-1"))[0].readable).toBe("Ada Lovelace");
    const prods = await externalRefsFor(admin, TENANT, "products", ["p-1", "p-2"]);
    expect(prods["p-1"][0].readable).toBe("Mesh roll");
    expect(prods["p-2"][0].readable).toBe("GATE-9");
    const q = await externalRefsForOne(admin, TENANT, "standard_quotes", "q-1");
    expect(q[0]).toMatchObject({ readable: "SQ-0007", direction: "push" });
  });

  it("never shows a GUID as the label, even when the stored key is one or the name is missing", async () => {
    const admin = db([link({ external_key: GUID }), link({ object_id: "acc-2", external_id: "55555555-5555-5555-5555-555555555555" })], {
      accounts: [{ id: "acc-1", tenant_id: TENANT, name: "Contoso" }, { id: "acc-2", tenant_id: TENANT, name: "" }],
    });
    const m = await externalRefsFor(admin, TENANT, "accounts", ["acc-1", "acc-2"]);
    expect(m["acc-1"][0].readable).toBe("Contoso");
    expect(m["acc-2"][0].readable).toBe("Linked record");
    for (const refs of Object.values(m)) for (const x of refs) expect(x.readable).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(m["acc-1"][0].title).toBe(GUID);
  });
});

describe("externalRefsFor: tenant isolation and missing tables", () => {
  it("does not return another tenant's link or use another tenant's name", async () => {
    const admin = db(
      [link({ tenant_id: OTHER_TENANT, external_key: "OTHER-1" }), link({ object_id: "acc-9", external_id: "66666666-6666-6666-6666-666666666666" })],
      { accounts: [{ id: "acc-9", tenant_id: OTHER_TENANT, name: "Stranger Ltd" }] },
    );
    expect(await externalRefsForOne(admin, TENANT, "accounts", "acc-1")).toEqual([]);
    // the link is ours but the record named in it is not: the name is not borrowed
    expect((await externalRefsForOne(admin, TENANT, "accounts", "acc-9"))[0].readable).toBe("Linked record");
  });

  it("returns nothing when the connector tables are missing (42P01 / PGRST205) or the type is unknown", async () => {
    for (const code of ["42P01", "PGRST205"]) {
      const bad = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ in: () => ({ order: () => Promise.resolve({ data: null, error: { code, message: "missing" } }) }) }) }) }) }) } as unknown as SupabaseClient;
      expect(await externalRefsForOne(bad, TENANT, "accounts", "acc-1")).toEqual([]);
    }
    const throws = { from: () => { throw new Error("boom"); } } as unknown as SupabaseClient;
    expect(await externalRefsForOne(throws, TENANT, "accounts", "acc-1")).toEqual([]);
    expect(await externalRefsFor(db([link()]), TENANT, "cases", ["acc-1"])).toEqual({});
    expect(await externalRefsFor(db([link()]), TENANT, "accounts", [])).toEqual({});
  });
});

describe("deep link", () => {
  const cfg = (over: Record<string, unknown> = {}) => ({
    product: "dataverse" as const, auth_mode: "client_secret" as const, environment_url: "https://orgd0307406.crm17.dynamics.com", entities: {}, ...over,
  });

  it("builds the Dataverse record address for account, contact, product and quote", () => {
    expect(buildDeepLink(cfg(), "accounts", GUID)).toBe(`https://orgd0307406.crm17.dynamics.com/main.aspx?etn=account&id=${GUID}&pagetype=entityrecord`);
    expect(buildDeepLink(cfg(), "contacts", `{${GUID}}`)).toContain("etn=contact&id=" + GUID);
    expect(buildDeepLink(cfg(), "products", GUID)).toContain("etn=product");
    expect(buildDeepLink(cfg(), "standard_quotes", GUID)).toContain("etn=quote");
  });

  it("uses the configured push entity for a fence project", () => {
    expect(buildDeepLink(cfg({ entities: { fence_projects: { enabled: true, entity_set: "opportunities", id_field: "opportunityid", field_map: {} } } }), "fence_projects", GUID)).toContain("etn=opportunity&");
    expect(buildDeepLink(cfg({ entities: { fence_projects: { enabled: true, entity_set: "msdyn_projects", id_field: "x", field_map: {} } } }), "fence_projects", GUID)).toContain("etn=msdyn_project&");
    expect(buildDeepLink(cfg(), "fence_projects", GUID)).toBeNull();
  });

  it("is null for Finance and Operations, Business Central and ids that are not GUIDs", () => {
    expect(buildDeepLink(cfg({ product: "fo", environment_url: "https://x.operations.dynamics.com" }), "products", GUID)).toBeNull();
    expect(buildDeepLink(cfg({ product: "bc", environment_url: "Production" }), "accounts", GUID)).toBeNull();
    expect(buildDeepLink(cfg(), "accounts", "usmf|CUST-1")).toBeNull();
    expect(buildDeepLink(null, "accounts", GUID)).toBeNull();
    expect(buildDeepLink(cfg(), "cases", GUID)).toBeNull();
  });

  it("only links hosts the connector itself accepts", () => {
    for (const url of [
      "https://dynamics.com.evil.io", "http://org.crm.dynamics.com", "https://evil.example.com", "javascript:alert(1)", "not a url",
      "https://org.crm.dynamics.cn", "https://user:pw@org.crm.dynamics.com", "",
    ]) expect(buildDeepLink(cfg({ environment_url: url }), "accounts", GUID), url).toBeNull();
    expect(buildDeepLink(cfg({ environment_url: "https://org.crm4.dynamics.com/some/path?x=1" }), "accounts", GUID)).toMatch(/^https:\/\/org\.crm4\.dynamics\.com\/main\.aspx\?/);
  });

  it("reaches the result: a stored hostile environment URL yields a line without a link", async () => {
    const seed = seedConnector();
    (seed.tenant_connectors[0].config as Record<string, unknown>).environment_url = "https://evil.example.com";
    const admin = fakeDb({ ...seed, connector_links: [link({ external_key: "ACC-1" })] }).client as unknown as SupabaseClient;
    const r = await externalRefsForOne(admin, TENANT, "accounts", "acc-1");
    expect(r[0].deepLink).toBeNull();
    expect(r[0].readable).toBe("ACC-1");
  });

  it("is built from the tenant's own connector config", async () => {
    const r = await externalRefsForOne(db([link({ external_key: "ACC-1" })]), TENANT, "accounts", "acc-1");
    expect(r[0].deepLink).toBe(`https://org.crm.dynamics.com/main.aspx?etn=account&id=${GUID}&pagetype=entityrecord`);
  });
});

describe("object table map", () => {
  const TABLES = ["accounts", "contacts", "products", "suppliers", "inventory_items", "standard_quotes", "quotes", "opportunities", "estimates", "fence_projects", "rfqs", "purchase_orders", "invoices", "work_orders", "service_cases", "wfm_projects", "employees"];

  it("covers every object that carries a link, each with a label and name columns", () => {
    for (const t of TABLES) {
      expect(OBJECT_TABLES[t], t).toBeDefined();
      expect(OBJECT_TABLES[t].label.length).toBeGreaterThan(2);
      expect(OBJECT_TABLES[t].cols).toMatch(/^id[, ]/);
    }
  });

  it("reads a readable fallback name for every table", async () => {
    const recs: Record<string, Record<string, unknown>> = {
      suppliers: { name: "Acme Steel" }, inventory_items: { name: "", sku: "INV-5" }, estimates: { ref: null, name: "Roof estimate" },
      opportunities: { ref: "OPP-3", title: "Tower" }, rfqs: { ref: null, title: "Mesh RFQ" }, purchase_orders: { ref: "PO-0009" },
      invoices: { ref: "INV-0042" }, work_orders: { ref: "WO-0011" }, service_cases: { ref: "CS-0100" }, quotes: { ref: "Q-0501" },
      wfm_projects: { ref: null, name: "Site A" }, employees: { employee_code: null, first_name: "Sam", last_name: "Lee" },
      fence_projects: { ref: "FNC-0002", name: "Perimeter" },
    };
    const want: Record<string, string> = {
      suppliers: "Acme Steel", inventory_items: "INV-5", estimates: "Roof estimate", opportunities: "OPP-3", rfqs: "Mesh RFQ", purchase_orders: "PO-0009",
      invoices: "INV-0042", work_orders: "WO-0011", service_cases: "CS-0100", quotes: "Q-0501", wfm_projects: "Site A", employees: "Sam Lee", fence_projects: "FNC-0002",
    };
    for (const [table, rec] of Object.entries(recs)) {
      const admin = db([link({ object_type: table, object_id: "r-1" })], { [table]: [{ id: "r-1", tenant_id: TENANT, ...rec }] });
      const r = await externalRefsForOne(admin, TENANT, table, "r-1");
      expect(r[0].readable, table).toBe(want[table]);
      expect(r[0].objectLabel, table).toBe(OBJECT_TABLES[table].label);
    }
  });

  it("maps tables to Dataverse tables for the deep link and gives none where Dataverse has no equivalent", () => {
    const cfg = { product: "dataverse" as const, auth_mode: "client_secret" as const, environment_url: "https://org.crm.dynamics.com", entities: {} };
    const etn = (t: string) => buildDeepLink(cfg, t, GUID)?.match(/etn=([a-z_]+)&/)?.[1] ?? null;
    expect(etn("quotes")).toBe("quote");
    expect(etn("opportunities")).toBe("opportunity");
    expect(etn("suppliers")).toBe("account");
    expect(etn("invoices")).toBe("invoice");
    expect(etn("service_cases")).toBe("incident");
    expect(etn("wfm_projects")).toBe("msdyn_project");
    for (const t of ["purchase_orders", "rfqs", "estimates", "employees", "not_a_table"]) expect(etn(t), t).toBeNull();
  });

  it("an unknown table still shows the link's readable key, without a link or a name lookup", async () => {
    const admin = db([link({ object_type: "gadgets", object_id: "g-1", external_key: "GAD-7" })]);
    const r = await externalRefsForOne(admin, TENANT, "gadgets", "g-1");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ readable: "GAD-7", deepLink: null, objectLabel: "Record" });
    const none = db([link({ object_type: "gadgets", object_id: "g-2" })]);
    expect((await externalRefsForOne(none, TENANT, "gadgets", "g-2"))[0].readable).toBe("Linked record");
    expect(await externalRefsFor(none, TENANT, "gadgets; drop table x", ["g-2"])).toEqual({});
  });
});

describe("several connectors on one record", () => {
  it("returns one entry per link, each under its own connector's name", async () => {
    const admin = db([
      link({ external_key: "QUO-01002", object_type: "standard_quotes", object_id: "q-1", direction: "push" }),
      link({ connector_id: "sap", external_key: "4500012345", object_type: "standard_quotes", object_id: "q-1", external_id: "4500012345", direction: "push", created_at: "2026-10-21T11:00:00Z" }),
      link({ connector_id: "epromis", external_key: "PRJ-77", object_type: "standard_quotes", object_id: "q-1", external_id: "77", created_at: "2026-10-21T12:00:00Z" }),
    ]);
    const r = await externalRefsForOne(admin, TENANT, "standard_quotes", "q-1");
    expect(r.map((x) => x.connectorId)).toEqual(["dynamics365", "sap", "epromis"]);
    expect(r.map((x) => x.readable)).toEqual(["QUO-01002", "4500012345", "PRJ-77"]);
    expect(r[0].system).toBe("Dynamics 365");
    expect(r[0].deepLink).toContain("etn=quote");
    // connectors without an address builder show their key and no link
    expect(r[1].deepLink).toBeNull();
    expect(r[2].deepLink).toBeNull();
    // the raw id stays a tooltip
    expect(r[1].title).toBe("4500012345");
  });

  it("takes the connector's name from the registry, short form first, falling back to the id", () => {
    expect(systemLabel("dynamics365")).toBe("Dynamics 365");
    expect(systemLabel("gmail")).toBe("Gmail");
    expect(systemLabel("sap")).toBe("sap");
  });

  it("does not list the same external record twice", async () => {
    const admin = db([link({ external_key: "ACC-1" }), link({ external_key: "ACC-1", entity: "vendors" })]);
    expect(await externalRefsForOne(admin, TENANT, "accounts", "acc-1")).toHaveLength(1);
  });
});

describe("explanation text", () => {
  it("stays within the InfoTip limits", () => {
    expect(tipTextProblems(EXTERNAL_RECORD_TIP)).toEqual([]);
  });
});
