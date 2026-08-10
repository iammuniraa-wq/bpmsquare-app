import { describe, it, expect, vi } from "vitest";

// "server-only" is Next.js's build-time-only guard module (aliased away by
// its webpack config) -- it isn't a real installed package, so it has to be
// stubbed for this file to import quoteService.ts under plain vitest/node.
// vi.mock calls are hoisted above the imports below, so this runs first.
vi.mock("server-only", () => ({}));

import { replaceQuoteLines, type NormalizedLine } from "./quoteService";

// Regression coverage for v1 PATCH /api/v1/quotations/[id]'s line-replacement
// step. It used to delete-then-insert: a failure between the two left the
// quote with zero lines and a stale total (MULTI_TENANT_GUARDRAILS.md's
// tracked-debt item). replaceQuoteLines() now inserts first and only then
// deletes the old rows by explicit id -- these tests assert the actual
// call ORDER against a mock Supabase client, and the safe-failure behavior
// on each side, not just the happy path.

type Call = { op: "insert" | "delete"; ids?: string[] };

function makeSupabase(opts: { insertError?: string; deleteError?: string; insertedRows?: Record<string, unknown>[] }) {
  const calls: Call[] = [];
  const supabase = {
    from(table: string) {
      expect(table).toBe("quote_lines");
      return {
        insert(rows: Record<string, unknown>[]) {
          calls.push({ op: "insert" });
          return {
            select: () => Promise.resolve(
              opts.insertError
                ? { data: null, error: { message: opts.insertError } }
                : { data: opts.insertedRows ?? rows, error: null }
            ),
          };
        },
        delete() {
          return {
            eq: () => ({
              eq: () => ({
                in: (_col: string, ids: string[]) => {
                  calls.push({ op: "delete", ids });
                  return Promise.resolve(opts.deleteError ? { error: { message: opts.deleteError } } : { error: null });
                },
              }),
            }),
          };
        },
      };
    },
  };
  return { supabase: supabase as never, calls };
}

const nextLines = [{ description: "New line", qty: 1, rate: 100, amount: 100 }] as unknown as NormalizedLine[];
const existingLines = [{ id: "old-1" }, { id: "old-2" }];

describe("replaceQuoteLines", () => {
  it("inserts the new lines before deleting the old ones", async () => {
    const { supabase, calls } = makeSupabase({});
    const result = await replaceQuoteLines(supabase, "tenant-1", "quote-1", existingLines, nextLines);
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.op)).toEqual(["insert", "delete"]);
    expect(calls[1].ids).toEqual(["old-1", "old-2"]);
  });

  it("never deletes the old lines if the insert fails -- no data loss on failure", async () => {
    const { supabase, calls } = makeSupabase({ insertError: "boom" });
    const result = await replaceQuoteLines(supabase, "tenant-1", "quote-1", existingLines, nextLines);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/Failed to insert/);
    expect(calls.map((c) => c.op)).toEqual(["insert"]); // delete never called
  });

  it("surfaces a distinct error (but keeps the already-inserted new lines) if the delete step fails", async () => {
    const { supabase, calls } = makeSupabase({ deleteError: "boom" });
    const result = await replaceQuoteLines(supabase, "tenant-1", "quote-1", existingLines, nextLines);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/New lines saved, but failed to remove/);
    expect(calls.map((c) => c.op)).toEqual(["insert", "delete"]); // insert still ran and succeeded
  });

  it("clearing all lines (nextLines empty) skips insert and just deletes the old ones", async () => {
    const { supabase, calls } = makeSupabase({});
    const result = await replaceQuoteLines(supabase, "tenant-1", "quote-1", existingLines, []);
    expect(result.ok).toBe(true);
    expect(result.ok && result.finalLines).toEqual([]);
    expect(calls.map((c) => c.op)).toEqual(["delete"]); // no insert call at all
  });

  it("skips the delete call entirely when there were no existing lines", async () => {
    const { supabase, calls } = makeSupabase({});
    await replaceQuoteLines(supabase, "tenant-1", "quote-1", [], nextLines);
    expect(calls.map((c) => c.op)).toEqual(["insert"]);
  });
});
