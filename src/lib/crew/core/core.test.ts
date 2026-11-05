import { describe, expect, it } from "vitest";
import { checkBudget, effectiveAgentCap, pausedReason, percentUsed } from "./budget";
import { addDaysIso, findingFingerprint, proposalFingerprint, purgeAfter } from "./fingerprint";
import { bannedHits, getPath, renderTemplate, templateProblems, validateDraft, type ValidateEnv } from "./grounding";
import { dailySlot, eventDedupeKey, localParts, manualDedupeKey, parseTime, weeklySlot } from "./schedule";
import { sanitizeConfig, tileStatus, withDigest } from "./settings";
import { foreignIds } from "./tools";
import type { DraftFinding } from "../types";

describe("getPath and renderTemplate (the number rule)", () => {
  const out = new Map<string, unknown>([["s1", { deals: { d1: { boq: { unpriced: 212, lines: 340 }, closing_at: "2026-11-05T09:00:00.000Z", rfq: [{ waiting: 3 }], note: null } } }]]);

  it("reads dotted and indexed paths, undefined when a hop is missing", () => {
    expect(getPath(out.get("s1"), "deals.d1.boq.unpriced")).toBe(212);
    expect(getPath(out.get("s1"), "deals.d1.rfq[0].waiting")).toBe(3);
    expect(getPath(out.get("s1"), "deals.d9.boq")).toBeUndefined();
    expect(getPath(out.get("s1"), "deals.d1.note.x")).toBeUndefined();
  });

  it("fills placeholders from the cited step and formats dates", () => {
    const r = renderTemplate("{{s1.deals.d1.boq.unpriced}} of {{s1.deals.d1.boq.lines}} lines, ends {{s1.deals.d1.closing_at|date}}", out);
    expect(r).toEqual({ ok: true, text: "212 of 340 lines, ends 5 Nov 2026" });
  });

  it("reports every placeholder that cannot be resolved (missing step, missing path, null)", () => {
    const r = renderTemplate("{{s2.x}} {{s1.deals.d1.nope}} {{s1.deals.d1.note}}", out);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["s2.x", "s1.deals.d1.nope", "s1.deals.d1.note"]);
  });

  it("rejects a digit outside a placeholder, a link, markup and an empty text", () => {
    expect(templateProblems("About 3 lines are unpriced")[0]).toMatch(/digit/);
    expect(templateProblems("See https://example.com")[0]).toMatch(/link/);
    expect(templateProblems("<b>bold</b>")[0]).toMatch(/markup/);
    expect(templateProblems("   ")).toEqual(["empty text"]);
    expect(templateProblems("{{s1.a}} lines are unpriced")).toEqual([]);
    expect(templateProblems("{{ s12.deals.d1.boq.unpriced|date }} is fine")).toEqual([]);
    expect(templateProblems("a stray {{ placeholder")[0]).toMatch(/malformed/);
  });

  it("finds banned terms as whole words only", () => {
    expect(bannedHits("We will win this one", ["will win"])).toEqual(["will win"]);
    expect(bannedHits("A margin call", ["margin"])).toEqual(["margin"]);
    expect(bannedHits("The marginal case", ["margin"])).toEqual([]);
  });
});

