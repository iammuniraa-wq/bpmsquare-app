import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u), fetchPublic: async () => new Response("{}") }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {} }));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: async () => ({ data: null, error: null }) }));

import { dispatchQuoteOutcome, previewQuoteOutcome, sendTestQuote } from "./dispatch";
import { FakeDataverse } from "./fakeDataverse";
import { fakeAdmin, seedMiddleware, T1, T2, type Row } from "./testHarness";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

const msgs = (db: { tables: Record<string, Row[]> }) => db.tables.integration_messages ?? [];
const run = (db: ReturnType<typeof fakeAdmin>, dv: FakeDataverse, over: Parameters<typeof dispatchQuoteOutcome>[3] = { trigger: "auto" }, quoteId = "q-1", tenant = T1) =>
  dispatchQuoteOutcome(db.client, tenant, quoteId, { http: dv, userId: "u-1", ...over });

describe("awarded / rejected on Dynamics Sales (Dataverse = Quote)", () => {
  it("awarded: one Won quote, a link with the readable number, one ok message", async () => {
    const db = fakeAdmin(seedMiddleware());
    const dv = new FakeDataverse();
    const r = await run(db, dv);
    expect(r.state).toBe("sent");
    expect(dv.quotes).toHaveLength(1);
    expect(dv.quotes[0]).toMatchObject({ statecode: 2, statuscode: 4, totalamount: 125 });
    expect(dv.quotes[0].name).toBe("SQ-0001 · A. Datum Corporation");
    const link = db.tables.connector_links.find((l) => l.entity === "standard_quotes")!;
    expect(link).toMatchObject({ object_type: "standard_quotes", object_id: "q-1", external_id: dv.quotes[0].quoteid, external_key: dv.quotes[0].quotenumber, direction: "push" });
    expect(msgs(db)).toHaveLength(1);
    expect(msgs(db)[0]).toMatchObject({ status: "ok", channel: "connector", direction: "out", object_id: "q-1", ref_label: "SQ-0001", entity: "quote" });
    expect((msgs(db)[0].summary as Record<string, unknown>).erp_number).toBe(dv.quotes[0].quotenumber);
    // no GUID in any heading or chip: it appears only inside the Open link
    const { link: openLink, ...rest } = msgs(db)[0].summary as Record<string, unknown>;
    expect(JSON.stringify(rest)).not.toContain(dv.quotes[0].quoteid);
    expect(String(openLink)).toContain(dv.quotes[0].quoteid);
  });

  it("rejected: the Dynamics quote is closed as Lost", async () => {
    const seed = seedMiddleware();
    seed.standard_quotes[0].status = "rejected";
    const db = fakeAdmin(seed);
    const dv = new FakeDataverse();
    expect((await run(db, dv)).state).toBe("sent");
    expect(dv.quotes[0]).toMatchObject({ statecode: 3, statuscode: 5 });
    expect((msgs(db)[0].summary as Record<string, unknown>).outcome).toBe("rejected");
  });

  it("is idempotent: a second dispatch for the same quote and outcome makes no twin and no new message", async () => {
    const db = fakeAdmin(seedMiddleware());
    const dv = new FakeDataverse();
    await run(db, dv);
    const callsBefore = dv.calls.filter((c) => c.method !== "GET").length;
    const again = await run(db, dv, { trigger: "retry" });
    expect(again.state).toBe("already_sent");
    expect(dv.quotes).toHaveLength(1);
    expect(dv.calls.filter((c) => c.method !== "GET")).toHaveLength(callsBefore);
    expect(msgs(db)).toHaveLength(1);
    expect(db.tables.connector_links.filter((l) => l.entity === "standard_quotes")).toHaveLength(1);
  });

  it("a failure in the middle is recorded, then Retry resumes and completes with one ERP quote", async () => {
    const db = fakeAdmin(seedMiddleware());
    const dv = new FakeDataverse();
    dv.failOnce.WinQuote = { status: 500, message: "The server did not respond" };
    const first = await run(db, dv);
    expect(first.state).toBe("failed");
    const failed = msgs(db)[0];
    expect(failed).toMatchObject({ status: "failed", http_status: 500, error: "The server did not respond" });
    expect((failed.summary as Record<string, unknown>).headline).toBeTruthy();
    expect((failed.summary as Record<string, unknown>).fix).toBeTruthy();
    expect(dv.quotes[0].statecode).toBe(1);
    expect(db.tables.connector_links.some((l) => l.entity === "standard_quotes")).toBe(true);

    const second = await run(db, dv, { trigger: "retry" });
    expect(second.state).toBe("sent");
    expect(dv.quotes).toHaveLength(1);
    expect(dv.quotes[0].statecode).toBe(2);
    // the earlier failure is replaced, so only open items stay failed
    expect(msgs(db).filter((m) => m.status === "failed")).toHaveLength(0);
    expect(msgs(db).find((m) => (m.summary as Record<string, unknown>).resolved)).toBeTruthy();
  });

  it("a customer that is not in the ERP yet is a failed message with the fix, and nothing is sent", async () => {
    const seed = seedMiddleware();
    seed.connector_links = [];
    const db = fakeAdmin(seed);
    const dv = new FakeDataverse();
    const r = await run(db, dv);
    expect(r).toMatchObject({ state: "failed", headline: "This customer is not in Dynamics yet." });
    expect((r as { fix: string }).fix).toMatch(/Sync customers, then retry/);
    expect(dv.calls).toHaveLength(0);
    expect(db.tables.connector_links.filter((l) => l.entity === "customers")).toHaveLength(0); // never creates accounts in the ERP
    expect(msgs(db)[0].status).toBe("failed");
  });

  it("no price list chosen: failed with the fix, nothing sent", async () => {
    const db = fakeAdmin(seedMiddleware({ cfg: { price_list_id: undefined } }));
    const dv = new FakeDataverse();
    const r = await run(db, dv);
    expect(r).toMatchObject({ state: "failed", headline: "No price list is chosen." });
    expect(dv.calls).toHaveLength(0);
  });

  it("the ERP's raw message is kept for Details, the headline is plain", async () => {
    const db = fakeAdmin(seedMiddleware());
    const dv = new FakeDataverse();
    dv.failOnce.create = { status: 403, message: "Principal user (Id=1) is missing prvCreateQuote privilege" };
    const r = await run(db, dv);
    expect(r).toMatchObject({ state: "failed", headline: "The connected app may not create quotes." });
    expect(msgs(db)[0].error).toContain("prvCreateQuote");
    expect(dv.quotes).toHaveLength(0);
  });
});

