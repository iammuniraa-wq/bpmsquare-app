import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";
import { scopeForChangeType } from "@/lib/api/changeFeedScope";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { CREATE_ACTIONS } from "@/lib/createActions";
import { SETTINGS_MENU } from "@/lib/settingsMenu";
import { NAV } from "@/lib/constants";
import { SEARCH_OBJECTS } from "@/lib/globalSearch";
import { NOVA_OBJECTS } from "@/lib/novaAccess";
import { FEATURE_DEPENDENCIES } from "@/lib/moduleDependencies";

// GCC tender deals, slice 5a: the shape of migration 0226, the bundle that carries it, the ledger, the gating map, the surfaces the
// module is wired into, and the promises that the budget is internal.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sql = lf(read("supabase/migrations/0226_contract_projects.sql"));
const code = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
const TABLES = ["erp_masters", "contract_projects", "project_budget_revisions", "project_budget_lines"];

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe("migration 0226", () => {
  it("is idempotent", () => {
    for (const m of code.matchAll(/create table (if not exists )?(\w+)/gi)) expect(m[1], `create table ${m[2]}`).toBeTruthy();
    for (const m of code.matchAll(/create (unique )?index (if not exists )?(\w+)/gi)) expect(m[2], `index ${m[3]}`).toBeTruthy();
    for (const m of code.matchAll(/create policy "([^"]+)"/gi)) expect(code, m[1]).toContain(`drop policy if exists "${m[1]}"`);
  });

  it("every table has tenant_id, RLS and a tenant SELECT policy and NOTHING that writes", () => {
    for (const t of TABLES) {
      expect(code, t).toMatch(new RegExp(`create table if not exists ${t} \\([^;]*?tenant_id uuid not null references tenants\\(id\\)`));
      expect(code, t).toMatch(new RegExp(`alter table ${t} enable row level security`));
      const policies = [...code.matchAll(new RegExp(`create policy "([^"]+)" on ${t} for (\\w+)`, "gi"))];
      expect(policies, t).toHaveLength(1);
      expect(policies[0][2].toLowerCase()).toBe("select");
      expect(code, t).toMatch(new RegExp(`on ${t} for select using \\(tenant_id in \\(select tenant_id from tenant_users where user_id = auth\\.uid\\(\\)\\)\\)`));
    }
    expect(code).not.toMatch(/for (all|insert|update|delete)/i);
  });

  it("one project per tender, one open and one approved revision per project, and a ref index the ref generator can recognise", () => {
    expect(code).toMatch(/create unique index if not exists contract_projects_one_per_tender on contract_projects \(tenant_id, source_opportunity_id\) where source_opportunity_id is not null/);
    expect(code).toMatch(/project_budget_revisions_one_open on project_budget_revisions \(project_id\) where status in \('draft', 'pending'\)/);
    expect(code).toMatch(/project_budget_revisions_one_approved on project_budget_revisions \(project_id\) where status = 'approved'/);
    expect(code).toContain("contract_projects_tenant_ref_uniq"); // isMasterRefCollision looks for "_tenant_ref_uniq"
    expect(code).toMatch(/unique \(tenant_id, kind, code\)/);
    expect(code).toMatch(/unique \(project_id, rev_no\)/);
  });

  it("the lists record where a row came from, so a refresh knows what it may replace", () => {
    expect(code).toMatch(/source in \('manual', 'file', 'epromis', 'default'\)/);
  });

  it("adds no column to any existing table", () => {
    expect(code).not.toMatch(/alter table (?!\w+ enable row level security)/i);
  });

  it("the bundle carries the migration verbatim, and the ledger lists it as pending", () => {
    const bundle = lf(read("scripts/run-bundle-36-contract-projects-2026-10-26.sql"));
    expect(bundle).toContain(sql.trim());
    const project = read("PROJECT.md");
    expect(project).toMatch(/0226_contract_projects\.sql/);
    expect(project).toMatch(/run-bundle-36-contract-projects-2026-10-26\.sql/);
  });
});

