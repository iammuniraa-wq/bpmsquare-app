import { describe, it, expect } from "vitest";
import { DEFAULT_WFM_CONFIG, type WfmConfig, type WfmTypeRules } from "@/lib/constants";
import {
  canonTypeEntry, cleanTypeEntry, customRuleCount, diffTypeRules, formatRuleValue, formatWeekOff, leavePayLabel, leaveRuleFor, rulesFor,
  visibleTypeRules, workspaceLeaveText,
} from "./typeRules";
import { expectedToWork, leaveEntryAfterAllowance, weekOffForDay } from "./summaryDayRules";
import { paidWithinMonthlyAllowance } from "./leaveRules";
import { standardMinutesForDay } from "./reportRules";

const TYPES = [
  { code: "full_time", label: "Full-time" }, { code: "intern", label: "Intern" },
  { code: "trainee", label: "Trainee" }, { code: "tba", label: "To Be Assigned" },
];
const base = (o: Partial<WfmConfig> = {}): WfmConfig => ({ ...DEFAULT_WFM_CONFIG, employment_types: TYPES, ...o });

const PAID = { id: "paid", category: "paid", paid_days_per_month: null };
const SICK = { id: "sick", category: "paid", paid_days_per_month: 1 };
const COMP = { id: "comp", category: "paid", paid_days_per_month: null };
const ONAPPROVAL = { id: "loa", category: "unpaid", paid_days_per_month: null };
const LEAVE_TYPES = [PAID, SICK, COMP, ONAPPROVAL];

// The BIM Trainee entry exactly as scripts/run-bim-trainee-rules-2026-11-03.sql writes it.
const TRAINEE: WfmTypeRules = {
  effective_from: "2026-11-01",
  week_off_days: [],
  leave: { paid: { mode: "off" }, sick: { mode: "off" }, comp: { mode: "off" } },
};
const withTrainee = (): WfmConfig => base({ type_rules: { trainee: TRAINEE } });

describe("default behaviour is byte-identical (the safety proof for workspaces that never set a rule)", () => {
  const dates = ["2025-01-01", "2026-10-31", "2026-11-01", "2030-06-30", null];
  const configs: [string, WfmConfig][] = [
    ["type_rules {}", base({ type_rules: {} })],
    ["type_rules missing (a config stored before the key existed)", { ...base(), type_rules: undefined as unknown as WfmConfig["type_rules"] }],
  ];
  for (const [name, cfg] of configs) {
    it(`rulesFor and leaveRuleFor return the workspace values for every type with ${name}`, () => {
      for (const t of [...TYPES.map((x) => x.code), "ghost", "", null, undefined]) {
        for (const d of dates) {
          const r = rulesFor(t, cfg, d);
          expect(r.week_off_days).toBe(cfg.week_off_days);
          expect(r.week_off_days).toEqual(DEFAULT_WFM_CONFIG.week_off_days);
          expect(r.source.week_off_days).toBe("workspace");
          for (const lt of LEAVE_TYPES) {
            expect(leaveRuleFor(t, lt, cfg, d)).toEqual({
              eligible: true,
              paid_days_per_month: lt.paid_days_per_month,
              unpaid: lt.category === "unpaid" || lt.paid_days_per_month === 0,
              source: "workspace",
            });
          }
        }
      }
    });
  }
  it("an unknown or empty type resolves to the workspace even when other types have rules", () => {
    const cfg = withTrainee();
    for (const t of ["ghost", "", null, undefined, "full_time", "tba"]) {
      expect(rulesFor(t, cfg, "2026-11-10").source.week_off_days).toBe("workspace");
      expect(leaveRuleFor(t, SICK, cfg, "2026-11-10").eligible).toBe(true);
    }
  });
  it("the summary leave naming is unchanged for the workspace rule", () => {
    const rule = leaveRuleFor("full_time", SICK, base(), "2026-11-10");
    const days = [{ date: "2026-11-03", half_day: false }, { date: "2026-11-04", half_day: false }];
    const paid = paidWithinMonthlyAllowance(rule.paid_days_per_month, days);
    const entry = { name: "Sick", category: "paid", half_day: false };
    expect(leaveEntryAfterAllowance(entry, rule, "Full-time", paid.get("2026-11-03"))).toEqual(entry);
    expect(leaveEntryAfterAllowance(entry, rule, "Full-time", paid.get("2026-11-04"))).toEqual({
      name: "Sick (beyond 1 paid day this month)", category: "unpaid", half_day: false,
    });
    // A type with no allowance is left exactly as it was.
    expect(leaveEntryAfterAllowance(entry, leaveRuleFor("full_time", PAID, base(), "2026-11-10"), "Full-time", undefined)).toBe(entry);
  });
});

