import type { Account360Factor } from "@/lib/account360/types";
import { getSegmentField, matchesAllFilters, type SegmentFilter, type SegmentOperator } from "@/lib/marketingSegmentation";
import { isKnownEvent } from "@/lib/events/catalog";

// The lead score (docs/marketing-platform-architecture.md 4.1). Pure: no
// database, no clock of its own, no AI. A number a rep is told to act on has
// to be explainable and identical on every reload (bpmsquarecore.md 10a), so
// this returns the working with the number -- the same { score, label,
// factors } shape the Account 360 rating uses -- and the same inputs always
// give the same output. AI may later write the sentence under the number,
// never the number.
//
// Three kinds of factor, summed and clamped to 0-100:
//   behaviour  what the person did (events), decayed by age
//   profile    who they are (rules over the account and the contact), no decay
//   market     the company's buying stage (Signals, later) -- the ONE factor a
//              lead score may take from another score, and never the reverse

export type ScoringEvent = {
  name: string;
  occurred_at: string;
  payload?: Record<string, unknown> | null;
};

export type BehaviourRule = {
  event: string;
  /** Shown in the factor list. */
  label: string;
  /** Signed. Zero means "recorded, counts for nothing". */
  points: number;
  /** Points halve every this many days. Absent or 0: no decay. */
  half_life_days?: number;
  /** At most this many of this rule's events count in any one week. */
  max_per_week?: number;
  /** Only events whose payload has all of these key/values. First matching rule wins, so list the specific rule first. */
  match?: Record<string, string | number | boolean>;
};

export type ProfileRule = {
  label: string;
  filters: SegmentFilter[];
  match: "all" | "any";
  points: number;
};

export type ScoringThresholds = {
  /** Score at or above this is Warm (stage "engaged"). */
  engaged: number;
  /** Score at or above this is Hot (stage "ready"). */
  ready: number;
};

export type ScoringRubric = {
  /** Bumped on every saved change, so "why 72?" can name the rubric in force. */
  version: number;
  /** Events older than this are ignored. */
  window_days: number;
  behaviour: BehaviourRule[];
  profile: ProfileRule[];
  thresholds: ScoringThresholds;
  /** Buying stage (Signals) -> points, 0 to 15 each. Empty until Signals exists. */
  buying_stage_points: Record<string, number>;
};

export type LeadScoreStage = "new" | "engaged" | "ready";
export type LeadScoreLabel = "Cold" | "Warm" | "Hot";

export type LeadScoreFactor = Account360Factor & { kind: "behaviour" | "profile" | "market" };

export type LeadScore = {
  /** 0-100. */
  score: number;
  label: LeadScoreLabel;
  stage: LeadScoreStage;
  factors: LeadScoreFactor[];
  rubric_version: number;
};

const DAY_MS = 86_400_000;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export const SCORE_LABEL: Record<LeadScoreStage, LeadScoreLabel> = {
  new: "Cold",
  engaged: "Warm",
  ready: "Hot",
};

export function stageForScore(score: number, t: ScoringThresholds): LeadScoreStage {
  return score >= t.ready ? "ready" : score >= t.engaged ? "engaged" : "new";
}

// ── Default rubric ───────────────────────────────────────────────────────────
// Straight from section 4.1. A tenant edits it in Settings -> Marketing ->
// Scoring; nothing here is tenant-specific.