describe("validateDraft", () => {
  const steps = new Map<string, unknown>([["s1", { deals: { d1: { ref: "TND-1", boq: { unpriced: 5, lines: 10 } } } }]]);
  const env: ValidateEnv = {
    steps, candidateIds: new Set(["deal-1"]), kinds: ["at_risk"], banned: ["margin"], actions: ["tender.nudge"],
    permittedRecipients: () => new Set(["u-ok"]), refsOf: () => [{ type: "opportunity", id: "deal-1", label: "TND-1" }], hrefFor: (r) => `/pipeline/${r.id}`,
  };
  const good: DraftFinding = {
    kind: "at_risk", severity: "review", subject: { type: "opportunity", id: "deal-1" }, title_tmpl: "{{s1.deals.d1.boq.unpriced}} lines are unpriced.",
    body_tmpl: "{{s1.deals.d1.ref}} needs a look.", evidence: [{ step: "s1", path: "deals.d1.boq.unpriced", label: "Unpriced" }], gaps: [],
  };

  it("accepts a grounded finding and builds the link on the server", () => {
    const v = validateDraft(good, env);
    expect(v.ok).toBe(true);
    if (v.ok) { expect(v.finding.title).toBe("5 lines are unpriced."); expect(v.finding.evidence[0].href).toBe("/pipeline/deal-1"); }
  });

  it.each<[string, Partial<DraftFinding>, RegExp]>([
    ["unknown kind", { kind: "made_up" }, /unknown kind/],
    ["a subject that is not a candidate", { subject: { type: "opportunity", id: "deal-9" } }, /out of scope/],
    ["no evidence", { evidence: [] }, /no evidence/],
    ["a step that does not exist", { evidence: [{ step: "s9", path: "x" }] }, /step that does not exist/],
    ["a path that is not in the result", { evidence: [{ step: "s1", path: "deals.d1.nope" }] }, /not in that result/],
    ["a digit in the title", { title_tmpl: "5 lines are unpriced" }, /digit/],
    ["a placeholder that points nowhere", { body_tmpl: "{{s1.deals.d1.nope}}" }, /not in the cited results/],
    ["banned wording", { body_tmpl: "{{s1.deals.d1.ref}} has a poor margin" }, /banned wording/],
    ["a digit in a gap", { gaps: ["could not check 2 things"] }, /gap/],
  ])("drops a finding with %s", (_n, over, why) => {
    const v = validateDraft({ ...good, ...over }, env);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(why);
  });

  it("checks a proposal's recipients, action and target", () => {
    const withNote = (p: Partial<NonNullable<DraftFinding["proposal"]>>): DraftFinding => ({ ...good, proposal: { action_key: "tender.nudge", target_type: "opportunity", target_id: "deal-1", recipient_ids: ["u-ok"], message_tmpl: "Could you look at {{s1.deals.d1.ref}}?", ...p } });
    expect(validateDraft(withNote({}), env).ok).toBe(true);
    expect(validateDraft(withNote({ recipient_ids: ["u-other"] }), env).ok).toBe(false);
    expect(validateDraft(withNote({ recipient_ids: [] }), env).ok).toBe(false);
    expect(validateDraft(withNote({ target_id: "deal-9" }), env).ok).toBe(false);
    expect(validateDraft(withNote({ action_key: "wfm.recheck" }), env).ok).toBe(false);
    expect(validateDraft(withNote({ message_tmpl: "Lower the margin on {{s1.deals.d1.ref}}" }), env).ok).toBe(false);
    expect(validateDraft(withNote({ message_tmpl: "Take 5 minutes" }), env).ok).toBe(false);
    expect(validateDraft(withNote({}), { ...env, permittedRecipients: () => null }).ok).toBe(false);
  });
});

describe("budget arithmetic: the tightest ceiling wins", () => {
  const base = { runUsed: 0, runCap: 80_000, agentUsed: 0, agentCap: 600_000, pooledUsed: 0, pooledBudget: 1_500_000 };
  it("allows a fresh run and reports the tightest remainder", () => {
    expect(checkBudget(base)).toEqual({ allowed: true, remaining: 80_000, limitedBy: null });
  });
  it("stops on the agent's cap, the workspace's pool or the run's own limit", () => {
    expect(checkBudget({ ...base, agentUsed: 600_000 })).toMatchObject({ allowed: false, limitedBy: "agent" });
    expect(checkBudget({ ...base, pooledUsed: 1_500_000 })).toMatchObject({ allowed: false, limitedBy: "workspace" });
    expect(checkBudget({ ...base, runUsed: 80_000 })).toMatchObject({ allowed: false, limitedBy: "run" });
    expect(checkBudget({ ...base, agentUsed: 590_000 })).toMatchObject({ allowed: true, remaining: 10_000 });
  });
  it("a cap of zero switches the agent off; a platform override beats the default", () => {
    expect(checkBudget({ ...base, agentCap: 0 }).allowed).toBe(false);
    expect(effectiveAgentCap(null, 600_000)).toBe(600_000);
    expect(effectiveAgentCap(250_000, 600_000)).toBe(250_000);
    expect(effectiveAgentCap(0, 600_000)).toBe(0);
    expect(effectiveAgentCap(-5, 600_000)).toBe(600_000);
  });
  it("percent and the card text", () => {
    expect(percentUsed(150_000, 600_000)).toBe(25);
    expect(percentUsed(10, 0)).toBe(100);
    expect(percentUsed(2_000_000, 600_000)).toBe(100);
    expect(pausedReason("agent")).toBe("Paused: monthly allowance reached");
  });
});

