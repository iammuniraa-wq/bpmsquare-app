import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The audit row and the daily count: both tolerate the migration (0205) not being applied, and the migration itself
// keeps the table service-role-write-only.

const db = vi.hoisted(() => ({ inserted: [] as Record<string, unknown>[], insertError: null as null | { code?: string; message: string }, countError: null as null | { code?: string; message: string }, count: 0, filters: [] as [string, unknown][] }));

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => { db.inserted.push({ table, ...row }); return { error: db.insertError }; },
      select: () => {
        const chain: Record<string, unknown> = {};
        const eq = (k: string, v: unknown) => { db.filters.push([k, v]); return chain; };
        Object.assign(chain, {
          eq, gte: (k: string, v: unknown) => { db.filters.push([k, v]); return Promise.resolve({ count: db.count, error: db.countError }); },
        });
        return chain;
      },
    }),
  }),
}));

import { RESEARCH_SURFACE, recordWebAudit, webResearchToday, type WebAudit } from "./research";

const audit: WebAudit = {
  tenantId: "t-1", userId: "u-1", route: "/accounts/x", query: "Tesla Germany company website", why: "basics", status: "done",
  sources: [{ title: "T", url: "https://t.example/" }], tokens: 12300, searches: 2, removed: 1,
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => { db.inserted = []; db.insertError = null; db.countError = null; db.count = 0; db.filters = []; errors = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => errors.mockRestore());

describe("the audit row", () => {
  it("is one assistant_actions row of kind web_search with the query, sources and tokens", async () => {
    await recordWebAudit(audit);
    expect(db.inserted).toEqual([{
      table: "assistant_actions", tenant_id: "t-1", user_id: "u-1", kind: "web_search", action_key: "web_search", route: "/accounts/x",
      params: { query: "Tesla Germany company website", why: "basics" }, status: "done",
      result: { reason: null, searches: 2, instruction_like_removed: 1 }, sources: audit.sources, tokens: 12300,
    }]);
  });

  it("a refusal records the reason and no sources", async () => {
    await recordWebAudit({ ...audit, status: "refused", reason: "The search contains words that did not come from you.", sources: [], tokens: 0, searches: 0 });
    expect(db.inserted[0]).toMatchObject({ status: "refused", result: { reason: "The search contains words that did not come from you." }, sources: [] });
  });

  it("while the migration is pending nothing is thrown and nothing is logged as an error", async () => {
    for (const e of [{ code: "42P01", message: "x" }, { code: "PGRST205", message: "Could not find the table 'public.assistant_actions' in the schema cache" }]) {
      db.insertError = e;
      await expect(recordWebAudit(audit)).resolves.toBeUndefined();
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it("any other failure is logged but never stops the search", async () => {
    db.insertError = { code: "23505", message: "boom" };
    await expect(recordWebAudit(audit)).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(1);
  });
});

describe("the daily count", () => {
  it("counts this person's research calls today from the usage log, scoped to the tenant", async () => {
    db.count = 7;
    expect(await webResearchToday("t-1", "u-1", new Date("2026-10-22T15:00:00Z"))).toBe(7);
    expect(db.filters).toEqual([["tenant_id", "t-1"], ["user_id", "u-1"], ["surface", RESEARCH_SURFACE], ["created_at", "2026-10-22T00:00:00.000Z"]]);
  });
  it("reads a missing log as zero", async () => {
    db.countError = { code: "42P01", message: "x" };
    expect(await webResearchToday("t-1", "u-1")).toBe(0);
  });
});

describe("migration 0205", () => {
  const dir = path.resolve(__dirname, "../../../");
  const file = readFileSync(path.join(dir, "supabase/migrations/0205_assistant_actions.sql"), "utf8");
  const code = file.replace(/--[^\n]*/g, "");

  it("enables row level security and gives members read access only: no insert, update, delete or all policy", () => {
    expect(code).toMatch(/alter table assistant_actions enable row level security/);
    const policies = [...code.matchAll(/create policy "([^"]+)" on assistant_actions for (\w+)/gi)];
    expect(policies.map((m) => m[2].toLowerCase())).toEqual(["select"]);
  });

  it("carries tenant_id and adds change_log.via only when change_log exists", () => {
    expect(code).toMatch(/tenant_id uuid not null references tenants\(id\)/);
    expect(code).toMatch(/to_regclass\('public\.change_log'\) is null/);
    expect(code).toMatch(/add column if not exists via text/);
  });

  it("the run bundle carries the migration verbatim and the demo switch", () => {
    const bundle = readFileSync(path.join(dir, "scripts/run-bundle-14-assistant-actions-2026-10-22.sql"), "utf8").replace(/\r\n/g, "\n");
    expect(bundle).toContain(file.replace(/\r\n/g, "\n").trim());
    expect(bundle).toContain('"ai_assistant_web": true');
    expect(bundle).toContain("is_demo = true");
  });
});