describe("Finance and Operations / Business Central = Project", () => {
  const foSeed = () => {
    const s = seedMiddleware({ product: "fo", cfg: { company: "usmf" } });
    s.connector_links[0].external_id = "usmf|C0100";
    return s;
  };

  it("awarded: a project is created with the ref in its name and linked with its key", async () => {
    const db = fakeAdmin(foSeed());
    const dv = new FakeDataverse();
    const r = await run(db, dv);
    expect(r.state).toBe("sent");
    expect(dv.data.Projects).toHaveLength(1);
    expect(dv.data.Projects[0]).toMatchObject({ ProjectName: "SQ-0001 · A. Datum Corporation", CustomerAccount: "C0100", dataAreaId: "usmf" });
    expect(db.tables.connector_links.find((l) => l.entity === "standard_quotes")).toMatchObject({ object_id: "q-1", direction: "push" });
    expect(msgs(db)[0]).toMatchObject({ status: "ok", entity: "project" });
  });

  it("a second dispatch does not create a second project", async () => {
    const db = fakeAdmin(foSeed());
    const dv = new FakeDataverse();
    await run(db, dv);
    expect((await run(db, dv, { trigger: "retry" })).state).toBe("already_sent");
    expect(dv.data.Projects).toHaveLength(1);
  });

  it("rejected sends nothing and records a skipped message saying so", async () => {
    const seed = foSeed();
    seed.standard_quotes[0].status = "rejected";
    const db = fakeAdmin(seed);
    const dv = new FakeDataverse();
    const r = await run(db, dv);
    expect(r.state).toBe("skipped");
    expect(dv.calls).toHaveLength(0);
    expect(msgs(db)[0]).toMatchObject({ status: "skipped" });
    expect((msgs(db)[0].summary as Record<string, unknown>).headline).toMatch(/tracks projects, not quotes/);
  });

  it("Business Central: the same path with its own preset", async () => {
    const db = fakeAdmin(seedMiddleware({ product: "bc" }));
    const dv = new FakeDataverse();
    expect((await run(db, dv)).state).toBe("sent");
    expect(dv.data.projects[0]).toEqual(expect.objectContaining({ displayName: "SQ-0001 · A. Datum Corporation" }));
  });

  it("an unsynced customer blocks the project too", async () => {
    const seed = foSeed();
    seed.connector_links = [];
    const db = fakeAdmin(seed);
    const dv = new FakeDataverse();
    expect((await run(db, dv)).state).toBe("failed");
    expect(dv.calls).toHaveLength(0);
  });
});

