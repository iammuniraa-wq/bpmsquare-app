import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONNECTIONS_BUNDLE } from "./store";

// 0250 holds credentials and the addresses the server calls with them: the same stance as api_keys and webhooks (0199). RLS on,
// NO policy at all, tenant_id on both tables, and the bundle the owner runs carries the file verbatim.

const root = path.resolve(__dirname, "../../..");
const file = readFileSync(path.join(root, "supabase/migrations/0250_integration_connections.sql"), "utf8");
const sql = file.replace(/--[^\n]*/g, "");

describe("0250 integration_connections and integration_endpoints", () => {
  for (const table of ["integration_connections", "integration_endpoints"]) {
    it(`${table}: tenant_id, RLS on, and no policy at all`, () => {
      expect(new RegExp(`create table if not exists ${table} \\([^;]*tenant_id\\s+uuid not null references tenants\\(id\\)`).test(sql)).toBe(true);
      expect(sql).toMatch(new RegExp(`alter table ${table} enable row level security`));
    });
  }

  it("the file creates no policy and adds nothing to tenants", () => {
    expect(/create\s+policy/i.test(sql)).toBe(false);
    expect(/alter\s+table\s+tenants/i.test(sql)).toBe(false);
  });

  it("is idempotent: every create and index is guarded", () => {
    expect((sql.match(/create table/gi) ?? []).length).toBe((sql.match(/create table if not exists/gi) ?? []).length);
    expect((sql.match(/create (unique )?index/gi) ?? []).length).toBe((sql.match(/create (unique )?index if not exists/gi) ?? []).length);
  });

  it("the endpoint list is empty by construction: the migration inserts no row", () => {
    expect(/insert\s+into/i.test(sql)).toBe(false);
  });

  it("the bundle the owner runs carries the migration verbatim, and the code names that bundle", () => {
    expect(existsSync(path.join(root, CONNECTIONS_BUNDLE))).toBe(true);
    const bundle = readFileSync(path.join(root, CONNECTIONS_BUNDLE), "utf8");
    expect(bundle.replace(/\r\n/g, "\n")).toContain(file.replace(/\r\n/g, "\n").trim());
  });
});
