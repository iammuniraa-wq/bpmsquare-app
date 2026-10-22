import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));

import { tipTextProblems } from "@/lib/infoTip";
import { DEFAULT_WFM_CONFIG, type WfmConfig } from "@/lib/constants";
import {
  ALERT_ROWS, alertCount, blankLeave, blankShift, blankSite, changedConfig, cleanEmploymentTypes, faceMode, leaveDraftFrom, leavePayload,
  leaveUsage, shiftPayload, shiftProblem, sitePayload, siteProblem, slugCode, withFaceMode, workforceTabs, type LeaveType,
} from "./logic";
import { WORKFORCE_TIPS } from "./tips";
import RulesTab from "./RulesTab";
import AlertsTab from "./AlertsTab";
import BillingTab from "./BillingTab";

const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (e: ReactElement) => renderToString(e).replace(/<!-- -->/g, "");
const noop = () => undefined;
const cfg = (o: Partial<WfmConfig> = {}): WfmConfig => ({ ...DEFAULT_WFM_CONFIG, ...o });

describe("the tabs", () => {
  it("has five tabs, and Billing only where project hours can be invoiced", () => {
    expect(workforceTabs(false)).toEqual(["rules", "shifts", "places", "leave", "alerts"]);
    expect(workforceTabs(true)).toEqual(["rules", "shifts", "places", "leave", "alerts", "billing"]);
  });
});

describe("one Save sends only what changed", () => {
  it("is clean until something changes, and never sends a group that was not touched", () => {
    const base = cfg();
    expect(changedConfig(base, base, true)).toEqual({});
    expect(Object.keys(changedConfig(base, { ...base, timezone: "UTC", leave_carry_forward: !base.leave_carry_forward }, true)).sort()).toEqual(["leave_carry_forward", "timezone"]);
  });
  it("sends a nested group whole when one of its fields changes", () => {
    const base = cfg();
    const next = changedConfig(base, { ...base, notifications: { ...base.notifications, late_arrival: !base.notifications.late_arrival } }, false);
    expect(Object.keys(next)).toEqual(["notifications"]);
    expect(Object.keys(next.notifications!).sort()).toEqual(Object.keys(base.notifications).sort());
  });
  it("leaves costing out unless project billing is on", () => {
    const base = cfg();
    const edited = { ...base, costing: { ...base.costing, default_bill_rate: 99 } };
    expect(changedConfig(base, edited, false)).toEqual({});
    expect(Object.keys(changedConfig(base, edited, true))).toEqual(["costing"]);
  });
  it("does not count an abandoned empty employment type as a change", () => {
    const base = cfg();
    const added = { ...base, employment_types: [...base.employment_types, { code: "", label: "" }] };
    expect(changedConfig(base, added, false)).toEqual({});
  });
});

describe("face recognition is one choice over two stored keys", () => {
  it("round-trips the three states", () => {
    for (const m of ["off", "tablet", "tablet_signin"] as const) expect(faceMode(withFaceMode(m))).toBe(m);
  });
  it("cannot leave sign-in on while the tablet is off", () => {
    expect(withFaceMode("off")).toEqual({ face_punch: "off", face_login: false });
    expect(faceMode({ face_punch: "off", face_login: true })).toBe("off");
  });
});

describe("employment types", () => {
  it("makes a code from the label and keeps it unique", () => {
    expect(slugCode("Part time", [])).toBe("part_time");
    expect(slugCode("Part time", ["part_time"])).toBe("part_time_2");
    expect(slugCode("  ", [])).toBe("type");
    expect(slugCode("Zażółć gęślą", [])).toMatch(/^[a-z0-9_]{1,40}$/);
  });
  it("drops a new type with no label and keeps a stored one's code", () => {
    const out = cleanEmploymentTypes([{ code: "full_time", label: " Full time " }, { code: "", label: "" }, { code: "intern", label: "Intern" }], ["full_time"]);
    expect(out).toEqual([{ code: "full_time", label: "Full time" }, { code: "intern", label: "Intern" }]);
  });
});

describe("alerts: eight stored switches, one grid", () => {
  it("covers every notification key exactly once", () => {
    const keys = ALERT_ROWS.flatMap((r) => [r.supervisor, r.employee, r.both]).filter(Boolean).sort();
    expect(keys).toEqual(Object.keys(DEFAULT_WFM_CONFIG.notifications).sort());
    expect(new Set(keys).size).toBe(keys.length);
    expect(alertCount(DEFAULT_WFM_CONFIG.notifications).total).toBe(8);
  });
});

