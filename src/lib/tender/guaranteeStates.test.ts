import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BOND_STATUSES } from "./bond";

// Migration 0228 (bundle 39): the bid guarantee's four visible states. The SQL must agree with the code's list of states, be safe to run
// twice, drop nothing but one named check constraint, and the bundle must carry it verbatim; the ledger lists it as pending.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase/migrations/0228_bid_guarantee_states.sql");
const code = sql.replace(/^\s*--.*$/gm, "");

describe("migration 0228", () => {
  it("allows exactly the states the code knows, keeps held as legacy and defaults new rows to requested", () => {
    const listed = [...(code.match(/check \(bond_status in \(([^)]*)\)\)/)![1].matchAll(/'([a-z]+)'/g))].map((m) => m[1]);
    expect(listed.sort()).toEqual([...BOND_STATUSES].sort());
    expect(code).toMatch(/alter column bond_status set default 'requested'/);
  });

  it("finds the old check by what it checks, is guarded, and is safe to run twice", () => {
    expect(code).toMatch(/pg_get_constraintdef\(oid\) ilike '%bond_status%'/);
    expect(code).toMatch(/to_regclass\('public\.opportunity_tenders'\) is null/);
    expect(code).toMatch(/column_name = 'bond_status'/);
    expect(code.match(/drop constraint/g)).toHaveLength(1);
  });

  it("adds no column, so it needs no grant, and touches no policy, table or row", () => {
    expect(code).not.toMatch(/add column|grant |create table|create policy|drop policy|drop table|drop column|truncate|delete from|\bupdate\b/i);
  });

  it("the bundle carries the migration verbatim, and the ledger lists it as pending", () => {
    const bundle = read("scripts/run-bundle-39-bid-guarantee-states-2026-10-27.sql");
    expect(bundle).toContain(sql.trim());
    const project = read("PROJECT.md");
    expect(project).toMatch(/0228_bid_guarantee_states\.sql -- PENDING/);
    expect(project).toMatch(/run-bundle-39-bid-guarantee-states-2026-10-27\.sql/);
  });
});