describe("the BIM Trainee set", () => {
  const cfg = withTrainee();
  it("resolves no weekly off, three leave types not offered and the unpaid type unpaid, from 2026-11-01", () => {
    expect(rulesFor("trainee", cfg, "2026-11-01").week_off_days).toEqual([]);
    expect(rulesFor("trainee", cfg, "2026-11-01").source.week_off_days).toBe("type");
    for (const lt of [PAID, SICK, COMP]) expect(leaveRuleFor("trainee", lt, cfg, "2026-11-01").eligible).toBe(false);
    expect(leaveRuleFor("trainee", ONAPPROVAL, cfg, "2026-11-01")).toMatchObject({ eligible: true, unpaid: true });
  });
  it("leaves Full-time and To Be Assigned on the workspace rules", () => {
    expect(rulesFor("full_time", cfg, "2026-11-10").week_off_days).toEqual([0]);
    expect(leaveRuleFor("tba", SICK, cfg, "2026-11-10").eligible).toBe(true);
  });
});

describe("rules start on their date and never reach back", () => {
  const cfg = withTrainee();
  it("2026-10-31 is the workspace's, 2026-11-01 is the type's", () => {
    expect(rulesFor("trainee", cfg, "2026-10-31").week_off_days).toEqual([0]);
    expect(rulesFor("trainee", cfg, "2026-10-31").source.week_off_days).toBe("workspace");
    expect(rulesFor("trainee", cfg, "2026-11-01").week_off_days).toEqual([]);
    expect(leaveRuleFor("trainee", SICK, cfg, "2026-10-31")).toMatchObject({ eligible: true, paid_days_per_month: 1, source: "workspace" });
    expect(leaveRuleFor("trainee", SICK, cfg, "2026-11-01")).toMatchObject({ eligible: false, source: "type" });
  });
  it("a month that straddles the date splits per day: October Sundays are week off, November Sundays are working days", () => {
    const sundays = ["2026-10-25", "2026-11-01", "2026-11-08"]; // all Sundays
    const off = sundays.map((d) => weekOffForDay({ weekOffDays: rulesFor("trainee", cfg, d).week_off_days, weekday: 0, secondSaturday: false }));
    expect(off).toEqual([true, false, false]);
  });
  it("leave days split into the two rules, each judged against its own allowance", () => {
    const cfg2 = base({ type_rules: { intern: { effective_from: "2026-11-15", leave: { sick: { mode: "unpaid" } } } } });
    const days = [{ date: "2026-11-10", half_day: false }, { date: "2026-11-20", half_day: false }];
    const rules = days.map((d) => leaveRuleFor("intern", SICK, cfg2, d.date));
    expect(rules.map((r) => r.source)).toEqual(["workspace", "type"]);
    // 10 Nov: the workspace's 1 paid day, so paid. 20 Nov: the type's rule, unpaid.
    expect(paidWithinMonthlyAllowance(rules[0].paid_days_per_month, [days[0]]).get("2026-11-10")).toBe(true);
    const paidAfter = paidWithinMonthlyAllowance(rules[1].paid_days_per_month, [days[1]]);
    const entry = { name: "Sick", category: "paid", half_day: false };
    expect(leaveEntryAfterAllowance(entry, rules[1], "Intern", paidAfter.get("2026-11-20"))).toEqual({
      name: "Sick (unpaid for Intern)", category: "unpaid", half_day: false,
    });
  });
});