describe("rules: automatic, manual, off", () => {
  it("manual mode records one waiting message and sends nothing; Send now sends and settles it", async () => {
    const db = fakeAdmin(seedMiddleware({ mwConfig: { rules: { quote_awarded: { enabled: true, mode: "manual" } } } }));
    const dv = new FakeDataverse();
    expect((await run(db, dv)).state).toBe("waiting");
    expect((await run(db, dv)).state).toBe("waiting"); // pressing save twice adds no second waiting item
    expect(msgs(db)).toHaveLength(1);
    expect(msgs(db)[0].status).toBe("pending");
    expect(dv.calls).toHaveLength(0);

    expect((await run(db, dv, { trigger: "send_now" })).state).toBe("sent");
    expect(dv.quotes).toHaveLength(1);
    expect(msgs(db).filter((m) => m.status === "pending")).toHaveLength(0);
  });

  it("a rule that is switched off does nothing and records nothing", async () => {
    const db = fakeAdmin(seedMiddleware({ mwConfig: { rules: { quote_awarded: { enabled: false } } } }));
    const dv = new FakeDataverse();
    expect(await run(db, dv)).toMatchObject({ state: "disabled" });
    expect(dv.calls).toHaveLength(0);
    expect(msgs(db)).toHaveLength(0);
  });

  it("Send now still works on a switched-off rule (the person asked)", async () => {
    const db = fakeAdmin(seedMiddleware({ mwConfig: { rules: { quote_awarded: { enabled: false } } } }));
    expect((await run(db, new FakeDataverse(), { trigger: "send_now" })).state).toBe("sent");
  });

  it("a workspace without the flag is untouched: no reads of the quote, no messages, no ERP call", async () => {
    const db = fakeAdmin(seedMiddleware({ features: { integration_middleware: false } }));
    const dv = new FakeDataverse();
    expect(await run(db, dv)).toMatchObject({ state: "disabled" });
    expect(dv.calls).toHaveLength(0);
    expect(msgs(db)).toHaveLength(0);
    expect(db.log.every((l) => l.table === "tenants")).toBe(true);
  });

  it("a quote that is not awarded or rejected is left alone", async () => {
    const seed = seedMiddleware();
    seed.standard_quotes[0].status = "sent";
    const db = fakeAdmin(seed);
    expect((await run(db, new FakeDataverse())).state).toBe("disabled");
    expect(msgs(db)).toHaveLength(0);
  });

  it("Send now with an outcome that does not match the quote's status is refused", async () => {
    const db = fakeAdmin(seedMiddleware());
    const dv = new FakeDataverse();
    expect(await run(db, dv, { trigger: "send_now", outcome: "rejected" })).toMatchObject({ state: "disabled" });
    expect(dv.calls).toHaveLength(0);
  });
});