describe("gating and wiring", () => {
  it("every spelling of the object is owned by the contract_projects module", () => {
    for (const n of ["contract_projects", "contract-projects", "project_budget_revisions", "project_budget_lines", "erp_masters"]) expect(featureForObject(n), n).toBe("contract_projects");
  });

  it("the module needs the tender edition", () => {
    expect(FEATURE_DEPENDENCIES.some((d) => d.key === "contract_projects" && d.needs === "gcc_tender" && d.strength === "hard")).toBe(true);
  });

  it("is a nav item under Sales with its module flag and workcenter, a settings entry, a palette entry, a search object and a timeline object", () => {
    const items = NAV.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])]));
    expect(items.find((i) => i.href === "/contract-projects")).toMatchObject({ featureKey: "contract_projects", workcenterKey: "contract_projects" });
    expect(SETTINGS_MENU.find((s) => s.href === "/settings/contract-projects")).toMatchObject({ featureKey: "contract_projects", adminOnly: true });
    expect(CREATE_ACTIONS.find((a) => a.href === "/contract-projects/new")).toMatchObject({ featureKey: "contract_projects", workcenterKey: "contract_projects" });
    expect(SEARCH_OBJECTS.find((o) => o.type === "contract_project")).toMatchObject({ featureKeys: ["contract_projects"], workcenters: ["contract_projects"] });
    expect(NOVA_OBJECTS.contract_projects).toMatchObject({ table: "contract_projects", feature: "contract_projects" });
    expect(read("src/app/api/nova/inbox/route.ts")).toContain("contract_projects");
    expect(read("src/components/NovaInbox.tsx")).toContain("contract_projects: ROUTES.contractProject");
    expect(read("src/app/(app)/contract-projects/[id]/page.tsx")).toContain('<RecordActivity objectType="contract_projects"');
  });

  it("is in the tenant editor and the new-tenant form (default off), and in the change-history filter", () => {
    expect(read("src/app/admin/tenants/[id]/TenantEditor.tsx")).toContain('key: "contract_projects"');
    expect(read("src/app/admin/tenants/new/NewTenantForm.tsx")).toMatch(/contract_projects: false/);
    expect(read("src/app/(app)/administration/change-history/ChangeHistoryClient.tsx")).toContain('value: "contract_projects"');
  });

  it("Talk to data shows header fields and totals only, behind an explicit scope, and the change feed follows the same scope", () => {
    const src = LIST_SOURCES.contract_projects;
    expect(src).toBeTruthy();
    const fields = src.fields.map((f) => f.path);
    for (const f of fields) expect(f, f).not.toMatch(/unit_cost|cost_code|resource|reserve|justification|description/);
    expect(scopeForChangeType("contract_projects")).toBe("contract_projects");
    expect(read("src/app/api/v1/_auth.ts")).toMatch(/EXPLICIT_SCOPE_ONLY = new Set\([^)]*"contract_projects"/);
  });

  it("the assistant's create card is deferred with a stated reason", () => {
    expect(read("src/lib/actions/registry.ts")).toContain('"contract-projects":');
  });

  it("every control of the screens carries a data-guide id the assistant can point at", () => {
    const files = [
      "src/components/contractProjects/ApprovalControls.tsx", "src/components/contractProjects/BudgetGrid.tsx", "src/components/contractProjects/RevisionsPanel.tsx",
      "src/components/contractProjects/HandoverPanel.tsx", "src/components/contractProjects/ContractProjectBanner.tsx", "src/components/contractProjects/ProjectOverview.tsx", "src/components/contractProjects/ProjectDetailsForm.tsx", "src/components/contractProjects/ProjectPathBar.tsx",
      "src/app/(app)/settings/contract-projects/ContractProjectsSettingsClient.tsx",
    ];
    const ids = new Set(files.flatMap((f) => [...read(f).matchAll(/"(cp\.[a-z_.]+)"/g)].map((m) => m[1])));
    for (const id of ["cp.overview", "cp.approval.ask", "cp.approval.approve", "cp.approval.reject", "cp.approval.withdraw", "cp.budget", "cp.budget.add", "cp.budget.save", "cp.budget.revision", "cp.revisions", "cp.revisions.start_button", "cp.handover.download", "cp.handover.send", "cp.banner.create", "cp.settings", "cp.settings.import", "cp.settings.margin_floor", "cp.needs_you", "cp.path"]) {
      expect(ids, id).toContain(id);
    }
  });
});

