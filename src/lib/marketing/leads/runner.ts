import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { marketingScoringOn } from "../config";
import { isSchemaPending } from "../pending";
import { isLeadOverdue } from "./timing";
import { teamLeadForAccount } from "./assign";
import { autoCreateLeads } from "./autoCreate";
import { handoverOf } from "./handover";
import { leadsAlreadyAnnounced, notifyLeadOverdue } from "./notify";
import { effectiveLeadStage, isLeadStageKey } from "../leadStages";
import { rubricFromConfig, scoreLead, type ScorerDeps } from "./scorer";

// The scoring cron (docs/marketing-platform-architecture.md 4.1, "recomputed,
// not incremented"). One pass visits the workspaces that have the program on,
// the one visited longest ago first, and stops starting new work when its time
// budget is spent, so a heavy workspace cannot starve the others and a run can
// never overrun the function limit. It re-scores
//   * leads whose people did something since the bookmark, and
//   * leads not scored for a day (so a score fades with the passing of time),
// and it is safe to run twice: scoring is a pure recompute, the bookmark only
// ever moves forward, and re-reading a few events twice changes nothing.

const DAY_MS = 86_400_000;
export const DECAY_AFTER_HOURS = 20;
const EVENT_BATCH = 1000;
const IN_CHUNK = 100;
/** Without the bookmark table, look this far back each run; runs overlap and that is harmless. */
const NO_STATE_LOOKBACK_MS = 60 * 60 * 1000;

export type RunSummary = {
  tenants_checked: number;
  tenants_run: number;
  leads_scored: number;
  moved_to_ready: number;
  overdue_flagged: number;
  overdue_announced: number;
  leads_auto_created: number;
  budget_exhausted: boolean;
  errors: number;
};

type StateRow = { tenant_id: string; event_cursor_at: string | null; last_run_at: string | null };

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function loadState(admin: SupabaseClient): Promise<{ rows: Map<string, StateRow>; pending: boolean }> {
  const { data, error } = await admin.from("marketing_scoring_state").select("tenant_id, event_cursor_at, last_run_at");
  if (error) {
    if (!isSchemaPending(error)) console.error(`[leads] scoring state not read: ${error.message}`);
    return { rows: new Map(), pending: true };
  }
  return { rows: new Map(((data ?? []) as StateRow[]).map((r) => [r.tenant_id, r])), pending: false };
}

/** Leads of this workspace whose contact or company had an event after the bookmark. Returns ids and the new bookmark. */
async function leadsWithNewEvents(admin: SupabaseClient, tenantId: string, since: string): Promise<{ ids: Set<string>; contactIds: string[]; cursor: string | null; full: boolean }> {
  const { data, error } = await admin
    .from("domain_event").select("contact_id, account_id, created_at")
    .eq("tenant_id", tenantId).gte("created_at", since)
    .order("created_at", { ascending: true }).limit(EVENT_BATCH);
  if (error) throw error;
  const events = ((data ?? []) as { contact_id: string | null; account_id: string | null; created_at: string }[])
    .slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  const contactIds = [...new Set(events.map((e) => e.contact_id).filter((x): x is string => !!x))];
  const accountIds = [...new Set(events.map((e) => e.account_id).filter((x): x is string => !!x))];

  const ids = new Set<string>();
  for (const part of chunks(contactIds, IN_CHUNK)) {
    const { data: rows } = await admin.from("leads").select("id").eq("tenant_id", tenantId).in("contact_id", part);
    for (const r of rows ?? []) ids.add(r.id as string);
  }
  // A company-level lead (no contact) is scored from everyone at the company.
  for (const part of chunks(accountIds, IN_CHUNK)) {
    const { data: rows } = await admin.from("leads").select("id, contact_id").eq("tenant_id", tenantId).in("account_id", part);
    for (const r of rows ?? []) if (!r.contact_id) ids.add(r.id as string);
  }

  const full = events.length >= EVENT_BATCH;
  const last = events.length ? events[events.length - 1].created_at : null;
  // gte re-reads the boundary row next time (harmless). If a whole batch shares
  // one timestamp, step past it so the bookmark cannot stall.
  const cursor = last && full && events[0].created_at === last ? new Date(Date.parse(last) + 1).toISOString() : last;
  return { ids, contactIds, cursor, full };
}

