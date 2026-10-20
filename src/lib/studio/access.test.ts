import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canSeeStudy, visibleStudies } from "./access";

const alice = { userId: "alice", role: "member" as const, tenantIsDemo: true };
const bob = { userId: "bob", role: "member" as const, tenantIsDemo: true };
const demoAdmin = { userId: "carol", role: "admin" as const, tenantIsDemo: true };
const clientAdmin = { userId: "dan", role: "admin" as const, tenantIsDemo: false };
const clientMember = { userId: "erin", role: "member" as const, tenantIsDemo: false };

describe("a study is private to its creator on the demo workspace", () => {
  const study = { created_by: "alice" };

  it("the creator sees it", () => {
    expect(canSeeStudy(alice, study)).toBe(true);
  });

  it("another prospect on the same demo workspace does not", () => {
    expect(canSeeStudy(bob, study)).toBe(false);
  });

  it("not even a workspace admin on the demo tenant", () => {
    expect(canSeeStudy(demoAdmin, study)).toBe(false);
  });

  it("a list is filtered to the viewer's own", () => {
    const rows = [{ created_by: "alice", n: 1 }, { created_by: "bob", n: 2 }, { created_by: "alice", n: 3 }];
    expect(visibleStudies(alice, rows).map((r) => r.n)).toEqual([1, 3]);
    expect(visibleStudies(bob, rows).map((r) => r.n)).toEqual([2]);
    expect(visibleStudies(demoAdmin, rows)).toEqual([]);
  });
});

describe("on a client workspace", () => {
  const study = { created_by: "erin" };
  it("the creator and the tenant's admins see it, other members do not", () => {
    expect(canSeeStudy(clientMember, study)).toBe(true);
    expect(canSeeStudy(clientAdmin, study)).toBe(true);
    expect(canSeeStudy({ ...clientMember, userId: "frank" }, study)).toBe(false);
  });
});

// The same rule is enforced in the database. These read the migration and the
// route layer so a change to either cannot quietly drop the privacy rule.
describe("the privacy rule is enforced below the app as well", () => {
  const sql = readFileSync(join(__dirname, "..", "..", "..", "supabase", "migrations", "0152_process_studio.sql"), "utf8");

  it("the header policy keys on the creator on a demo tenant", () => {
    expect(sql).toMatch(/create or replace function process_studio_can_see/);
    expect(sql).toMatch(/p_creator = auth\.uid\(\)/);
    expect(sql).toMatch(/is_demo/);
    expect(sql).toMatch(/for select\s+using \(process_studio_can_see\(tenant_id, created_by\)\)/);
  });

  it("no table has a write policy: writes go through routes that check ownership", () => {
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/for (all|insert|update|delete)\b/i);
  });

  it("every table has RLS enabled", () => {
    const tables = [...sql.matchAll(/create table if not exists (process_stud\w+)/g)].map((m) => m[1]);
    expect(tables.length).toBe(9);
    for (const t of tables.filter((x) => x === "process_studies")) expect(sql).toMatch(new RegExp(`alter table ${t} enable row level security`));
    expect(sql).toMatch(/'process_study_messages','process_study_steps','process_study_fit'/);
    expect(sql).toMatch(/enable row level security/);
  });

  const apiDir = join(__dirname, "..", "..", "app", "api", "process-studio");
  const routeFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? routeFiles(join(dir, e.name)) : e.name === "route.ts" ? [join(dir, e.name)] : []));

  it("every studio route opens the study through the access check", () => {
    const files = routeFiles(apiDir);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} must call studioAccess`).toContain("studioAccess(");
      // A route that takes an id must load the study through the owner-checked loader.
      if (f.includes("[id]")) expect(src, `${f} must open the study through ownedStudy`).toMatch(/ownedStudy\(/);
    }
  });
});
