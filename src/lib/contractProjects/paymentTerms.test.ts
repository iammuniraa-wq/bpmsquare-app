import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { marginState, readMarginFloor } from "./budget";
import { PATH_STEPS, projectPath } from "./path";
import { TERM_LIMITS, choiceFrom, parseChoice, parsePaymentTermTemplates, percentTotal, readPaymentTermTemplates, termLines, toMilestoneInput } from "./paymentTerms";
import { marginTone } from "./format";

let n = 0;
const newId = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, "0")}`;
const m = (title: string, percent: number | null, trigger = "", basis: "percent" | "fixed" = "percent", fixed: number | null = null) => ({ title, basis, percent, fixed_amount: fixed, trigger });

describe("payment-term templates", () => {
  it("accepts a few named schedules, gives a new one an id and keeps an existing id", () => {
    const keep = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const r = parsePaymentTermTemplates([
      { name: "  30 / 60 / 10 ", milestones: [m("Advance", 30, "On award"), m("Delivery", 60, "On delivery"), m("Retention", 10, "After 12 months")] },
      { id: keep, name: "Lump sum", milestones: [{ title: "All", basis: "fixed", fixed_amount: "50000", trigger: "" }] },
    ], newId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.templates[0].name).toBe("30 / 60 / 10");
    expect(r.templates[0].id).toMatch(/^aaaaaaaa-/);
    expect(r.templates[1]).toMatchObject({ id: keep, milestones: [{ basis: "fixed", percent: null, fixed_amount: 50000 }] });
  });

  it("refuses what cannot be a schedule, with a plain reason", () => {
    const bad = (raw: unknown) => { const r = parsePaymentTermTemplates(raw, newId); return r.ok ? "ok" : r.error; };
    expect(bad("x")).toMatch(/list/);
    expect(bad([{ name: "", milestones: [m("A", 10)] }])).toMatch(/name/);
    expect(bad([{ name: "A", milestones: [] }])).toMatch(/at least one milestone/);
    expect(bad([{ name: "A", milestones: [m("", 10)] }])).toMatch(/title/);
    expect(bad([{ name: "A", milestones: [m("X", null)] }])).toMatch(/percent/);
    expect(bad([{ name: "A", milestones: [m("X", 101)] }])).toMatch(/0 to 100/);
    expect(bad([{ name: "A", milestones: [m("X", null, "", "fixed", -1)] }])).toMatch(/0 or more/);
    expect(bad([{ name: "A", milestones: [m("X", 10)] }, { name: " a ", milestones: [m("Y", 10)] }])).toMatch(/Two templates/);
    expect(bad(Array.from({ length: TERM_LIMITS.maxTemplates + 1 }, (_, i) => ({ name: `T${i}`, milestones: [m("X", 10)] })))).toMatch(/up to/);
    expect(bad([{ name: "A", milestones: Array.from({ length: TERM_LIMITS.maxMilestones + 1 }, () => m("X", 1)) }])).toMatch(/up to/);
  });

  it("reads a stored config defensively: a malformed entry is left out, never thrown on", () => {
    const good = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "50 / 50", milestones: [m("A", 50), m("B", 50)] };
    expect(readPaymentTermTemplates({ contract_projects: { payment_term_templates: [good, { name: "broken" }, null, 7] } })).toEqual([good]);
    expect(readPaymentTermTemplates({ contract_projects: {} })).toEqual([]);
    expect(readPaymentTermTemplates(null)).toEqual([]);
  });

  it("a chosen template is kept as a copy, and read back only when well formed", () => {
    const t = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "50 / 50", milestones: [m("A", 50, "On award"), m("B", 50, "On delivery")] };
    const choice = choiceFrom(t, new Date("2026-10-29T10:00:00Z"));
    expect(choice).toEqual({ template_id: t.id, name: "50 / 50", milestones: t.milestones, chosen_at: "2026-10-29T10:00:00.000Z" });
    expect(parseChoice(JSON.parse(JSON.stringify(choice)))).toEqual(choice);
    expect(parseChoice(null)).toBeNull();
    expect(parseChoice({ template_id: t.id, name: "x", milestones: "no" })).toBeNull();
  });

  it("prints one line per milestone for a bid document, and totals the percents", () => {
    const ms = [m("Advance", 30, "on award"), m("Delivery", 60), m("Final", null, "at handover", "fixed", 25000)];
    expect(termLines(ms, (v) => `SAR ${v}`)).toEqual(["Advance: 30%, on award", "Delivery: 60%", "Final: SAR 25000, at handover"]);
    expect(percentTotal(ms)).toBe(90);
  });

  it("becomes billing-schedule milestones: no date, the trigger as the note", () => {
    expect(toMilestoneInput(m("Advance", 30, "On award"))).toEqual({ title: "Advance", due_date: null, basis: "percent", percent: 30, fixed_amount: null, note: "On award" });
    expect(toMilestoneInput(m("Final", null, "", "fixed", 5))).toMatchObject({ basis: "fixed", fixed_amount: 5, note: null });
  });
});

describe("the margin floor", () => {
  it("is the workspace's number from 0 to 95, or none", () => {
    expect(readMarginFloor({ contract_projects: { margin_floor_pct: 12.5 } })).toBe(12.5);
    expect(readMarginFloor({ contract_projects: { margin_floor_pct: "8" } })).toBe(8);
    for (const v of [undefined, null, "", 96, -1, "abc"]) expect(readMarginFloor({ contract_projects: { margin_floor_pct: v } }), String(v)).toBeNull();
    expect(readMarginFloor(null)).toBeNull();
  });

  it("red when negative, amber under the floor, green otherwise; with no floor never amber; nothing to read is none", () => {
    expect(marginState(-0.1, 10)).toBe("over");
    expect(marginState(-5, null)).toBe("over");
    expect(marginState(9.9, 10)).toBe("low");
    expect(marginState(10, 10)).toBe("ok");
    expect(marginState(3, null)).toBe("ok");
    expect(marginState(0, null)).toBe("ok");
    expect(marginState(null, 10)).toBe("none");
    expect(marginState(Number.NaN, 10)).toBe("none");
    expect([marginState(-1, 5), marginState(1, 5), marginState(9, 5), marginState(null, 5)].map(marginTone)).toEqual(["bad", "warn", "good", "neutral"]);
  });
});

describe("the project path", () => {
  const step = (status: Parameters<typeof projectPath>[0]["status"], handedOver = false, stamp: string | null = null) => projectPath({ status, handover_sent_at: stamp }, handedOver);

  it("has the five steps in order and marks the one the project is on", () => {
    expect(PATH_STEPS.map((s) => s.label)).toEqual(["Draft", "Baseline waiting", "Active", "Handed over", "Closed"]);
    expect(step("draft").current).toBe("draft");
    expect(step("baseline_pending").current).toBe("baseline_pending");
    expect(step("active").current).toBe("active");
    expect(step("closed").current).toBe("closed");
    expect(step("active").steps.map((s) => s.state)).toEqual(["done", "done", "current", "todo", "todo"]);
  });

  it("Handed over is a buy-out package handed over OR the budget file downloaded, and only for an active project", () => {
    expect(step("active", true).current).toBe("handed_over");
    expect(step("active", false, "2026-10-29T00:00:00Z").current).toBe("handed_over");
    expect(step("draft", true, "2026-10-29T00:00:00Z").current).toBe("draft");
    expect(step("baseline_pending", true).current).toBe("baseline_pending");
    expect(step("closed", true).steps.every((s) => s.state !== "todo")).toBe(true);
  });
});

describe("the tips of this slice fit the InfoTip limit", () => {
  it("every text is two sentences and 160 characters at most", async () => {
    const { PROJECT_TIPS } = await import("./tips");
    for (const key of ["whereBudgetGoes", "path", "copyTerms", "paymentTerms", "paymentTemplates", "marginFloor"] as const) {
      expect(tipTextProblems(PROJECT_TIPS[key]), key).toEqual([]);
    }
  });
});
