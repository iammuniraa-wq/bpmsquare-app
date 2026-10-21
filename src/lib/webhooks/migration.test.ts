import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// No SQL engine runs in the test suite, so the idempotency and safety of 0202 are held by what the file
// must say: every change is guarded or conflict-safe, the import is keyed by legacy_key, and no policy is added.

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8").replaceAll(String.fromCharCode(13), "");
const code = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("migration 0202: webhooks library", () => {
  const raw = read("supabase/migrations/0202_webhooks_library.sql");
  const sql = code(raw);

  it("extends webhooks with every column of the spec, additively", () => {
    for (const col of ["kind text not null default 'event'", "object_type text", "method text not null default 'POST'", "headers jsonb not null default '[]'::jsonb",
      "payload_mode text not null default 'standard'", "template text", "allow_personal_data boolean not null default false",
      "timeout_ms integer not null default 15000", "paused_reason text", "legacy_key text", "updated_at timestamptz"]) {
      expect(sql, col).toContain(`add column if not exists ${col}`);
    }
    expect(sql).toMatch(/check \(timeout_ms between 5000 and 30000\)/);
    expect(sql).not.toMatch(/drop (column|table)/i);
  });

  it("every block is guarded with to_regclass, so a database without the table is skipped", () => {
    for (const t of ["webhooks", "coverages", "integration_messages", "tenants"]) expect(sql, t).toContain(`to_regclass('public.${t}')`);
    const doBlocks = sql.match(/do \$\$/g) ?? [];
    expect(doBlocks.length).toBeGreaterThanOrEqual(5);
  });

  it("the references are added with if not exists", () => {
    expect(sql).toContain("alter table coverages add column if not exists webhook_id uuid references webhooks(id) on delete set null");
    expect(sql).toContain("alter table integration_messages add column if not exists webhook_id uuid");
    expect(sql).toContain("create index if not exists webhooks_tenant_kind_idx");
    expect(sql).toContain("create unique index if not exists webhooks_legacy_key_idx on webhooks (tenant_id, legacy_key) where legacy_key is not null");
  });

  it("imports the ERP push URL and each Coverage endpoint once: keyed by legacy_key, conflict-safe", () => {
    expect(sql).toContain("'integration_push:default'");
    expect(sql).toContain("'integration_push:endpoint:' || (e ->> 'id')");
    const inserts = sql.match(/insert into webhooks[\s\S]*?do nothing/g) ?? [];
    expect(inserts).toHaveLength(2);
    for (const i of inserts) expect(i).toContain("on conflict (tenant_id, legacy_key) where legacy_key is not null do nothing");
  });

  it("keeps what the old push sent: a Call webhook for accounts with personal data allowed, secret copied as stored, URL as stored", () => {
    expect(sql).toMatch(/'call', 'accounts', 'POST', 'standard', true, true/);
    expect(sql).toContain("t.config -> 'integration_push' ->> 'webhook_secret'");
    expect(sql).toContain("btrim(t.config -> 'integration_push' ->> 'webhook_url')");
    // A migrated http:// address is kept (not rewritten): the app marks it "needs https".
    expect(sql).not.toMatch(/replace\([^)]*http:/i);
  });

  it("points Coverage rows and the Accounts button at the imported webhooks, only where they are not set", () => {
    expect(sql).toMatch(/update coverages c set webhook_id = w\.id/);
    expect(sql).toContain("c.webhook_id is null");
    expect(sql).toContain("w.legacy_key = 'integration_push:endpoint:' || c.erp_endpoint_id");
    expect(sql).toContain("w.tenant_id = c.tenant_id");
    expect(sql).toMatch(/coalesce\(t\.config -> 'webhooks_library' -> 'record_buttons' ->> 'accounts', ''\) = ''/);
  });

  it("never removes the old configuration and adds no policy and no tenants column", () => {
    expect(sql).not.toMatch(/erp_endpoint_id\s*=\s*null/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/alter table tenants/i);
    expect(sql).not.toMatch(/#-\s*'\{/);
    expect(sql).not.toMatch(/[^>]-\s+'integration_push'/);
  });

  it("the demo seed switches the flag on for is_demo workspaces only", () => {
    const seed = code(read("scripts/seed-webhooks-demo.sql"));
    expect(seed).toMatch(/update tenants set features = [\s\S]*where is_demo = true/);
    expect((seed.match(/where t\.is_demo = true/g) ?? []).length).toBe(2);
    expect((seed.match(/on conflict \(tenant_id, legacy_key\) where legacy_key is not null do nothing/g) ?? []).length).toBe(2);
    expect(seed).toContain("https://example.com");
    expect(seed).not.toMatch(/http:\/\//);
  });

  it("bundle 11 is 0202 then the seed, and says to run bundle 10 first", () => {
    const bundle = read("scripts/run-bundle-11-webhooks-2026-10-21.sql");
    expect(bundle.indexOf(raw.trim())).toBeGreaterThan(-1);
    expect(bundle.indexOf("-- ---- seed: scripts/seed-webhooks-demo.sql ----")).toBeGreaterThan(bundle.indexOf(raw.trim()) + raw.trim().length - 1);
    expect(bundle).toMatch(/bundle 10/);
  });
});
