import { describe, it, expect, vi, beforeAll } from "vitest";
import ExcelJS from "exceljs";
import { DEFAULT_WFM_CONFIG, type WfmConfig } from "@/lib/constants";
import type { EmployeeMonthSummary } from "./monthlySummary";

vi.mock("server-only", () => ({}));

const TABLES: Record<string, unknown[]> = {};

function builder(table: string) {
  const b: Record<string, unknown> = {
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: TABLES[table] ?? [], error: null }).then(res),
  };
  for (const m of ["select", "eq", "in", "is", "gte", "lte", "lt", "order", "range", "neq", "or"]) b[m] = () => b;
  return b;
}

const CFG = vi.hoisted(() => ({ current: {} as WfmConfig }));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => ({ from: (t: string) => builder(t) }) }));
vi.mock("./server", () => ({ getWfmConfig: async () => CFG.current, dateKeyInTz: () => "2026-10-23" }));

const { getSummaryForRange } = await import("./monthlySummary");
const { buildSummaryWorkbook } = await import("./summaryWorkbook");

// ── Fixture: three sites x (Employee, Trainee, To Be Assigned), a person with no site and one with a type the
// workspace no longer lists. Monday to Friday of one week, 09:00-17:00 UTC (480 minutes standard a day).
const TYPES = [
  { code: "employee", label: "Employee" },
  { code: "trainee", label: "Trainee" },
  { code: "to_be_assigned", label: "To Be Assigned" },
];
const SITES = [{ id: "s-doha", name: "Doha" }, { id: "s-wakra", name: "Wakra" }, { id: "s-khor", name: "Al Khor" }];
const SHIFT = { id: "sh1", name: "Day", start_time: "09:00:00", end_time: "17:00:00", grace_minutes: 10, is_night_shift: false, crosses_midnight: false, night_allowance_amount: 0 };
// Codes deliberately have gaps; the Sl No must not.
const PEOPLE: { id: string; code: string; first: string; type: string; site: string | null }[] = [
  { id: "e1", code: "EMP-0001", first: "Asha", type: "employee", site: "s-doha" },
  { id: "e2", code: "EMP-0004", first: "Bina", type: "employee", site: "s-doha" },
  { id: "t1", code: "EMP-0007", first: "Chitra", type: "trainee", site: "s-doha" },
  { id: "b1", code: "EMP-0009", first: "Dev", type: "to_be_assigned", site: "s-doha" },
  { id: "e3", code: "EMP-0012", first: "Esha", type: "employee", site: "s-wakra" },
  { id: "t2", code: "EMP-0015", first: "Farid", type: "trainee", site: "s-wakra" },
  { id: "t3", code: "EMP-0016", first: "Gita", type: "trainee", site: "s-wakra" },
  { id: "e4", code: "EMP-0020", first: "Hari", type: "employee", site: "s-khor" },
  { id: "b2", code: "EMP-0021", first: "Indu", type: "to_be_assigned", site: "s-khor" },
  { id: "n1", code: "EMP-0030", first: "Jai", type: "employee", site: null },
  { id: "u1", code: "EMP-0031", first: "Kiran", type: "casual", site: "s-wakra" },
];
const WEEK = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];

const cfg = (o: Partial<WfmConfig>): WfmConfig => ({
  ...DEFAULT_WFM_CONFIG, timezone: "UTC", week_off_days: [0], deduct_breaks: false, ot_rate_per_hour: 60, employment_types: TYPES, ...o,
});

function load() {
  TABLES.wfm_shifts = [SHIFT];
  TABLES.wfm_sites = SITES;
  TABLES.employees = PEOPLE.map((p) => ({
    id: p.id, employee_code: p.code, first_name: p.first, last_name: "Test", employment_type: p.type, shift_id: "sh1", site_id: p.site, status: "active", valid_to: null,
  }));
  const events: unknown[] = [];
  for (const p of PEOPLE) {
    for (const d of WEEK) {
      let out = "17:00";
      if (p.id === "e1" && d === "2026-10-05") out = "18:15"; // +75 minutes over standard
      if (p.id === "t1" && d === "2026-10-06") out = "15:30"; // -90 minutes under standard
      events.push({ employee_id: p.id, kind: "check_in", ts: `${d}T09:00:00Z` }, { employee_id: p.id, kind: "check_out", ts: `${d}T${out}:00Z` });
    }
  }
  TABLES.wfm_presence_events = events;
  TABLES.wfm_ot_sessions = [
    { employee_id: "e1", ot_date: "2026-10-05", minutes: 24, status: "approved", started_at: "2026-10-05T18:30:00Z", ended_at: "2026-10-05T18:54:00Z" },
    { employee_id: "e1", ot_date: "2026-10-06", minutes: 30, status: "approved", started_at: "2026-10-06T18:00:00Z", ended_at: "2026-10-06T18:30:00Z" },
    { employee_id: "e3", ot_date: "2026-10-07", minutes: 120, status: "approved", started_at: "2026-10-07T18:00:00Z", ended_at: "2026-10-07T20:00:00Z" },
  ];
}

