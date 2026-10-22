import "server-only";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import { unsealSecret } from "@/lib/encryption";
import { fetchPublic } from "@/lib/net/safeHost";
import { buildExchangePayload } from "@/lib/middleware/exchange";
import { MESSAGES_TABLE, recordMessage } from "@/lib/middleware/messages";
import { SQL_BUNDLES, type StoredStatus } from "@/lib/middleware/types";
import { loadCallRecord, loadTenantInfo, type TenantInfo } from "./loaders";
import { renderStandard, renderTemplate, renderUrl, sized, validateTemplate, validateUrlTemplate } from "./render";
import { mapForWebhook } from "@/lib/middleware/mapping/engineServer";
import { CALL_OBJECTS, isCallObject, type CallObject, type RenderContext } from "./tokens";
import { AUTO_PAUSE_AFTER, WEBHOOK_COLUMNS, needsAttention, type WebhookRow } from "./validate";

// THE sender of a Call webhook (docs/design/webhooks-library.md). Everything that
// fires one -- a Standard Quote award, the account record button, a Coverage
// route, the Test tab, Restart on the Monitor -- calls fireWebhook(), so there is
// one place that loads the definition WITH its tenant, renders, signs, posts, retries
// once and leaves exactly one Monitor row. It never throws into a caller: a webhook
// that cannot be sent must not fail a save, an award or a click.

export type FireTrigger = "award" | "button" | "coverage" | "test" | "retry";

export type FireInput = {
  tenantId: string;
  webhookId: string | null;
  objectType: string;
  objectId: string;
  trigger: FireTrigger;
  event?: string;
  userId?: string | null;
  /** The Monitor row being restarted: the new attempt keeps its idempotency key. */
  retryOf?: string | null;
  /** The outcome word the award path files its rows under, so a later success settles them. */
  outcome?: "awarded";
};

