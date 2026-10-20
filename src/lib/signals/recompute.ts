import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { isSchemaPending } from "@/lib/marketing/pending";
import { notifyOwner, authEmailResolver, type OwnerEmailResolver } from "./alert";
import { collectSignals } from "./collect";
import { computeIntent } from "./rubric";
import { stageRank, type IntentRow, type Stage } from "./types";

// The recompute: for one tenant, score every account that has a signal or an
// earlier score, store the result (account_intent), the day's history row, and
// tell the rest of the suite when a stage changed.
//
// Properties the tests pin:
//  - idempotent: running it twice on the same day writes the same rows, emits no
//    second event and sends no second alert (a stage change is detected against
//    the STORED stage, and the stored stage is updated before anything is emitted);
//  - bounded: it stops starting new work at `deadline`, and accounts are taken
//    least recently scored first, so the next run carries on where this stopped;
//  - tenant-scoped: every query chains .eq("tenant_id", tenantId), because this
//    runs on the service-role client where RLS is no backstop.

const DAY = 86_400_000;
const CHUNK = 200;
export const HISTORY_RETENTION_DAYS = 120;
const MAX_ALERTS_PER_RUN = 25;

export type RecomputeOpts = {
  now?: Date;
  /** Epoch ms after which no new batch is started. */
  deadline?: number;
  source?: string;
  /** Score only these accounts (a person just changed one). Everything else is left as stored. */
  only?: string[];
  resolveOwnerEmail?: OwnerEmailResolver;
};

export type RecomputeResult = {
  scored: number;
  stageChanges: number;
  alerts: number;
  /** True when the deadline cut the run short; the next run continues. */
  partial: boolean;
  /** The first run for a tenant sets the baseline and alerts nobody. */
  baseline: boolean;
  warnings: string[];
  error?: string;
};

type Existing = Pick<IntentRow, "account_id" | "stage" | "previous_stage" | "stage_changed_at" | "marked_not_in_market_at" | "computed_at" | "score">;