describe("schedules in the workspace's own clock", () => {
  // 04:45 UTC on Mon 2 Nov 2026 is 07:45 in Riyadh (UTC+3) and 10:15 in Kolkata.
  const now = new Date("2026-11-02T04:45:00Z");
  it("reads the local day, time and weekday", () => {
    expect(localParts(now, "Asia/Riyadh")).toMatchObject({ dayKey: "2026-11-02", hhmm: "07:45", dow: 1 });
    expect(localParts(now, "Asia/Kolkata").hhmm).toBe("10:15");
    expect(localParts(now, "Not/AZone").dayKey).toBe("2026-11-02");
  });
  it("a daily slot is due once the clock passes the time, on an allowed day, with one key per local day", () => {
    expect(dailySlot("tender_watch", { time: "07:30" }, now, "Asia/Riyadh")).toEqual({ due: true, key: "tender_watch|daily|2026-11-02", day: "2026-11-02" });
    expect(dailySlot("tender_watch", { time: "08:00" }, now, "Asia/Riyadh").due).toBe(false);
    expect(dailySlot("tender_watch", { time: "07:30", days: [0, 2] }, now, "Asia/Riyadh").due).toBe(false);
    expect(dailySlot("tender_watch", { time: "07:30", days: [1] }, now, "Asia/Riyadh").due).toBe(true);
  });
  it("no week-off is assumed: Friday and Saturday are ordinary days unless the workspace excludes them", () => {
    const friday = new Date("2026-11-06T05:00:00Z");
    expect(dailySlot("tender_watch", { time: "07:30" }, friday, "Asia/Riyadh").due).toBe(true);
  });
  it("the weekly slot needs its weekday; event and manual keys are debounced per hour", () => {
    expect(weeklySlot("attendance", { time: "02:00", weeklyDay: 1 }, now, "Asia/Riyadh").due).toBe(true);
    expect(weeklySlot("attendance", { time: "02:00", weeklyDay: 2 }, now, "Asia/Riyadh").due).toBe(false);
    expect(eventDedupeKey("tender_watch", "deal-1", now, "Asia/Riyadh")).toBe("tender_watch|deal:deal-1|2026-11-02T07");
    expect(manualDedupeKey("tender_watch", now)).toBe("tender_watch|manual|2026-11-02T04");
  });
  it("parses HH:MM", () => {
    expect(parseTime("07:30")).toBe("07:30");
    expect(parseTime("7:30")).toBeNull();
    expect(parseTime("24:00")).toBeNull();
  });
});

describe("fingerprints", () => {
  it("are stable, and a worse key fact is a different fingerprint", () => {
    expect(findingFingerprint("tender_watch", "at_risk", "d1", "d3")).toBe(findingFingerprint("tender_watch", "at_risk", "d1", "d3"));
    expect(findingFingerprint("tender_watch", "at_risk", "d1", "d3")).not.toBe(findingFingerprint("tender_watch", "at_risk", "d1", "d1"));
    expect(findingFingerprint("tender_watch", "at_risk", "d1", "d3")).not.toBe(findingFingerprint("tender_watch", "stuck_decision", "d1", "d3"));
  });
  it("a proposal fingerprint ignores the order of recipients", () => {
    expect(proposalFingerprint("tender.nudge", "d1", ["b", "a"])).toBe(proposalFingerprint("tender.nudge", "d1", ["a", "b"]));
  });
  it("adds days across a month end and computes purge dates", () => {
    expect(addDaysIso("2026-11-30", 1)).toBe("2026-12-01");
    expect(purgeAfter("2026-11-04", 180)).toBe("2027-05-03");
  });
});