export const DEFAULT_RUBRIC: ScoringRubric = {
  version: 1,
  window_days: 90,
  behaviour: [
    { event: "email.clicked", label: "Clicked a link in an email", points: 10, half_life_days: 14, max_per_week: 10 },
    { event: "email.interest", label: "Said they are interested", points: 30, half_life_days: 30 },
    { event: "quote.opened", label: "Opened a quote", points: 20, half_life_days: 14 },
    { event: "web.page_viewed", label: "Looked at a pricing or product page", points: 15, half_life_days: 7, max_per_week: 10, match: { buying_interest: true } },
    { event: "web.page_viewed", label: "Visited the website", points: 2, half_life_days: 7, max_per_week: 10 },
    { event: "form.submitted", label: "Filled in a form", points: 30, half_life_days: 30 },
    { event: "whatsapp.replied", label: "Replied on WhatsApp", points: 25, half_life_days: 14 },
    { event: "event.attended", label: "Came to an event", points: 40, half_life_days: 60 },
    { event: "email.opened", label: "Opened an email", points: 1, half_life_days: 7, max_per_week: 5 },
    { event: "email.unsubscribed", label: "Unsubscribed", points: -40 },
    { event: "email.bounced", label: "Email address bounced", points: 0 },
  ],
  profile: [
    { label: "OEM account", filters: [{ id: "p1", field: "type", operator: "equals", value: "oem" }], match: "all", points: 10 },
    {
      label: "Based in the Gulf",
      filters: ["Saudi Arabia", "United Arab Emirates", "Qatar", "Kuwait", "Oman", "Bahrain"].map((v, i) => ({ id: `g${i}`, field: "country", operator: "equals" as const, value: v })),
      match: "any", points: 5,
    },
    { label: "Has an active service contract", filters: [{ id: "p3", field: "has_active_amc", operator: "is_true", value: "" }], match: "all", points: 5 },
    {
      label: "Buyer-type role",
      filters: [
        { id: "r1", field: "contact_role", operator: "contains", value: "procurement" },
        { id: "r2", field: "contact_role", operator: "contains", value: "purchas" },
        { id: "r3", field: "contact_role", operator: "contains", value: "manager" },
      ],
      match: "any", points: 10,
    },
  ],
  thresholds: { engaged: 20, ready: 60 },
  buying_stage_points: {},
};

// ── Profile fields ───────────────────────────────────────────────────────────
// Scoring has its own small field list rather than reaching into
// SEGMENT_FIELDS: that registry feeds the campaign segmentation builder, and a
// scoring-only field (the contact's role) must not appear in a campaign's
// palette.

export type ProfileField = { key: string; label: string; type: "text" | "select" | "boolean" | "number"; operators: SegmentOperator[]; options?: { value: string; label: string }[] };

const fromSegments = (key: string, label?: string): ProfileField | null => {
  const f = getSegmentField(key);
  return f ? { key: f.key, label: label ?? f.label, type: f.type === "date" ? "text" : f.type, operators: f.operators, options: f.options } : null;
};

export const PROFILE_FIELDS: ProfileField[] = [
  fromSegments("type", "Account type"),
  fromSegments("industry"),
  fromSegments("country"),
  fromSegments("city"),
  fromSegments("annual_revenue", "Annual revenue"),
  fromSegments("has_active_amc", "Has an active service contract"),
  fromSegments("owned_product_skus", "Has bought product (SKU or name)"),
  { key: "contact_role", label: "Contact's role", type: "text", operators: ["contains", "equals"] },
  { key: "contact_department", label: "Contact's department", type: "text", operators: ["contains", "equals"] },
].filter((f): f is ProfileField => f !== null);

export function getProfileField(key: string): ProfileField | undefined {
  return PROFILE_FIELDS.find((f) => f.key === key);
}

// ── The score ────────────────────────────────────────────────────────────────

