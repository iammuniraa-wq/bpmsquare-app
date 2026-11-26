import { describe, expect, it } from "vitest";
import { connectionState, hasNumber, reading, stateNote, worstState, type ErpKindState } from "./state";
import { cashLight, countLevels, deliveryLight, isPlanLight, lightsOf, marginLight } from "./lights";
import { canSeeFinance, canSeeProjectFinance, financeVisibleProjects, type FinanceCaller } from "./access";
import { FINANCE_DEFAULTS, LIGHT_WORD, type FinanceSettings } from "./types";
import { parseFinanceSettings, readFinanceSettings } from "./settings";
import { ETG_LIMITS, parseEtgEntries, unknownCells } from "./etg";
import { tipTextProblems } from "@/lib/infoTip";
import { PF_TIPS } from "./tips";
import { toneForLight } from "@/lib/ui/tone";

const NOW = new Date("2026-11-24T06:00:00Z");
const st = (over: Partial<ErpKindState> = {}): ErpKindState => ({ kind: "cost_actual", linked: true, last_ok_at: "2026-11-23T06:00:00Z", last_status: "ok", row_count: 12, ...over });

describe("states: Not connected is a state, never a zero", () => {
  it("no row, not linked, or never pulled is Not connected", () => {
    expect(connectionState(undefined, NOW, 3).state).toBe("not_connected");
    expect(connectionState(null, NOW, 3).state).toBe("not_connected");
    expect(connectionState(st({ linked: false }), NOW, 3).state).toBe("not_connected");
    expect(connectionState(st({ last_ok_at: null }), NOW, 3).state).toBe("not_connected");
    expect(connectionState(st({ last_ok_at: null, last_status: "failed" }), NOW, 3).state).toBe("not_connected");
  });
  it("a recent good pull is live, an old one is stale, an empty pull says nothing posted, a failed last run keeps the last good number", () => {
    expect(connectionState(st(), NOW, 3)).toEqual({ state: "live", asOf: "2026-11-23T06:00:00Z" });
    expect(connectionState(st({ last_ok_at: "2026-11-17T06:00:00Z" }), NOW, 3).state).toBe("stale");
    expect(connectionState(st({ row_count: 0 }), NOW, 3).state).toBe("nothing_posted");
    expect(connectionState(st({ last_status: "failed" }), NOW, 3)).toEqual({ state: "failed", asOf: "2026-11-23T06:00:00Z" });
  });
  it("the freshness limit is the workspace's", () => {
    expect(connectionState(st({ last_ok_at: "2026-11-17T06:00:00Z" }), NOW, 10).state).toBe("live");
  });
  it("a reading carries a number only when the state allows one; a real 0 stays a 0", () => {
    expect(reading("not_connected", null, 0)).toEqual({ state: "not_connected", value: null, asOf: null });
    expect(reading("nothing_posted", "2026-11-23T06:00:00Z", 0)).toMatchObject({ state: "nothing_posted", value: 0 });
    expect(hasNumber("failed")).toBe(true);
    expect(hasNumber("not_connected")).toBe(false);
  });
  it("the words under a figure", () => {
    expect(stateNote("live", "2026-11-23T06:00:00Z")).toBe("as of 23 Nov");
    expect(stateNote("stale", "2026-11-17T06:00:00Z")).toContain("out of date");
    expect(stateNote("nothing_posted", "2026-11-23T06:00:00Z")).toBe("nothing posted yet");
    expect(stateNote("failed", "2026-11-23T06:00:00Z")).toContain("last pull failed");
    expect(stateNote("not_connected", null)).toBe("Connect the ERP cost read-back");
  });
  it("the worst state of several wins", () => {
    expect(worstState(["live", "not_connected"])).toBe("not_connected");
    expect(worstState(["live", "stale", "failed"])).toBe("failed");
    expect(worstState(["live", "nothing_posted"])).toBe("nothing_posted");
    expect(worstState(["live", "live"])).toBe("live");
  });
});

const settings: FinanceSettings = { visibility: "everyone", dropPoints: 5, cashDays: 30, latePct: 15, freshnessDays: 3, marginFloor: 10 };

