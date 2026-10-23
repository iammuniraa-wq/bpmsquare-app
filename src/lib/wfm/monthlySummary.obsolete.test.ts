import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_WFM_CONFIG } from "@/lib/constants";

vi.mock("server-only", () => ({}));

const TABLES: Record<string, unknown[]> = {};
const orCalls: string[] = [];

function builder(table: string) {
  const b: Record<string, unknown> = {
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: TABLES[table] ?? [], error: null }).then(res),
  };
  for (const m of ["select", "eq", "in", "is", "gte", "lte", "lt", "order", "range", "neq"]) b[m] = () => b;
  b.or = (f: string) => { if (table === "employees") orCalls.push(f); return b; };
  return b;
}

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => ({ from: (t: string) => builder(t) }) }));
vi.mock("./server", () => ({
  getWfmConfig: async () => ({ ...DEFAULT_WFM_CONFIG, timezone: "UTC", week_off_days: [], deduct_breaks: false }),
  dateKeyInTz: () => "2026-10-23",
}));

const { getMonthlySummary, getSummaryForRange } = await import("./monthlySummary");

const SHIFT = { id: "s1", name: "Day", start_time: "09:00", end_time: "17:00", grace_minutes: 10, is_night_shift: false, crosses_midnight: false, night_allowance_amount: 0 };
const emp = (id: string, first: string, status: string, valid_to: string | null) => ({
  id, employee_code: id.toUpperCase(), first_name: first, last_name: "Rao", employment_type: "full_time", shift_id: "s1", site_id: null, status, valid_to,
});

beforeEach(() => {
  orCalls.length = 0;
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  TABLES.wfm_shifts = [SHIFT];
  TABLES.wfm_presence_events = [
    { employee_id: "obs", kind: "check_in", ts: "2026-10-05T09:00:00Z" },
    { employee_id: "obs", kind: "check_out", ts: "2026-10-05T17:00:00Z" },
    { employee_id: "obs", kind: "check_in", ts: "2026-10-12T09:00:00Z" },
    { employee_id: "obs", kind: "check_out", ts: "2026-10-12T17:00:00Z" },
  ];
});

describe("Monthly Summary with an obsolete employee", () => {
  it("counts them through valid_to inclusive, drops later days, and names them (obsolete)", async () => {
    TABLES.employees = [emp("obs", "Asha", "inactive", "2026-10-10"), emp("act", "Ben", "active", null)];
    const rows = await getMonthlySummary("t1", "2026-10");
    const o = rows.find((r) => r.employee_id === "obs")!;
    const a = rows.find((r) => r.employee_id === "act")!;

    expect(o.full_name).toBe("Asha Rao (obsolete)");
    expect(o.obsolete).toBe(true);
    expect(o.days.map((d) => d.date)).toEqual(Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`));
    // Oct 5 is inside the window and counts normally; the Oct 12 punch is after valid_to and does not.
    expect(o.totals.days_present).toBe(1);
    expect(o.totals.working_minutes).toBe(8 * 60);
    // Nine unpunched days up to valid_to are absences; none accrue afterwards.
    expect(o.totals.absent_days).toBe(9);

    expect(a.full_name).toBe("Ben Rao");
    expect(a.days).toHaveLength(31);
  });

  it("asks the database for active employees plus obsolete ones ending on or after the first day", async () => {
    TABLES.employees = [emp("act", "Ben", "active", null)];
    await getMonthlySummary("t1", "2026-10");
    expect(orCalls).toEqual(["status.eq.active,and(status.eq.inactive,valid_to.gte.2026-10-01)"]);
  });

  it("leaves out an obsolete employee who ended before the range, and one with no end date", async () => {
    TABLES.employees = [emp("old", "Cy", "inactive", "2026-09-30"), emp("legacy", "Di", "inactive", null), emp("act", "Ben", "active", null)];
    const rows = await getMonthlySummary("t1", "2026-10");
    expect(rows.map((r) => r.employee_id)).toEqual(["act"]);
  });

  it("includes an employee made obsolete on the very first day of the range, for that day only", async () => {
    TABLES.employees = [emp("obs", "Asha", "inactive", "2026-10-01")];
    const rows = await getSummaryForRange("t1", "2026-10-01", "2026-10-31");
    expect(rows?.[0].days.map((d) => d.date)).toEqual(["2026-10-01"]);
  });

  it("an active employee's own validity dates are not enforced in the report", async () => {
    TABLES.employees = [{ ...emp("act", "Ben", "active", "2026-10-10") }];
    const rows = await getMonthlySummary("t1", "2026-10");
    expect(rows[0].days).toHaveLength(31);
    expect(rows[0].full_name).toBe("Ben Rao");
  });
});
