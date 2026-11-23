import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The register's migrations (0255-0257): RLS on every table with a tenant SELECT policy and NOTHING that writes (the 0078 and 0199 lessons: release
// is an authority, so a member must not set status = 'released' through PostgREST), the release function reachable by the service role only, the
// immutability triggers, a private bucket with no member policy, and the bundles carrying each migration verbatim.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const m0255 = read("supabase/migrations/0255_drawing_register.sql");
const m0256 = read("supabase/migrations/0256_drawing_elements.sql");
const m0257 = read("supabase/migrations/0257_drawing_boq_pins.sql");
const code = (sql: string) => sql.replace(/--[^\n]*/g, "");

const TABLES = [["drawing_types", m0255], ["drawings", m0255], ["drawing_revisions", m0255], ["drawing_revision_elements", m0256]] as const;

describe("row level security", () => {
  it.each(TABLES)("%s: RLS on, one tenant SELECT policy, no policy that writes", (table, sql) => {
    const c = code(sql);
    expect(c).toMatch(new RegExp(`alter table ${table} enable row level security`));
    const policies = [...c.matchAll(new RegExp(`create policy "[^"]+" on ${table}\\s+for (\\w+)`, "g"))].map((m) => m[1]);
    expect(policies).toEqual(["select"]);
    expect(c).toMatch(new RegExp(`create policy "${table}: tenant read" on ${table} for select\\s+using \\(tenant_id in \\(select tenant_id from tenant_users where user_id = auth\\.uid\\(\\)\\)\\)`));
    expect(c).not.toMatch(new RegExp(`on ${table}\\s+for (all|insert|update|delete)`));
  });

  it("every table has a tenant_id that cascades with the workspace", () => {
    for (const [table, sql] of TABLES) {
      const block = sql.slice(sql.indexOf(`create table if not exists ${table} (`));
      expect(block.slice(0, block.indexOf(");"))).toMatch(/tenant_id\s+uuid not null references tenants\(id\) on delete cascade/);
    }
  });

  it("0257 adds columns only: no policy is added or changed on the BOQ lines", () => {
    expect(code(m0257)).not.toMatch(/create policy|drop policy|disable row level security/i);
    expect(code(m0257)).toMatch(/add column if not exists drawing_rev_id/);
  });

  it("only the file bucket is created, private, with no storage policy for anyone", () => {
    const c = code(m0255);
    expect(c).toMatch(/insert into storage\.buckets \(id, name, public, file_size_limit\)\s+values \('drawing-files', 'drawing-files', false, 52428800\)/);
    expect(c).not.toMatch(/on storage\.objects/);
  });
});

describe("the one atomic release", () => {
  const c = code(m0255);
  it("is a security definer function the service role alone can run", () => {
    expect(c).toMatch(/function release_drawing_revision\(p_tenant uuid, p_revision uuid, p_user uuid, p_effective date default current_date\)/);
    expect(c).toMatch(/security definer set search_path = public/);
    expect(c).toMatch(/revoke all on function release_drawing_revision\(uuid, uuid, uuid, date\) from public/);
    expect(c).toMatch(/revoke all on function release_drawing_revision\(uuid, uuid, uuid, date\) from anon, authenticated/);
    expect(c).toMatch(/grant execute on function release_drawing_revision\(uuid, uuid, uuid, date\) to service_role/);
    expect(c).not.toMatch(/grant execute on function release_drawing_revision[^;]*to (anon|authenticated|public)/);
  });
  it("locks the drawing, supersedes the old release, releases the new one and points the drawing at it, all scoped to the tenant", () => {
    const fn = c.slice(c.indexOf("function release_drawing_revision"), c.indexOf("revoke all on function release_drawing_revision"));
    expect(fn).toMatch(/for update/);
    expect(fn.indexOf("set status = 'superseded'")).toBeGreaterThan(-1);
    expect(fn.indexOf("set status = 'superseded'")).toBeLessThan(fn.indexOf("set status = 'released'"));
    expect(fn).toMatch(/update drawings set current_rev_id = rev\.id/);
    for (const stmt of fn.match(/update drawing[^;]+;/g) ?? []) expect(stmt).toMatch(/tenant_id = p_tenant/);
    expect(fn).toMatch(/Only a revision in review can be released/);
  });
  it("repeats the second-person rule so a bug in a route cannot let a submitter sign their own drawing", () => {
    expect(c).toMatch(/typ\.second_person and rev\.submitted_by is not distinct from p_user/);
  });
});

