import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fireWebhook, type FireDeps, type FireResult } from "@/lib/webhooks/sender";
import { readResponsePath } from "@/lib/webhooks/responsePath";
import type { DispatchResult } from "./dispatch";

// An awarded Standard Quote whose Links target is a webhook. Everything else about the award
// (the rule, the claim, Send now, Restart) is the same as for an ERP document, so the claim is the
// same too: a connector_links row for the quote, filed under connector_id "webhook:<id>", inserted as
// "pending:<uuid>" BEFORE the call. The unique claim index of 0201 lets only one insert win, so the
// automatic send, Send now and Restart can never fire the same quote at the same webhook twice.
// A success replaces the placeholder with the delivery id; any other result gives the claim back.

const ENTITY = "standard_quotes";
const PENDING = "pending:";
const CLAIM_STALE_MS = 10 * 60_000;

export type WebhookSendInput = {
  quoteId: string;
  webhookId: string | null;
  trigger: "auto" | "manual" | "retry" | "send_now";
  userId?: string | null;
  /** The Monitor row being restarted: the new attempt keeps its idempotency key. */
  retryOf?: string | null;
};

type Acquired = { busy: true } | { busy: false; already: boolean; pendingId: string | null } | { error: string };

async function acquire(admin: SupabaseClient, tenantId: string, connectorId: string, quoteId: string): Promise<Acquired> {
  const key = { tenant_id: tenantId, connector_id: connectorId, entity: ENTITY, object_id: quoteId };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await admin.from("connector_links").select("id, external_id, synced_at").eq("tenant_id", tenantId).eq("connector_id", connectorId)
      .eq("entity", ENTITY).eq("object_id", quoteId).eq("direction", "push").limit(1).maybeSingle();
    const found = data as { id: string; external_id: string; synced_at: string | null } | null;
    if (found && !found.external_id.startsWith(PENDING)) return { busy: false, already: true, pendingId: null };
    const pendingId = `${PENDING}${randomUUID()}`;
    const now = new Date().toISOString();
    if (!found) {
      const { error } = await admin.from("connector_links").insert({ ...key, object_type: ENTITY, external_id: pendingId, external_key: null, direction: "push", synced_at: now });
      if (!error) return { busy: false, already: false, pendingId };
      if (error.code !== "23505") return { error: error.message };
      continue;
    }
    // Someone else holds the claim. It is theirs unless it went stale (a send that died); taking it over is a
    // compare-and-swap on its placeholder, so only one waiting send can win.
    if (!(Date.now() - Date.parse(found.synced_at ?? "") > CLAIM_STALE_MS)) return { busy: true };
    const { data: won } = await admin.from("connector_links").update({ external_id: pendingId, synced_at: now })
      .eq("tenant_id", tenantId).eq("connector_id", connectorId).eq("entity", ENTITY).eq("object_id", quoteId).eq("external_id", found.external_id).select("id");
    if ((won as unknown[] | null)?.length) return { busy: false, already: false, pendingId };
  }
  return { busy: true };
}

const release = (admin: SupabaseClient, tenantId: string, connectorId: string, quoteId: string, pendingId: string) =>
  admin.from("connector_links").delete().eq("tenant_id", tenantId).eq("connector_id", connectorId).eq("entity", ENTITY).eq("object_id", quoteId).eq("external_id", pendingId);

export function toDispatchResult(r: FireResult): DispatchResult {
  if (r.needsDatabaseUpdate) return { state: "needs_database_update" };
  if (r.ok && !r.redirected) return { state: "sent", messageId: r.messageId, number: null, link: null };
  if (r.ok || r.skipped) return { state: "skipped", messageId: r.messageId, headline: r.headline };
  return { state: "failed", messageId: r.messageId, headline: r.headline, fix: r.fix ?? "Restart it from the Monitor." };
}

/** Send an awarded quote to its webhook. Never throws: every outcome is a Monitor row and a DispatchResult. */
export async function sendViaWebhook(admin: SupabaseClient, tenantId: string, a: WebhookSendInput, deps: FireDeps = {}): Promise<DispatchResult> {
  const fire = (): Promise<FireResult> => fireWebhook(admin, {
    tenantId, webhookId: a.webhookId, objectType: "standard_quotes", objectId: a.quoteId,
    trigger: a.trigger === "retry" ? "retry" : "award", userId: a.userId ?? null, retryOf: a.retryOf ?? null, outcome: "awarded",
  }, deps);

  // No webhook chosen: the sender records the failure; there is nothing to claim.
  if (!a.webhookId) return toDispatchResult(await fire());

  const connectorId = `webhook:${a.webhookId}`;
  const got = await acquire(admin, tenantId, connectorId, a.quoteId);
  if ("error" in got) return { state: "failed", messageId: null, headline: "The send could not be started.", fix: "Try again in a moment." };
  if (got.busy) return { state: "in_progress" };
  if (got.already) return { state: "already_sent", number: null, link: null };

  const pendingId = got.pendingId as string;
  let r: FireResult;
  try {
    r = await fire();
  } catch {
    await release(admin, tenantId, connectorId, a.quoteId, pendingId);
    return { state: "failed", messageId: null, headline: "The webhook call did not complete.", fix: "Restart it from the Monitor." };
  }
  if (r.ok && !r.redirected) {
    // The readable id of what the receiver created, when the webhook says where its answer holds it (migration 0203's response_key_path).
    const { data: pathRow, error: pathErr } = await admin.from("webhooks").select("response_key_path").eq("id", a.webhookId).eq("tenant_id", tenantId).maybeSingle();
    const key = pathErr ? null : readResponsePath(r.response?.body, (pathRow as { response_key_path?: string | null } | null)?.response_key_path);
    await admin.from("connector_links").update({ external_id: `delivery:${r.deliveryId ?? pendingId}`, external_key: key, synced_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("connector_id", connectorId).eq("entity", ENTITY).eq("object_id", a.quoteId).eq("external_id", pendingId);
  } else {
    await release(admin, tenantId, connectorId, a.quoteId, pendingId);
  }
  return toDispatchResult(r);
}
