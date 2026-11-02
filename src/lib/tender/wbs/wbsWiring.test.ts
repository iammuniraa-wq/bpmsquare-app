import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";

// The WBS of a tender (migration 0243): the shape of the migration, the ledger, the gate every route goes through, and the isolation shape of
// every query the server makes. Source-level, like boqWiring.test.ts.

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const walk = (dir: string): string[] => readdirSync(path.join(ROOT, dir)).flatMap((n) => {
  const rel = `${dir}/${n}`;
  return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
});
const sql = lf(read("supabase/migrations/0243_wbs.sql"));
const code = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("migration 0243", () => {
  it("is idempotent", () => {
    for (const m of code.matchAll(/create table (if not exists )?(\w+)/gi)) expect(m[1], `create table ${m[2]}`).toBeTruthy();
    for (const m of code.matchAll(/create (unique )?index (if not exists )?(\w+)/gi)) expect(m[2], `index ${m[3]}`).toBeTruthy();
    for (const m of code.matchAll(/add column (if not exists )?(\w+)/gi)) expect(m[1], `add column ${m[2]}`).toBeTruthy();
    for (const m of code.matchAll(/create policy "([^"]+)"/gi)) expect(code, m[1]).toContain(`drop policy if exists "${m[1]}"`);
  });

  it("names its prerequisites and refuses to half-run", () => {
    expect(code).toMatch(/to_regclass\('public\.tender_boq_lines'\) is null/);
    expect(code).toMatch(/to_regclass\('public\.project_work_packages'\) is null/);
  });

  it("every new table has tenant_id and RLS with one tenant SELECT policy and NOTHING that writes", () => {
    for (const t of ["tender_wbs_items", "tender_wbs_line_parts", "project_work_package_line_parts"]) {
      expect(code, t).toMatch(new RegExp(`create table if not exists ${t} \\([^;]*?tenant_id +uuid not null references tenants\\(id\\)`));
      expect(code, t).toMatch(new RegExp(`alter table ${t} enable row level security`));
      const policies = [...code.matchAll(new RegExp(`create policy "([^"]+)" on ${t} for (\\w+)`, "gi"))];
      expect(policies, t).toHaveLength(1);
      expect(policies[0][2].toLowerCase()).toBe("select");
    }
    expect(code).not.toMatch(/for (all|insert|update|delete)/i);
  });

  it("keeps a code unique per deal, a line in one item per part, and the share between 0 and 100", () => {
    expect(code).toMatch(/unique \(opportunity_id, code\)/);
    expect(code).toMatch(/unique \(boq_line_id, wbs_item_id\)/);
    expect(code).toMatch(/unique \(project_id, line_key, package_id\)/);
    expect(code.match(/check \(share_pct > 0 and share_pct <= 100\)/g)).toHaveLength(2);
    expect(code).toMatch(/wbs_item_id uuid references tender_wbs_items\(id\) on delete set null/);
  });

  it("the bundle is one transaction that carries the migration verbatim, and the ledger lists it as pending", () => {
    const bundle = lf(read("scripts/run-bundle-51-wbs-2026-11-02.sql"));
    expect(bundle).toContain(sql.trim());
    expect(bundle).toMatch(/^begin;$/m);
    expect(bundle.trimEnd().endsWith("commit;")).toBe(true);
    expect(bundle).toMatch(/Run AFTER 0240 \(bundle 48\) and 0242 \(bundle 50\)/);
    const project = read("PROJECT.md");
    expect(project).toMatch(/run-bundle-51-wbs-2026-11-02\.sql/);
    expect(project).toMatch(/PENDING on dev AND production AND KAMCO\. Run `scripts\/run-bundle-51-wbs-2026-11-02\.sql` \(= 0243\)/);
  });

  it("each of the new objects is owned by a module", () => {
    expect(featureForObject("tender_wbs_items")).toBe("gcc_tender");
    expect(featureForObject("tender_wbs_line_parts")).toBe("gcc_tender");
    expect(featureForObject("project_work_package_line_parts")).toBe("contract_projects");
  });
});

