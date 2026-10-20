import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig } from "@/lib/constants";
import { MAX_EVENT_DEPTH } from "@/lib/events/catalog";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { computeAccountSignals } from "@/lib/coverage/resolve";
import { marketingConfigOf } from "../config";
import { effectiveLeadStage, isLeadStageKey, type LeadStageKey } from "../leadStages";
import { setLeadStage } from "../leadStatus";
import { isSchemaPending } from "../pending";
import {
  computeLeadScore, isNotableScoreChange, rubricOf,
  type LeadScore, type LeadScoreStage, type ScoringEvent, type ScoringRubric,
} from "../scoring";

// Turns what a lead's people did (domain_event) into the lead's stored score
// and the factors behind it. Recomputed from scratch every time, never
// incremented: the same events and the same rubric always give the same
// number, so running it twice, or from the cron and from a button at once,
// cannot drift (docs/marketing-platform-architecture.md 4.1).

const DAY_MS = 86_400_000;
const EVENT_LIMIT = 1000;

export type StoredFactors = {
  rubric_version: number;
  label: string;
  stage: LeadScoreStage;
  factors: LeadScore["factors"];
  events_seen: number;
};

export type ScoreOutcome =
  | { ok: true; leadId: string; score: number; stage: LeadScoreStage; label: string; moved_to: LeadStageKey | null; events_seen: number }
  | { ok: false; reason: "not_found" | "pending" | "error"; message?: string };

type LeadRow = {
  id: string; account_id: string; contact_id: string | null; status: string | null; custom_status_id: string | null;
  score: number | null; score_factors: Partial<StoredFactors> | null;
};

export type ScorerDeps = { computeSignals?: typeof computeAccountSignals };

/** The rubric a workspace runs, from its saved config. */
export function rubricFromConfig(config: Partial<TenantConfig> | null | undefined): ScoringRubric {
  return rubricOf(marketingConfigOf(config).scoring);
}

const usesField = (rubric: ScoringRubric, key: string) => rubric.profile.some((r) => r.filters.some((f) => f.field === key));

/** The events about this lead's person: their own if the lead names a contact, otherwise everyone at the company. */
export async function loadLeadEvents(admin: SupabaseClient, tenantId: string, lead: Pick<LeadRow, "account_id" | "contact_id">, rubric: ScoringRubric, now: Date): Promise<ScoringEvent[]> {
  const since = new Date(now.getTime() - rubric.window_days * DAY_MS).toISOString();
  let q = admin
    .from("domain_event").select("name, occurred_at, payload, depth, created_at")
    .eq("tenant_id", tenantId).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(EVENT_LIMIT);
  q = lead.contact_id ? q.eq("contact_id", lead.contact_id) : q.eq("account_id", lead.account_id);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as { name: string; occurred_at: string; payload: Record<string, unknown> | null; depth: number | null }[])
    // The score's own announcements and the loop guard (depth) never count as the person's behaviour.
    .filter((e) => !e.name.startsWith("lead.") && (e.depth ?? 0) <= MAX_EVENT_DEPTH)
    .map((e) => ({ name: e.name, occurred_at: e.occurred_at, payload: e.payload }));
}

export async function loadLeadProfile(admin: SupabaseClient, tenantId: string, lead: Pick<LeadRow, "account_id" | "contact_id">, rubric: ScoringRubric, deps: ScorerDeps = {}): Promise<Record<string, unknown>> {
  const record: Record<string, unknown> = {};
  const { data: account } = await admin
    .from("accounts").select("type, industry, country, city, state, annual_revenue")
    .eq("id", lead.account_id).eq("tenant_id", tenantId).maybeSingle();
  Object.assign(record, account ?? {});

  if (lead.contact_id) {
    const { data: contact } = await admin
      .from("contacts").select("role, department")
      .eq("id", lead.contact_id).eq("tenant_id", tenantId).maybeSingle();
    record.contact_role = contact?.role ?? "";
    record.contact_department = contact?.department ?? "";
  } else if (usesField(rubric, "contact_role") || usesField(rubric, "contact_department")) {
    const { data: people } = await admin
      .from("contacts").select("role, department").eq("tenant_id", tenantId).eq("account_id", lead.account_id).limit(25);
    record.contact_role = (people ?? []).map((c) => c.role ?? "").filter(Boolean).join(", ");
    record.contact_department = (people ?? []).map((c) => c.department ?? "").filter(Boolean).join(", ");
  }

  if (usesField(rubric, "has_active_amc") || usesField(rubric, "owned_product_skus")) {
    const signals = await (deps.computeSignals ?? computeAccountSignals)(tenantId, lead.account_id);
    record.has_active_amc = signals.has_active_amc;
    record.owned_product_skus = signals.owned_product_skus;
  }
  return record;
}

