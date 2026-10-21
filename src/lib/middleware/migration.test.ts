import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isKnownEvent, EVENTS } from "@/lib/events/catalog";

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8").replaceAll(String.fromCharCode(13), "");
const code = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/[ \t]+/g, " ");

describe("migration 0201: integration_messages", () => {
  const sql = code(read("supabase/migrations/0201_integration_middleware.sql"));

  it("has the spec's columns and tenant_id", () => {
    for (const col of ["tenant_id uuid not null references tenants(id)", "direction", "channel", "connector_id", "entity", "object_type", "object_id", "ref_label", "status", "http_status", "error", "duration_ms", "correlation_id", "summary jsonb", "payload jsonb", "created_at"]) {
      expect(sql, col).toContain(col);
    }
    expect(sql).toMatch(/status\s+text not null check \(status in \('ok', 'failed', 'pending', 'skipped', 'redirected'\)\)/);
  });

  it("enables RLS in the same migration, SELECT for admins of the tenant only, no member write policy", () => {
    expect(sql).toMatch(/alter table integration_messages enable row level security/);
    const policies = [...sql.matchAll(/create policy "([^"]+)" on integration_messages for (\w+)/g)];
    expect(policies).toHaveLength(1);
    expect(policies[0][2]).toBe("select");
    expect(sql).toMatch(/user_id = auth\.uid\(\) and role = 'admin'/);
    expect(sql).not.toMatch(/for (all|insert|update|delete)/);
  });

  it("indexes (tenant_id, created_at desc) and (tenant_id, status, created_at desc)", () => {
    expect(sql).toContain("on integration_messages (tenant_id, created_at desc)");
    expect(sql).toContain("on integration_messages (tenant_id, status, created_at desc)");
  });

  it("is idempotent", () => {
    expect(sql).toMatch(/create table if not exists integration_messages/);
    expect(sql.match(/create index/g)!.length).toBe(sql.match(/create index if not exists/g)!.length);
    expect(sql).toMatch(/drop policy if exists "integration_messages: admin read"/);
  });
});

describe("demo seed and bundle", () => {
  const seed = code(read("scripts/seed-middleware-demo.sql"));
  const bundle = read("scripts/run-bundle-10-middleware-2026-10-21.sql");

  it("flips the flag on for demo tenants only", () => {
    expect(seed).toMatch(/where is_demo = true/);
    expect(seed).toContain('"integration_middleware": true');
    expect(seed).not.toMatch(/delete|drop|truncate/i);
  });

  it("the bundle is 0201 followed by the seed", () => {
    const m = read("supabase/migrations/0201_integration_middleware.sql");
    const s = read("scripts/seed-middleware-demo.sql");
    expect(bundle).toContain(m);
    expect(bundle).toContain(s);
    expect(bundle.indexOf(m)).toBeLessThan(bundle.indexOf(s));
  });

  it("is listed in the operational ledger as pending", () => {
    const ledger = read("PROJECT.md");
    expect(ledger).toContain("0201_integration_middleware.sql -- PENDING");
    expect(ledger).toContain("run-bundle-10-middleware-2026-10-21.sql");
  });
});

describe("vocabulary events", () => {
  it("quote.awarded and quote.rejected are in the catalogue next to quote.status_changed", () => {
    expect(isKnownEvent("quote.awarded")).toBe(true);
    expect(isKnownEvent("quote.rejected")).toBe(true);
    expect(isKnownEvent("quote.status_changed")).toBe(true);
    expect(EVENTS.QUOTE_AWARDED).toBe("quote.awarded");
  });
});
