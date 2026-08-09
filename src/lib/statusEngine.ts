import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// The status-schema engine (0070_status_schema_engine.sql). One shared
// validation path for every object migrated onto the two-layer status
// model (system_status + tenant-configurable custom_status), instead of
// each object re-deriving its own status/transition logic -- see the
// approved plan for the full rollout sequence.
//
// entity_type covers every object the whole rollout will ever need,
// mirroring system_status's seeded set (0070) -- kept in sync by hand,
// since Postgres enums and TS unions can't share a single source of truth.
export type StatusEntityType =
  | "quotes" | "cases" | "work_orders" | "invoices" | "purchase_orders"
  | "inventory" | "suppliers" | "standard_quotes" | "technicians"
  | "attendance" | "leave_request";

export type StatusChangeSource = "manual" | "system_action" | "api" | "integration";

export type StatusTransitionCheck =
  | {
      ok: true;
      fromCode: string | null;
      toCode: string;
      fromSystemCode: string | null;
      toSystemCode: string;
      triggersAction: string | null;
    }
  | { ok: false; error: string };

/**
 * Validates a proposed status change against the tenant's configured
 * status_transition_rule set. Strict: no matching rule means the
 * transition is rejected -- there is no soft-validate fallback, per the
 * "enforce from day one" decision.
 *
 * Read-only -- this does NOT write `custom_status_id` itself. Every
 * migrated object's own table/shape differs, so the caller performs its
 * own `.update({ custom_status_id: ... , ...otherPatchFields })` after a
 * successful check (same before/after split as applyDateProfile() in
 * quoteService.ts, which prepares a patch and leaves the real write to the
 * caller). Once that write succeeds, call recordStatusTransition() below.
 */
export async function validateStatusTransition(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    userId: string;
    role: "admin" | "member";
    fromCustomStatusId: string | null;
    toCustomStatusId: string;
    comment?: string | null;
  }
): Promise<StatusTransitionCheck> {
  const { tenantId, userId, role, fromCustomStatusId, toCustomStatusId, comment } = params;

  const { data: toStatus } = await supabase
    .from("custom_status")
    .select("id, code, system_status_code, status_profile_id")
    .eq("id", toCustomStatusId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!toStatus) return { ok: false, error: "Target status not found." };

  let fromCode: string | null = null;
  let fromSystemCode: string | null = null;
  if (fromCustomStatusId) {
    const { data: fromStatus } = await supabase
      .from("custom_status")
      .select("code, system_status_code")
      .eq("id", fromCustomStatusId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!fromStatus) return { ok: false, error: "Current status not found." };
    fromCode = fromStatus.code;
    fromSystemCode = fromStatus.system_status_code;
  }

  // "from any status" rules (from_custom_status_id null) apply alongside a
  // rule specific to the current status -- fetch every rule targeting this
  // destination within the profile and match in memory rather than two
  // separate round trips.
  const { data: rules } = await supabase
    .from("status_transition_rule")
    .select("id, requires_comment, triggers_action, from_custom_status_id")
    .eq("tenant_id", tenantId)
    .eq("status_profile_id", toStatus.status_profile_id)
    .eq("to_custom_status_id", toCustomStatusId);

  const rule = (rules ?? []).find(
    (r) => r.from_custom_status_id === fromCustomStatusId || r.from_custom_status_id === null
  );
  if (!rule) return { ok: false, error: "This status change isn't allowed by the configured transition rules." };

  if (rule.requires_comment && !comment?.trim()) {
    return { ok: false, error: "A comment is required for this status change." };
  }

  // admin always bypasses role gating, same as everywhere else in this
  // codebase. Zero rows in status_transition_rule_roles for this rule means
  // unrestricted -- mirrors resolvePermissions()'s "no Business Role
  // assigned == unrestricted" default (src/lib/permissions.ts), so this
  // doesn't introduce a second, inconsistent access-control philosophy.
  if (role !== "admin") {
    const { data: roleRows } = await supabase
      .from("status_transition_rule_roles")
      .select("role_id")
      .eq("tenant_id", tenantId)
      .eq("rule_id", rule.id);
    if (roleRows && roleRows.length > 0) {
      const { data: assignments } = await supabase
        .from("business_user_roles")
        .select("role_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId);
      const myRoleIds = new Set((assignments ?? []).map((a) => a.role_id as string));
      const allowed = roleRows.some((r) => myRoleIds.has(r.role_id as string));
      if (!allowed) return { ok: false, error: "You don't have permission to make this status change." };
    }
  }

  return {
    ok: true,
    fromCode,
    toCode: toStatus.code,
    fromSystemCode,
    toSystemCode: toStatus.system_status_code,
    triggersAction: rule.triggers_action ?? null,
  };
}

/**
 * Records one status_history row. Never throws -- same contract as
 * logChange()/logChangeBatch() in changeLog.ts: a logging failure must not
 * fail the mutation it's describing. Call AFTER the entity's own
 * custom_status_id write has already succeeded.
 */
export async function recordStatusTransition(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    entityType: StatusEntityType;
    entityId: string;
    fromCustomStatusId: string | null;
    toCustomStatusId: string;
    fromSystemCode: string | null;
    toSystemCode: string;
    changedByUserId?: string | null;
    comment?: string | null;
    source: StatusChangeSource;
  }
): Promise<void> {
  try {
    const { error } = await supabase.from("status_history").insert({
      tenant_id: params.tenantId,
      entity_type: params.entityType,
      entity_id: params.entityId,
      from_custom_status_id: params.fromCustomStatusId,
      to_custom_status_id: params.toCustomStatusId,
      system_status_code_before: params.fromSystemCode,
      system_status_code_after: params.toSystemCode,
      changed_by_user_id: params.changedByUserId ?? null,
      comment: params.comment ?? null,
      source: params.source,
    });
    if (error) {
      console.error(`[statusEngine] status_history insert failed for ${params.entityType}/${params.entityId}`, error.message);
    }
  } catch (e) {
    console.error(`[statusEngine] status_history insert threw for ${params.entityType}/${params.entityId}`, e);
  }
}
