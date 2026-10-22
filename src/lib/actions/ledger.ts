import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";

// assistant_actions: the audit trail of everything the assistant did on a person's press, and the thing that makes a
// card single-use. The table and change_log.via come from one migration (0205, applied by hand). While it is pending
// the assistant cannot create anything: claimCard answers "unavailable" and /api/ai/act refuses with a 503 before the
// object's route runs, so single use and the "via assistant" mark are never silently dropped.

export type AssistantActionStatus = "pending" | "done" | "failed";

export type AssistantActionRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  conversation_id: string | null;
  kind: "create" | "update" | "web_search" | "guide";
  /** The card as the person saw it (PII redacted). */
  card: unknown;
  action_key: string | null;
  route: string | null;
  /** The values they confirmed (PII redacted). */
  params: unknown;
  status: AssistantActionStatus;
  result: unknown;
  sources: unknown;
  tokens: number | null;
  created_at: string;
  executed_at: string | null;
};

export type ClaimInput = {
  cardId: string;
  tenantId: string;
  userId: string;
  kind: "create" | "update";
  actionKey: string;
  route: string;
  card: unknown;
  params: unknown;
};

export type ClaimResult =
  | { state: "claimed" }
  | { state: "done"; result: unknown }
  | { state: "busy" }
  /** The ledger cannot be written (migration 0205 not applied, or the database failed): nothing may run. */
  | { state: "unavailable" };


/**
 * The result of a card that has already been used, if it has. Asked before anything else is checked so a second
 * press of a finished card always answers "already done" (the record it made now exists, so a fresh duplicate
 * check would only confuse the answer).
 */
export async function usedResult(admin: SupabaseClient, c: { cardId: string; tenantId: string; userId: string }): Promise<{ result: unknown } | null> {
  try {
    const { data, error } = await admin.from("assistant_actions").select("status, result")
      .eq("id", c.cardId).eq("tenant_id", c.tenantId).eq("user_id", c.userId).maybeSingle();
    if (!error && data?.status === "done") return { result: data.result };
  } catch { /* the claim below fails closed if the ledger is unreachable */ }
  return null;
}

/**
 * Takes the one execution a card has. The insert with the card id as the row id is the atomic claim: a second press
 * hits the primary key. A card whose run failed (the route refused it) can be pressed again once the person has
 * fixed it; a card that is done is never run twice and hands back its result so the dock can show it again.
 */
export async function claimCard(admin: SupabaseClient, c: ClaimInput): Promise<ClaimResult> {
  const row = {
    id: c.cardId, tenant_id: c.tenantId, user_id: c.userId, kind: c.kind, card: c.card,
    action_key: c.actionKey, route: c.route, params: c.params, status: "pending" as const,
  };
  try {
    const { error } = await admin.from("assistant_actions").insert(row);
    if (!error) return { state: "claimed" };
    if (error.code === "23505") {
      const { data: existing } = await admin.from("assistant_actions")
        .select("status, result").eq("id", c.cardId).eq("tenant_id", c.tenantId).eq("user_id", c.userId).maybeSingle();
      if (!existing) return { state: "busy" };
      if (existing.status === "done") return { state: "done", result: existing.result };
      if (existing.status === "failed") {
        const { data: retaken } = await admin.from("assistant_actions")
          .update({ status: "pending", card: c.card, params: c.params, result: null })
          .eq("id", c.cardId).eq("tenant_id", c.tenantId).eq("user_id", c.userId).eq("status", "failed")
          .select("id");
        return retaken && retaken.length > 0 ? { state: "claimed" } : { state: "busy" };
      }
      return { state: "busy" };
    }
    if (!isSchemaPending(error)) console.error("[assistant_actions] claim failed, refusing the action", error.message);
  } catch (e) {
    console.error("[assistant_actions] claim threw, refusing the action", e);
  }
  // Fail closed (audit 2026-10-22 L3): a per-process fallback is not single use across instances, and without the
  // table the "via assistant" mark and the audit row would be dropped silently.
  return { state: "unavailable" };
}

/** Records how the run ended. Never throws: the action has already happened or been refused. */
export async function finishCard(
  admin: SupabaseClient,
  c: { cardId: string; tenantId: string; userId: string },
  outcome: { status: "done" | "failed"; result: unknown },
): Promise<void> {
  try {
    const { error } = await admin.from("assistant_actions")
      .update({ status: outcome.status, result: outcome.result, executed_at: new Date().toISOString() })
      .eq("id", c.cardId).eq("tenant_id", c.tenantId).eq("user_id", c.userId);
    if (error && !isSchemaPending(error)) console.error("[assistant_actions] finish failed", error.message);
  } catch (e) {
    console.error("[assistant_actions] finish threw", e);
  }
}