let summaries: EmployeeMonthSummary[];
beforeAll(async () => {
  load();
  CFG.current = cfg({});
  summaries = (await getSummaryForRange("t1", WEEK[0], WEEK[4]))!;
});

const build = (o: Partial<WfmConfig>) =>
  buildSummaryWorkbook(new ExcelJS.Workbook(), {
    summaries, config: cfg(o), label: "5 Oct 2026 – 9 Oct 2026", tenantName: "Test Co",
  });

const rowValues = (sheet: ExcelJS.Worksheet, n: number): unknown[] => (sheet.getRow(n).values as unknown[]).slice(1);
const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** The header row of a section-style sheet (row 2) and its data rows, up to the blank spacer. */
function sectionTable(sheet: ExcelJS.Worksheet) {
  const header = rowValues(sheet, 2) as string[];
  const rows: unknown[][] = [];
  for (let n = 3; n <= sheet.rowCount; n++) {
    const v = rowValues(sheet, n);
    if (v.length === 0 || v[0] === undefined || v[0] === null || v[0] === "") break;
    rows.push(v);
  }
  return { header, rows };
}
const col = (t: { header: string[]; rows: unknown[][] }, name: string) => {
  const i = t.header.indexOf(name);
  expect(i, `column ${name}`).toBeGreaterThanOrEqual(0);
  return t.rows.map((r) => r[i]);
};

// ── (a) The default workbook is today's workbook ─────────────────────────────
describe("default (payroll_by_location off, no OT minimum): the export is unchanged", () => {
  const MONTHLY_HEADERS = [
    "Employee Code", "Name", "Site", "Shift", "Days Present", "Absent Days", "Working Hours", "Late Marks", "Half-Day Deductions",
    "Paid Leave", "Unpaid Leave", "Holidays", "Night Shifts", "Night Allowance", "OT Hours", "OT Amount", "Incomplete Days",
  ];
  const SUMMARY_HEADERS = [
    "Employee Code", "Name", "Site", "Days Present", "Absent Days", "Paid Leave", "Unpaid Leave", "Half-Day Deductions", "Late Marks",
    "Incomplete Days", "Total Worked", "OT", "OT Amount",
  ];
  const DAILY_HEADERS = [
    "Employee Code", "Name", "Site", "Date", "Check In", "Check Out", "Sessions", "Session Times", "Breaks Taken", "Break Times",
    "Break Hours", "Gross Hours", "Total Worked", "OT Hours", "Status",
  ];
  const PAYROLL_DAY_HEADERS = ["Date", "Check In", "Check Out", "Break", "Gross", "Total Worked", "OT", "Status"];

  it("has today's sheet names", () => {
    const wb = build({});
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Payroll Report", "Employee", "Trainee", "To Be Assigned", "Other", "Daily Detail"]);
  });

  it("has today's headers on every sheet", () => {
    const wb = build({});
    expect(rowValues(wb.getWorksheet("Employee")!, 2)).toEqual(MONTHLY_HEADERS);
    expect(rowValues(wb.getWorksheet("Other")!, 2)).toEqual(MONTHLY_HEADERS);
    expect(rowValues(wb.getWorksheet("Summary")!, 4)).toEqual(SUMMARY_HEADERS);
    expect(rowValues(wb.getWorksheet("Daily Detail")!, 3)).toEqual(DAILY_HEADERS);
    expect(rowValues(wb.getWorksheet("Payroll Report")!, 5)).toEqual(PAYROLL_DAY_HEADERS);
  });

  it("shows no Sl No, Category, Actual Hrs or OT not counted anywhere", () => {
    const wb = build({});
    for (const ws of wb.worksheets) {
      const flat = JSON.stringify(ws.getSheetValues());
      for (const word of ["Sl No", "Category", "Actual Hrs", "Standard Hrs", "OT not counted", "not counted"]) expect(flat, `${ws.name}: ${word}`).not.toContain(word);
    }
  });

  it("keeps the TOTAL row of the Summary as live SUM formulas from column 4", () => {
    const ws = build({}).getWorksheet("Summary")!;
    const last = rowValues(ws, ws.rowCount);
    expect(last.slice(0, 3)).toEqual(["TOTAL", "", ""]);
    expect((last[3] as { formula: string }).formula).toMatch(/^SUM\(D5:D15\)$/);
    expect(last).toHaveLength(13);
  });

  it("keeps the per-employee subtotal of the Payroll Report: label, two blanks, four SUMs", () => {
    const ws = build({}).getWorksheet("Payroll Report")!;
    const sub = rowValues(ws, 11);
    expect(sub.slice(0, 3)).toEqual(["Employee Total", "", ""]);
    expect(sub).toHaveLength(7);
    expect((sub[3] as { formula: string }).formula).toBe("SUM(D6:D10)");
  });

  it("puts the person with an unlisted type on the single Other sheet", () => {
    const t = sectionTable(build({}).getWorksheet("Other")!);
    expect(col(t, "Name")).toEqual(["Kiran Test"]);
  });
});

