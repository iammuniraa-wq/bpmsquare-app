import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// Buildings and element codes: what is wired where (bpmsquarecore 3b), read from the source and from a loader run against an in-memory database.
// The route behaviour has its own tests (contract-projects/buildings.routes.test.ts, opportunities/tender.buildings.routes.test.ts).

vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => true, getTenant: async () => ({ config: {}, features: {} }) }));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => ({}), getAuthUser: async () => null, requireTenantUser: async () => ({}) }));

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe("the migrations and the bundles the owner runs", () => {
  it("0253 and 0254 are the only new numbers, and each bundle wraps its migration in one transaction", () => {
    const names = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => /^025[3-9]/.test(f));
    expect(names.filter((n) => /^0253|^0254/.test(n)).sort()).toEqual(["0253_buildings_and_elements.sql", "0254_project_model_imports.sql"]);
    for (const [bundle, migration] of [["run-bundle-55-buildings-elements-0253-2026-11-24.sql", "0253_buildings_and_elements.sql"], ["run-bundle-56-model-imports-0254-2026-11-24.sql", "0254_project_model_imports.sql"]]) {
      const text = read(`scripts/${bundle}`).replace(/\r\n/g, "\n");
      expect(text, bundle).toContain("\nbegin;\n");
      expect(text.trimEnd().endsWith("commit;"), bundle).toBe(true);
      expect(text.replace(/\r\n/g, "\n"), bundle).toContain(read(`supabase/migrations/${migration}`).replace(/\r\n/g, "\n").trimEnd());
    }
  });

  it("0253 is idempotent, checks its prerequisites, keeps a building to level 1 and a code unique per tender, project and revision", () => {
    const sql = read("supabase/migrations/0253_buildings_and_elements.sql");
    expect(sql).toContain("raise exception 'Run 0226");
    expect(sql).toContain("raise exception 'Run 0243");
    expect(sql).toMatch(/building_code ~ '\^\[A-Z0-9\]\{1,6\}\$' and parent_id is null/);
    expect(sql).toMatch(/create unique index if not exists tender_wbs_items_building_uniq on tender_wbs_items \(opportunity_id, building_code\) where building_code is not null/);
    expect(sql).toMatch(/create unique index if not exists project_work_packages_building_uniq on project_work_packages \(project_id, building_code\) where building_code is not null/);
    expect(sql).toMatch(/create unique index if not exists project_budget_lines_element_uniq on project_budget_lines \(project_id, revision_id, element_code\) where element_code is not null/);
    expect(sql).toMatch(/create unique index if not exists tender_boq_lines_element_uniq on tender_boq_lines \(opportunity_id, element_code\) where element_code is not null/);
    expect(sql).toContain("'element_type'");
    // every create and every alter is safe to run twice
    for (const line of sql.split("\n").filter((l) => /^(create|alter table)/i.test(l))) {
      expect(line, line).toMatch(/if not exists|if exists|drop constraint|add constraint|enable row level security/i);
    }
  });

  it("0254 has RLS on both tables with a tenant SELECT policy and no policy that writes (the 0243 convention)", () => {
    const sql = read("supabase/migrations/0254_project_model_imports.sql");
    for (const t of ["project_model_imports", "project_model_import_rows"]) {
      expect(sql).toContain(`alter table ${t} enable row level security;`);
      expect(sql).toMatch(new RegExp(`create policy "${t}: tenant read" on ${t} for select`));
    }
    expect(sql).not.toMatch(/for (all|insert|update|delete)/i);
    expect(sql).toMatch(/tenant_id\s+uuid not null references tenants\(id\)/);
  });
});

