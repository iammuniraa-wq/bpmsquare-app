import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ANALYTICS_META, ANALYTICS_REQUIRES, analyticsFeatureOn } from "@/lib/analyticsMeta";
import { WORKCENTERS } from "@/lib/workcenters";
import { FEATURE_DEPENDENCIES } from "@/lib/moduleDependencies";
import { loadRecordedCost } from "./server";
import { DEFAULT_LAYOUT, TENDER_BLOCKS } from "@/lib/dashboardBlocks";

// The module is hidden by default and internal (docs/design/pcbs-project-dashboards.md): a platform-admin flag that is off for every existing
// workspace, no tenant-specific code, no hardcoded colour, no console.log, tables that no member can read, and cost and margin kept off the
// API, MCP, Data Workbench and Talk to data surfaces.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const PF_IDS = ["pf_margin_at_risk", "pf_forecast_margin", "pf_cost_to_complete", "pf_billing_behind", "pf_portfolio", "pf_cash"] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const sources = () => [...walk(path.join(ROOT, "src/lib/projectFinance")), ...walk(path.join(ROOT, "src/components/projectFinance"))]
  .filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\.ts$/.test(f));

describe("hidden by default", () => {
  it("the flag exists in the platform-admin editor and defaults off for a new workspace", () => {
    expect(read("src/app/admin/tenants/[id]/TenantEditor.tsx")).toMatch(/key: "project_dashboards"/);
    expect(read("src/app/admin/tenants/new/NewTenantForm.tsx")).toMatch(/project_dashboards: false/);
    expect(read("src/app/admin/tenants/new/NewTenantForm.tsx")).toMatch(/key: "project_dashboards"/);
  });
  it("needs Contract projects (a hard dependency)", () => {
    expect(FEATURE_DEPENDENCIES.some((d) => d.key === "project_dashboards" && d.needs === "contract_projects" && d.strength === "hard")).toBe(true);
  });
  it("every tile and block needs the flag and Contract projects, and a workspace without either never gets them", () => {
    for (const id of PF_IDS) {
      expect(ANALYTICS_META[id].feature, id).toBe("project_dashboards");
      expect(ANALYTICS_REQUIRES[id], id).toEqual(["contract_projects"]);
      expect(analyticsFeatureOn(id, {}), id).toBe(false);
      expect(analyticsFeatureOn(id, { project_dashboards: true }), id).toBe(false);
      expect(analyticsFeatureOn(id, { contract_projects: true }), id).toBe(false);
      expect(analyticsFeatureOn(id, { project_dashboards: true, contract_projects: true }), id).toBe(true);
    }
  });
  it("is in no default layout: a workspace adds the blocks in Adapt", () => {
    const ids = [...DEFAULT_LAYOUT, ...TENDER_BLOCKS].map((b) => b.id);
    for (const id of PF_IDS) expect(ids).not.toContain(id);
    for (const f of ["src/lib/dashboardBlocks.ts", "src/lib/standardRoles.ts"]) expect(read(f)).not.toMatch(/\bpf_(margin|forecast|cost|billing|portfolio|cash)/);
  });
  it("the workcenter a Business Role can grant exists", () => {
    expect(WORKCENTERS.some((w) => w.key === "project_finance")).toBe(true);
  });
});

describe("the new tables (migrations 0261 and 0262)", () => {
  const sql = [read("supabase/migrations/0261_project_forecast_etg.sql"), read("supabase/migrations/0262_project_erp_readback_tables.sql")].join("\n").replace(/--[^\n]*/g, "");
  const tables = [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
  it("creates the four tables, each with a tenant and row level security and NO policy at all (a member must not read cost through PostgREST)", () => {
    expect(tables.sort()).toEqual(["project_erp_facts", "project_erp_state", "project_forecast_etg", "project_kpi_snapshots"]);
    for (const t of tables) {
      expect(sql, t).toMatch(new RegExp(`alter table ${t} enable row level security`));
    }
    expect(sql).not.toMatch(/create policy/i);
    expect((sql.match(/tenant_id\s+uuid not null references tenants\(id\)/g) ?? []).length).toBe(4);
  });
  it("is idempotent and hand-applied: the bundles carry the same SQL", () => {
    for (const [bundle, migration] of [["scripts/run-bundle-pf-0261-forecast-etg-2026-11-24.sql", "supabase/migrations/0261_project_forecast_etg.sql"], ["scripts/run-bundle-pf-0262-erp-readback-tables-2026-11-24.sql", "supabase/migrations/0262_project_erp_readback_tables.sql"]] as const) {
      expect(existsSync(path.join(ROOT, bundle)), bundle).toBe(true);
      expect(read(bundle)).toContain(read(migration).trim().split("\n").filter((l) => !l.startsWith("--")).join("\n").trim().slice(0, 200));
    }
    expect(sql).not.toMatch(/create table (?!if not exists)/);
  });
});

describe("the code stays standard and quiet", () => {
  it("has no console.log, no hardcoded colour and no tenant-specific branch", () => {
    for (const f of sources()) {
      const text = readFileSync(f, "utf8");
      const rel = path.relative(ROOT, f);
      expect(text, `${rel} console.log`).not.toMatch(/console\.log/);
      expect(text, `${rel} hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
      expect(text, `${rel} tenant branch`).not.toMatch(/tenant\.slug|tenantSlug|["']pcbs["']|["']vikas["']|["']bim["']/i);
    }
  });
});

describe("internal cost: never on the API, MCP, Data Workbench, Talk to data or the change feed", () => {
  const secret = /projectFinance|project_forecast_etg|project_erp_facts|project_erp_state|project_kpi_snapshots/;
  it("no v1 route, import, export or update route, no MCP tool and no Talk to data source reads it", () => {
    for (const dir of ["src/app/api/v1", "src/app/api/import", "src/app/api/export", "src/app/api/update", "src/lib/import", "src/lib/api"]) {
      for (const f of walk(path.join(ROOT, dir)).filter((x) => /\.(ts|tsx)$/.test(x) && !/\.test\./.test(x))) {
        expect(readFileSync(f, "utf8"), path.relative(ROOT, f)).not.toMatch(secret);
      }
    }
    expect(read("mcp-server/mcp.json")).not.toMatch(secret);
    expect(read("src/lib/api/listSources.ts")).not.toMatch(secret);
  });
  it("the tables are not mapped to a Data Workbench object, so no bulk route can reach them", () => {
    expect(read("src/lib/objectFeatureMap.ts")).not.toMatch(/project_forecast_etg|project_erp_facts|project_erp_state|project_kpi_snapshots/);
  });
});

describe("the seam for recorded site expenses", () => {
  it("returns nothing until that module supplies a reader, which the model reads as no recorded cost, never a zero", async () => {
    const out = await loadRecordedCost({} as never, "t1", ["p1", "p2"]);
    expect(out.size).toBe(0);
  });
});