describe("tenant isolation", () => {
  it("a quote id from another workspace never matches: not found, nothing sent or recorded", async () => {
    const other = seedMiddleware({ tenantId: T2 });
    const mine = seedMiddleware({ tenantId: T1 });
    const db = fakeAdmin({
      tenants: [...mine.tenants, ...other.tenants],
      tenant_connectors: [...mine.tenant_connectors, ...other.tenant_connectors],
      accounts: [{ id: "acc-9", tenant_id: T2, name: "Foreign Ltd" }],
      standard_quotes: [{ ...other.standard_quotes[0], id: "q-foreign", account_id: "acc-9" }],
      standard_quote_lines: [{ ...other.standard_quote_lines[0], standard_quote_id: "q-foreign" }],
      connector_links: [], integration_messages: [],
    });
    const dv = new FakeDataverse();
    expect(await run(db, dv, { trigger: "send_now" }, "q-foreign", T1)).toEqual({ state: "not_found" });
    expect(dv.calls).toHaveLength(0);
    expect(msgs(db)).toHaveLength(0);
    expect(db.tables.connector_links).toHaveLength(0);
  });

  it("a link of another workspace is never used as this quote's ERP document", async () => {
    const seed = seedMiddleware();
    seed.connector_links.push({ tenant_id: T2, connector_id: "dynamics365", entity: "standard_quotes", object_type: "standard_quotes", object_id: "q-1", external_id: "foreign-guid", external_key: "QUO-FOREIGN", direction: "push" });
    const db = fakeAdmin(seed);
    const dv = new FakeDataverse();
    const r = await run(db, dv);
    expect(r.state).toBe("sent");
    expect(dv.quotes).toHaveLength(1);
    expect(dv.calls.some((c) => c.path.includes("foreign-guid"))).toBe(false);
  });

  it("every admin-client query that touches a workspace table names the tenant", async () => {
    const db = fakeAdmin(seedMiddleware());
    await run(db, new FakeDataverse());
    const tenantOwned = db.log.filter((l) => l.table !== "tenants" && l.op === "select" || l.op === "update" || l.op === "delete");
    for (const l of tenantOwned) {
      if (l.table === "tenants") continue;
      expect(l.filters.some((f) => f.startsWith("tenant_id=")), `${l.op} ${l.table} must filter by tenant_id`).toBe(true);
    }
  });
});

describe("degraded mode while migration 0201 is pending", () => {
  it("the table is missing: an explicit needs-database-update state, nothing sent, no crash", async () => {
    const db = fakeAdmin(seedMiddleware(), { missing: ["integration_messages"] });
    const dv = new FakeDataverse();
    expect(await run(db, dv)).toEqual({ state: "needs_database_update" });
    expect(dv.calls).toHaveLength(0);
  });

  it("manual mode also degrades", async () => {
    const db = fakeAdmin(seedMiddleware({ mwConfig: { rules: { quote_awarded: { mode: "manual" } } } }), { missing: ["integration_messages"] });
    expect(await run(db, new FakeDataverse())).toEqual({ state: "needs_database_update" });
  });
});