const RANK: Record<string, number> = { new: 0, engaged: 1, ready: 2 };

/**
 * Scores one lead and saves the result. Moves a lead UP the first three
 * stages when its score earns it (new -> engaged -> ready); never down, and
 * never touches a lead a person has already taken on (working, deal, ...).
 */
export async function scoreLead(
  admin: SupabaseClient,
  tenantId: string,
  leadId: string,
  opts: { now?: Date; rubric?: ScoringRubric; deps?: ScorerDeps } = {},
): Promise<ScoreOutcome> {
  const now = opts.now ?? new Date();
  try {
    const { data: lead, error: lErr } = await admin
      .from("leads").select("id, account_id, contact_id, status, custom_status_id, score, score_factors")
      .eq("id", leadId).eq("tenant_id", tenantId).maybeSingle();
    if (lErr) return { ok: false, reason: isSchemaPending(lErr) ? "pending" : "error", message: lErr.message };
    if (!lead) return { ok: false, reason: "not_found" };
    const row = lead as LeadRow;

    let rubric = opts.rubric;
    if (!rubric) {
      const { data: tenant } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
      rubric = rubricFromConfig(tenant?.config as Partial<TenantConfig> | undefined);
    }

    const events = await loadLeadEvents(admin, tenantId, row, rubric, now);
    const profile = await loadLeadProfile(admin, tenantId, row, rubric, opts.deps);
    const result = computeLeadScore(rubric, events, profile, null, now);

    const stored: StoredFactors = { rubric_version: result.rubric_version, label: result.label, stage: result.stage, factors: result.factors, events_seen: events.length };
    const { error: uErr } = await admin
      .from("leads").update({ score: result.score, score_factors: stored, scored_at: now.toISOString() })
      .eq("id", leadId).eq("tenant_id", tenantId);
    if (uErr) return { ok: false, reason: isSchemaPending(uErr) ? "pending" : "error", message: uErr.message };

    // Where the lead stands now, so we only ever move it forward.
    let storedStage: LeadStageKey | null = null;
    if (row.custom_status_id) {
      const { data: cs } = await admin.from("custom_status").select("code").eq("id", row.custom_status_id).eq("tenant_id", tenantId).maybeSingle();
      storedStage = cs && isLeadStageKey(cs.code) ? cs.code : null;
    }
    const current = effectiveLeadStage({ status: row.status }, storedStage);
    let movedTo: LeadStageKey | null = null;
    if (current in RANK && RANK[result.stage] > RANK[current]) {
      const moved = await setLeadStage({
        tenantId, leadId, to: result.stage, userId: null, role: "admin",
        source: "system_action", touchActivity: false, client: admin,
      });
      if (moved.ok && moved.from !== moved.stage) movedTo = moved.stage;
    }

    const prev = typeof row.score === "number" ? { score: row.score, stage: (row.score_factors?.stage ?? "new") as LeadScoreStage } : null;
    if (isNotableScoreChange(prev, { score: result.score, stage: result.stage })) {
      await emitEvent(tenantId, {
        name: EVENTS.LEAD_SCORED, object_type: "lead", object_id: leadId, source: "runner",
        lead_id: leadId, account_id: row.account_id, contact_id: row.contact_id,
        key: `${leadId}:${result.score}:${result.stage}:${now.toISOString().slice(0, 13)}`,
        payload: { score: result.score, stage: result.stage, rubric_version: result.rubric_version },
      }, admin);
    }

    return { ok: true, leadId, score: result.score, stage: result.stage, label: result.label, moved_to: movedTo, events_seen: events.length };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (isSchemaPending(err)) return { ok: false, reason: "pending", message: err.message };
    console.error("[leads] scoreLead failed", e);
    return { ok: false, reason: "error", message: err?.message };
  }
}
