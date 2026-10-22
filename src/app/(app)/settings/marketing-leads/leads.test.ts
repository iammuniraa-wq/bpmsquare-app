import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const nav = vi.hoisted(() => ({ to: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => { nav.to = to; throw new Error("NEXT_REDIRECT"); },
}));

import { DEFAULT_RUBRIC } from "@/lib/marketing/scoring";
import { PROFILE_FIELDS } from "@/lib/marketing/scoring";
import { SCORING_TIPS } from "@/lib/marketing/scoringTips";
import { HANDOVER_TIPS } from "@/lib/marketing/leads/tips";
import { handoverOf } from "@/lib/marketing/leads/handover";
import { EVENTS } from "@/lib/events/catalog";
import { SETTINGS_MENU, visibleSettingsMenu } from "@/lib/settingsMenu";
import { ROUTES } from "@/lib/constants";
import { COLLAPSED_ROWS, addRule, lineError, pointsWord, removeRule, ruleRows } from "./scoringLogic";
import { ScoringView } from "./ScoringTab";
import { HandoverView } from "./HandoverTab";
import MarketingScoringSettingsRedirect from "../marketing-scoring/page";
import MarketingHandoverSettingsRedirect from "../marketing-handover/page";

const events = Object.values(EVENTS);
const fields = PROFILE_FIELDS;
const total = DEFAULT_RUBRIC.behaviour.length + DEFAULT_RUBRIC.profile.length;
const scoring = (over: Partial<Parameters<typeof ScoringView>[0]> = {}) =>
  renderToString(createElement(ScoringView, { rubric: DEFAULT_RUBRIC, events, fields, set: () => {}, ...over })).replace(/<!-- -->/g, "");

describe("the scoring rows", () => {
  it("is one row per rule, what people do first and who they are after", () => {
    const rows = ruleRows(DEFAULT_RUBRIC);
    expect(rows).toHaveLength(total);
    expect(rows.slice(0, DEFAULT_RUBRIC.behaviour.length).every((r) => r.ref.kind === "behaviour")).toBe(true);
    expect(rows.slice(DEFAULT_RUBRIC.behaviour.length).every((r) => r.ref.kind === "profile")).toBe(true);
  });

  it("adds a rule of the chosen kind at the end and removes exactly that one", () => {
    const added = addRule(DEFAULT_RUBRIC, "profile", events, fields);
    expect(added.rubric.profile).toHaveLength(DEFAULT_RUBRIC.profile.length + 1);
    expect(added.ref).toEqual({ kind: "profile", index: DEFAULT_RUBRIC.profile.length });
    expect(removeRule(added.rubric, added.ref)).toEqual(DEFAULT_RUBRIC);
    const b = addRule(DEFAULT_RUBRIC, "behaviour", events, fields);
    expect(b.rubric.behaviour).toHaveLength(DEFAULT_RUBRIC.behaviour.length + 1);
    expect(removeRule(DEFAULT_RUBRIC, { kind: "behaviour", index: 0 }).behaviour).toHaveLength(DEFAULT_RUBRIC.behaviour.length - 1);
  });

  it("writes points with their sign and catches a Hot line that is not above the Warm line", () => {
    expect([pointsWord(5), pointsWord(-3), pointsWord(0)]).toEqual(["+5", "-3", "0"]);
    expect(lineError(DEFAULT_RUBRIC)).toBe("");
    expect(lineError({ ...DEFAULT_RUBRIC, thresholds: { engaged: 40, ready: 40 } })).toMatch(/higher than Warm/);
  });
});