// ── (b) payroll_by_location on ───────────────────────────────────────────────
describe("payroll_by_location on", () => {
  const wb = () => build({ payroll_by_location: true });

  it("makes a sheet per location and type, with No location and Other, in a stable order", () => {
    expect(wb().worksheets.map((w) => w.name)).toEqual([
      "Summary", "Payroll Report",
      "Al Khor - Employee", "Al Khor - To Be Assigned",
      "Doha - Employee", "Doha - Trainee", "Doha - To Be Assigned",
      "Wakra - Employee", "Wakra - Trainee", "Wakra - Other",
      "No location - Employee",
      "Daily Detail",
    ]);
  });

  it("keeps the section layout and adds Sl No first, then Category, Standard Hrs and Actual Hrs", () => {
    const t = sectionTable(wb().getWorksheet("Doha - Employee")!);
    expect(t.header[0]).toBe("Sl No");
    expect(t.header.slice(1, 4)).toEqual(["Employee Code", "Name", "Category"]);
    expect(t.header).toContain("Standard Hrs");
    expect(t.header).toContain("Actual Hrs");
    expect(t.header).not.toContain("OT not counted");
    expect(col(t, "Category")).toEqual(["Employee", "Employee"]);
  });

  it("restarts Sl No at 1 on every section sheet with no gaps or duplicates, while codes keep their gaps", () => {
    const w = wb();
    let seen = 0;
    for (const ws of w.worksheets) {
      if (["Summary", "Payroll Report", "Daily Detail"].includes(ws.name)) continue;
      const t = sectionTable(ws);
      const sl = col(t, "Sl No");
      expect(sl, ws.name).toEqual(sl.map((_, i) => i + 1));
      seen += sl.length;
    }
    expect(seen).toBe(PEOPLE.length);
    const wakraTrainee = sectionTable(w.getWorksheet("Wakra - Trainee")!);
    expect(col(wakraTrainee, "Sl No")).toEqual([1, 2]);
    expect(col(wakraTrainee, "Employee Code")).toEqual(["EMP-0015", "EMP-0016"]);
  });

  it("sorts inside a sheet by employee code then name", () => {
    const t = sectionTable(wb().getWorksheet("Doha - Employee")!);
    expect(col(t, "Employee Code")).toEqual(["EMP-0001", "EMP-0004"]);
  });

  it("puts a person with no site on 'No location - <Type>' and the unlisted type on '<Location> - Other'", () => {
    const w = wb();
    expect(col(sectionTable(w.getWorksheet("No location - Employee")!), "Name")).toEqual(["Jai Test"]);
    const other = sectionTable(w.getWorksheet("Wakra - Other")!);
    expect(col(other, "Name")).toEqual(["Kiran Test"]);
    expect(col(other, "Category")).toEqual(["casual"]);
  });

  it("flags a To Be Assigned person through the Category column under their current location", () => {
    const t = sectionTable(wb().getWorksheet("Al Khor - To Be Assigned")!);
    expect(col(t, "Category")).toEqual(["To Be Assigned"]);
    expect(col(t, "Name")).toEqual(["Indu Test"]);
  });

  it("keeps the Summary, Payroll Report and Daily Detail as the complete record, with the new columns", () => {
    const w = wb();
    const sum = w.getWorksheet("Summary")!;
    const hdr = rowValues(sum, 4) as string[];
    expect(hdr.slice(0, 4)).toEqual(["Sl No", "Employee Code", "Name", "Category"]);
    expect(hdr).toContain("Actual Hrs");
    const sl = [] as unknown[];
    for (let n = 5; n < 5 + PEOPLE.length; n++) sl.push(rowValues(sum, n)[0]);
    expect(sl).toEqual(PEOPLE.map((_, i) => i + 1));
    // The Summary totals row is still SUM formulas, and the Actual Hrs total is text.
    const totals = rowValues(sum, sum.rowCount);
    expect(totals[0]).toBe("TOTAL");
    expect(typeof totals[hdr.indexOf("Actual Hrs")]).toBe("string");

    const report = w.getWorksheet("Payroll Report")!;
    expect(String(rowValues(report, 4)[0])).toMatch(/^Sl No 1 {3}\| {3}EMP-0001/);
    expect(rowValues(report, 5)).toContain("Actual Hrs");
    expect(w.getWorksheet("Daily Detail")!.getRow(3).values).toContain("Actual Hrs");
  });

  it("the section sheets add up to the Summary: totals across locations match the original data", () => {
    const w = wb();
    const sectionSheets = w.worksheets.filter((x) => !["Summary", "Payroll Report", "Daily Detail"].includes(x.name));
    const sumOf = (name: string) => sectionSheets.reduce((s, ws) => s + col(sectionTable(ws), name).reduce<number>((a, v) => a + num(v), 0), 0);

    const sum = w.getWorksheet("Summary")!;
    const hdr = rowValues(sum, 4) as string[];
    const summaryRows: unknown[][] = [];
    for (let n = 5; n < 5 + PEOPLE.length; n++) summaryRows.push(rowValues(sum, n));
    const summaryCol = (name: string) => summaryRows.reduce((a, r) => a + num(r[hdr.indexOf(name)]), 0);

    expect(sumOf("Days Present")).toBe(summaryCol("Days Present"));
    expect(sumOf("Working Hours")).toBeCloseTo(summaryCol("Total Worked"), 9);
    expect(sumOf("Standard Hrs")).toBeCloseTo(summaryCol("Standard Hrs"), 9);
    expect(sumOf("OT Hours")).toBeCloseTo(summaryCol("OT"), 9);
    expect(sumOf("OT Amount")).toBeCloseTo(summaryCol("OT Amount"), 9);
    // ...and both match the computed data, not just each other.
    expect(sumOf("Days Present")).toBe(summaries.reduce((s, r) => s + r.totals.days_present, 0));
    expect(sumOf("Working Hours") * 1440).toBeCloseTo(summaries.reduce((s, r) => s + r.totals.working_minutes, 0), 6);
    expect(sumOf("OT Amount")).toBeCloseTo(summaries.reduce((s, r) => s + r.totals.ot_amount, 0), 6);
  });
});