describe("the lights (design section 6)", () => {
  it("margin: at risk below zero or a drop of the threshold or more under the plan; watch under the floor or half the drop", () => {
    expect(marginLight({ forecastPct: -1, plannedPct: 20, floor: 10, dropPoints: 5 }).level).toBe("risk");
    expect(marginLight({ forecastPct: 15, plannedPct: 20, floor: 10, dropPoints: 5 }).level).toBe("risk");
    expect(marginLight({ forecastPct: 9, plannedPct: 9.5, floor: 10, dropPoints: 5 }).level).toBe("watch");
    expect(marginLight({ forecastPct: 17.4, plannedPct: 20, floor: 10, dropPoints: 5 }).level).toBe("watch");
    expect(marginLight({ forecastPct: 19, plannedPct: 20, floor: 10, dropPoints: 5 }).level).toBe("good");
    expect(marginLight({ forecastPct: 12, plannedPct: null, floor: null, dropPoints: 5 }).level).toBe("good");
  });
  it("margin without a forecast is a grey ring Not connected, except a plan that is itself below the floor or below zero", () => {
    expect(marginLight({ forecastPct: null, plannedPct: 20, floor: 10, dropPoints: 5 })).toMatchObject({ level: "not_connected", word: "Not connected" });
    expect(marginLight({ forecastPct: null, plannedPct: 6, floor: 10, dropPoints: 5 })).toMatchObject({ level: "plan_watch", word: "Plan below floor" });
    expect(marginLight({ forecastPct: null, plannedPct: -3, floor: 10, dropPoints: 5 })).toMatchObject({ level: "plan_risk", word: "Plan below floor" });
    expect(marginLight({ forecastPct: null, plannedPct: null, floor: 10, dropPoints: 5 }).level).toBe("not_connected");
    expect(marginLight({ forecastPct: null, plannedPct: 6, floor: null, dropPoints: 5 }).level).toBe("not_connected");
  });
  const behind = (count: number, oldestDays: number) => ({ count, amount: 1, oldestDays, milestones: [] });
  it("cash: at risk for a milestone more than the threshold behind or an invoice over 60 days overdue, watch for any behind, else on track", () => {
    expect(cashLight({ behind: behind(1, 31), overdueDays: null, cashDays: 30 }).level).toBe("risk");
    expect(cashLight({ behind: behind(1, 30), overdueDays: null, cashDays: 30 }).level).toBe("watch");
    expect(cashLight({ behind: behind(0, 0), overdueDays: 61, cashDays: 30 }).level).toBe("risk");
    expect(cashLight({ behind: behind(0, 0), overdueDays: 20, cashDays: 30 }).level).toBe("good");
    expect(cashLight({ behind: null, overdueDays: null, cashDays: 30 }).level).toBe("not_connected");
  });
  it("delivery: at risk at the late share, watch at a third of it, not connected without delivery data", () => {
    expect(deliveryLight({ latePct: 15, settings }).level).toBe("risk");
    expect(deliveryLight({ latePct: 5, settings }).level).toBe("watch");
    expect(deliveryLight({ latePct: 4.9, settings }).level).toBe("good");
    expect(deliveryLight({ latePct: null, settings }).level).toBe("not_connected");
  });
  it("every light says it in words, and the tone follows the level", () => {
    const l = lightsOf({ forecastPct: null, plannedPct: 6, behind: null, settings });
    expect(Object.values(l).map((x) => x.word)).toEqual(["Plan below floor", "Not connected", "Not connected"]);
    expect(isPlanLight(l.margin)).toBe(true);
    expect(LIGHT_WORD.good).toBe("On track");
    expect(toneForLight("good")).toBe("good");
    expect(toneForLight("watch")).toBe("warn");
    expect(toneForLight("risk")).toBe("bad");
    expect(toneForLight("not_connected")).toBe("neutral");
    expect(countLevels(Object.values(l)).not_connected).toBe(2);
  });
});

const caller = (over: Partial<FinanceCaller> = {}): FinanceCaller => ({ moduleOn: true, visibility: "everyone", role: "member", canOpenProjects: true, unrestricted: true, hasGrant: false, ...over });

describe("who sees cost and margin (design section 8)", () => {
  it("nobody without the module or without access to Contract projects", () => {
    expect(canSeeFinance(caller({ moduleOn: false }))).toBe(false);
    expect(canSeeFinance(caller({ canOpenProjects: false }))).toBe(false);
    expect(canSeeProjectFinance(caller({ moduleOn: false }), { manager_id: "u1" }, "u1")).toBe(false);
  });
  it("everyone mode: anyone who can open Contract projects", () => {
    expect(canSeeFinance(caller())).toBe(true);
    expect(canSeeFinance(caller({ unrestricted: false }))).toBe(true);
  });
  it("granted mode: an admin, or a member who holds the grant; an unrestricted member with no role does NOT pass", () => {
    const granted = (o: Partial<FinanceCaller>) => caller({ visibility: "granted", ...o });
    expect(canSeeFinance(granted({ role: "admin" }))).toBe(true);
    expect(canSeeFinance(granted({ unrestricted: false, hasGrant: true }))).toBe(true);
    expect(canSeeFinance(granted({ unrestricted: true }))).toBe(false);
    expect(canSeeFinance(granted({ unrestricted: false, hasGrant: false }))).toBe(false);
    expect(canSeeFinance(granted({ unrestricted: true, hasGrant: true }))).toBe(false);
  });
  it("a project manager sees the projects they manage, only in granted mode, and not the others", () => {
    const c = caller({ visibility: "granted" });
    expect(canSeeProjectFinance(c, { manager_id: "u1" }, "u1")).toBe(true);
    expect(canSeeProjectFinance(c, { manager_id: "u2" }, "u1")).toBe(false);
    expect(canSeeProjectFinance(c, { manager_id: null }, "u1")).toBe(false);
    expect(financeVisibleProjects(c, [{ manager_id: "u1", id: "a" }, { manager_id: "u2", id: "b" }], "u1").map((p) => p.id)).toEqual(["a"]);
    expect(financeVisibleProjects(caller({ visibility: "granted", role: "admin" }), [{ manager_id: "u2", id: "b" }], "u1").map((p) => p.id)).toEqual(["b"]);
  });
});