describe("the Scoring tab", () => {
  it("is the three lines and one table, not a card of inputs per rule", () => {
    const out = scoring();
    expect(out.match(/<table /g)).toHaveLength(1);
    expect(out.match(/<input /g)).toHaveLength(3);
    expect(out).toContain("Warm from");
    expect(out).toContain("Hot from");
    expect(out).toContain("Look back (days)");
  });

  it("shows a few rows and then all of them on request", () => {
    expect(scoring().match(/: edit"/g)).toHaveLength(COLLAPSED_ROWS);
    expect(scoring()).toContain(`Show all rules (${total})`);
    expect(scoring({ expanded: true }).match(/: edit"/g)).toHaveLength(total);
  });

  it("offers a rule of either kind and the sample lead, none of the explanations printed", () => {
    const out = scoring();
    expect(out).toContain("Add: what people do");
    expect(out).toContain("Add: who they are");
    expect(out).toContain("Try on a sample lead");
    for (const text of Object.values(SCORING_TIPS)) expect(out, text).not.toContain(text);
  });

  it("opens a rule in a panel with its fields; fades and weekly cap wait behind More", () => {
    const out = scoring({ openPanel: { type: "rule", ref: { kind: "behaviour", index: 0 } } });
    expect(out).toContain('role="dialog"');
    for (const label of ["When someone…", "Shown as", "Points", "Fades over (days)", "Counts up to (a week)", "Remove rule"]) expect(out).toContain(label);
    expect(out).toMatch(/<details>/);
  });

  it("opens a who-they-are rule with its filter lines", () => {
    const out = scoring({ openPanel: { type: "rule", ref: { kind: "profile", index: 0 } } });
    expect(out).toContain("Matches when");
    expect(out).toContain('aria-label="About"');
    expect(out).toContain("+ Add a line");
  });

  it("opens the sample lead in a panel that says nothing is saved", () => {
    const out = scoring({ openPanel: { type: "try" } });
    expect(out).toContain("Nothing is saved or sent");
    expect(out).toContain("Account type");
  });

  it("says why the Hot line is wrong, next to the field", () => {
    const out = scoring({ rubric: { ...DEFAULT_RUBRIC, thresholds: { engaged: 40, ready: 30 } } });
    expect(out).toContain("Must be higher than Warm from.");
  });
});

const people = [{ user_id: "u1", label: "Rana" }, { user_id: "u2", label: "Omar" }, { user_id: "u3", label: "Lina" }];
const handover = (over: Partial<ReturnType<typeof handoverOf>> = {}, coverage = true, teams: { in_turn: number; team_lead: number } | null = { in_turn: 2, team_lead: 1 }) =>
  renderToString(createElement(HandoverView, { s: { ...handoverOf({}), ...over }, people, coverage, teams, set: () => {} })).replace(/<!-- -->/g, "");

describe("the Hand-over tab", () => {
  it("is one short form: no sections, no fixed Nova inbox row, no explanations printed", () => {
    const out = handover();
    for (const label of ["Make a lead when someone becomes Warm", "Working days to pick up a lead", "Days off", "Tell the owner", "Tell the team lead"]) expect(out).toContain(label);
    for (const gone of ["Leads by themselves", "Response time", "When a lead is overdue", "Where they hear", "Nova inbox"]) expect(out, gone).not.toContain(gone);
    for (const text of Object.values(HANDOVER_TIPS)) expect(out, text).not.toContain(text);
    expect(out.match(/aria-label="About [^"]+"/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("shows the standard response time (one working day, Sunday off) and the switches off", () => {
    const out = handover();
    expect(out).toMatch(/value="1"/);
    expect(out).toMatch(/aria-pressed="true"[^>]*>Sun</);
    expect(out).toMatch(/aria-checked="false" aria-label="Make a lead when someone becomes Warm"/);
  });

  it("shows the chosen settings: the rota in order with a way to remove each, only the others to add", () => {
    const out = handover({ fallback_user_ids: ["u2", "u1"], weekly_off: [5, 6], auto_create_leads: true });
    expect(out.indexOf("1. Omar")).toBeGreaterThan(-1);
    expect(out.indexOf("1. Omar")).toBeLessThan(out.indexOf("2. Rana"));
    expect(out).toContain('aria-label="Remove Omar"');
    expect(out).toMatch(/<option value="u3">Lina<\/option>/);
    expect(out).not.toMatch(/<option value="u1">/);
    expect(out).toMatch(/aria-pressed="true"[^>]*>Fri</);
  });

  it("links to Coverage with the result of its per-team choice, and only when Coverage is on", () => {
    const on = handover();
    expect(on).toContain("2 in turn, 1 to the team lead");
    expect(on).toContain(`href="${ROUTES.settingsCoverage}"`);
    expect(handover({}, false, null)).not.toContain("Change in Coverage");
  });

  it("keeps the tap targets at least 44 px", () => {
    expect(handover()).toMatch(/min-height:44px;min-width:44px/);
  });
});

describe("the old addresses", () => {
  it("send Scoring and Hand-over to their tab on Leads", () => {
    expect(() => MarketingScoringSettingsRedirect()).toThrow("NEXT_REDIRECT");
    expect(nav.to).toBe("/settings/marketing-leads");
    expect(() => MarketingHandoverSettingsRedirect()).toThrow("NEXT_REDIRECT");
    expect(nav.to).toBe("/settings/marketing-leads?tab=handover");
  });
});

describe("the Settings menu for Marketing", () => {
  const marketing = () => SETTINGS_MENU.filter((m) => m.group === "marketing");

  it("has three entries: Consent, Leads, Brand kit", () => {
    expect(marketing().map((m) => m.label)).toEqual(["Consent", "Leads", "Brand kit"]);
    expect(SETTINGS_MENU.some((m) => ["marketing-scoring", "marketing-handover"].includes(m.id))).toBe(false);
  });

  it("keeps the gates the separate pages had", () => {
    expect(marketing().find((m) => m.id === "marketing-leads")).toMatchObject({ adminOnly: true, featureKey: "marketing_scoring", href: "/settings/marketing-leads" });
    expect(marketing().find((m) => m.id === "marketing-consent")).toMatchObject({ adminOnly: true, featureAnyOf: ["marketing_scoring", "newsletter_studio"] });
    const ids = (features: Record<string, boolean>, isAdmin = true) =>
      visibleSettingsMenu({ isAdmin, canEdit: () => false, features }).flatMap((g) => g.items.map((i) => i.id));
    expect(ids({ marketing_scoring: true })).toEqual(expect.arrayContaining(["marketing-consent", "marketing-leads"]));
    expect(ids({})).not.toContain("marketing-leads");
    expect(ids({ newsletter_studio: true })).toContain("marketing-consent");
    expect(ids({ newsletter_studio: true })).not.toContain("marketing-leads");
    expect(ids({ marketing_scoring: true }, false)).not.toContain("marketing-leads");
  });

  it("is still found by the old words", () => {
    const leads = marketing().find((m) => m.id === "marketing-leads")!;
    expect(leads.keywords).toEqual(expect.arrayContaining(["scoring", "hand-over"]));
    expect(marketing().find((m) => m.id === "marketing-consent")!.keywords).toEqual(expect.arrayContaining(["limits", "opens"]));
  });
});