describe("a released revision is a record", () => {
  it("one released and one open revision per drawing, enforced by partial unique indexes", () => {
    const c = code(m0255);
    expect(c).toMatch(/create unique index if not exists drawing_revisions_one_released on drawing_revisions \(drawing_id\) where status = 'released'/);
    expect(c).toMatch(/create unique index if not exists drawing_revisions_one_open on drawing_revisions \(drawing_id\) where status in \('draft', 'in_review'\)/);
    expect(c).toMatch(/create unique index if not exists drawing_revisions_source_uniq on drawing_revisions \(drawing_id, source_ref\) where source_ref is not null/);
    expect(c).toMatch(/create unique index if not exists drawings_tenant_no_uniq on drawings \(tenant_id, lower\(drawing_no\)\)/);
  });
  it("a trigger refuses to change the file, label or number once submitted, to un-release, and to delete a non-draft revision", () => {
    const c = code(m0255);
    const guard = c.slice(c.indexOf("function drawing_revisions_guard"), c.indexOf("drop trigger if exists drawing_revisions_guard_trg"));
    expect(guard).toMatch(/A drawing revision that left draft cannot be deleted/);
    expect(guard).toMatch(/old\.status <> 'draft'[\s\S]*new\.file_path is distinct from old\.file_path/);
    expect(guard).toMatch(/new\.file_sha256 is distinct from old\.file_sha256/);
    expect(guard).toMatch(/new\.rev_label is distinct from old\.rev_label/);
    expect(guard).toMatch(/A released drawing revision is never un-released/);
    expect(guard).toMatch(/A superseded drawing revision is final/);
    expect(guard).toMatch(/pg_trigger_depth\(\) <= 1/);
    expect(c).toMatch(/create trigger drawing_revisions_guard_trg before update or delete on drawing_revisions\s+for each row/);
  });
  it("the elements of a revision that left draft are frozen as well", () => {
    const c = code(m0256);
    expect(c).toMatch(/The elements of a drawing revision are fixed once it was submitted/);
    expect(c).toMatch(/create trigger drawing_elements_guard_trg before insert or update or delete on drawing_revision_elements/);
  });
});

describe("applied by hand, twice safely", () => {
  it.each([["0255", m0255], ["0256", m0256], ["0257", m0257]])("%s is idempotent and says what to run first", (_n, sql) => {
    expect(sql).toMatch(/Idempotent; safe to run twice/);
    expect(sql).toMatch(/raise exception 'Run /);
    const c = code(sql);
    expect(c).not.toMatch(/create table (?!if not exists)/i);
    expect(c).not.toMatch(/create (unique )?index (?!if not exists)/i);
  });
  it("the bundles carry the migrations verbatim, in order, in one transaction", () => {
    const a = read("scripts/run-bundle-dwg-0255-0256-2026-11-24.sql");
    expect(a).toContain(m0255.trim());
    expect(a).toContain(m0256.trim());
    expect(a.indexOf(m0255.trim())).toBeLessThan(a.indexOf(m0256.trim()));
    expect(a).toMatch(/\nbegin;\n/);
    expect(a.trimEnd().endsWith("commit;")).toBe(true);
    const b = read("scripts/run-bundle-dwg-0257-2026-11-24.sql");
    expect(b).toContain(m0257.trim());
    expect(b.trimEnd().endsWith("commit;")).toBe(true);
  });
});