describe("workspace settings", () => {
  it("default to everyone, drop 5 points, 30 days, 15 percent late, and the margin floor", () => {
    expect(readFinanceSettings(null)).toEqual({ visibility: "everyone", dropPoints: 5, cashDays: 30, latePct: 15, freshnessDays: 3, marginFloor: null });
    expect(readFinanceSettings({ contract_projects: { margin_floor_pct: 10, finance_visibility: "granted", finance_lights: { drop_points: 7, cash_days: 45, late_pct: 20 } } }))
      .toMatchObject({ visibility: "granted", dropPoints: 7, cashDays: 45, latePct: 20, marginFloor: 10 });
  });
  it("a value that is wrong or out of range reads as its default", () => {
    expect(readFinanceSettings({ contract_projects: { finance_visibility: "nobody", finance_lights: { drop_points: -3, cash_days: "abc", late_pct: 900 } } }))
      .toMatchObject({ visibility: "everyone", dropPoints: FINANCE_DEFAULTS.dropPoints, cashDays: FINANCE_DEFAULTS.cashDays, latePct: FINANCE_DEFAULTS.latePct });
  });
  it("a settings request is checked: the visibility is one of the two, the numbers are in range", () => {
    expect(parseFinanceSettings({ finance_visibility: "granted" })).toEqual({ ok: true, value: { finance_visibility: "granted" } });
    expect(parseFinanceSettings({ finance_visibility: "everybody" }).ok).toBe(false);
    expect(parseFinanceSettings({ finance_lights: { drop_points: 6, cash_days: 40, late_pct: 10 } })).toEqual({ ok: true, value: { finance_lights: { drop_points: 6, cash_days: 40, late_pct: 10 } } });
    expect(parseFinanceSettings({ finance_lights: { drop_points: 0, cash_days: 40, late_pct: 10 } }).ok).toBe(false);
    expect(parseFinanceSettings({ finance_lights: { drop_points: 6, cash_days: 4000, late_pct: 10 } }).ok).toBe(false);
    expect(parseFinanceSettings({ finance_lights: "x" }).ok).toBe(false);
  });
});

describe("the typed estimate to go", () => {
  it("parses entries: amounts of 0 or more, null clears, duplicates and junk refused", () => {
    expect(parseEtgEntries({ entries: [{ wbs_code: "1.1", resource_code: "11", amount: "250.6" }, { resource_code: "41", amount: null }] }))
      .toEqual({ ok: true, entries: [{ wbs_code: "1.1", resource_code: "11", amount: 250.6, note: null }, { wbs_code: "", resource_code: "41", amount: null, note: null }] });
    expect(parseEtgEntries({ entries: [{ wbs_code: "1", resource_code: "11", amount: -1 }] }).ok).toBe(false);
    expect(parseEtgEntries({ entries: [{ wbs_code: "1", resource_code: "11", amount: "abc" }] }).ok).toBe(false);
    expect(parseEtgEntries({ entries: [{ resource_code: "11", amount: 1 }, { resource_code: "11", amount: 2 }] }).ok).toBe(false);
    expect(parseEtgEntries({ entries: [] }).ok).toBe(false);
    expect(parseEtgEntries({}).ok).toBe(false);
    expect(parseEtgEntries({ entries: Array.from({ length: ETG_LIMITS.maxEntries + 1 }, (_, i) => ({ resource_code: String(i), amount: 1 })) }).ok).toBe(false);
    expect(parseEtgEntries({ entries: [{ resource_code: "x".repeat(41), amount: 1 }] }).ok).toBe(false);
  });
  it("only a cell the approved budget has can take an estimate; clearing is always allowed", () => {
    const known = new Set(["1.1|11"]);
    const e = [{ wbs_code: "1.1", resource_code: "11", amount: 5, note: null }, { wbs_code: "9", resource_code: "11", amount: 5, note: null }, { wbs_code: "9", resource_code: "11", amount: null, note: null }];
    expect(unknownCells(e, known)).toEqual([e[1]]);
  });
});

describe("explanations stay behind the i (two sentences, 160 characters)", () => {
  it.each(Object.entries(PF_TIPS))("%s", (_k, text) => {
    expect(tipTextProblems(text)).toEqual([]);
  });
});
