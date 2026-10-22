import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// No SQL engine runs in the test suite, so the safety of 0203 is held by what the file must say: both tables are service role only
// (RLS on, no policy), every statement is idempotent, the webhook columns are guarded, and nothing is added to `tenants`.

const root = path.resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8").replaceAll(String.fromCharCode(13), "");
const code = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("migration 0203: mapping engine", () => {
  const raw = read("supabase/migrations/0203_mapping_engine.sql");
  const sql = code(raw);

  it("creates both tables only if they do not exist, tied to the tenant", () => {
    expect(sql).toContain("create table if not exists integration_mappings");
    expect(sql).toContain("create table if not exists integration_value_lists");
    expect((sql.match(/tenant_id uuid not null references tenants\(id\) on delete cascade/g) ?? []).length).toBe(2);
  });

  it("RLS is on and there is deliberately no policy, so only the service role reaches them", () => {
    expect(sql).toContain("alter table integration_mappings enable row level security");
    expect(sql).toContain("alter table integration_value_lists enable row level security");
    expect(/create\s+policy/i.test(sql)).toBe(false);
  });

  it("one active and one draft row per connection and document, a value list per kind", () => {
    expect(sql).toContain("create unique index if not exists integration_mappings_active_idx on integration_mappings (tenant_id, connection_id, document) where status = 'active'");
    expect(sql).toContain("create unique index if not exists integration_mappings_draft_idx on integration_mappings (tenant_id, connection_id, document) where status = 'draft'");
    expect(sql).toContain("unique (tenant_id, connection_id, kind)");
    expect(sql).toContain("check (status in ('active', 'previous', 'draft'))");
    expect(sql).toContain("check (direction in ('out', 'in'))");
  });

  it("the webhook columns and the new payload mode are guarded, and added only when payload_mode exists", () => {
    expect(sql).toContain("to_regclass('public.webhooks') is null");
    expect(sql).toContain("column_name = 'payload_mode'");
    expect(sql).toContain("payload_mode in ('standard', 'template', 'mapping')");
    expect(sql).toContain("add column if not exists mapping_id uuid references integration_mappings(id) on delete set null");
    expect(sql).toContain("add column if not exists response_key_path text");
  });

  it("is additive: nothing dropped but the one check it replaces, nothing added to tenants, no secret column", () => {
    expect(sql).not.toMatch(/drop (column|table)/i);
    expect(sql.match(/drop constraint/gi) ?? []).toHaveLength(1);
    expect(sql).not.toMatch(/alter table tenants/i);
    expect(sql).not.toMatch(/\b(secret|password|token|credential)\b/i);
  });

  it("the demo seed touches is_demo workspaces only and is conflict-safe", () => {
    const seed = code(read("scripts/seed-mapping-demo.sql"));
    expect((seed.match(/where t\.is_demo = true/g) ?? []).length).toBe(2);
    expect((seed.match(/on conflict \(tenant_id, connection_id, kind\) do nothing/g) ?? []).length).toBe(2);
    expect(seed).not.toMatch(/update tenants/);
  });

  it("bundle 12 is 0203 then the seed, and says to run bundles 10 and 11 first", () => {
    const bundle = read("scripts/run-bundle-12-mapping-2026-10-21.sql");
    const at = bundle.indexOf(raw.trim());
    expect(at).toBeGreaterThan(-1);
    expect(bundle.indexOf("-- ---- seed: scripts/seed-mapping-demo.sql ----")).toBeGreaterThan(at + raw.trim().length - 1);
    expect(bundle).toMatch(/bundle 10/);
    expect(bundle).toMatch(/bundle 11/);
  });
});