describe("fence projects and estimates as the quote's source", () => {
  const fenceSeed = (selection?: Record<string, boolean>) => {
    const s = seedMiddleware({ mwConfig: selection ? { fence: selection } : undefined });
    s.fence_projects = [{ id: "f-1", tenant_id: T1, standard_quote_id: "q-1", name: "North boundary", layout: "closed_perimeter", total_length_m: 500, fabric_height_m: 2.4, mesh_spec: null, coating: null, security_profile_id: "sp-1" }];
    s.fence_security_profiles = [{ id: "sp-1", tenant_id: T1, label: "High security" }];
    s.fence_gates = [{ tenant_id: T1, fence_project_id: "f-1", gate_type: "sliding", width_m: 6 }];
    return s;
  };

  it("a fence-sourced quote follows the fence selection", async () => {
    const db = fakeAdmin(fenceSeed({ security_profile: true, quantity_lines: false }));
    const dv = new FakeDataverse();
    await run(db, dv);
    const body = dv.quotes[0].body;
    expect(String(body.description)).toContain("North boundary: Closed perimeter, 500 m");
    expect(String(body.description)).toContain("Security profile: High security");
    expect((body.quote_details as unknown[]).length).toBe(1); // quantity lines unticked: one lump line
    expect(dv.quotes[0].totalamount).toBe(125);
  });

  it("the fence-sourced quote is unaffected by the estimate selection", async () => {
    const db = fakeAdmin(fenceSeed());
    const dv = new FakeDataverse();
    await run(db, dv);
    expect((dv.quotes[0].body.quote_details as unknown[]).length).toBe(2);
  });

  const estSeed = (product: "dataverse" | "fo" | "bc", mw?: Record<string, unknown>, cfg?: Record<string, unknown>) => {
    const s = seedMiddleware({ product, mwConfig: mw, cfg });
    if (product === "fo") s.connector_links[0].external_id = "usmf|C0100";
    s.estimates = [{ id: "e-1", tenant_id: T1, standard_quote_id: "q-1", ref: "EST-0007", name: "Villa precast", params: { floors: 2 }, notes: null, template_id: null, totals: { cost_total: 80, margin_pct: 20, margin_amount: 16, price: 96, by_component: { materials: 80 } } }];
    s.estimate_lines = [
      { id: "l1", tenant_id: T1, estimate_id: "e-1", sort_order: 1, code: "L1", group_key: "walls", description: "Wall panel", uom: "pcs", qty: 4, waste_pct: 0, unit_cost: 10, cost_total: 40, component: "materials", custom_data: { sku: "PNL-1" }, source: "rule" },
      { id: "l2", tenant_id: T1, estimate_id: "e-1", sort_order: 2, code: "L2", group_key: "walls", description: "Slab", uom: "pcs", qty: 2, waste_pct: 0, unit_cost: 20, cost_total: 40, component: "materials", custom_data: { sku: "SLB-1" }, source: "rule" },
    ];
    return s;
  };

  it("estimate -> Dynamics quote: summary and price lines only, even with BOM, WBS and costs ticked", async () => {
    const db = fakeAdmin(estSeed("dataverse", { estimate: { bom: true, wbs: true, internal_costs: true } }));
    const dv = new FakeDataverse();
    await run(db, dv);
    const body = dv.quotes[0].body;
    expect(String(body.description)).toContain("EST-0007 · Villa precast");
    expect(JSON.stringify(body)).not.toMatch(/Internal costs|PNL-1|CostPrice/);
    expect((body.quote_details as unknown[]).length).toBe(2);
  });

  it("estimate -> F&O project: tasks and BOM go to the targets set under Mapping, costs stay out", async () => {
    const db = fakeAdmin(estSeed("fo", undefined, { company: "usmf", outbound: { project: { tasks: { entity_set: "ProjectTasks", link_field: "ProjectID" }, bom: { entity_set: "ProjectBomLines", link_field: "ProjectID" } } } }));
    const dv = new FakeDataverse();
    const r = await run(db, dv);
    expect(r.state).toBe("sent");
    expect(dv.data.Projects).toHaveLength(1);
    const projectId = String(dv.data.Projects[0].id);
    expect(dv.data.ProjectTasks.length).toBeGreaterThan(0);
    expect(dv.data.ProjectTasks.every((t) => t.ProjectID === projectId)).toBe(true);
    expect(dv.data.ProjectBomLines.map((b) => b.ItemNumber)).toEqual(["PNL-1", "SLB-1"]);
    expect(JSON.stringify(dv.data)).not.toMatch(/CostPrice|LineAmount|PlannedCost/);
    expect(msgs(db)[0].status).toBe("ok");
  });

  it("estimate -> project without task targets: the project is made and the message warns what was not sent", async () => {
    const db = fakeAdmin(estSeed("fo", undefined, { company: "usmf" }));
    const dv = new FakeDataverse();
    expect((await run(db, dv)).state).toBe("sent");
    expect(dv.data.ProjectTasks).toBeUndefined();
    const warnings = (msgs(db)[0].summary as { warnings?: string[] }).warnings ?? [];
    expect(warnings.join(" ")).toMatch(/Project tasks were not sent/);
  });

  it("internal costs go to a Project only when explicitly ticked", async () => {
    const db = fakeAdmin(estSeed("fo", { estimate: { internal_costs: true } }, { company: "usmf", outbound: { project: { bom: { entity_set: "ProjectBomLines", link_field: "ProjectID" } } } }));
    const dv = new FakeDataverse();
    await run(db, dv);
    expect(Object.keys(dv.data.ProjectBomLines[0])).toContain("CostPrice");
  });
});