async function staleLeadIds(admin: SupabaseClient, tenantId: string, before: string, limit: number): Promise<string[]> {
  const { data: never } = await admin.from("leads").select("id, status").eq("tenant_id", tenantId).is("scored_at", null).limit(limit);
  const { data: old } = await admin.from("leads").select("id, status, scored_at").eq("tenant_id", tenantId).lt("scored_at", before).limit(limit);
  const rows = [...((never ?? []) as { id: string; status: string | null }[]), ...(((old ?? []) as { id: string; status: string | null; scored_at?: string }[]).sort((a, b) => (a.scored_at ?? "").localeCompare(b.scored_at ?? "")))];
  // A lead that is already won or converted has nothing left to decide.
  return rows.filter((r) => r.status !== "won" && r.status !== "converted").map((r) => r.id).slice(0, limit);
}

/**
 * Emits lead.sla_breached once per overdue ready lead (the event's natural key makes a repeat a no-op) and, for a
 * workspace that chose who to tell, writes the one overdue notice per lead to the Nova inbox.
 */
async function flagOverdue(
  admin: SupabaseClient, tenant: { id: string; features: Partial<TenantFeatures> | null; config: Partial<TenantConfig> | null }, now: Date,
): Promise<{ flagged: number; announced: number }> {
  const tenantId = tenant.id;
  const { data, error } = await admin
    .from("leads").select("id, account_id, contact_id, title, status, custom_status_id, sla_due_at, owner_user_id")
    .eq("tenant_id", tenantId).lt("sla_due_at", now.toISOString()).limit(100);
  if (error) return { flagged: 0, announced: 0 };
  const rows = (data ?? []) as { id: string; account_id: string; contact_id: string | null; title: string | null; status: string | null; custom_status_id: string | null; sla_due_at: string; owner_user_id: string | null }[];
  const codes = new Map<string, string>();
  if (rows.some((r) => r.custom_status_id)) {
    const { data: cs } = await admin.from("custom_status").select("id, code").eq("tenant_id", tenantId).eq("entity_type", "leads");
    for (const c of cs ?? []) codes.set(c.id as string, c.code as string);
  }
  const overdue = rows.filter((r) => {
    const stored = r.custom_status_id ? codes.get(r.custom_status_id) : null;
    const stage = effectiveLeadStage({ status: r.status }, isLeadStageKey(stored) ? stored : null);
    return isLeadOverdue(stage, r.sla_due_at, now);
  });

  const choice = handoverOf(tenant.config).overdue_notify;
  const told = choice.owner || choice.team_lead ? await leadsAlreadyAnnounced(admin, tenantId, overdue.map((r) => r.id)) : null;

  let flagged = 0;
  let announced = 0;
  for (const r of overdue) {
    const ok = await emitEvent(tenantId, {
      name: EVENTS.LEAD_SLA_BREACHED, object_type: "lead", object_id: r.id, source: "runner",
      lead_id: r.id, account_id: r.account_id, contact_id: r.contact_id,
      key: `${r.id}:sla:${r.sla_due_at}`, payload: { due: r.sla_due_at, owner: r.owner_user_id },
    }, admin);
    if (ok) flagged++;
    if (told && !told.has(r.id)) {
      const n = await notifyLeadOverdue(admin, tenantId, {
        lead: r, features: tenant.features, config: tenant.config,
        teamLead: (accountId) => teamLeadForAccount(admin, tenantId, accountId, tenant.features),
      });
      if (n.written) { announced++; told.add(r.id); }
    }
  }
  return { flagged, announced };
}