// ── (c) OT minimum in the export ─────────────────────────────────────────────
describe("OT minimum 30 in the export", () => {
  it("shows the not-counted OT in its own column and leaves it out of OT and the amount", async () => {
    CFG.current = cfg({ ot_min_minutes: 30, payroll_by_location: true });
    const withMin = (await getSummaryForRange("t1", WEEK[0], WEEK[4]))!;
    const w = buildSummaryWorkbook(new ExcelJS.Workbook(), {
      summaries: withMin, config: cfg({ ot_min_minutes: 30, payroll_by_location: true }), label: "x", tenantName: "T",
    });
    const t = sectionTable(w.getWorksheet("Doha - Employee")!);
    expect(t.header.indexOf("OT not counted")).toBe(t.header.indexOf("OT Hours") + 1);
    const asha = t.rows.find((r) => r[t.header.indexOf("Name")] === "Asha Test")!;
    expect(asha[t.header.indexOf("OT Hours")]).toBeCloseTo(30 / 1440, 9);
    expect(asha[t.header.indexOf("OT not counted")]).toBeCloseTo(24 / 1440, 9);
    expect(asha[t.header.indexOf("OT Amount")]).toBe(30); // 30 minutes at 60 an hour; the 24 minute day is not paid

    // The day the 24 minutes fell on still shows them, with the note.
    const daily = w.getWorksheet("Daily Detail")!;
    const dh = rowValues(daily, 3) as string[];
    const row = [...Array(daily.rowCount)].map((_, i) => rowValues(daily, i + 4)).find((r) => r[dh.indexOf("Name")] === "Asha Test" && r[dh.indexOf("Date")] === "2026-10-05")!;
    expect(row[dh.indexOf("OT not counted")]).toBeCloseTo(24 / 1440, 9);
    expect(row[dh.indexOf("OT Hours")]).toBe(0);
    expect(String(row[dh.indexOf("Status")])).toContain("OT below minimum, not counted");
    const counted = [...Array(daily.rowCount)].map((_, i) => rowValues(daily, i + 4)).find((r) => r[dh.indexOf("Name")] === "Asha Test" && r[dh.indexOf("Date")] === "2026-10-06")!;
    expect(counted[dh.indexOf("OT Hours")]).toBeCloseTo(30 / 1440, 9);
    expect(String(counted[dh.indexOf("Status")])).not.toContain("not counted");
  });

  it("the OT column appears with the minimum alone, without the location layout", async () => {
    CFG.current = cfg({ ot_min_minutes: 30 });
    const s = (await getSummaryForRange("t1", WEEK[0], WEEK[4]))!;
    const w = buildSummaryWorkbook(new ExcelJS.Workbook(), { summaries: s, config: cfg({ ot_min_minutes: 30 }), label: "x", tenantName: "T" });
    expect(w.worksheets.map((x) => x.name)).toEqual(["Summary", "Payroll Report", "Employee", "Trainee", "To Be Assigned", "Other", "Daily Detail"]);
    const t = sectionTable(w.getWorksheet("Employee")!);
    expect(t.header[0]).toBe("Employee Code");
    expect(t.header).toContain("OT not counted");
    expect(t.header).not.toContain("Actual Hrs");
    CFG.current = cfg({});
  });
});

