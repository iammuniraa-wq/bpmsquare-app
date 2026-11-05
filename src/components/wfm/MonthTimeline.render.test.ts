import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/wfm/PunchAudit", () => ({
  default: (p: { employeeId: string; date?: string }) => createElement("div", { "data-punch-audit": `${p.employeeId}|${p.date}` }),
}));

import { DayDetail, type TimelineDay } from "./MonthTimeline";

const day = (date: string): TimelineDay => ({
  date, sessions: [], breaks: [], net_minutes: 0, gross_minutes: 0, break_minutes: 0,
  late: false, absent: false, incomplete: false, on_leave: null, holiday: null, is_week_off: false,
  ot_minutes: 0, ot_pending_minutes: 0, ot_segments: [],
});
const html = (d: TimelineDay, employeeId?: string) =>
  renderToStaticMarkup(createElement(DayDetail, { day: d, employeeId, hasPendingCorrection: false, onClose: () => {} }));

describe("MonthTimeline day pop-up", () => {
  it("shows the day's punch details when it knows whose month this is", () => {
    const out = html(day("2026-09-10"), "emp-1");
    expect(out).toContain("Punch details");
    expect(out).toContain('data-punch-audit="emp-1|2026-09-10"');
  });

  it("is unchanged without an employee id", () => {
    const out = html(day("2026-09-10"));
    expect(out).not.toContain("Punch details");
    expect(out).not.toContain("data-punch-audit");
    expect(out).toContain("No punches recorded.");
  });

  it("does not look up punches for a day that has not happened yet", () => {
    expect(html(day("2099-01-01"), "emp-1")).not.toContain("data-punch-audit");
  });
});