describe("settings a workspace may change", () => {
  it("keeps only the editable subset and refuses bad values", () => {
    const cur = { visibility: "admins" as const, digest_optin: ["u1"], sensitivity: "balanced" as const };
    const r = sanitizeConfig("tender_watch", { schedule: { time: "06:15", days: [0, 1, 1, 9] }, sensitivity: "quiet", watch_window_days: 30, visibility: "deal_teams", digest_optin: [], evil: true }, cur);
    expect(r.problems).toEqual([]);
    expect(r.config).toMatchObject({ schedule: { time: "06:15", days: [0, 1] }, sensitivity: "quiet", watch_window_days: 30, visibility: "admins", digest_optin: ["u1"] });
    expect("evil" in r.config).toBe(false);
    expect(sanitizeConfig("tender_watch", { schedule: { time: "25:00" } }, cur).problems.length).toBe(1);
    expect(sanitizeConfig("tender_watch", { sensitivity: "loud" }, cur).problems.length).toBe(1);
    expect(sanitizeConfig("tender_watch", { watch_window_days: 1 }, cur).problems.length).toBe(1);
  });
  it("every day selected means no day filter", () => {
    expect(sanitizeConfig("tender_watch", { schedule: { time: "07:30", days: [0, 1, 2, 3, 4, 5, 6] } }, {}).config.schedule).toEqual({ time: "07:30" });
  });
  it("the digest is each person's own switch", () => {
    expect(withDigest({}, "u1", true).digest_optin).toEqual(["u1"]);
    expect(withDigest({ digest_optin: ["u1", "u2"] }, "u1", false).digest_optin).toEqual(["u2"]);
  });
});

describe("the tile's status chip", () => {
  const ok = { engineReady: true, dbPending: false, enabled: true, paused: false, workspacePaused: false, platformStopped: false, aiConfigured: true, overCap: false, needsTimezone: false };
  it("reads the cause in order", () => {
    expect(tileStatus(ok).key).toBe("on");
    expect(tileStatus({ ...ok, enabled: false }).key).toBe("off");
    expect(tileStatus({ ...ok, paused: true }).key).toBe("paused");
    expect(tileStatus({ ...ok, workspacePaused: true }).key).toBe("paused");
    expect(tileStatus({ ...ok, platformStopped: true }).key).toBe("paused");
    expect(tileStatus({ ...ok, overCap: true }).key).toBe("allowance");
    expect(tileStatus({ ...ok, aiConfigured: false }).key).toBe("no_ai");
    expect(tileStatus({ ...ok, needsTimezone: true }).key).toBe("no_timezone");
    expect(tileStatus({ ...ok, enabled: false, needsTimezone: true })).toMatchObject({ key: "needs_setup", label: "Needs setup" });
    expect(tileStatus({ ...ok, enabled: false, needsTimezone: false }).key).toBe("off");
    expect(tileStatus({ ...ok, dbPending: true })).toMatchObject({ key: "needs_db", label: "Needs a database update" });
    expect(tileStatus({ ...ok, engineReady: false, dbPending: true })).toMatchObject({ key: "needs_setup", label: "Needs setup" });
  });
});

describe("the tool host refuses ids that are not this run's candidates", () => {
  const cands = new Set(["deal-1", "deal-2"]);
  it("passes candidates and rejects anything else", () => {
    expect(foreignIds({ deal_id: "deal-1" }, cands)).toEqual([]);
    expect(foreignIds({ deal_ids: ["deal-1", "deal-2"] }, cands)).toEqual([]);
    expect(foreignIds({ deal_id: "other-tenant-deal" }, cands)).toEqual(["other-tenant-deal"]);
    expect(foreignIds({ deal_ids: ["deal-1", "x"] }, cands)).toEqual(["x"]);
    expect(foreignIds({ deal_id: 5 }, cands)).toEqual(["5"]);
    expect(foreignIds(null, cands)).toEqual([]);
  });
});