// ── (d) Actual Hrs ───────────────────────────────────────────────────────────
describe("Actual Hrs", () => {
  const w = () => build({ payroll_by_location: true });

  it("is text with a leading minus under standard and plain hh:mm at or over it", () => {
    const doha = w().getWorksheet("Doha - Employee")!;
    const t = sectionTable(doha);
    const actual = (name: string) => t.rows.find((r) => r[t.header.indexOf("Name")] === name)![t.header.indexOf("Actual Hrs")];
    expect(actual("Asha Test")).toBe("01:15");   // one day 75 minutes long
    expect(actual("Bina Test")).toBe("00:00");   // exactly standard
    const tr = sectionTable(w().getWorksheet("Doha - Trainee")!);
    expect(tr.rows[0][tr.header.indexOf("Actual Hrs")]).toBe("-01:30"); // one day 90 minutes short
    const std = t.rows[0][t.header.indexOf("Standard Hrs")];
    expect(std).toBeCloseTo((5 * 480) / 1440, 9);
  });

  it("is on the daily detail and the payroll report day rows, with a text subtotal", () => {
    const book = w();
    const daily = book.getWorksheet("Daily Detail")!;
    const dh = rowValues(daily, 3) as string[];
    const rows = [...Array(daily.rowCount)].map((_, i) => rowValues(daily, i + 4));
    const find = (name: string, date: string) => rows.find((r) => r[dh.indexOf("Name")] === name && r[dh.indexOf("Date")] === date)!;
    expect(find("Chitra Test", "2026-10-06")[dh.indexOf("Actual Hrs")]).toBe("-01:30");
    expect(find("Asha Test", "2026-10-05")[dh.indexOf("Actual Hrs")]).toBe("01:15");
    expect(find("Asha Test", "2026-10-07")[dh.indexOf("Actual Hrs")]).toBe("00:00");

    const report = book.getWorksheet("Payroll Report")!;
    const h = rowValues(report, 5) as string[];
    const ai = h.indexOf("Actual Hrs");
    expect(ai).toBeGreaterThan(0);
    // First employee block (Asha): five days then the subtotal row.
    const sub = rowValues(report, 6 + 5);
    expect(sub[0]).toBe("Employee Total");
    expect(sub[ai]).toBe("01:15");
  });
});
