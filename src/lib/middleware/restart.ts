import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import { runPull, runPushFenceProjects } from "@/lib/connectors/d365/server";
import type { D365EntityKey } from "@/lib/connectors/d365/types";
import { runSapPull } from "@/lib/connectors/sap_s4/server";
import { SAP_CONNECTOR_ID, isSapEntity } from "@/lib/connectors/sap_s4/types";
import { dispatchQuoteOutcome, type DispatchResult } from "./dispatch";
import { sendViaWebhook } from "./webhookTarget";
import { fireWebhook, type FireDeps, type FireResult } from "@/lib/webhooks/sender";
import type { ErpHttp } from "./erp";
import { MESSAGES_TABLE } from "./messages";
import { listMessages } from "./monitor";
import type { RunCache } from "./pricing";
import { classifyIntegrationRow, isRunnableEntity } from "./monitorRows";
import type { MessageFilters, Outcome } from "./types";

// "Restart" on the Monitor list (spec section 7): one action that means the same for every row.
//  - an outbound document row (a quote that failed or is waiting) is sent again through the SAME idempotent
//    send as before: the claim, the link and the marker mean it never makes a twin, and repeating is safe;
//  - an inbound run row (a customers / contacts / products pull that failed) runs that entity again.
// A row that cannot be restarted (already OK, skipped by design) is reported, not acted on. Every id is loaded
// with its tenant, so an id from another workspace is simply "not restartable" and untouched.

export const RESTART_CAP = 50;
/** Stay inside the route's time limit; whatever is left is reported as not started. */
const BUDGET_MS = 240_000;

export type RestartOutcome = "done" | "failed" | "already_ok" | "not_restartable";
export type RestartResult = { id: string; outcome: RestartOutcome; message: string };

export type RestartInput = { ids?: unknown; filter?: MessageFilters; limit?: unknown };

