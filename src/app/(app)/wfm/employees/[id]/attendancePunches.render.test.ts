import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/wfm/employees/e1",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));
vi.mock("@/components/ui/useUrlTab", () => ({ useUrlTab: () => ["attendance", () => {}] }));
vi.mock("@/components/fields/ObjectSections", () => ({ default: () => null }));
vi.mock("@/components/wfm/SupervisorTimeCorrection", () => ({ default: () => null }));
// The audit list fetches on mount; here only its mounting and props matter.
vi.mock("@/components/wfm/PunchAudit", () => ({
  default: (p: { employeeId: string; date?: string }) => createElement("div", { "data-punch-audit": `${p.employeeId}|${p.date}` }),
}));

import EmployeeHubClient from "./EmployeeHubClient";
import { DayPunchesRow, DayPunchesToggle } from "./DayPunches";

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

const day = (date: string, punches: number) => ({
  date, first_in: null, last_out: null, net_minutes: 0, gross_minutes: 0, break_minutes: 0,
  late: false, absent: false, incomplete: false, on_leave: null, holiday: null, is_week_off: false, punches,
});

const profile = {
  id: "e1", employee_code: "E1", first_name: "Asha", last_name: "Rao", phone: null, status: "active",
  employment_type: "full_time", wfm_role: "employee", supervisor_id: null, consent_recorded_at: null,
  wfm_shifts: null, wfm_sites: null, supervisor: null, has_login: false, reports: [], month,
  month_summary: {
    totals: { days_present: 0, working_minutes: 0, late_marks: 0, half_day_deductions: 0, paid_leave_days: 0, unpaid_leave_days: 0, holiday_days: 0, incomplete_days: 0 },
    days: [day(today, 0)],
  },
  leave_balance: [],
};
const lists = { shifts: [], sites: [], supervisors: [], upcoming: [], corrections: [], leaveRequests: [], leaveRecords: [], recheck: [] };

describe("the employee record's Attendance tab", () => {
  it("gives every daily row a collapsed Punches control, including a day with no punches", () => {
    const out = renderToStaticMarkup(createElement(EmployeeHubClient, { employeeId: "e1", initialProfile: profile as never, initialLists: lists as never }));
    expect(out).toContain("Daily attendance");
    expect(out).toMatch(new RegExp(`<button[^>]*aria-expanded="false"[^>]*aria-controls="day-punches-${today}"[^>]*>Punches`));
    expect(out).not.toContain("data-punch-audit");
  });
});

describe("a day's punches under its row", () => {
  it("the toggle states whether it is open and is a button of its own", () => {
    const shut = renderToStaticMarkup(createElement(DayPunchesToggle, { date: "2026-09-10", open: false, onToggle: () => {} }));
    const open = renderToStaticMarkup(createElement(DayPunchesToggle, { date: "2026-09-10", open: true, onToggle: () => {} }));
    expect(shut).toContain('aria-expanded="false"');
    expect(shut).toContain('type="button"');
    expect(shut).toContain("wfm-punch-toggle");
    expect(open).toContain('aria-expanded="true"');
  });

  it("the open row spans the table and mounts the audit list for that employee and date", () => {
    const out = renderToStaticMarkup(createElement("table", null, createElement("tbody", null,
      createElement(DayPunchesRow, { employeeId: "e1", date: "2026-09-10", colSpan: 8 }))));
    expect(out).toContain('colSpan="8"');
    expect(out).toContain('id="day-punches-2026-09-10"');
    expect(out).toContain('data-punch-audit="e1|2026-09-10"');
  });
});
