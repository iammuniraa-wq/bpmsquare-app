import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The audit row and the daily count: both tolerate the migration (0205) not being applied, and the migration itself
// keeps the table service-role-write-only.

const db = vi.hoisted(() => ({ inserted: [] as Record<string, unknown>[], deleted: [] as unknown[], insertError: null as null | { code?: string; message: string }, countError: null as null | { code?: string; message: string }, count: 0 as number | null, filters: [] as [string, unknown][], first: [] as { id: string }[] | null, firstError: null as null | { message: string } }));

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        db.inserted.push({ table, ...row });
        const result = { error: db.insertError };
        return {
          then: (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res),
          select: () => ({ single: async () => ({ data: db.insertError ? null : { id: "slot-1" }, error: db.insertError }) }),
        };
      },
      delete: () => ({ eq: (_k: string, id: unknown) => ({ eq: async () => { db.deleted.push(id); return { error: null }; } }) }),
      select: () => {
        const chain: Record<string, unknown> = {};
        const eq = (k: string, v: unknown) => { db.filters.push([k, v]); return chain; };
        Object.assign(chain, {
          order: () => chain, limit: () => Promise.resolve({ data: db.first, error: db.firstError }),
          eq, gte: (k: string, v: unknown) => { db.filters.push([k, v]); return Promise.resolve({ count: db.count, error: db.countError }); },
        });
        return chain;
      },
    }),
  }),
}));

import { MAX_RESEARCH_PER_DAY } from "./webConsent";
import { CLAIM_SURFACE, SLOT_SURFACE, claimWebConsent, recordWebAudit, reserveWebSlot, type WebAudit } from "./research";

const audit: WebAudit = {
  tenantId: "t-1", userId: "u-1", route: "/accounts/x", query: "Tesla Germany company website", why: "basics", status: "done",
  sources: [{ title: "T", url: "https://t.example/" }], tokens: 12300, searches: 2, removed: 1,
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => { db.inserted = []; db.deleted = []; db.insertError = null; db.countError = null; db.count = 0; db.filters = []; db.first = []; db.firstError = null; errors = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => errors.mockRestore());

describe("the audit row", () => {
  it("records the signed consent id when there is one (audit 2026-10-22 L5)", async () => {
    await recordWebAudit({ ...audit, consent: { id: "c-1" } });
    expect(db.inserted[0].params).toEqual({ query: "Tesla Germany company website", why: "basics", consent_id: "c-1" });
  });

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

describe("the daily cap reserves a slot before the search (audit 2026-10-22 L4)", () => {
  const NOW = new Date("2026-10-22T15:00:00Z");

  it("writes a zero-token reservation row, counts today's reservations for this person, and keeps the slot when under the cap", async () => {
    db.count = 3;
    const slot = await reserveWebSlot("t-1", "u-1", NOW);
    expect(slot.ok).toBe(true);
    expect(db.inserted[0]).toMatchObject({ table: "ai_usage_log", tenant_id: "t-1", user_id: "u-1", surface: SLOT_SURFACE, input_tokens: 0, output_tokens: 0 });
    expect(db.filters).toEqual([["tenant_id", "t-1"], ["user_id", "u-1"], ["surface", SLOT_SURFACE], ["created_at", "2026-10-22T00:00:00.000Z"]]);
    expect(db.deleted).toEqual([]);
  });

  it("the last allowed slot is still granted; the one past the cap is refused and gives its row back", async () => {
    db.count = MAX_RESEARCH_PER_DAY;
    expect((await reserveWebSlot("t-1", "u-1", NOW)).ok).toBe(true);
    db.count = MAX_RESEARCH_PER_DAY + 1;
    expect((await reserveWebSlot("t-1", "u-1", NOW)).ok).toBe(false);
    expect(db.deleted).toEqual(["slot-1"]);
  });

  it("fails closed: a failed count, a null count, a failed insert or a missing log all refuse", async () => {
    db.countError = { code: "XX000", message: "boom" };
    expect((await reserveWebSlot("t-1", "u-1", NOW)).ok).toBe(false);
    db.countError = null; db.count = null;
    expect((await reserveWebSlot("t-1", "u-1", NOW)).ok).toBe(false);
    db.count = 0; db.insertError = { code: "42P01", message: "x" };
    expect((await reserveWebSlot("t-1", "u-1", NOW)).ok).toBe(false);
  });

  it("releasing a slot deletes its row, scoped to the tenant", async () => {
    db.count = 1;
    const slot = await reserveWebSlot("t-1", "u-1", NOW);
    if (slot.ok) await slot.release();
    expect(db.deleted).toEqual(["slot-1"]);
  });
});

describe("a consent is spent on first use (audit 2026-10-22 L5)", () => {
  beforeEach(() => { db.first = [{ id: "slot-1" }]; db.firstError = null; });

  it("writes a zero-token claim row carrying the consent id and wins when its row is the earliest", async () => {
    expect(await claimWebConsent("t-1", "u-1", "consent-1")).toBe(true);
    expect(db.inserted[0]).toMatchObject({ table: "ai_usage_log", tenant_id: "t-1", user_id: "u-1", surface: CLAIM_SURFACE, model: "consent-1", input_tokens: 0, output_tokens: 0 });
    expect(db.filters).toEqual([["tenant_id", "t-1"], ["surface", CLAIM_SURFACE], ["model", "consent-1"]]);
  });

  it("a replay loses: an earlier row for the same consent id already exists", async () => {
    db.first = [{ id: "earlier-claim" }];
    expect(await claimWebConsent("t-1", "u-1", "consent-1")).toBe(false);
  });

  it("fails closed: a failed write, a failed read or an empty read all refuse", async () => {
    db.insertError = { code: "42P01", message: "x" };
    expect(await claimWebConsent("t-1", "u-1", "consent-1")).toBe(false);
    db.insertError = null; db.firstError = { message: "boom" };
    expect(await claimWebConsent("t-1", "u-1", "consent-1")).toBe(false);
    db.firstError = null; db.first = [];
    expect(await claimWebConsent("t-1", "u-1", "consent-1")).toBe(false);
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