describe("preview and test quote", () => {
  it("preview is words first plus the exact body, and sends nothing", async () => {
    const db = fakeAdmin(seedMiddleware());
    const p = await previewQuoteOutcome(db.client, T1, "q-1");
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.words[0]).toMatch(/SQ-0001 for A. Datum Corporation, with 2 lines, total 143.75/);
      expect(p.words.join(" ")).toMatch(/Won/);
      expect(p.body).toMatchObject({ "pricelevelid@odata.bind": "/pricelevels(pl-0001)" });
      expect(p.problems).toEqual([]);
    }
    expect(msgs(db)).toHaveLength(0);
  });

  it("preview says what would stop it", async () => {
    const seed = seedMiddleware();
    seed.connector_links = [];
    const p = await previewQuoteOutcome(fakeAdmin(seed).client, T1, "q-1");
    expect(p.ok && p.problems[0].code).toBe("customer_not_linked");
  });

  it("preview of a foreign quote id is not found", async () => {
    const p = await previewQuoteOutcome(fakeAdmin(seedMiddleware()).client, T2, "q-1");
    expect(p).toMatchObject({ ok: false });
  });

  it("preview lists what the Quote target refuses for an estimate", async () => {
    const s = seedMiddleware({ mwConfig: { estimate: { internal_costs: true } } });
    s.estimates = [{ id: "e-1", tenant_id: T1, standard_quote_id: "q-1", ref: "EST-1", name: "Villa", params: {}, notes: null, template_id: null, totals: null }];
    s.estimate_lines = [];
    const p = await previewQuoteOutcome(fakeAdmin(s).client, T1, "q-1");
    expect(p.ok && p.refused.map((r) => r.part)).toEqual(["internal_costs"]);
    expect(p.ok && p.words.join(" ")).toMatch(/carries prices only/);
  });

  it("the test quote is named ZZ, sent through the real path, and returns its readable number and link", async () => {
    const db = fakeAdmin(seedMiddleware());
    const dv = new FakeDataverse();
    const r = await sendTestQuote(db.client, T1, "u-1", { http: dv, now: new Date("2026-10-21T10:30:00Z") });
    expect(r).toMatchObject({ ok: true, ref: "ZZ-TEST-202610211030" });
    if (r.ok) {
      expect(r.number).toMatch(/^QUO-/);
      expect(r.link).toContain("etn=quote");
    }
    expect(dv.quotes[0].name.startsWith("ZZ-TEST-")).toBe(true);
    expect(dv.quotes[0].statecode).toBe(2);
    expect(msgs(db)[0].summary).toMatchObject({ test: true });
    // a test is never linked to a BPMSquare record
    expect(db.tables.connector_links.filter((l) => l.entity === "standard_quotes")).toHaveLength(0);
  });

  it("the test quote needs a synced customer and says so", async () => {
    const seed = seedMiddleware();
    seed.connector_links = [];
    const r = await sendTestQuote(fakeAdmin(seed).client, T1, null, { http: new FakeDataverse() });
    expect(r).toMatchObject({ ok: false, headline: "No customer has been synced from the ERP yet." });
  });

  it("the test quote degrades while the table is pending", async () => {
    const r = await sendTestQuote(fakeAdmin(seedMiddleware(), { missing: ["integration_messages"] }).client, T1, null, { http: new FakeDataverse() });
    expect(r).toMatchObject({ ok: false, headline: "A database update is needed first." });
  });
});
