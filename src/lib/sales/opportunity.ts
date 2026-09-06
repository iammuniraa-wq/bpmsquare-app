// Opportunity (deal) rules -- Sales Engine Piece B, docs/
// sales-engine-architecture.md §4. Pure, no I/O: stages, probability and
// the amount rule, shared by the routes (stored values) and the pages
// (display), so the board and the detail page can never disagree.

import { DEFAULT_OPPORTUNITY_STAGES, type OpportunityStageDef, type QuoteOutcome } from "@/lib/constants";
import { documentTotal, type SelectableLine } from "./lineTotals";

/** The tenant's stages, or the defaults; malformed config falls back too. */
export function opportunityStages(config: { opportunity_stages?: OpportunityStageDef[] | null } | null | undefined): OpportunityStageDef[] {
  const s = config?.opportunity_stages;
  if (!Array.isArray(s) || s.length === 0) return DEFAULT_OPPORTUNITY_STAGES;
  const clean = s.filter((x) => x && typeof x.value === "string" && x.value && typeof x.label === "string");
  return clean.length > 0 ? clean : DEFAULT_OPPORTUNITY_STAGES;
}

export function initialStage(stages: OpportunityStageDef[]): OpportunityStageDef {
  return stages.find((s) => s.is_initial) ?? stages[0];
}

export function stageDef(stages: OpportunityStageDef[], value: string): OpportunityStageDef | undefined {
  return stages.find((s) => s.value === value);
}

export function isClosedStage(stages: OpportunityStageDef[], value: string): boolean {
  return stageDef(stages, value)?.is_closed === true;
}

/** The outcome a closed stage implies (Won -> won, Lost -> lost); an open
 *  stage implies "open". A tenant stage can carry its own `outcome`. */
export function outcomeForStage(stages: OpportunityStageDef[], value: string): QuoteOutcome {
  const def = stageDef(stages, value);
  if (!def?.is_closed) return "open";
  return def.outcome ?? "won";
}

/**
 * Stored probability: the rep's override when set (0..100), else the
 * stage's hint, else 0. Piece E replaces the hint with the win rubric;
 * the override always wins.
 */
export function probabilityFor(
  stages: OpportunityStageDef[],
  stage: string,
  override: number | null | undefined
): number {
  if (typeof override === "number" && Number.isFinite(override)) return Math.max(0, Math.min(100, Math.round(override)));
  const def = stageDef(stages, stage);
  if (def?.is_closed) return def.outcome === "won" || def.outcome === undefined ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(def?.probability_hint ?? 0)));
}

/**
 * §4.4: a deal's amount is the latest linked quote's pre-tax subtotal when
 * one exists (deals compare like for like), else its own lines' total.
 */
export function opportunityAmount(
  linkedQuoteSubtotals: { created_at: string; subtotal: number }[],
  lines: SelectableLine[]
): number {
  if (linkedQuoteSubtotals.length > 0) {
    const latest = [...linkedQuoteSubtotals].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return Math.round((latest.subtotal || 0) * 100) / 100;
  }
  return Math.round(documentTotal(lines) * 100) / 100;
}

export function weightedValue(amount: number, probability: number): number {
  return Math.round(amount * (probability / 100) * 100) / 100;
}

/** Whole days since `sinceIso` as of `todayKey` (yyyy-mm-dd, tenant's day). */
export function daysBetween(sinceIso: string | null | undefined, todayKey: string): number {
  if (!sinceIso) return 0;
  const since = Date.parse(sinceIso.slice(0, 10));
  const today = Date.parse(todayKey);
  if (!Number.isFinite(since) || !Number.isFinite(today)) return 0;
  return Math.max(0, Math.floor((today - since) / 86_400_000));
}

export const OPPORTUNITY_SOURCES = ["lead", "campaign", "direct", "referral", "other"] as const;
export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];
export const OPPORTUNITY_SOURCE_LABEL: Record<OpportunitySource, string> = {
  lead: "Lead", campaign: "Campaign", direct: "Direct", referral: "Referral", other: "Other",
};

export const TEAM_ROLES = ["owner", "sales", "technical", "knows_customer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  owner: "Owner", sales: "Sales", technical: "Technical", knows_customer: "Knows the customer",
};

/** [{ user_id, role }] from anything -- unknown roles dropped, de-duplicated by user. */
export function parseTeam(raw: unknown): { user_id: string; role: TeamRole }[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: { user_id: string; role: TeamRole }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const userId = typeof o.user_id === "string" ? o.user_id : "";
    const role = (TEAM_ROLES as readonly string[]).includes(String(o.role)) ? (o.role as TeamRole) : null;
    if (!userId || !role || seen.has(userId)) continue;
    seen.add(userId);
    out.push({ user_id: userId, role });
  }
  return out;
}