export async function runLeadScoringPass(
  admin: SupabaseClient,
  opts: { now?: Date; budgetMs?: number; maxLeadsPerTenant?: number; deps?: ScorerDeps; clock?: () => number } = {},
): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? (() => Date.now());
  const started = clock();
  const budgetMs = opts.budgetMs ?? 40_000;
  const maxLeads = opts.maxLeadsPerTenant ?? 200;
  const summary: RunSummary = { tenants_checked: 0, tenants_run: 0, leads_scored: 0, moved_to_ready: 0, overdue_flagged: 0, overdue_announced: 0, leads_auto_created: 0, budget_exhausted: false, errors: 0 };
  const spent = () => clock() - started >= budgetMs;

  const { data: tenants, error } = await admin.from("tenants").select("id, features, config");
  if (error) { summary.errors++; return summary; }
  const on = ((tenants ?? []) as { id: string; features: Partial<TenantFeatures> | null; config: Partial<TenantConfig> | null }[])
    .filter((t) => marketingScoringOn(t.features));
  summary.tenants_checked = on.length;

  const state = await loadState(admin);
  // Longest-ago-visited first; a workspace never visited goes before all.
  on.sort((a, b) => (state.rows.get(a.id)?.last_run_at ?? "").localeCompare(state.rows.get(b.id)?.last_run_at ?? ""));

  for (const t of on) {
    if (spent()) { summary.budget_exhausted = true; break; }
    const prev = state.rows.get(t.id);
    const since = prev?.event_cursor_at ?? new Date(now.getTime() - (state.pending ? NO_STATE_LOOKBACK_MS : DAY_MS)).toISOString();
    const rubric = rubricFromConfig(t.config);
    let cursor = prev?.event_cursor_at ?? null;
    let lastError: string | null = null;
    let scored = 0;

    try {
      const fresh = await leadsWithNewEvents(admin, t.id, since);
      if (fresh.cursor) cursor = fresh.cursor;
      else if (!cursor) cursor = now.toISOString();
      const stale = await staleLeadIds(admin, t.id, new Date(now.getTime() - DECAY_AFTER_HOURS * 3_600_000).toISOString(), maxLeads);
      // Lead ids with new events first: that is who changed.
      const order = [...new Set([...fresh.ids, ...stale])].slice(0, maxLeads);
      for (const id of order) {
        if (spent()) { summary.budget_exhausted = true; break; }
        const r = await scoreLead(admin, t.id, id, { now, rubric, deps: opts.deps });
        if (r.ok) {
          scored++;
          if (r.moved_to === "ready") summary.moved_to_ready++;
        } else if (r.reason === "pending") {
          lastError = r.message ?? "pending";
          break;
        } else {
          summary.errors++;
          lastError = r.message ?? r.reason;
        }
      }
      // If the budget cut this workspace short, hold the bookmark so the
      // un-scored leads with events are found again next run.
      if (summary.budget_exhausted) cursor = prev?.event_cursor_at ?? null;
      // Leads that appear by themselves (off unless the workspace switched it on in Hand-over).
      if (!summary.budget_exhausted && handoverOf(t.config).auto_create_leads) {
        const made = await autoCreateLeads(admin, t.id, fresh.contactIds, { now, rubric, deps: opts.deps });
        summary.leads_auto_created += made.created;
        summary.moved_to_ready += made.moved_to_ready;
      }
      const overdue = await flagOverdue(admin, t, now);
      summary.overdue_flagged += overdue.flagged;
      summary.overdue_announced += overdue.announced;
    } catch (e) {
      summary.errors++;
      lastError = (e as { message?: string })?.message ?? "error";
      if (!isSchemaPending(e as { code?: string; message?: string })) console.error(`[leads] scoring pass failed for a workspace: ${lastError}`);
      cursor = prev?.event_cursor_at ?? null;
    }

    summary.leads_scored += scored;
    summary.tenants_run++;
    if (!state.pending) {
      await admin.from("marketing_scoring_state").upsert({
        tenant_id: t.id, event_cursor_at: cursor, last_run_at: now.toISOString(),
        last_decay_at: now.toISOString(), leads_scored: scored, last_error: lastError, updated_at: now.toISOString(),
      }, { onConflict: "tenant_id" });
    }
  }
  return summary;
}
