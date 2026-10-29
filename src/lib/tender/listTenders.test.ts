import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryDb, type Row } from "@/lib/inbox/testing/memoryDb";
import { listTenders } from "./server";

const T1 = "tenant-1";
const T2 = "tenant-2";

function tender(i: number, tenant: string): Row {
  return { opportunity_id: `opp-${String(i).padStart(5, "0")}`, tenant_id: tenant, closing_at: "2026-11-01T08:00:00Z", reminders_sent: [], bond_status: "held", created_at: "2026-09-01T08:00:00Z", updated_at: "2026-09-01T08:00:00Z" };
}

const asAdmin = (db: MemoryDb) => db as unknown as SupabaseClient;

describe("listTenders", () => {
  it("returns every tender past PostgREST's 1000-row cap, each once, and none of another workspace", async () => {
    const db = new MemoryDb({
      opportunity_tenders: [...Array.from({ length: 2300 }, (_, i) => tender(i, T1)), ...Array.from({ length: 40 }, (_, i) => tender(10_000 + i, T2))],
    });
    db.maxRows = 1000;
    const { rows, pending } = await listTenders(asAdmin(db), T1);
    expect(pending).toBe(false);
    expect(rows).toHaveLength(2300);
    expect(new Set(rows.map((r) => r.opportunity_id)).size).toBe(2300);
    expect(rows.every((r) => r.tenant_id === T1)).toBe(true);
  });

  it("reads an exact multiple of the page size without losing or repeating a row", async () => {
    const db = new MemoryDb({ opportunity_tenders: Array.from({ length: 2000 }, (_, i) => tender(i, T1)) });
    db.maxRows = 1000;
    expect((await listTenders(asAdmin(db), T1)).rows).toHaveLength(2000);
  });

  it("keeps the pending answer when the table is not there yet", async () => {
    const db = new MemoryDb();
    db.missing.add("opportunity_tenders");
    expect(await listTenders(asAdmin(db), T1)).toEqual({ rows: [], pending: true });
  });

  it("still falls back to the older column lists while a later migration is pending, across pages", async () => {
    const db = new MemoryDb({ opportunity_tenders: Array.from({ length: 1500 }, (_, i) => tender(i, T1)) });
    db.maxRows = 1000;
    db.missingColumns.opportunity_tenders = new Set(["award_value", "bond_status"]);
    const { rows, pending } = await listTenders(asAdmin(db), T1);
    expect(pending).toBe(false);
    expect(rows).toHaveLength(1500);
  });
});