describe("the budget is internal", () => {
  it("no customer-facing surface (print pages, public links, emails to customers, the standard v1 routes) reads the budget tables", () => {
    const roots = ["src/app/(print)", "src/app/api/v1", "src/lib/quotePublicLink.ts", "src/lib/salesOrderPublicLink.ts"];
    for (const r of roots) {
      const full = path.join(ROOT, r);
      const files = full.endsWith(".ts") ? [full] : walk(full).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("_auth.ts"));
      for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/project_budget|contract_projects|erp_masters/);
    }
  });

  it("the client's priced Excel and the answer sheet are still given a rate and an amount and nothing else (the cost the budget starts from stays in the BOQ table)", () => {
    const write = read("src/lib/tender/boq/write.ts").replace(/\/\/[^\n]*|\/\*\*[\s\S]*?\*\//g, "");
    expect(write).not.toMatch(/unit_cost|markup|margin|cost_price|cost_rate/i);
    for (const f of walk(path.join(ROOT, "src/app/api/opportunities/[id]/boq")).filter((x) => /route\.ts$/.test(x) && /export/.test(x))) {
      expect(readFileSync(f, "utf8").replace(/\/\/[^\n]*|\/\*\*[\s\S]*?\*\//g, ""), f).not.toMatch(/unit_cost|markup|cost_rate/);
    }
    // The cost source stores the cost and markup on the BOQ row (0223); this slice reads them, it does not add a second copy.
    expect(lf(read("supabase/migrations/0223_tender_boq.sql"))).toMatch(/unit_cost\s+numeric/);
    expect(code).not.toContain("cost_rate");
  });

  it("the handover workbook is an authenticated download, never a link anyone can open", () => {
    const route = read("src/app/api/contract-projects/[id]/handover/route.ts");
    expect(route).toContain("openProjectRequest()");
    expect(route).toContain("private, no-store");
    expect(route.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")).not.toMatch(/signed|publicLink/i);
  });
});

describe("a workspace without the module", () => {
  it("every contract-projects route starts with the gate that answers 404", () => {
    const routes = walk(path.join(ROOT, "src/app/api/contract-projects")).filter((f) => /route\.ts$/.test(f));
    expect(routes.length).toBeGreaterThanOrEqual(10);
    // The buy-out routes open through their own door, which is the same gate plus the tender-project check.
    for (const f of routes) expect(readFileSync(f, "utf8"), f).toMatch(/openProjectRequest\(|openBuyoutRequest\(|openPackageRequest\(/);
    expect(read("src/lib/contractProjects/buyout/server.ts")).toMatch(/const gate = await openProjectRequest\(\{ write: opts\.write \}\);/);
    const gate = read("src/lib/contractProjects/server.ts");
    expect(gate).toMatch(/for \(const key of \["contract_projects", "gcc_tender"\] as const\)/);
    expect(gate).toContain('error: "Not found"');
  });

  it("the deal page asks nothing of the new tables unless the module is on", () => {
    const page = lf(read("src/app/(app)/pipeline/[id]/page.tsx"));
    expect(page).toMatch(/if \(tender && tenant\?\.features\?\.contract_projects === true\) \{/);
  });
});
