import "server-only";
import { createHmac } from "crypto";
import type { createAdminSupabase } from "@/lib/supabase-server";

type Admin = ReturnType<typeof createAdminSupabase>;

// How many change_log rows one webhook can drain per dispatcher run. A backlog
// larger than this simply catches up over the next runs -- the cursor advances
// monotonically, so nothing is lost.
const BATCH = 100;
// Consecutive failures after which a webhook auto-pauses, so one dead endpoint
// doesn't retry forever on every cron tick.
const MAX_FAILURES = 15;

export type WebhookRow = {
  id: string;
  tenant_id: string;
  url: string;
  secret: string;
  object_types: string[] | null;
  cursor_ts: string | null;
  cursor_id: string | null;
  failure_count: number;
};

type ChangeLogRow = {
  id: string; object_type: string; object_id: string; object_label: string | null;
  action: string; changes: unknown; actor_email: string | null; created_at: string;
};

function mapEvent(r: ChangeLogRow) {
  return {
    id: r.id, object_type: r.object_type, object_id: r.object_id, object_label: r.object_label,
    action: r.action, changes: r.changes, actor: r.actor_email ?? null, at: r.created_at,
  };
}

/** Sign and POST a JSON payload; HMAC-SHA256 over the raw body, same scheme as the on-demand push. */
export async function postSigned(url: string, secret: string, payload: unknown, deliveryId: string): Promise<{ status: number | null; ok: boolean; error?: string; ms: number }> {
  const body = JSON.stringify(payload);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BPMSquare-Signature": createHmac("sha256", secret).update(body).digest("hex"),
        "X-BPMSquare-Delivery": deliveryId,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, ok: res.ok, ms: Date.now() - started, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e: unknown) {
    return { status: null, ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message : "Request failed" };
  }
}

/**
 * Drain one webhook's backlog: read change_log rows strictly after its cursor
 * (keyset over created_at,id -- the /changes contract), filter by its
 * object_types, POST one signed batch, log the delivery, and advance the cursor
 * ONLY on success. A cross-tenant row can't appear here: the query is
 * .eq("tenant_id", webhook.tenant_id).
 */
export async function deliverWebhook(admin: Admin, wh: WebhookRow): Promise<{ delivered: number; ok: boolean; skipped?: boolean }> {
  let q = admin
    .from("change_log")
    .select("id, object_type, object_id, object_label, action, changes, actor_email, created_at")
    .eq("tenant_id", wh.tenant_id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(BATCH);

  const types = Array.isArray(wh.object_types) ? wh.object_types : ["*"];
  if (!types.includes("*") && types.length) q = q.in("object_type", types);

  if (wh.cursor_ts && wh.cursor_id) {
    q = q.or(`created_at.gt.${wh.cursor_ts},and(created_at.eq.${wh.cursor_ts},id.gt.${wh.cursor_id})`);
  }

  const { data, error } = await q;
  if (error) return { delivered: 0, ok: false };

  const rows = (data ?? []) as ChangeLogRow[];
  if (rows.length === 0) return { delivered: 0, ok: true, skipped: true };

  const deliveryId = crypto.randomUUID();
  const payload = {
    delivery_id: deliveryId,
    sent_at: new Date().toISOString(),
    events: rows.map(mapEvent),
  };

  const result = await postSigned(wh.url, wh.secret, payload, deliveryId);

  await admin.from("webhook_deliveries").insert({
    tenant_id: wh.tenant_id, webhook_id: wh.id, event_count: rows.length,
    status: result.status, ok: result.ok, error: result.error ?? null, duration_ms: result.ms,
  });

  if (result.ok) {
    const last = rows[rows.length - 1];
    await admin.from("webhooks").update({
      cursor_ts: last.created_at, cursor_id: last.id,
      last_delivery_at: new Date().toISOString(), last_status: result.status,
      last_error: null, failure_count: 0,
    }).eq("id", wh.id).eq("tenant_id", wh.tenant_id);
    return { delivered: rows.length, ok: true };
  }

  // Failure: keep the cursor put (retry next run), count the failure, auto-pause
  // past the threshold so a dead endpoint stops burning cron time.
  const failures = wh.failure_count + 1;
  await admin.from("webhooks").update({
    last_delivery_at: new Date().toISOString(), last_status: result.status,
    last_error: result.error ?? "delivery failed", failure_count: failures,
    ...(failures >= MAX_FAILURES ? { active: false } : {}),
  }).eq("id", wh.id).eq("tenant_id", wh.tenant_id);
  return { delivered: 0, ok: false };
}