describe("list payloads", () => {
  it("a shift needs a name, and only an edit carries Active", () => {
    expect(shiftProblem(blankShift())).toMatch(/name/);
    const d = { ...blankShift(), name: " Day ", night: false, allowance: "50" };
    expect(shiftPayload(d, true)).toMatchObject({ name: "Day", night_allowance_amount: 0 });
    expect(shiftPayload(d, true)).not.toHaveProperty("active");
    expect(shiftPayload({ ...d, active: false }, false)).toHaveProperty("active", false);
  });
  it("a leave type caps a month only for a yearly quota", () => {
    const d = { ...blankLeave(), name: "Casual", maxMonth: "2" };
    expect(leavePayload({ ...d, per: "month" }, true).monthly_limit).toBeNull();
    expect(leavePayload({ ...d, per: "year" }, true).monthly_limit).toBe(2);
    expect(leavePayload({ ...d, paidDays: "" }, true).paid_days_per_month).toBeNull();
  });
  it("round-trips a stored leave type", () => {
    const t: LeaveType = { id: "1", name: "Sick", category: "paid", active: true, annual_quota: 12, quota_period: "year", monthly_limit: 3, paid_days_per_month: null, records_count: 2, requests_count: 1, pending_requests: 1 };
    expect(leavePayload(leaveDraftFrom(t), false)).toMatchObject({ name: "Sick", annual_quota: 12, monthly_limit: 3, active: true });
    expect(leaveUsage(t)).toBe("2 records, 1 request (1 pending)");
  });
  it("a site needs a name and a location, and never lists its supervisor as an extra approver", () => {
    expect(siteProblem(blankSite())).toMatch(/name/);
    expect(siteProblem({ ...blankSite(), name: "Yard" })).toMatch(/location/);
    const d = { ...blankSite(), name: "Yard", lat: "15.2", lng: "76.3", supervisorId: "a", approverIds: ["a", "b"] };
    expect(siteProblem(d)).toBeNull();
    expect(sitePayload(d, true).approver_ids).toEqual(["b"]);
  });
});

describe("the explanations", () => {
  it("every tip fits the InfoTip limit", () => {
    for (const [k, v] of Object.entries(WORKFORCE_TIPS)) expect(tipTextProblems(v), k).toEqual([]);
  });
});

describe("the tabs render", () => {
  it("Rules shows six everyday controls and keeps the rest behind one More", () => {
    const out = html(el(RulesTab, { cfg: cfg(), savedCodes: [], shifts: [], onChange: noop }));
    for (const label of ["Timezone", "Late marks per half-day", "Weekly off days", "Take breaks off worked hours", "Extra punch types", "Selfie with a punch"]) expect(out, label).toContain(label);
    expect((out.match(/<details/g) ?? []).length).toBe(1);
    for (const inMore of ["Employee self-service", "Face recognition", "Passkey sign-in", "Alternate Saturdays", "Employment types", "Keep selfies for"]) expect(out, inMore).toContain(inMore);
    expect(out).not.toMatch(/defaultOpen/);
  });
  it("Rules shows the overtime rate only while overtime is on", () => {
    const base = cfg();
    expect(html(el(RulesTab, { cfg: { ...base, punch_types: { ...base.punch_types, ot: false } }, savedCodes: [], shifts: [], onChange: noop }))).not.toContain("Overtime rate per hour");
    expect(html(el(RulesTab, { cfg: { ...base, punch_types: { ...base.punch_types, ot: true } }, savedCodes: [], shifts: [], onChange: noop }))).toContain("Overtime rate per hour");
  });
  it("Alerts is two cards: phone reminders and one email grid", () => {
    const out = html(el(AlertsTab, { cfg: cfg(), onChange: noop }));
    expect(out).toContain("Phone reminders");
    expect((out.match(/<table/g) ?? []).length).toBe(1);
    expect((out.match(/type="checkbox"/g) ?? []).length).toBe(8);
  });
  it("Billing lists each employment type with an optional rate", () => {
    const base = cfg({ employment_types: [{ code: "full_time", label: "Full time" }, { code: "intern", label: "Intern" }] });
    const out = html(el(BillingTab, { cfg: base, onChange: noop }));
    expect(out).toContain("Full time");
    expect(out).toContain("Intern bill rate");
    expect(out).toContain("Draft invoices at month end");
  });
});

describe("the screen carries no running text and no default-open sections", () => {
  const dir = join(process.cwd(), "src/app/(app)/settings/workforce");
  it("no source uses defaultOpen, SettingsSection or a hint line", () => {
    for (const f of ["RulesTab.tsx", "ShiftsTab.tsx", "PlacesTab.tsx", "LeaveTab.tsx", "AlertsTab.tsx", "BillingTab.tsx", "WorkforceClient.tsx"]) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/defaultOpen|SettingsSection|bpm-t-help/);
    }
  });
  it("is one column under 900 px with 44 px targets on a phone", () => {
    const css = readFileSync(join(dir, "workforce.module.css"), "utf8");
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*grid-template-columns: 1fr/);
    expect(css).toMatch(/@media \(max-width: 780px\)[\s\S]*min-height: 44px/);
  });
});
