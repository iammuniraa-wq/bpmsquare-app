import { describe, it, expect, vi } from "vitest";
import { insertLinesTolerant, resolveLineIdsAndSelection } from "./quoteLineFlags";
import type { SupabaseClient } from "@supabase/supabase-js";

// Fake Supabase client whose .from(table).insert(rows) answers from a
// scripted queue of responses -- enough to exercise insertLinesTolerant's
// retry loop without a real database.
function fakeSupabase(responses: ({ error: null } | { error: { code?: string; message: string } })[]): SupabaseClient {
  let i = 0;
  const insert = vi.fn(async () => responses[Math.min(i++, responses.length - 1)]);
  return { from: () => ({ insert }) } as unknown as SupabaseClient;
}

describe("insertLinesTolerant", () => {
  it("succeeds on the first try when nothing is missing", async () => {
    const supabase = fakeSupabase([{ error: null }]);
    const result = await insertLinesTolerant(supabase, "standard_quote_lines", [{ a: 1 }]);
    expect(result).toEqual({ error: null, strippedColumns: [] });
  });

  it("strips exactly the column PostgREST names and retries", async () => {
    const supabase = fakeSupabase([
      { error: { code: "42703", message: 'column "group_id" of relation "standard_quote_lines" does not exist' } },
      { error: null },
    ]);
    const result = await insertLinesTolerant(supabase, "standard_quote_lines", [{ group_id: "g1", description: "x" }]);
    expect(result.error).toBeNull();
    expect(result.strippedColumns).toEqual(["group_id"]);
  });

  it("strips more than one missing column across successive retries", async () => {
    const supabase = fakeSupabase([
      { error: { code: "42703", message: 'column "group_id" of relation "standard_quote_lines" does not exist' } },
      { error: { code: "42703", message: 'column "break_of" of relation "standard_quote_lines" does not exist' } },
      { error: null },
    ]);
    const result = await insertLinesTolerant(supabase, "standard_quote_lines", [{ group_id: "g1", break_of: "b1", description: "x" }]);
    expect(result.error).toBeNull();
    expect(result.strippedColumns).toEqual(["group_id", "break_of"]);
  });

  it("passes through a non-missing-column error immediately", async () => {
    const supabase = fakeSupabase([{ error: { code: "23505", message: "duplicate key value" } }]);
    const result = await insertLinesTolerant(supabase, "quote_lines", [{ description: "x" }]);
    expect(result.error?.message).toBe("duplicate key value");
    expect(result.strippedColumns).toEqual([]);
  });

  it("gives up after too many missing-column retries rather than looping forever", async () => {
    const supabase = fakeSupabase(
      Array.from({ length: 10 }, (_, i) => ({ error: { code: "42703", message: `column "c${i}" of relation "x" does not exist` } }))
    );
    const result = await insertLinesTolerant(supabase, "quote_lines", [{ description: "x" }]);
    expect(result.error).not.toBeNull();
    expect(result.strippedColumns.length).toBe(8);
  });
});

type Raw = { local_id?: string; amount: number; group_id?: string | null; group_type?: string | null; break_of?: string | null; is_selected?: boolean };

describe("resolveLineIdsAndSelection", () => {
  it("assigns every line a fresh, distinct real id", () => {
    const out = resolveLineIdsAndSelection<Raw>([{ amount: 100 }, { amount: 200 }]);
    expect(out).toHaveLength(2);
    expect(out[0].id).not.toBe(out[1].id);
    expect(out.every((l) => typeof l.id === "string" && l.id.length > 0)).toBe(true);
  });

  it("resolves break_of to the parent's real id when local_id matches within the batch", () => {
    const out = resolveLineIdsAndSelection<Raw>([
      { local_id: "base", amount: 22365 },
      { local_id: "b10", amount: 21200, break_of: "base" },
    ]);
    const base = out.find((l) => l.amount === 22365)!;
    const brk = out.find((l) => l.amount === 21200)!;
    expect(brk.break_of).toBe(base.id);
  });

  it("drops a break_of that does not match any local_id in this batch", () => {
    // A local_id from a PREVIOUS request (e.g. a stale/replayed value, or
    // one aimed at an entirely different document) must never be trusted --
    // this is the guardrail against a foreign id from the request body.
    const out = resolveLineIdsAndSelection<Raw>([
      { local_id: "x", amount: 100, break_of: "some-other-quotes-line-local-id" },
    ]);
    expect(out[0].break_of).toBeNull();
  });

  it("never lets a break_of reference resolve outside its own submitted batch even with colliding local_ids", () => {
    // Two independent calls (e.g. two different documents saved back to
    // back) must not leak an id from one into the other, even if their
    // client-chosen local_id strings happen to collide.
    const first = resolveLineIdsAndSelection<Raw>([{ local_id: "L1", amount: 100 }]);
    const second = resolveLineIdsAndSelection<Raw>([{ local_id: "L2", amount: 200, break_of: "L1" }]);
    expect(second[0].break_of).toBeNull();
    expect(first[0].id).not.toBe(second[0].id);
  });

  it("resolves an alternative group and a break family together in one batch", () => {
    const out = resolveLineIdsAndSelection<Raw>([
      { local_id: "base", amount: 22365 },
      { local_id: "b50", amount: 20100, break_of: "base", is_selected: true },
      { local_id: "optA", amount: 1000, group_id: "g1", group_type: "alternative" },
      { local_id: "optB", amount: 2000, group_id: "g2", group_type: "alternative" },
    ]);
    const byLocal = (k: string) => out.find((_l, i) => ["base", "b50", "optA", "optB"][i] === k)!;
    expect(byLocal("base").is_selected).toBe(false); // the break was chosen instead
    expect(byLocal("b50").is_selected).toBe(true);
    expect(byLocal("optA").is_selected).toBe(true); // first group wins, nothing explicit
    expect(byLocal("optB").is_selected).toBe(false);
  });

  it("omits local_id from the returned rows so it never lands in a database insert", () => {
    const out = resolveLineIdsAndSelection<Raw>([{ local_id: "x", amount: 100 }]);
    expect(out[0]).not.toHaveProperty("local_id");
  });
});