describe("a trainee Sunday in the monthly summary (no database)", () => {
  const sunday = "2026-11-08";
  const shift = { start_time: "09:00", end_time: "18:00" };
  const judge = (cfg: WfmConfig) => {
    const weekOff = weekOffForDay({ weekOffDays: rulesFor("trainee", cfg, sunday).week_off_days, weekday: 0, secondSaturday: false });
    const expected = expectedToWork({ hasShift: true, rosterDayOff: false, onLeave: false, holiday: false, weekOff });
    const absent = expected; // a past day with no punch
    const standard = standardMinutesForDay({ shift, dayOff: false, weekOff, holiday: false, leave: null, date: sunday, todayKey: "2026-11-20", punches: 0 });
    return { weekOff, absent, standard };
  };
  it("is absent with the shift length as standard minutes under the Trainee rule", () => {
    expect(judge(withTrainee())).toEqual({ weekOff: false, absent: true, standard: 540 });
  });
  it("is a week off with 0 standard minutes with type_rules {} (today's behaviour)", () => {
    expect(judge(base({ type_rules: {} }))).toEqual({ weekOff: true, absent: false, standard: 0 });
  });
});

describe("a rule that came from the type is named in the summary", () => {
  it("reads (unpaid for Trainee) for a day of an unpaid-for-type leave", () => {
    const cfg = base({ type_rules: { trainee: { effective_from: "2026-11-01", leave: { sick: { mode: "off" } } } } });
    const rule = leaveRuleFor("trainee", SICK, cfg, "2026-11-04");
    const paid = paidWithinMonthlyAllowance(rule.paid_days_per_month, [{ date: "2026-11-04", half_day: false }]);
    expect(leaveEntryAfterAllowance({ name: "Sick", category: "paid", half_day: false }, rule, "Trainee", paid.get("2026-11-04")))
      .toEqual({ name: "Sick (unpaid for Trainee)", category: "unpaid", half_day: false });
  });
});

describe("leaveRuleFor ignores what it cannot read", () => {
  it("an unknown leave id, an unknown mode and a negative allowance fall back to the leave type's own rule", () => {
    const cfg = base({
      type_rules: {
        intern: {
          leave: {
            ghost: { mode: "off" },
            sick: { mode: "paid", paid_days_per_month: -3 },
            paid: { mode: "nonsense" as unknown as "off" },
          },
        },
      },
    });
    expect(leaveRuleFor("intern", PAID, cfg, null).source).toBe("workspace");
    expect(leaveRuleFor("intern", SICK, cfg, null)).toMatchObject({ source: "workspace", paid_days_per_month: 1 });
  });
  it("paid up to N a month overrides the allowance; 0 is unpaid", () => {
    const cfg = base({ type_rules: { intern: { leave: { paid: { mode: "paid", paid_days_per_month: 2 }, comp: { mode: "paid", paid_days_per_month: 0 } } } } });
    expect(leaveRuleFor("intern", PAID, cfg, null)).toMatchObject({ eligible: true, paid_days_per_month: 2, unpaid: false, source: "type" });
    expect(leaveRuleFor("intern", COMP, cfg, null)).toMatchObject({ paid_days_per_month: 0, unpaid: true });
  });
});

