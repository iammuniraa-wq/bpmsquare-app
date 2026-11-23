import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateNextStandardQuoteRef } from "./standardQuoteRef";
import { sanitizeIdFormat, formatQuoteRef } from "./quoteRefFormat";

type Row = Record<string, unknown>;

// A tiny in-memory stand-in for the Supabase query builder: select / eq / gte / lt / order / limit, awaited.
function fake(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let max = Infinity;
    const b: Record<string, unknown> = {};
    const result = () => ({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, max) });
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; };
    b.gte = (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b; };
    b.lt = (c: string, v: string) => { filters.push((r) => String(r[c]) < v); return b; };
    b.order = () => b;
    b.limit = (n: number) => { max = n; return b; };
    b.maybeSingle = async () => ({ data: result().data[0] ?? null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

const T = "t1";
const date = new Date(2026, 7, 10);
const quote = (ref: string) => ({ tenant_id: T, ref, created_at: new Date(2026, 3, 1).toISOString() });

describe("Standard Quote numbers", () => {
  it("keeps SQ-YYYY-NNNN for a workspace with no pattern, exactly as before", async () => {
    const db = fake({ tenants: [{ id: T, config: {} }], standard_quotes: [quote("SQ-2026-0007"), quote("SQ-2026-0003")] });
    expect(await generateNextStandardQuoteRef(db, T, date)).toBe("SQ-2026-0008");
  });

  it("uses the workspace's own pattern as its own series ('167 / 2026')", async () => {
    const config = { standard_quote_id_format: { template: "{SEQ} / {YYYY}", prefix: "", seq_digits: 3, reset: "yearly" } };
    const db = fake({ tenants: [{ id: T, config }], standard_quotes: [quote("166 / 2026"), quote("12 / 2026"), quote("SQ-2026-0900")] });
    expect(await generateNextStandardQuoteRef(db, T, date)).toBe("167 / 2026");
  });

  it("starts at the first number of a new pattern and never reads another table's series", async () => {
    const config = { standard_quote_id_format: { template: "{PREFIX}-{SEQ}", prefix: "PQ", seq_digits: 4, reset: "never" } };
    const db = fake({ tenants: [{ id: T, config }], standard_quotes: [], quotes: [{ tenant_id: T, ref: "PQ-0099", created_at: new Date().toISOString() }] });
    expect(await generateNextStandardQuoteRef(db, T, date)).toBe("PQ-0001");
  });

  it("ignores an unusable stored pattern and falls back to the fixed format", async () => {
    const db = fake({ tenants: [{ id: T, config: { standard_quote_id_format: { template: "NO-NUMBER", prefix: "X", seq_digits: 4, reset: "yearly" } } }], standard_quotes: [] });
    expect(await generateNextStandardQuoteRef(db, T, date)).toBe("SQ-2026-0001");
  });
});

describe("sanitizeIdFormat", () => {
  it("needs {SEQ}, known tokens only, plain text", () => {
    expect(sanitizeIdFormat({ template: "{SEQ} / {YYYY}", prefix: "", seq_digits: 3, reset: "yearly" })).toEqual({ template: "{SEQ} / {YYYY}", prefix: "", seq_digits: 3, reset: "yearly" });
    expect(sanitizeIdFormat({ template: "{YYYY}" })).toBeNull();
    expect(sanitizeIdFormat({ template: "{SEQ}{NOPE}" })).toBeNull();
    expect(sanitizeIdFormat({ template: "<b>{SEQ}" })).toBeNull();
    expect(sanitizeIdFormat({ template: "{SEQ}", prefix: "a{b" })).toBeNull();
    expect(sanitizeIdFormat(null)).toBeNull();
    expect(sanitizeIdFormat({ template: "{SEQ}", seq_digits: 99, reset: "x" })).toMatchObject({ seq_digits: 4, reset: "yearly" });
  });
  it("prints the sample pattern", () => {
    expect(formatQuoteRef({ template: "{SEQ} / {YYYY}", prefix: "", seq_digits: 3, reset: "yearly" }, date, 167)).toBe("167 / 2026");
  });
});
