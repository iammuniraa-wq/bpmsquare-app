import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
type Call = { table: string; eq: Record<string, unknown> };

const db: { tables: Record<string, Row[]>; calls: Call[] } = { tables: {}, calls: [] };

// Minimal PostgREST stand-in: honours eq / in / not-null / range (order is a no-op) and records
// the eq filters each query carried, so the tenant-scoping rule can be asserted.
function fakeAdmin() {
  return {
    from(table: string) {
      const eq: Record<string, unknown> = {};
      const inF: Record<string, unknown[]> = {};
      const notNull: string[] = [];
      let range: [number, number] | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (c: string, v: unknown) => { eq[c] = v; return builder; },
        in: (c: string, v: unknown[]) => { inF[c] = v; return builder; },
        not: (c: string, op: string, v: unknown) => { if (op === "is" && v === null) notNull.push(c); return builder; },
        order: () => builder, // rows are already in a fixed order here
        range: (a: number, b: number) => { range = [a, b]; return builder; },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
          db.calls.push({ table, eq: { ...eq } });
          let rows = (db.tables[table] ?? []).filter((r) =>
            Object.entries(eq).every(([c, v]) => r[c] === v) &&
            Object.entries(inF).every(([c, vs]) => vs.includes(r[c])) &&
            notNull.every((c) => r[c] != null)
          );
          if (range) rows = rows.slice(range[0], range[1] + 1);
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => fakeAdmin() }));
vi.mock("@/lib/encryption", () => ({ encrypt: (v: unknown) => v, decrypt: (v: unknown) => v }));

import { resolveMarketingRecipientsLive } from "./live";
import type { SegmentFilter } from "@/lib/marketingSegmentation";

const T = "tenant-a";
const OTHER = "tenant-b";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const acct = (id: string, tenant = T): Row => ({
  id, tenant_id: tenant, name: `Acct ${id}`, type: "direct", email: `${id}@x.com`, email2: null,
  marketing_opt_out: false, city: null, state: null, country: null, industry: null,
  employee_count: null, annual_revenue: null, created_at: "2024-01-01",
});

const filter = (field: string, operator: SegmentFilter["operator"], value = ""): SegmentFilter => ({ id: field, field, operator, value });
const rule = (filters: SegmentFilter[]) => ({
  account_types: [], include_account_ids: [], exclude_account_ids: [], manual_emails: [], filters, match: "all" as const,
});
const ids = async (filters: SegmentFilter[]) =>
  (await resolveMarketingRecipientsLive(T, rule(filters))).map((c) => c.account_id).sort();

beforeEach(() => {
  db.calls = [];
  db.tables = {
    accounts: [acct("a1"), acct("a2"), acct("a3"), acct("a4"), acct("a5"), acct("x1", OTHER)],
    contracts: [
      { id: "c1", tenant_id: T, account_id: "a1", status: "active", start_date: day(-30), end_date: day(30) },
      { id: "c2", tenant_id: T, account_id: "a2", status: "expired", start_date: day(-90), end_date: day(-10) },
      { id: "c3", tenant_id: T, account_id: "a3", status: "active", start_date: day(-90), end_date: day(-1) },
      { id: "c4", tenant_id: T, account_id: "a4", status: "draft", start_date: null, end_date: null },
      { id: "c5", tenant_id: T, account_id: "a5", status: "active", start_date: day(5), end_date: day(100) },
      { id: "c6", tenant_id: OTHER, account_id: "x1", status: "active", start_date: null, end_date: null },
    ],
    products: [
      { id: "p1", tenant_id: T, sku: "PMP-100", name: "Centrifugal Pump" },
      { id: "p2", tenant_id: T, sku: "VLV-200", name: "Gate Valve" },
      { id: "p9", tenant_id: OTHER, sku: "PMP-100", name: "Centrifugal Pump" },
    ],
    quotes: [
      { id: "q1", tenant_id: T, account_id: "a1", outcome: "won" },
      { id: "q2", tenant_id: T, account_id: "a2", outcome: "lost" },
      { id: "q3", tenant_id: T, account_id: "a3", outcome: "open" },
      { id: "q4", tenant_id: T, account_id: "a4", outcome: "open" },
      { id: "q9", tenant_id: OTHER, account_id: "x1", outcome: "won" },
    ],
    quote_lines: [
      { id: "l1", tenant_id: T, quote_id: "q1", product_id: "p1" },
      { id: "l2", tenant_id: T, quote_id: "q2", product_id: "p1" },
      { id: "l3", tenant_id: T, quote_id: "q3", product_id: "p2" },
      { id: "l4", tenant_id: T, quote_id: "q4", product_id: "p2" },
      { id: "l5", tenant_id: T, quote_id: "q1", product_id: null },
      { id: "l9", tenant_id: OTHER, quote_id: "q9", product_id: "p9" },
    ],
    invoices: [
      { id: "i1", tenant_id: T, account_id: "a3", quote_id: "q3", status: "paid" },
      { id: "i2", tenant_id: T, account_id: "a4", quote_id: "q4", status: "draft" },
    ],
  };
});

describe("segment filter: Has active AMC", () => {
  it("matches only accounts with an active contract whose dates cover today", async () => {
    expect(await ids([filter("has_active_amc", "is_true")])).toEqual(["a1"]);
  });

  it("is_false matches everyone else in this tenant, and never another tenant's account", async () => {
    expect(await ids([filter("has_active_amc", "is_false")])).toEqual(["a2", "a3", "a4", "a5"]);
  });
});

describe("segment filter: Has bought product", () => {
  it("matches on SKU for accounts with a won quote line carrying that product", async () => {
    expect(await ids([filter("owned_product_skus", "contains", "PMP-100")])).toEqual(["a1"]);
  });

  it("matches on product name, case-insensitively", async () => {
    expect(await ids([filter("owned_product_skus", "contains", "gate valve")])).toEqual(["a3"]);
  });

  it("counts a non-draft invoice's quote as bought, but not a draft invoice, a lost quote or an open quote", async () => {
    expect(await ids([filter("owned_product_skus", "contains", "VLV-200")])).toEqual(["a3"]);
  });

  it("combines with a plain account field under 'all'", async () => {
    expect(await ids([filter("has_active_amc", "is_true"), filter("owned_product_skus", "contains", "PMP")])).toEqual(["a1"]);
  });
});

describe("tenant scoping", () => {
  it("scopes every query it issues to the tenant", async () => {
    await ids([filter("has_active_amc", "is_true"), filter("owned_product_skus", "contains", "PMP")]);
    expect(db.calls.length).toBeGreaterThan(0);
    for (const c of db.calls) expect(c.eq.tenant_id, `table ${c.table}`).toBe(T);
  });

  it("does no signal queries when no filter needs them", async () => {
    await ids([filter("type", "equals", "direct")]);
    expect(db.calls.map((c) => c.table)).toEqual(["accounts"]);
  });
});