export type FireDeps = {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type SentRequest = { method: string; url: string; headers: string[]; body: unknown };

export type FireResult = {
  ok: boolean;
  /** Not sent on purpose (switched off); the caller treats it as nothing to do, not as a failure of the receiver. */
  skipped?: boolean;
  /** A demo workspace: recorded, nothing left the building. */
  redirected?: boolean;
  needsDatabaseUpdate?: boolean;
  status: number | null;
  messageId: string | null;
  deliveryId: string | null;
  durationMs: number;
  headline: string;
  fix: string | null;
  request?: SentRequest;
  response?: { status: number | null; body: unknown };
};

export const RETRY_DELAY_MS = 2000;
const MAX_RESPONSE_CHARS = 8000;

/** accounts -> account.pushed (what today's push sends); a quote -> quote.awarded. */
export function defaultEvent(objectType: string): string {
  return objectType === "accounts" ? "account.pushed" : objectType === "standard_quotes" ? "quote.awarded" : "record.sent";
}

export function idempotencyKey(webhookId: string, objectId: string, event: string, origin: string): string {
  return createHash("sha256").update(`${webhookId}|${objectId}|${event}|${origin}`).digest("hex");
}

export const signBody = (secret: string, body: string): string => createHmac("sha256", secret).update(body).digest("hex");

// ── plain-language failures ─────────────────────────────────────────────────

const NOT_RETRYABLE = /private or internal network|must use https|valid URL|could not be resolved|redirected too many|No host/i;

export function describeFailure(a: { status: number | null; message?: string | null; timedOut?: boolean }): { headline: string; fix: string } {
  const s = a.status;
  if (s !== null) {
    if (s === 401 || s === 403) return { headline: `The receiver refused the call (HTTP ${s}).`, fix: "Check the header (an API key or token) the receiver expects, then restart." };
    if (s === 404 || s === 410) return { headline: `The receiving address was not found (HTTP ${s}).`, fix: "Check the address, then restart." };
    if (s === 429) return { headline: "The receiver is asking us to slow down (HTTP 429).", fix: "Restart in a few minutes." };
    if (s >= 500) return { headline: `The receiver had an error (HTTP ${s}).`, fix: "Restart sends it again, with the same idempotency key." };
    return { headline: `The receiver rejected the call (HTTP ${s}).`, fix: "Open the response on the Monitor to see why, then restart." };
  }
  if (a.timedOut) return { headline: "The receiver did not answer in time.", fix: "Raise the timeout on the Request tab, or check the receiver." };
  if (a.message && /private or internal network/i.test(a.message)) return { headline: "That address points at a private or internal network.", fix: "Use a public https address." };
  if (a.message && /could not be resolved/i.test(a.message)) return { headline: "The address could not be found.", fix: "Check the spelling of the host name." };
  return { headline: "Could not reach the receiver.", fix: "Check the address and that the receiver is online, then restart." };
}

// ── preparing a request ─────────────────────────────────────────────────────

type Prepared =
  | { ok: true; method: string; url: string; headers: Record<string, string>; bodyText: string | null; bodyValue: unknown; label: string; objectType: string | null; objectId: string | null }
  | { ok: false; headline: string; fix: string; label?: string };

async function prepare(
  admin: SupabaseClient, def: WebhookRow, tenant: TenantInfo, input: Pick<FireInput, "tenantId" | "objectType" | "objectId" | "trigger">,
  event: string, deliveryId: string, sentAt: string, idemKey: string, nowSec: number,
): Promise<Prepared> {
  const secret = unsealSecret(def.secret);
  if (!secret) return { ok: false, headline: "The signing secret could not be read.", fix: "Regenerate it on the Security tab." };

  let method = def.method ?? "POST";
  let url = def.url.trim();
  let bodyValue: unknown = null;
  let bodyText: string | null = null;
  let label = "";
  let objectType: string | null = null;
  let objectId: string | null = null;

  if (def.kind === "event") {
    // The Test tab's ping: the change feed is drained by the cron, never fired by a record.
    method = "POST";
    bodyValue = { event, delivery_id: deliveryId, sent_at: sentAt, workspace: tenant.name, ping: true };
    bodyText = JSON.stringify(bodyValue);
    label = def.name;
  } else {
    if (!isCallObject(def.object_type)) return { ok: false, headline: "This webhook has no object to send.", fix: "Edit it and choose one." };
    if (def.object_type !== input.objectType) {
      const want = CALL_OBJECTS.find((o) => o.key === def.object_type)?.label ?? def.object_type;
      return { ok: false, headline: `This webhook sends ${want}.`, fix: "Choose a webhook for this kind of record." };
    }
    const objectTypeOk: CallObject = def.object_type;
    const loaded = await loadCallRecord(admin, input.tenantId, objectTypeOk, input.objectId, tenant, def.allow_personal_data === true);
    if (!loaded) return { ok: false, headline: "That record was not found.", fix: "It may have been deleted." };
    label = loaded.label;
    objectType = objectTypeOk;
    objectId = input.objectId;
    const ctx: RenderContext = { event, sent_at: sentAt, delivery_id: deliveryId, workspace: { name: tenant.name }, ...loaded.parts };

    // The address is judged again at send time: a stored value is never trusted to have been checked.
    const checkedUrl = validateUrlTemplate(url, objectTypeOk);
    if (!checkedUrl.ok) return { ok: false, headline: checkedUrl.errors[0].message, fix: "Edit the address in Settings > Webhooks.", label };
    try {
      url = renderUrl(url, objectTypeOk, ctx);
    } catch (e) {
      return { ok: false, headline: (e as Error).message, fix: "Edit the address in Settings > Webhooks.", label };
    }

    if (method !== "GET") {
      let rendered;
      if (def.payload_mode === "mapping") {
        // The body is the saved mapping's: the same engine as the ERP path, with the webhook's own signing and headers below.
        const mapped = await mapForWebhook(admin, input.tenantId, { id: def.id, allow_personal_data: def.allow_personal_data === true }, loaded.parts, { event, workspace: tenant.name, sentAt, deliveryId });
        if (!mapped.ok) return { ok: false, headline: mapped.headline, fix: mapped.fix, label };
        rendered = sized(mapped.body);
      } else if (def.payload_mode === "template") {
        const t = validateTemplate(def.template ?? "", objectTypeOk, def.allow_personal_data === true);
        if (!t.ok) return { ok: false, headline: t.errors[0].message, fix: "Fix the template on the Request tab.", label };
        rendered = renderTemplate(t.value, ctx);
      } else {
        rendered = renderStandard(objectTypeOk, ctx, def.allow_personal_data === true);
      }
      if (!rendered.ok) return { ok: false, headline: rendered.message, fix: "Use fewer fields in the template.", label };
      bodyValue = rendered.value;
      bodyText = rendered.json;
    }
  }

  const headers: Record<string, string> = {};
  if (bodyText !== null) headers["Content-Type"] = "application/json";
  for (const h of Array.isArray(def.headers) ? def.headers : []) {
    const v = unsealSecret(h.value);
    if (v === undefined) return { ok: false, headline: `The value of the header ${h.name} could not be read.`, fix: "Enter it again on the Request tab.", label };
    headers[h.name] = v;
  }
  // BPMSquare's own headers go last, so a tenant header can never replace them.
  headers["X-BPMSquare-Signature"] = signBody(secret, bodyText ?? "");
  headers["X-BPMSquare-Delivery"] = deliveryId;
  headers["X-BPMSquare-Event"] = event;
  headers["X-BPMSquare-Timestamp"] = String(nowSec);
  headers["X-BPMSquare-Idempotency-Key"] = idemKey;
  return { ok: true, method, url, headers, bodyText, bodyValue, label, objectType, objectId };
}

/** The request as it would be sent, nothing sent and nothing recorded. Header VALUES are never returned, only their names. */
export async function previewWebhook(
  admin: SupabaseClient, input: { tenantId: string; webhookId: string; objectType: string; objectId: string },
): Promise<{ ok: true; request: SentRequest } | { ok: false; headline: string; fix: string | null; needsDatabaseUpdate?: boolean }> {
  const loaded = await loadDefinition(admin, input.tenantId, input.webhookId);
  if ("pending" in loaded) return { ok: false, headline: "A database update is needed first.", fix: `Run ${SQL_BUNDLES.webhooks} once.`, needsDatabaseUpdate: true };
  if (!loaded.def) return { ok: false, headline: "That webhook was not found.", fix: null };
  const tenant = await loadTenantInfo(admin, input.tenantId);
  if (!tenant) return { ok: false, headline: "Workspace not found.", fix: null };
  const def = loaded.def;
  const event = def.kind === "event" ? "webhook.test" : defaultEvent(input.objectType);
  const p = await prepare(admin, def, tenant, { ...input, trigger: "test" }, event, randomUUID(), new Date().toISOString(), "preview", Math.floor(Date.now() / 1000));
  if (!p.ok) return { ok: false, headline: p.headline, fix: p.fix };
  return { ok: true, request: { method: p.method, url: p.url, headers: Object.keys(p.headers), body: p.bodyValue } };
}

async function loadDefinition(admin: SupabaseClient, tenantId: string, webhookId: string): Promise<{ def: WebhookRow | null } | { pending: true; def?: undefined }> {
  const { data, error } = await admin.from("webhooks").select(WEBHOOK_COLUMNS).eq("id", webhookId).eq("tenant_id", tenantId).maybeSingle();
  if (isSchemaPending(error)) return { pending: true };
  if (error) return { def: null };
  return { def: (data as WebhookRow | null) ?? null };
}

// ── the origin of the idempotency key ───────────────────────────────────────

/** The key stays the same across attempts at the same firing: a restart (or another try while an earlier attempt is
 *  still open) reuses the origin of the open failed row; a fresh firing, and a test, get a new one. */
async function originFor(admin: SupabaseClient, input: FireInput, webhookId: string): Promise<string> {
  if (input.trigger === "test") return randomUUID();
  try {
    if (input.retryOf) {
      const { data } = await admin.from(MESSAGES_TABLE).select("id, summary").eq("id", input.retryOf).eq("tenant_id", input.tenantId).maybeSingle();
      const o = (data as { summary?: { origin?: unknown } } | null)?.summary?.origin;
      if (typeof o === "string" && o) return o;
    }
    const { data } = await admin.from(MESSAGES_TABLE).select("id, summary").eq("tenant_id", input.tenantId).eq("webhook_id", webhookId)
      .eq("object_id", input.objectId).eq("status", "failed").order("created_at", { ascending: false }).limit(1);
    const o = ((data ?? []) as { summary?: { origin?: unknown } }[])[0]?.summary?.origin;
    if (typeof o === "string" && o) return o;
  } catch {
    // A new origin is the safe fallback: at worst the receiver sees a new key.
  }
  return randomUUID();
}

/** A success settles the earlier failed rows of the same record on the same webhook, so the Monitor shows only what is open. */
async function settleEarlier(admin: SupabaseClient, tenantId: string, webhookId: string, objectId: string, byId: string | null): Promise<void> {
  try {
    const { data } = await admin.from(MESSAGES_TABLE).select("id, summary").eq("tenant_id", tenantId).eq("webhook_id", webhookId).eq("object_id", objectId).eq("status", "failed").limit(50);
    for (const r of (data ?? []) as { id: string; summary: Record<string, unknown> | null }[]) {
      if (r.id === byId) continue;
      await admin.from(MESSAGES_TABLE).update({ status: "skipped", summary: { ...(r.summary ?? {}), resolved: true, resolved_by: byId } }).eq("id", r.id).eq("tenant_id", tenantId);
    }
  } catch {
    // Housekeeping only.
  }
}

// ── firing ──────────────────────────────────────────────────────────────────

async function readResponse(res: Response): Promise<unknown> {
  let t = "";
  try { t = (await res.text()).slice(0, MAX_RESPONSE_CHARS); } catch { return null; }
  if (!t) return null;
  try { return JSON.parse(t); } catch { return t; }
}

export async function fireWebhook(admin: SupabaseClient, input: FireInput, deps: FireDeps = {}): Promise<FireResult> {
  const now = deps.now ?? Date.now;
  const t0 = now();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const doFetch = deps.fetch ?? ((u: string, init: RequestInit) => fetchPublic(u, init));
  const event = input.event ?? defaultEvent(input.objectType);
  const deliveryId = randomUUID();
  const sentAt = new Date(t0).toISOString();

  // One Monitor row per firing, whatever happened. `def` is only the webhook's own, tenant-verified row.
  const note = async (a: {
    status: StoredStatus; headline: string; fix: string | null; def?: WebhookRow | null; label?: string; httpStatus?: number | null;
    error?: string | null; origin?: string; exchange?: ReturnType<typeof buildExchangePayload>; objectType?: string | null; objectId?: string | null;
  }): Promise<string | null> => {
    const r = await recordMessage(admin, {
      tenantId: input.tenantId, direction: "out", channel: "webhook", entity: a.objectType === undefined ? input.objectType : a.objectType,
      objectType: a.objectType === undefined ? input.objectType : a.objectType, objectId: a.objectId === undefined ? input.objectId : a.objectId,
      refLabel: a.label ?? null, status: a.status, httpStatus: a.httpStatus ?? null, error: a.error ?? null, durationMs: now() - t0,
      webhookId: a.def?.id ?? null, exchange: a.exchange ?? null,
      summary: {
        kind: "webhook_call", webhook: a.def?.name ?? null, trigger: input.trigger, event, origin: a.origin ?? null, ref: a.label ?? null,
        headline: a.headline, ...(a.fix ? { fix: a.fix } : {}), ...(input.outcome ? { outcome: input.outcome } : {}),
      },
    });
    return r.id;
  };
  const stop = async (a: Omit<Parameters<typeof note>[0], "status"> & { status?: StoredStatus; skipped?: boolean }): Promise<FireResult> => {
    const messageId = await note({ status: a.status ?? "failed", ...a });
    return { ok: false, skipped: a.skipped, status: null, messageId, deliveryId: null, durationMs: now() - t0, headline: a.headline, fix: a.fix };
  };

  if (!input.webhookId) return stop({ headline: "No webhook is chosen.", fix: "Choose one under Settings > Webhooks." });

  const loaded = await loadDefinition(admin, input.tenantId, input.webhookId);
  if ("pending" in loaded) {
    return { ok: false, needsDatabaseUpdate: true, status: null, messageId: null, deliveryId: null, durationMs: now() - t0, headline: "A database update is needed first.", fix: `Run ${SQL_BUNDLES.webhooks} once.` };
  }
  const def = loaded.def;
  // A foreign or deleted id fires nothing and says so.
  if (!def) return stop({ headline: "That webhook was not found.", fix: "Choose another under Settings > Webhooks." });
  if (def.kind !== "call" && !(def.kind === "event" && input.trigger === "test")) {
    return stop({ def, headline: "That is an Event webhook.", fix: "It is sent by the change feed, not by a record." });
  }
  if (def.kind === "call" && def.object_type !== input.objectType) {
    const want = CALL_OBJECTS.find((o) => o.key === def.object_type)?.label ?? String(def.object_type);
    return stop({ def, headline: `This webhook sends ${want}.`, fix: "Choose a webhook for this kind of record." });
  }
  const attention = needsAttention(def);
  if (attention) return stop({ def, headline: "The address needs https.", fix: "Edit the address in Settings > Webhooks to start with https://." });
  if (input.trigger !== "test") {
    if (def.paused_reason) return stop({ def, headline: def.paused_reason, fix: "Resume it under Settings > Webhooks, then restart." });
    if (!def.active) return stop({ def, status: "skipped", skipped: true, headline: "The webhook is switched off.", fix: null });
  }

  const tenant = await loadTenantInfo(admin, input.tenantId);
  if (!tenant) return stop({ def, headline: "Workspace not found.", fix: null });

  const origin = await originFor(admin, input, def.id);
  const idemKey = idempotencyKey(def.id, input.objectId, event, origin);
  const p = await prepare(admin, def, tenant, input, event, deliveryId, sentAt, idemKey, Math.floor(t0 / 1000));
  if (!p.ok) return stop({ def, label: p.label, origin, headline: p.headline, fix: p.fix });

  const request: SentRequest = { method: p.method, url: p.url, headers: Object.keys(p.headers), body: p.bodyValue };
  const quiet = input.trigger === "test"; // a test never moves the counters or pauses the webhook

  if (tenant.isDemo) {
    // Same posture as mail: a demo workspace never reaches a real receiver.
    const exchange = buildExchangePayload({ method: p.method, path: p.url, requestBody: p.bodyValue, status: null, responseBody: { note: "Demo workspace: nothing was sent." }, durationMs: 0, failed: false });
    const messageId = await note({ status: "redirected", def, label: p.label, origin, exchange, objectType: p.objectType, objectId: p.objectId, headline: "Demo workspace: nothing was sent.", fix: null });
    return { ok: true, redirected: true, status: null, messageId, deliveryId, durationMs: now() - t0, headline: "Demo workspace: nothing was sent.", fix: null, request };
  }

  const attempt = async (): Promise<{ res: Response | null; err: Error | null; ms: number }> => {
    const a0 = now();
    try {
      const res = await doFetch(p.url, { method: p.method, headers: p.headers, ...(p.bodyText !== null ? { body: p.bodyText } : {}), signal: AbortSignal.timeout(def.timeout_ms ?? 15000) });
      return { res, err: null, ms: now() - a0 };
    } catch (e) {
      return { res: null, err: e instanceof Error ? e : new Error(String(e)), ms: now() - a0 };
    }
  };
  const retryable = (r: { res: Response | null; err: Error | null }) =>
    r.err ? !NOT_RETRYABLE.test(r.err.message) : !!r.res && (r.res.status === 429 || r.res.status >= 500);

  let r = await attempt();
  if (retryable(r)) {
    // Drain the first response so the connection is released, wait, and try exactly once more.
    if (r.res) await r.res.text().catch(() => "");
    await sleep(RETRY_DELAY_MS);
    r = await attempt();
  }

  const status = r.res ? r.res.status : null;
  const responseBody = r.res ? await readResponse(r.res) : { error: r.err?.message ?? "Request failed" };
  const ok = !!r.res && r.res.ok;
  const timedOut = !!r.err && (r.err.name === "TimeoutError" || r.err.name === "AbortError" || /timed? ?out|aborted/i.test(r.err.message));
  const exchange = buildExchangePayload({ method: p.method, path: p.url, requestBody: p.bodyValue, status, responseBody, durationMs: r.ms, failed: !ok });
  const response = { status, body: responseBody };
  const total = now() - t0;

  if (ok) {
    const headline = `Sent (HTTP ${status}).`;
    const messageId = await note({ status: "ok", def, label: p.label, origin, httpStatus: status, exchange, objectType: p.objectType, objectId: p.objectId, headline, fix: null });
    if (!quiet) {
      await admin.from("webhooks").update({ last_delivery_at: new Date(now()).toISOString(), last_status: status, last_error: null, failure_count: 0 }).eq("id", def.id).eq("tenant_id", input.tenantId);
      if (p.objectId) await settleEarlier(admin, input.tenantId, def.id, p.objectId, messageId);
    }
    return { ok: true, status, messageId, deliveryId, durationMs: total, headline, fix: null, request, response };
  }

  const f = describeFailure({ status, message: r.err?.message, timedOut });
  const messageId = await note({
    status: "failed", def, label: p.label, origin, httpStatus: status, error: r.err?.message ?? (status !== null ? `HTTP ${status}` : null),
    exchange, objectType: p.objectType, objectId: p.objectId, headline: f.headline, fix: f.fix,
  });
  if (!quiet) {
    const failures = (def.failure_count ?? 0) + 1;
    await admin.from("webhooks").update({
      last_delivery_at: new Date(now()).toISOString(), last_status: status, last_error: (r.err?.message ?? `HTTP ${status}`).slice(0, 500), failure_count: failures,
      ...(failures >= AUTO_PAUSE_AFTER ? { active: false, paused_reason: `Paused after ${AUTO_PAUSE_AFTER} failures` } : {}),
    }).eq("id", def.id).eq("tenant_id", input.tenantId);
  }
  return { ok: false, status, messageId, deliveryId, durationMs: total, headline: f.headline, fix: f.fix, request, response };
}