export type RestartDeps = {
  /** The ERP client for quote sends (tests pass a fake; production builds its own). */
  http?: ErpHttp;
  now?: () => number;
  /** The webhook sender's seams (tests pass a fake fetch). */
  webhook?: FireDeps;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRestartId(raw: string): { source: "integration" | "connector"; uuid: string } | null {
  const i = raw.indexOf(":");
  const source = i < 0 ? "integration" : raw.slice(0, i);
  const uuid = i < 0 ? raw : raw.slice(i + 1);
  if ((source !== "integration" && source !== "connector") || !UUID.test(uuid)) return null;
  return { source, uuid };
}

/** How many to restart: at most RESTART_CAP, at least one. */
export function capLimit(v: unknown): number {
  const n = typeof v === "number" ? Math.trunc(v) : Number.parseInt(String(v ?? ""), 10);
  return Math.max(1, Math.min(RESTART_CAP, Number.isFinite(n) && n > 0 ? n : RESTART_CAP));
}

/** The restartable rows a list filter selects, newest first, up to the cap. */
export async function idsForFilter(admin: SupabaseClient, tenantId: string, filter: MessageFilters, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10 && ids.length < limit; page++) {
    const r = await listMessages(admin, tenantId, filter, cursor, 100);
    for (const m of r.items) if (m.restartable && ids.length < limit) ids.push(m.id);
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  return ids;
}

function describeDocument(r: DispatchResult): { outcome: RestartOutcome; message: string } {
  switch (r.state) {
    case "sent": return { outcome: "done", message: r.number ? `Sent. The ERP number is ${r.number}.` : "Sent." };
    case "already_sent": return { outcome: "already_ok", message: r.number ? `Already in the ERP as ${r.number}. Nothing was sent twice.` : "Already in the ERP. Nothing was sent twice." };
    case "in_progress": return { outcome: "already_ok", message: "This one is already being sent." };
    case "skipped": return { outcome: "done", message: r.headline };
    case "waiting": return { outcome: "done", message: "Waiting for you to send it." };
    case "failed": return { outcome: "failed", message: `${r.headline} ${r.fix}`.trim() };
    case "needs_database_update": return { outcome: "failed", message: "A database update is needed first." };
    case "not_found": return { outcome: "not_restartable", message: "That quote was not found." };
    case "disabled": return { outcome: "not_restartable", message: r.reason };
  }
}

function describeFire(r: FireResult): { outcome: RestartOutcome; message: string } {
  if (r.needsDatabaseUpdate) return { outcome: "failed", message: "A database update is needed first." };
  if (r.ok) return { outcome: "done", message: r.redirected ? "Demo workspace: nothing was sent." : "Sent." };
  if (r.skipped) return { outcome: "not_restartable", message: r.headline };
  return { outcome: "failed", message: `${r.headline} ${r.fix ?? ""}`.trim() };
}

type IntegrationRow = { id: string; object_type: string | null; object_id: string | null; status: string; entity: string | null; connector_id?: string | null; summary: Record<string, unknown> | null };

async function runEntity(admin: SupabaseClient, tenantId: string, userId: string, entity: D365EntityKey, connectorId: string | null = null): Promise<{ outcome: RestartOutcome; message: string }> {
  // A SAP S/4HANA run is run again by SAP's own pull, never by the Dynamics one.
  if (connectorId === SAP_CONNECTOR_ID && !isSapEntity(entity)) return { outcome: "not_restartable", message: "This one can't be restarted." };
  const res = connectorId === SAP_CONNECTOR_ID && isSapEntity(entity)
    ? await runSapPull(admin, tenantId, entity, { trigger: "manual", userId })
    : entity === "fence_projects"
      ? await runPushFenceProjects(admin, tenantId, { trigger: "manual", userId })
      : await runPull(admin, tenantId, entity, { trigger: "manual", userId });
  if (res.error) return { outcome: "failed", message: res.error };
  if (res.counts.failed > 0) return { outcome: "failed", message: `${res.counts.failed} still failing. ${res.issues[0] ?? ""}`.trim() };
  return { outcome: "done", message: `Ran again: ${res.counts.read} read, ${res.counts.created} created, ${res.counts.updated} updated.` };
}

/** After a run went well, the failed run rows of that entity are settled, so only open items stay failed. */
async function settleRuns(admin: SupabaseClient, tenantId: string, entity: string, connectorId: string | null = null): Promise<void> {
  try {
    let q = admin.from(MESSAGES_TABLE).select("id, summary").eq("tenant_id", tenantId).eq("channel", "connector").eq("entity", entity).eq("status", "failed");
    if (connectorId) q = q.eq("connector_id", connectorId);
    const { data } = await q.limit(100);
    for (const r of (data ?? []) as { id: string; summary: Record<string, unknown> | null }[]) {
      if (r.summary?.kind !== "connector_run") continue;
      await admin.from(MESSAGES_TABLE).update({ status: "skipped", summary: { ...r.summary, resolved: true } }).eq("id", r.id).eq("tenant_id", tenantId);
    }
  } catch {
    // Housekeeping only.
  }
}

export async function restartMessages(
  admin: SupabaseClient, tenantId: string, userId: string, input: RestartInput, deps: RestartDeps = {},
): Promise<{ results: RestartResult[] } | { needsDatabaseUpdate: true }> {
  const now = deps.now ?? Date.now;
  const started = now();
  const limit = capLimit(input.limit);

  let ids: string[];
  const skipped: RestartResult[] = [];
  if (Array.isArray(input.ids)) {
    const all = [...new Set(input.ids.filter((x): x is string => typeof x === "string"))];
    ids = all.slice(0, RESTART_CAP);
    for (const extra of all.slice(RESTART_CAP)) skipped.push({ id: extra, outcome: "not_restartable", message: `Restart up to ${RESTART_CAP} at a time.` });
  } else if (input.filter) {
    ids = await idsForFilter(admin, tenantId, input.filter, limit);
  } else {
    ids = [];
  }

  const cache: RunCache = {};
  const results: RestartResult[] = [];
  const ranEntity = new Map<string, { outcome: RestartOutcome; message: string }>();

  for (const id of ids) {
    if (now() - started > BUDGET_MS) { results.push({ id, outcome: "failed", message: "Not started: out of time. Press Restart again." }); continue; }
    const done = (outcome: RestartOutcome, message: string) => results.push({ id, outcome, message });
    const parsed = parseRestartId(id);
    if (!parsed) { done("not_restartable", "That is not a message id."); continue; }

    if (parsed.source === "connector") {
      // An older sync-run line (before the message log existed).
      const { data, error } = await admin.from("connector_sync_runs").select("id, entity, status, connector_id").eq("id", parsed.uuid).eq("tenant_id", tenantId).maybeSingle();
      if (error || !data) { done("not_restartable", "Message not found."); continue; }
      const row = data as { entity: string; status: string; connector_id?: string | null };
      if (row.status === "succeeded") { done("already_ok", "That run went well. Nothing to restart."); continue; }
      if (row.status === "running") { done("already_ok", "That run is still going."); continue; }
      if (!isRunnableEntity(row.entity)) { done("not_restartable", "This one can't be restarted."); continue; }
      const runKey = `${row.connector_id ?? ""}:${row.entity}`;
      const prior = ranEntity.get(runKey);
      const r = prior ?? (await runEntity(admin, tenantId, userId, row.entity, row.connector_id ?? null));
      ranEntity.set(runKey, r);
      done(r.outcome, prior ? "Run again together with the others of the same kind." : r.message);
      continue;
    }

    const { data, error } = await admin.from(MESSAGES_TABLE).select("id, object_type, object_id, status, entity, connector_id, summary").eq("id", parsed.uuid).eq("tenant_id", tenantId).maybeSingle();
    if (error) {
      if (isSchemaPending(error)) return { needsDatabaseUpdate: true };
      done("failed", "Could not read the message.");
      continue;
    }
    const row = data as IntegrationRow | null;
    if (!row) { done("not_restartable", "Message not found."); continue; }
    if (row.status === "ok") { done("already_ok", "Already sent. Nothing to restart."); continue; }
    if (row.status === "skipped") {
      done(row.summary?.resolved ? "already_ok" : "not_restartable", row.summary?.resolved ? "A later attempt already dealt with this one." : "Nothing to send here, by design.");
      continue;
    }
    const kind = classifyIntegrationRow(row);
    if (!kind) { done("not_restartable", "This one can't be restarted."); continue; }

    if (kind === "webhook_call") {
      // webhook_id is read on its own, so the list query never depends on the column existing.
      const { data: w } = await admin.from(MESSAGES_TABLE).select("webhook_id").eq("id", row.id).eq("tenant_id", tenantId).maybeSingle();
      const webhookId = (w as { webhook_id?: string | null } | null)?.webhook_id ?? null;
      if (!webhookId || !row.object_id || !row.object_type) { done("not_restartable", "This call has no webhook to send again."); continue; }
      if (row.object_type === "standard_quotes" && row.summary?.outcome === "awarded") {
        // The award path again, through its claim: the same quote is never sent to the same webhook twice.
        const r = await sendViaWebhook(admin, tenantId, { quoteId: row.object_id, webhookId, trigger: "retry", userId, retryOf: row.id }, deps.webhook);
        const d = describeDocument(r);
        done(d.outcome, r.state === "already_sent" ? "Already sent to the webhook. Nothing was sent twice." : d.message);
        continue;
      }
      const r = await fireWebhook(admin, { tenantId, webhookId, objectType: row.object_type, objectId: row.object_id, trigger: "retry", userId, retryOf: row.id }, deps.webhook);
      const d = describeFire(r);
      done(d.outcome, d.message);
      continue;
    }

    if (kind === "document") {
      const outcome = row.summary?.outcome;
      if (outcome !== "awarded" || !row.object_id) { done("not_restartable", "Only an awarded quote is sent to the ERP."); continue; }
      const r = await dispatchQuoteOutcome(admin, tenantId, row.object_id, {
        trigger: row.status === "pending" ? "send_now" : "retry", userId, outcome: outcome as Outcome, cache, ...(deps.http ? { http: deps.http } : {}),
      });
      const d = describeDocument(r);
      done(d.outcome, d.message);
      continue;
    }

    const entity = row.entity as D365EntityKey;
    const runKey = `${row.connector_id ?? ""}:${entity}`;
    const prior = ranEntity.get(runKey);
    const r = prior ?? (await runEntity(admin, tenantId, userId, entity, row.connector_id ?? null));
    ranEntity.set(runKey, r);
    if (!prior && r.outcome === "done") await settleRuns(admin, tenantId, entity, row.connector_id ?? null);
    done(r.outcome, prior ? "Run again together with the others of the same kind." : r.message);
  }
  return { results: [...results, ...skipped] };
}
