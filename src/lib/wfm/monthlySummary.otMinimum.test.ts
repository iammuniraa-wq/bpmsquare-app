import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_WFM_CONFIG, type WfmConfig } from "@/lib/constants";

vi.mock("server-only", () => ({}));

const TABLES: Record<string, unknown[]> = {};
const CFG = vi.hoisted(() => ({ current: {} as WfmConfig }));

function builder(table: string) {
  const b: Record<string, unknown> = {
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: TABLES[table] ?? [], error: null }).then(res),
  };
  for (const m of ["select", "eq", "in", "is", "gte", "lte", "lt", "order", "range", "neq", "or"]) b[m] = () => b;
  return b;
}

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => ({ from: (t: string) => builder(t) }) }));
vi.mock("./server", () => ({
  getWfmConfig: async () => CFG.current,
  dateKeyInTz: () => "2026-10-23",
}));

const { getMonthlySummary, getSummaryForRange } = await import("./monthlySummary");

const SHIFT = { id: "s1", name: "Day", start_time: "09:00:00", end_time: "17:00:00", grace_minutes: 10, is_night_shift: false, crosses_midnight: false, night_allowance_amount: 0 };
const EMP = { id: "e1", employee_code: "EMP-0001", first_name: "Asha", last_name: "Rao", employment_type: "full_time", shift_id: "s1", site_id: null, status: "active", valid_to: null };
const cfg = (o: Partial<WfmConfig>): WfmConfig => ({ ...DEFAULT_WFM_CONFIG, timezone: "UTC", week_off_days: [0], deduct_breaks: false, ot_rate_per_hour: 120, ...o });
const ot = (date: string, minutes: number, status = "approved") => ({
  employee_id: "e1", ot_date: date, minutes, status, started_at: `${date}T18:00:00Z`, ended_at: `${date}T19:00:00Z`,
});
const punch = (date: string, inT: string, outT: string) => [
  { employee_id: "e1", kind: "check_in", ts: `${date}T${inT}:00Z` },
  { employee_id: "e1", kind: "check_out", ts: `${date}T${outT}:00Z` },
];

beforeEach(() => {
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  TABLES.wfm_shifts = [SHIFT];
  TABLES.employees = [EMP];
  TABLES.wfm_presence_events = [];
  TABLES.wfm_ot_sessions = [
    ot("2026-10-05", 24),          // under 30: shown, not counted
    ot("2026-10-06", 30),          // exactly the minimum: counts
    ot("2026-10-07", 12), ot("2026-10-07", 14), // 26 minutes in total that day: the DAY is what is compared
    ot("2026-10-08", 90),          // well over: counts in full, not only the part above 30
    ot("2026-10-09", 20, "pending"), // pending never counts anywhere
  ];
});

describe("OT below the minimum is shown but not counted", () => {
  it("with a 30 minute minimum", async () => {
    CFG.current = cfg({ ot_min_minutes: 30 });
    const [r] = await getMonthlySummary("t1", "2026-10");
    const day = (d: string) => r.days.find((x) => x.date === d)!;

    expect(day("2026-10-05")).toMatchObject({ ot_minutes: 24, ot_counted_minutes: 0, ot_below_minimum: true });
    expect(day("2026-10-06")).toMatchObject({ ot_minutes: 30, ot_counted_minutes: 30, ot_below_minimum: false });
    expect(day("2026-10-07")).toMatchObject({ ot_minutes: 26, ot_counted_minutes: 0, ot_below_minimum: true });
    expect(day("2026-10-08")).toMatchObject({ ot_minutes: 90, ot_counted_minutes: 90, ot_below_minimum: false });
    expect(day("2026-10-09")).toMatchObject({ ot_minutes: 0, ot_pending_minutes: 20, ot_below_minimum: false });

    expect(r.totals.ot_minutes).toBe(120);
    expect(r.totals.ot_not_counted_minutes).toBe(50);
    // 120 minutes at 120 per hour: the amount follows the COUNTED minutes only.
    expect(r.totals.ot_amount).toBe(240);
  });

  it("with a minimum of 0 every approved minute counts, exactly as before", async () => {
    CFG.current = cfg({ ot_min_minutes: 0 });
    const [r] = await getMonthlySummary("t1", "2026-10");
    expect(r.totals.ot_minutes).toBe(24 + 30 + 26 + 90);
    expect(r.totals.ot_not_counted_minutes).toBe(0);
    expect(r.totals.ot_amount).toBe(((24 + 30 + 26 + 90) / 60) * 120);
    expect(r.days.every((d) => d.ot_counted_minutes === d.ot_minutes && !d.ot_below_minimum)).toBe(true);
  });

  it("a config saved before the key existed behaves as 0", async () => {
    const old = cfg({}) as Partial<WfmConfig>;
    delete old.ot_min_minutes;
    CFG.current = old as WfmConfig;
    const [r] = await getMonthlySummary("t1", "2026-10");
    expect(r.totals.ot_minutes).toBe(170);
  });
});

describe("Actual Hrs = Total Worked - Standard Hrs", () => {
  it("is negative under standard, positive over it, and skips weekly offs and holidays", async () => {
    CFG.current = cfg({});
    TABLES.wfm_holidays = [{ date: "2026-10-09", name: "Holiday", applies_to: "all" }];
    TABLES.wfm_ot_sessions = [];
    TABLES.wfm_presence_events = [
      ...punch("2026-10-05", "09:00", "17:00"), // 480 worked, 480 standard: 0
      ...punch("2026-10-06", "09:00", "18:00"), // 540 worked: +60
      ...punch("2026-10-07", "09:00", "15:30"), // 390 worked: -90
      // 2026-10-08 absent: nothing worked, standard 480: -480
      // 2026-10-09 holiday: standard 0
    ];
    const rows = await getSummaryForRange("t1", "2026-10-05", "2026-10-11");
    const r = rows![0];
    const day = (d: string) => r.days.find((x) => x.date === d)!;

    expect(day("2026-10-05")).toMatchObject({ standard_minutes: 480, actual_minutes: 0 });
    expect(day("2026-10-06")).toMatchObject({ standard_minutes: 480, actual_minutes: 60 });
    expect(day("2026-10-07")).toMatchObject({ standard_minutes: 480, actual_minutes: -90 });
    expect(day("2026-10-08")).toMatchObject({ standard_minutes: 480, actual_minutes: -480, absent: true });
    expect(day("2026-10-09")).toMatchObject({ standard_minutes: 0, actual_minutes: 0 });
    // 10-10 is a Saturday with no week-off configured, so it is a scheduled day; 10-11 is a Sunday (weekly off).
    expect(day("2026-10-10").standard_minutes).toBe(480);
    expect(day("2026-10-11").standard_minutes).toBe(0);

    expect(r.totals.working_minutes).toBe(480 + 540 + 390);
    expect(r.totals.standard_minutes).toBe(480 * 5);
    expect(r.totals.actual_minutes).toBe(1410 - 2400);
  });
});