describe("the tender WBS routes", () => {
  const routes = walk("src/app/api/opportunities/[id]/tender/wbs").filter((f) => f.endsWith("route.ts"));

  it("there are six, each through the one gate, none taking the workspace from the request", () => {
    expect(routes).toHaveLength(6);
    for (const f of routes) {
      const src = read(f);
      expect(src, f).toMatch(/openBoqRequest\(id, (true|false)\)/);
      expect(src, f).not.toMatch(/requireTenantUser|createAdminSupabase/);
      expect(src, f).not.toMatch(/body\.(tenant_id|opportunity_id|user_id|created_by)/);
    }
  });

  it("a write needs edit access and a read does not (the owners list is read by editors only)", () => {
    const owners = routes.find((f) => f.includes("/owners/"))!;
    expect(read(owners)).toMatch(/openBoqRequest\(id, true\)/);
    for (const f of routes.filter((r) => r !== owners)) {
      const src = read(f);
      for (const m of src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)[\s\S]*?openBoqRequest\(id, (true|false)\)/g)) {
        expect(m[2], `${f} ${m[1]}`).toBe(m[1] === "GET" ? "false" : "true");
      }
    }
  });

  it("the BOQ keeps its seven routes: the WBS is not one of them", () => {
    expect(walk("src/app/api/opportunities/[id]/boq").filter((f) => f.endsWith("route.ts"))).toHaveLength(7);
  });
});

describe("the tender WBS server", () => {
  const files = ["src/lib/tender/wbs/server.ts", "src/lib/tender/wbs/read.ts"];

  it("every query on a WBS table carries the workspace and the deal", () => {
    for (const f of files) {
      const src = lf(read(f));
      expect(src.match(/\.from\("(tender_wbs_items|tender_wbs_line_parts|tender_boq_lines)"\)/g)?.length, f).toBeGreaterThan(0);
      for (const m of src.matchAll(/\.from\("(tender_wbs_items|tender_wbs_line_parts|tender_boq_lines)"\)[^;]*?;\n/g)) {
        if (/\.insert\(/.test(m[0])) continue; // inserted rows are checked below
        expect(m[0], `${f}: ${m[0].slice(0, 120)}`).toMatch(/tenant_id|tenantId/);
        expect(m[0], `${f}: ${m[0].slice(0, 120)}`).toMatch(/opportunity_id|opportunityId|oppId/);
      }
      // employees: always by this workspace
      for (const m of src.matchAll(/\.from\("employees"\)[^;]*?;\n/g)) expect(m[0], f).toMatch(/tenant_id/);
    }
  });

  it("every row it inserts names the workspace and the deal", () => {
    const src = lf(read("src/lib/tender/wbs/server.ts"));
    const inserts = [...src.matchAll(/\.insert\(([\s\S]*?)\);\n/g)].map((m) => m[1]);
    expect(inserts.length).toBeGreaterThanOrEqual(4);
    for (const body of inserts) {
      expect(body).toMatch(/tenant_id: ctx\.tenantId/);
      expect(body).toMatch(/opportunity_id: ctx\.opportunityId/);
    }
  });

  it("a write is reached only through the gate: nothing here opens its own session or reads a tenant from a body", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/requireTenantUser|createAdminSupabase\(/);
      expect(src, f).not.toMatch(/body\.tenant|input\.tenant/);
    }
  });

  it("changes are logged on the tender", () => {
    const src = read("src/lib/tender/wbs/server.ts");
    expect(src).toMatch(/objectType: "opportunity_tenders"/);
    for (const field of ["added", "renamed", "moved", "owner", "removed", "lines", "split", "unsplit", "renumbered"]) expect(src, field).toContain(field);
  });
});