describe("what the screens say", () => {
  const cfg = withTrainee();
  it("one helper words the rule for the employee and the supervisor", () => {
    expect(leavePayLabel(leaveRuleFor("trainee", SICK, cfg, "2026-11-02"), "paid", "Trainee")).toMatchObject({ text: "Not offered for Trainee", tone: "red" });
    expect(leavePayLabel(leaveRuleFor("trainee", ONAPPROVAL, cfg, "2026-11-02"), "unpaid", "Trainee")).toMatchObject({ text: "Unpaid, on approval", tone: "quiet" });
    const unpaid = base({ type_rules: { intern: { leave: { paid: { mode: "unpaid" } } } } });
    expect(leavePayLabel(leaveRuleFor("intern", PAID, unpaid, null), "paid", "Intern")).toMatchObject({ text: "Unpaid for Intern", tone: "amber" });
    expect(leavePayLabel(leaveRuleFor("full_time", SICK, cfg, "2026-11-02"), "paid", "Full-time")).toMatchObject({ text: "1 paid a month" });
    expect(leavePayLabel(leaveRuleFor("full_time", PAID, cfg, "2026-11-02"), "paid", "Full-time").text).toBeNull();
  });
  it("formats values, with None spelled out", () => {
    expect(formatWeekOff([])).toBe("None (every day is a working day)");
    expect(formatRuleValue("week_off_days", [])).toBe("None (every day is a working day)");
    expect(formatRuleValue("week_off_days", [6, 0])).toBe("Sun, Sat");
    expect(formatRuleValue("week_off_days", undefined)).toBe("Same as everyone");
    expect(formatRuleValue("leave", { mode: "off" })).toBe("Not offered");
    expect(formatRuleValue("leave", { mode: "paid", paid_days_per_month: 2 })).toBe("Paid, up to 2 a month");
    expect(workspaceLeaveText({ category: "paid", paid_days_per_month: 1 })).toBe("Paid, up to 1 a month");
    expect(workspaceLeaveText({ category: "unpaid" })).toBe("Unpaid, on approval");
  });
  it("shows only the rows this slice ships", () => {
    expect(visibleTypeRules().map((r) => r.id)).toEqual(["leave", "week_off_days"]);
  });
});

describe("diffTypeRules produces the confirm lines", () => {
  const names = [{ id: "sick", name: "Sick" }, { id: "comp", name: "Comp off" }];
  it("names each changed rule with before and after", () => {
    const after: WfmTypeRules = { week_off_days: [], leave: { sick: { mode: "off" } } };
    expect(diffTypeRules("Trainee", undefined, after, names)).toEqual([
      { field: "Trainee · Sick", before: "Same as everyone", after: "Not offered" },
      { field: "Trainee · Weekly off days", before: "Same as everyone", after: "None (every day is a working day)" },
    ]);
  });
  it("reports a removed rule and nothing for an unchanged one", () => {
    const before: WfmTypeRules = { leave: { sick: { mode: "off" }, comp: { mode: "unpaid" } } };
    const after: WfmTypeRules = { leave: { comp: { mode: "unpaid" } } };
    expect(diffTypeRules("Trainee", before, after, names)).toEqual([{ field: "Trainee · Sick", before: "Not offered", after: "Same as everyone" }]);
    expect(diffTypeRules("Trainee", before, before, names)).toEqual([]);
  });
});

describe("a draft is cleaned before it is stored", () => {
  it("drops an entry with no custom row, and with it the start date", () => {
    expect(cleanTypeEntry({ effective_from: "2026-11-01", leave: {} })).toBeNull();
    expect(cleanTypeEntry({ effective_from: "2026-11-01", week_off_days: [] })).toEqual({ effective_from: "2026-11-01", week_off_days: [] });
    expect(customRuleCount(TRAINEE)).toBe(4);
    expect(canonTypeEntry({ leave: { b: { mode: "off" }, a: { mode: "off" } } })).toBe(canonTypeEntry({ leave: { a: { mode: "off" }, b: { mode: "off" } } }));
    expect(canonTypeEntry({ effective_from: "2026-01-01", week_off_days: [] })).toBe(canonTypeEntry({ week_off_days: [] }));
  });
});