async function pageAll<T>(warnings: string[], source: string, run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999);
    if (error) {
      if (!isSchemaPending(error)) warnings.push(`${source}: ${error.message ?? "could not be read"}`);
      return out;
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export async function recomputeTenant(admin: SupabaseClient, tenantId: string, opts: RecomputeOpts = {}): Promise<RecomputeResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const day = nowIso.slice(0, 10);
  const deadline = opts.deadline ?? Number.POSITIVE_INFINITY;
  const resolve = opts.resolveOwnerEmail ?? authEmailResolver;
  const result: RecomputeResult = { scored: 0, stageChanges: 0, alerts: 0, partial: false, baseline: false, warnings: [] };

  // The run row: rotation across tenants and the "Updated 2 h ago" line.
  let runId: string | null = null;
  {
    const { data, error } = await admin.from("signal_runs")
      .insert({ tenant_id: tenantId, source: opts.source ?? "rescore", started_at: nowIso }).select("id").single();
    if (!error && data) runId = (data as { id: string }).id;
  }

  try {
    const [accountRows, existingRows, collected] = await Promise.all([
      pageAll<{ id: string; name: string; owner_user_id: string | null }>(result.warnings, "accounts", (a, b) =>
        admin.from("accounts").select("id, name, owner_user_id").eq("tenant_id", tenantId).range(a, b)),
      pageAll<Existing>(result.warnings, "account_intent", (a, b) =>
        admin.from("account_intent").select("account_id, stage, previous_stage, stage_changed_at, marked_not_in_market_at, computed_at, score").eq("tenant_id", tenantId).range(a, b)),
      collectSignals(admin, tenantId, now),
    ]);
    result.warnings.push(...collected.warnings);
    result.baseline = existingRows.length === 0;

    const accounts = new Map(accountRows.map((a) => [a.id, a]));
    const existing = new Map(existingRows.map((e) => [e.account_id, e]));
    // Only accounts of THIS tenant: a signal that names any other id is dropped.
    const candidates = [...new Set([...collected.byAccount.keys(), ...existing.keys()])].filter((id) => accounts.has(id) && (!opts.only || opts.only.includes(id)));
    candidates.sort((a, b) => (existing.get(a)?.computed_at ?? "").localeCompare(existing.get(b)?.computed_at ?? ""));

    let alertsLeft = MAX_ALERTS_PER_RUN;
    for (let i = 0; i < candidates.length; i += CHUNK) {
      if (Date.now() > deadline) { result.partial = true; break; }
      const ids = candidates.slice(i, i + CHUNK);
      const intentRows: Record<string, unknown>[] = [];
      const historyRows: Record<string, unknown>[] = [];
      const changes: { id: string; from: Stage; to: Stage; score: number; headline: string | null }[] = [];

      for (const id of ids) {
        const prev = existing.get(id);
        const r = computeIntent(collected.byAccount.get(id) ?? [], { now, notInMarketAt: prev?.marked_not_in_market_at ?? null });
        // Nothing then, nothing now: no row, no history, nothing to say.
        if (!prev && r.score === 0 && r.stage === "quiet" && r.factors.length === 0) continue;
        const from: Stage = prev?.stage ?? "quiet";
        const changed = from !== r.stage;
        intentRows.push({
          tenant_id: tenantId, account_id: id, score: r.score, stage: r.stage,
          previous_stage: changed ? from : (prev?.previous_stage ?? null),
          factors: r.factors, top_signals: r.topSignals, signal_count: r.signalCount, topics: r.topics,
          stage_changed_at: changed ? nowIso : (prev?.stage_changed_at ?? null),
          marked_not_in_market_at: prev?.marked_not_in_market_at ?? null,
          computed_at: nowIso,
        });
        historyRows.push({ tenant_id: tenantId, account_id: id, day, score: r.score, stage: r.stage, factors: r.factors });
        if (changed) changes.push({ id, from, to: r.stage, score: r.score, headline: r.topSignals[0]?.headline ?? null });
      }
      if (intentRows.length === 0) continue;

      const up = await admin.from("account_intent").upsert(intentRows, { onConflict: "tenant_id,account_id" });
      if (up.error) {
        if (!isSchemaPending(up.error)) result.warnings.push(`account_intent: ${up.error.message}`);
        if (isSchemaPending(up.error)) { result.error = "The database update for Buying signals has not been applied."; break; }
        continue;
      }
      const hist = await admin.from("account_intent_history").upsert(historyRows, { onConflict: "tenant_id,account_id,day" });
      if (hist.error && !isSchemaPending(hist.error)) result.warnings.push(`account_intent_history: ${hist.error.message}`);
      result.scored += intentRows.length;

      // The stored stage is already the new one, so a retry finds no change and
      // emits nothing twice; the event key adds the day as a second guard.
      for (const c of changes) {
        result.stageChanges++;
        await emitEvent(tenantId, {
          name: EVENTS.ACCOUNT_BUYING_STAGE_CHANGED, object_type: "account", object_id: c.id, account_id: c.id,
          source: "runner", key: `${c.id}:${c.from}->${c.to}:${day}`,
          payload: { from: c.from, to: c.to, score: c.score },
        }, admin);
        const up2 = stageRank(c.to) > stageRank(c.from) && (c.to === "comparing" || c.to === "deciding");
        if (up2 && !result.baseline && alertsLeft > 0) {
          const acct = accounts.get(c.id)!;
          const sent = await notifyOwner(admin, tenantId, { accountId: c.id, accountName: acct.name, ownerUserId: acct.owner_user_id, from: c.from, to: c.to, score: c.score, headline: c.headline }, resolve);
          if (sent) { result.alerts++; alertsLeft--; }
        }
      }
    }

    const cutoff = new Date(now.getTime() - HISTORY_RETENTION_DAYS * DAY).toISOString().slice(0, 10);
    await admin.from("account_intent_history").delete().eq("tenant_id", tenantId).lt("day", cutoff);
  } catch (e) {
    result.error = (e as Error).message?.slice(0, 300) ?? "recompute failed";
  }

  if (runId) {
    await admin.from("signal_runs").update({
      finished_at: new Date().toISOString(), accounts_scored: result.scored, stage_changes: result.stageChanges,
      alerts: result.alerts, error: result.error ?? (result.warnings[0] ?? null),
    }).eq("id", runId).eq("tenant_id", tenantId);
  }
  return result;
}
