import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import { redactPayload, redactText } from "./redact";
import type { MessageChannel, MessageDirection, StoredStatus } from "./types";

// The writer of integration_messages (0201). The table has admin-select-only
// RLS and no write policy, so every write is the service-role client, from
// server code, after the thing it describes already happened. Nothing here
// ever throws into the caller: a message that cannot be recorded must not fail
// a save, a sync or an API response.

export const MESSAGES_TABLE = "integration_messages";

export type NewMessage = {
  tenantId: string;
  direction: MessageDirection;
  channel: MessageChannel;
  connectorId?: string | null;
  entity?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  refLabel?: string | null;
  status: StoredStatus;
  httpStatus?: number | null;
  error?: string | null;
  durationMs?: number | null;
  correlationId?: string | null;
  /** Short facts for the list and the plain-language failure. No personal data. */
  summary?: Record<string, unknown>;
  /** Request/response body. Kept only when `capture` is true, and then redacted. */
  payload?: unknown;
};

export type RecordResult = { id: string | null; needsDatabaseUpdate: boolean };

/** The row to insert. Pure so the redaction and capture rules are testable. */
export function buildMessageRow(m: NewMessage, capture: boolean): Record<string, unknown> {
  return {
    tenant_id: m.tenantId,
    direction: m.direction,
    channel: m.channel,
    connector_id: m.connectorId ?? null,
    entity: m.entity ?? null,
    object_type: m.objectType ?? null,
    object_id: m.objectId ?? null,
    ref_label: m.refLabel ? m.refLabel.slice(0, 200) : null,
    status: m.status,
    http_status: typeof m.httpStatus === "number" ? Math.trunc(m.httpStatus) : null,
    error: m.error ? redactText(m.error).slice(0, 1000) : null,
    duration_ms: typeof m.durationMs === "number" ? Math.max(0, Math.round(m.durationMs)) : null,
    correlation_id: m.correlationId ?? null,
    summary: redactPayload(m.summary ?? {}) ?? {},
    payload: capture && m.payload !== undefined ? redactPayload(m.payload) : null,
  };
}

export async function recordMessage(admin: SupabaseClient, m: NewMessage, capture = false): Promise<RecordResult> {
  try {
    const { data, error } = await admin.from(MESSAGES_TABLE).insert(buildMessageRow(m, capture)).select("id").single();
    if (error) {
      if (isSchemaPending(error)) return { id: null, needsDatabaseUpdate: true };
      console.error("[middleware] could not record a message", error.message);
      return { id: null, needsDatabaseUpdate: false };
    }
    return { id: (data as { id: string } | null)?.id ?? null, needsDatabaseUpdate: false };
  } catch (e) {
    console.error("[middleware] could not record a message", (e as Error).message);
    return { id: null, needsDatabaseUpdate: false };
  }
}

/** Is the table there? A one-row probe, tenant-scoped like every other read. */
export async function messagesTableReady(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { error } = await admin.from(MESSAGES_TABLE).select("id").eq("tenant_id", tenantId).limit(1);
  return !isSchemaPending(error);
}

/** A newer attempt succeeded: the older failed or waiting ones for the same
 *  record and outcome are replaced, so the Resync tab shows only what is open. */
export async function resolveEarlier(admin: SupabaseClient, tenantId: string, objectId: string, outcome: string, byId: string | null): Promise<void> {
  try {
    const { data } = await admin.from(MESSAGES_TABLE).select("id, summary").eq("tenant_id", tenantId).eq("object_type", "standard_quotes").eq("object_id", objectId)
      .in("status", ["failed", "pending"]).limit(50);
    for (const r of (data ?? []) as { id: string; summary: Record<string, unknown> | null }[]) {
      if (r.summary?.outcome !== outcome || r.id === byId) continue;
      await admin.from(MESSAGES_TABLE).update({ status: "skipped", summary: { ...r.summary, resolved: true, resolved_by: byId } }).eq("id", r.id).eq("tenant_id", tenantId);
    }
  } catch {
    // Housekeeping only.
  }
}

/** An open (failed or waiting) message for this record and outcome, if any. */
export async function findOpenMessage(admin: SupabaseClient, tenantId: string, objectId: string, outcome: string, status: "pending" | "failed"): Promise<{ id: string } | null> {
  const { data, error } = await admin.from(MESSAGES_TABLE).select("id, summary").eq("tenant_id", tenantId).eq("object_type", "standard_quotes").eq("object_id", objectId)
    .eq("status", status).order("created_at", { ascending: false }).limit(20);
  if (error) return null;
  const hit = ((data ?? []) as { id: string; summary: Record<string, unknown> | null }[]).find((r) => r.summary?.outcome === outcome);
  return hit ? { id: hit.id } : null;
}

// ── Connector runs ──────────────────────────────────────────────────────────

export type RunNote = {
  runId: string | null;
  entity: string;
  direction: "pull" | "push";
  trigger: "manual" | "schedule";
  counts: Record<string, number>;
  issues: string[];
  error: string | null;
  startedAtMs: number;
};

/** One message per connector run: counts and the first failed rows. The run's
 *  own id is the correlation id, which is how the monitor shows the run once
 *  (this row replaces its connector_sync_runs line). */
export async function recordConnectorRun(admin: SupabaseClient, tenantId: string, n: RunNote): Promise<void> {
  const failed = n.counts.failed ?? 0;
  await recordMessage(admin, {
    tenantId, direction: n.direction === "pull" ? "in" : "out", channel: "connector", connectorId: "dynamics365", entity: n.entity,
    status: n.error || failed > 0 ? "failed" : "ok",
    error: n.error,
    durationMs: Date.now() - n.startedAtMs,
    correlationId: n.runId,
    summary: { kind: "connector_run", trigger: n.trigger, counts: n.counts, failed_rows: n.issues.slice(0, 5) },
  });
}

// ── v1 API calls ────────────────────────────────────────────────────────────

/** Metadata only: method, path, outcome. Never a body, a header or a key. The response
 *  status and duration are not known where v1 calls are logged (authorization, before the
 *  handler runs), so an authorised call is recorded ok with no duration. */
export async function recordApiCall(admin: SupabaseClient, tenantId: string, c: { method: string; path: string; status: number | null; durationMs: number | null; keyId: string | null; object: string }): Promise<void> {
  await recordMessage(admin, {
    tenantId, direction: "in", channel: "api", entity: c.object,
    status: c.status !== null && c.status >= 400 ? "failed" : "ok",
    httpStatus: c.status, durationMs: c.durationMs,
    summary: { method: c.method, path: c.path.slice(0, 200), key: c.keyId ? "scoped key" : "workspace key" },
  });
}

/** Keep 30 days. Per tenant, so the delete is always tenant-filtered. */
export const MESSAGE_RETENTION_DAYS = 30;

export async function pruneMessages(admin: SupabaseClient, tenantId: string, nowMs: number = Date.now()): Promise<void> {
  const cutoff = new Date(nowMs - MESSAGE_RETENTION_DAYS * 86_400_000).toISOString();
  await admin.from(MESSAGES_TABLE).delete().eq("tenant_id", tenantId).lt("created_at", cutoff);
}