describe("the add-on is a flag, off by default, and every surface asks it", () => {
  it("is in TenantFeatures, the platform-admin editor, the new-workspace defaults (off) and the object map", () => {
    expect(read("src/lib/constants.ts")).toMatch(/^\s{2}contract_buildings: boolean;/m);
    expect(read("src/app/admin/tenants/[id]/TenantEditor.tsx")).toContain('key: "contract_buildings"');
    expect(read("src/app/admin/tenants/new/NewTenantForm.tsx")).toMatch(/contract_buildings: false/);
    expect(read("src/lib/objectFeatureMap.ts")).toMatch(/project_wbs_items: "contract_projects"/);
  });

  it("every route the add-on added checks the flag (buildingsOn, or the v1 / settings equivalent) before it does anything", () => {
    const files = [
      ...walk(path.join(ROOT, "src/app/api/contract-projects/[id]/buildings")), ...walk(path.join(ROOT, "src/app/api/contract-projects/[id]/elements")), ...walk(path.join(ROOT, "src/app/api/contract-projects/[id]/model-imports")),
      ...walk(path.join(ROOT, "src/app/api/opportunities/[id]/tender/buildings")), ...walk(path.join(ROOT, "src/app/api/opportunities/[id]/tender/elements")),
      ...walk(path.join(ROOT, "src/app/api/settings/contract-elements")),
    ].filter((f) => f.endsWith("route.ts"));
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) expect(read(path.relative(ROOT, f)), f).toMatch(/buildingsOn\(|tenderEnabled\(/);
    for (const f of ["src/app/api/v1/contract-projects/route.ts", "src/app/api/v1/contract-projects/[id]/elements/route.ts"]) {
      const src = read(f);
      expect(src, f).toContain("authorizeApi(");
      expect(src, f).toContain('"contract_buildings"');
    }
  });

  it("the Data Workbench objects gate on the object, the add-on and the grant; project budget lines have no Import, on purpose", () => {
    for (const [route, obj] of [["export/project_budget_lines", "project_budget_lines"], ["update/project_budget_lines", "project_budget_lines"], ["export/project_wbs_items", "project_wbs_items"], ["update/project_wbs_items", "project_wbs_items"], ["import/project_wbs_items", "project_wbs_items"]]) {
      const src = read(`src/app/api/${route}/route.ts`);
      expect(src, route).toContain(`assertObjectFeature(tenantId, "${obj}")`);
      expect(src, route).toContain("projectDwGate(");
    }
    expect(existsSync(path.join(ROOT, "src/app/api/import/project_budget_lines"))).toBe(false);
    expect(read("src/lib/import/projectElementsServer.ts")).toContain("buildingsOn(");
    expect(read("src/app/(app)/data-workbench/DataWorkbenchClient.tsx")).toMatch(/project_budget_lines has no Import/);
  });

  it("a Data Workbench update goes through the screen's writers and matches on the real id only", () => {
    const upd = read("src/app/api/update/project_budget_lines/route.ts");
    expect(upd).toContain("lineOfId(");
    expect(upd).toContain("setLineElement(");
    expect(upd).not.toMatch(/item_no|element_code\)\.eq|\.eq\("wbs"/);
    expect(read("src/lib/import/projectElementsServer.ts")).toMatch(/\.eq\("id", id\)\.eq\("tenant_id", tenantId\)/);
  });
});

describe("the API and Talk to data carry no cost", () => {
  it("the element fields name no cost, margin or allocation", () => {
    const src = read("src/lib/elements/apiRows.ts");
    const fields = src.slice(src.indexOf("export const PROJECT_ELEMENT_FIELDS"), src.indexOf("export const ELEMENTS_API_SCOPE"));
    expect(fields).toContain("element_code");
    expect(fields).not.toMatch(/cost|margin|amount|allocated|resource|reserve|rate/i);
    const type = /export type ProjectElementRow = \{[^}]*\};/.exec(src)![0];
    expect(type).not.toMatch(/cost|margin|amount|allocated|resource|reserve|rate/i);
  });

  it("the loader never puts a cost on a row, whatever the budget holds", async () => {
    const T = "00000000-0000-4000-8000-0000000000a1";
    const db = new MemoryDb({
      contract_projects: [{ id: "p1", tenant_id: T, ref: "CPR-1", name: "Job" }],
      project_budget_revisions: [{ id: "r1", tenant_id: T, project_id: "p1", rev_no: 0, status: "draft", total: 17.77 }],
      project_budget_lines: [{
        id: "l1", tenant_id: T, project_id: "p1", revision_id: "r1", line_no: 1, line_key: "k1", resource_code: "11", cost_code: "SECRET-CC", wbs: "1.1", description: "Slab", qty: 10, unit: "m2",
        unit_cost: 17.77, amount: 177.7, allocated: true, client_rate: 20, client_amount: 200, source_ref: "SECRET SUPPLIER", element_type: "HCS", element_code: "B01-HCS-0001", client_qty: 10, model_qty: 11,
      }],
      project_work_packages: [{ id: "w1", tenant_id: T, project_id: "p1", code: "1", name: "Block", parent_id: null, building_code: "B01", sort_order: 10 }],
      project_work_package_lines: [{ tenant_id: T, project_id: "p1", package_id: "w1", line_key: "k1", sort_order: 0 }],
    });
    const { loadProjectElementsForApi } = await import("./apiRows");
    const rows = await loadProjectElementsForApi(db as never, T, "p1");
    expect(rows).toEqual([expect.objectContaining({ project_ref: "CPR-1", building_code: "B01", element_type: "HCS", element_code: "B01-HCS-0001", client_qty: 10, model_qty: 11, quantity: 10, budget_uses: "client" })]);
    const text = JSON.stringify(rows);
    for (const secret of ["17.77", "177.7", "SECRET", "unit_cost", "amount", "resource_code", "cost_code", "source_ref"]) expect(text, secret).not.toContain(secret);
    expect(await loadProjectElementsForApi(db as never, "another-workspace", "p1")).toBeNull();
  });

  it("an API key reaches the elements only by naming the scope, and Talk to data asks with it", { timeout: 60_000 }, async () => {
    expect(read("src/app/api/v1/_auth.ts")).toMatch(/EXPLICIT_SCOPE_ONLY = new Set\([^)]*"contract_projects"[^)]*"project_elements"/);
    const { askScopeFor } = await import("@/lib/api/listSources");
    expect(askScopeFor("project_elements")).toBe("contract_projects");
    expect(askScopeFor("tender_boq_lines")).toBe("tenders");
    expect(askScopeFor("accounts")).toBe("accounts");
    expect(read("src/app/api/settings/api-keys/route.ts")).toMatch(/"contract_projects"/);
  });

  it("the MCP manifest has the two tools and a bumped version", () => {
    const mcp = JSON.parse(read("mcp-server/mcp.json")) as { version: string; tools: { name: string; path: string; method: string }[] };
    expect(mcp.version).toBe("1.22.0");
    expect(mcp.tools.filter((t) => ["list_contract_projects", "get_project_elements"].includes(t.name)).map((t) => `${t.method} ${t.path}`).sort()).toEqual(["GET /api/v1/contract-projects", "GET /api/v1/contract-projects/{id}/elements"]);
  });
});

describe("the workspace without the add-on sees what it saw before", () => {
  it("the element types list, the handover columns, the screens and the search are all behind the flag", () => {
    expect(read("src/app/api/contract-projects/masters/route.ts")).toMatch(/element_type" && !elementsOn/);
    expect(read("src/app/api/contract-projects/[id]/handover/route.ts")).toContain("buildingsOn(");
    expect(read("src/lib/globalSearch.ts")).toMatch(/type: "project_element"[^\n]*featureKeys: \["contract_buildings"\]/);
    // the two screens render nothing when the answer is { enabled: false } or a 404
    expect(read("src/components/elements/BuildingsPanel.tsx")).toMatch(/if \(!data \|\| !d\) return null/);
    expect(read("src/components/elements/ModelComparison.tsx")).toMatch(/r\.status === 404\) \{ setOff\(true\)/);
  });
});