function ruleFor(rules: BehaviourRule[], e: ScoringEvent): BehaviourRule | undefined {
  return rules.find((r) => {
    if (r.event !== e.name) return false;
    if (!r.match) return true;
    const payload = e.payload ?? {};
    return Object.entries(r.match).every(([k, v]) => payload[k] === v);
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ago(days: number): string {
  const d = Math.floor(days);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export function computeLeadScore(
  rubric: ScoringRubric,
  events: ScoringEvent[],
  profile: Record<string, unknown>,
  buyingStage: string | null | undefined,
  now: Date = new Date(),
): LeadScore {
  const factors: LeadScoreFactor[] = [];
  const nowMs = now.getTime();

  // Behaviour. Group events by the rule that claims them, apply the weekly
  // cap, then decay each survivor by its own age.
  const claimed = new Map<BehaviourRule, { ageDays: number }[]>();
  for (const e of events) {
    const t = Date.parse(e.occurred_at);
    if (!Number.isFinite(t) || t > nowMs) continue;
    const ageDays = (nowMs - t) / DAY_MS;
    if (ageDays > rubric.window_days) continue;
    const rule = ruleFor(rubric.behaviour, e);
    if (!rule || rule.points === 0) continue;
    const list = claimed.get(rule) ?? [];
    list.push({ ageDays });
    claimed.set(rule, list);
  }
  for (const [rule, list] of claimed) {
    list.sort((a, b) => a.ageDays - b.ageDays);
    const perWeek = new Map<number, number>();
    let raw = 0;
    let counted = 0;
    for (const { ageDays } of list) {
      const week = Math.floor(ageDays / 7);
      const used = perWeek.get(week) ?? 0;
      if (rule.max_per_week && used >= rule.max_per_week) continue;
      perWeek.set(week, used + 1);
      const decay = rule.half_life_days && rule.half_life_days > 0 ? Math.pow(0.5, ageDays / rule.half_life_days) : 1;
      raw += rule.points * decay;
      counted++;
    }
    const points = Math.round(raw);
    if (points === 0) continue;
    const latest = list[0].ageDays;
    factors.push({
      kind: "behaviour",
      label: rule.label,
      points,
      detail: `${plural(counted, "time", "times")} in the last ${rubric.window_days} days, most recently ${ago(latest)}${rule.half_life_days ? ` (fades over ${rule.half_life_days} days)` : ""}`,
    });
  }

  // Profile. No decay: who someone is does not age out.
  for (const rule of rubric.profile) {
    if (rule.points === 0) continue;
    if (rule.filters.length === 0) continue;
    if (matchesAllFilters(profile, rule.filters, rule.match)) {
      factors.push({ kind: "profile", label: rule.label, points: Math.round(rule.points), detail: "Matches this profile" });
    }
  }

  // Company in market (Signals): the one cross-score factor.
  if (buyingStage) {
    const p = clamp(Math.round(rubric.buying_stage_points[buyingStage] ?? 0), 0, 15);
    if (p > 0) factors.push({ kind: "market", label: "Company is in the market", points: p, detail: `Buying stage: ${buyingStage}` });
  }

  // Negative behaviour first (it is the thing a rep most needs to see), then
  // biggest contribution first. Stable for equal points: label order.
  factors.sort((a, b) => {
    const an = a.points < 0 ? 0 : 1;
    const bn = b.points < 0 ? 0 : 1;
    if (an !== bn) return an - bn;
    return Math.abs(b.points) - Math.abs(a.points) || a.label.localeCompare(b.label);
  });

  const score = clamp(factors.reduce((t, f) => t + f.points, 0), 0, 100);
  const stage = stageForScore(score, rubric.thresholds);
  return { score, label: SCORE_LABEL[stage], stage, factors, rubric_version: rubric.version };
}

/** Whether moving from one score to another is worth announcing (lead.scored): the label changed or it moved 10 points. */
export function isNotableScoreChange(prev: { score: number; stage: LeadScoreStage } | null, next: { score: number; stage: LeadScoreStage }): boolean {
  if (!prev) return true;
  return prev.stage !== next.stage || Math.abs(prev.score - next.score) >= 10;
}

// ── Validation (the settings route's safety boundary) ────────────────────────

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
};

export function sanitizeProfileFilters(input: unknown): SegmentFilter[] {
  if (!Array.isArray(input)) return [];
  const out: SegmentFilter[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const { id, field, operator, value } = raw as Record<string, unknown>;
    const def = typeof field === "string" ? getProfileField(field) : undefined;
    if (!def) continue;
    if (typeof operator !== "string" || !def.operators.includes(operator as SegmentOperator)) continue;
    out.push({
      id: typeof id === "string" && id ? id.slice(0, 40) : `${field}_${out.length}`,
      field: field as string,
      operator: operator as SegmentOperator,
      value: typeof value === "string" ? value.slice(0, 200) : "",
    });
  }
  return out.slice(0, 12);
}

/** Turns anything into a valid rubric. Unknown events and fields are dropped, numbers clamped. The version is NOT trusted from input. */
export function sanitizeRubric(input: unknown, version: number): ScoringRubric {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  const behaviour: BehaviourRule[] = [];
  for (const r of Array.isArray(raw.behaviour) ? raw.behaviour : []) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const event = str(o.event, 80);
    if (!isKnownEvent(event)) continue;
    const rule: BehaviourRule = {
      event,
      label: str(o.label, 80) || event,
      points: Math.round(num(o.points, -100, 100, 0)),
    };
    const half = Math.round(num(o.half_life_days, 0, 365, 0));
    if (half > 0) rule.half_life_days = half;
    const cap = Math.round(num(o.max_per_week, 0, 100, 0));
    if (cap > 0) rule.max_per_week = cap;
    if (o.match && typeof o.match === "object") {
      const m: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(o.match as Record<string, unknown>).slice(0, 4)) {
        if (/^[a-z_]{1,40}$/.test(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) m[k] = typeof v === "string" ? v.slice(0, 80) : v;
      }
      if (Object.keys(m).length > 0) rule.match = m;
    }
    behaviour.push(rule);
  }

  const profile: ProfileRule[] = [];
  for (const r of Array.isArray(raw.profile) ? raw.profile : []) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const filters = sanitizeProfileFilters(o.filters);
    if (filters.length === 0) continue;
    profile.push({
      label: str(o.label, 80) || "Profile match",
      filters,
      match: o.match === "any" ? "any" : "all",
      points: Math.round(num(o.points, -100, 100, 0)),
    });
  }

  const t = (raw.thresholds && typeof raw.thresholds === "object" ? raw.thresholds : {}) as Record<string, unknown>;
  let engaged = Math.round(num(t.engaged, 1, 99, DEFAULT_RUBRIC.thresholds.engaged));
  let ready = Math.round(num(t.ready, 2, 100, DEFAULT_RUBRIC.thresholds.ready));
  if (ready <= engaged) { engaged = DEFAULT_RUBRIC.thresholds.engaged; ready = DEFAULT_RUBRIC.thresholds.ready; }

  const stagePoints: Record<string, number> = {};
  if (raw.buying_stage_points && typeof raw.buying_stage_points === "object") {
    for (const [k, v] of Object.entries(raw.buying_stage_points as Record<string, unknown>).slice(0, 12)) {
      if (/^[a-z0-9_ -]{1,40}$/i.test(k)) stagePoints[k] = Math.round(num(v, 0, 15, 0));
    }
  }

  return {
    version,
    window_days: Math.round(num(raw.window_days, 7, 365, DEFAULT_RUBRIC.window_days)),
    behaviour: behaviour.slice(0, 40),
    profile: profile.slice(0, 40),
    thresholds: { engaged, ready },
    buying_stage_points: stagePoints,
  };
}

/** The rubric a tenant actually runs: theirs if they saved one, the default if not. */
export function rubricOf(saved: ScoringRubric | null | undefined): ScoringRubric {
  return saved && Array.isArray(saved.behaviour) && saved.thresholds ? saved : DEFAULT_RUBRIC;
}

/** True when two rubrics differ in anything that changes a score (ignores version). */
export function rubricChanged(a: ScoringRubric, b: ScoringRubric): boolean {
  const strip = ({ version: _v, ...rest }: ScoringRubric) => JSON.stringify(rest);
  return strip(a) !== strip(b);
}
