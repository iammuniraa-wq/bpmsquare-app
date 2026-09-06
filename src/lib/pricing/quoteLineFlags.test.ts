import { describe, it, expect, vi } from "vitest";
import { insertLinesTolerant } from "./quoteLineFlags";
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
