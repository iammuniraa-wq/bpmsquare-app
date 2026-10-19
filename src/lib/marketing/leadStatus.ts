import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { recordStatusTransition, validateStatusTransition } from "@/lib/statusEngine";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { marketingScoringOn } from "./config";
import { effectiveLeadStage, isLeadStageKey, LEAD_STAGES, legacyStatusForStage, type LeadStageKey } from "./leadStages";
import { isSchemaPending } from "./pending";

// The lead lifecycle on the status engine (0070 + 0140). A tenant gets its
// default 'leads' profile lazily, the first time the flow is used, rather than
// by a data migration: no tenant that has not switched marketing_scoring on
// ever gets a row.

export type LeadStageMap = Map<LeadStageKey, string>;

const PROFILE_NAME = "Lead stages";

/**
 * The tenant's default 'leads' status profile, created with its eight stages
 * and permissive "from any stage" transition rules if it does not exist yet.
 * Returns stage key -> custom_status id, or null while 0140 is pending.
 * Idempotent and safe to race: a lost race re-reads the winner's rows.
 */
export async function ensureLeadStatusProfile(admin: SupabaseClient, tenantId: string): Promise<LeadStageMap | null> {
  const read = async (): Promise<LeadStageMap | null> => {
    const { data: profile, error } = await admin
      .from("status_profile").select("id")
      .eq("tenant_id", tenantId).eq("entity_type", "leads").eq("is_default", true).maybeSingle();
    if (error) return null;
    if (!profile) return null;
    const { data: statuses, error: sErr } = await admin
      .from("custom_status").select("id, code").eq("tenant_id", tenantId).eq("status_profile_id", profile.id);
    if (sErr) return null;
    const map: LeadStageMap = new Map();
    for (const s of (statuses ?? []) as { id: string; code: string }[]) if (isLeadStageKey(s.code)) map.set(s.code, s.id);
    return map.size === LEAD_STAGES.length ? map : null;
  };

  try {
    const existing = await read();
    if (existing) return existing;

    const { data: created, error } = await admin
      .from("status_profile")
      .insert({ tenant_id: tenantId, entity_type: "leads", name: PROFILE_NAME, is_default: true })
      .select("id").single();
    if (error || !created) {
      if (error && !isSchemaPending(error) && error.code !== "23505") console.error(`[leadStatus] profile not created: ${error.message}`);
      return await read();
    }

    const { data: statuses, error: sErr } = await admin.from("custom_status").insert(
      LEAD_STAGES.map((s, i) => ({
        tenant_id: tenantId, status_profile_id: created.id, entity_type: "leads",
        system_status_code: s.code, code: s.key, label: s.label, is_initial: s.key === "new", sort_order: i,
      })),
    ).select("id, code");
    if (sErr || !statuses) {
      console.error(`[leadStatus] stages not created: ${sErr?.message}`);
      return await read();
    }

    // Any stage may move to any other (a rep can always mark "Not a fit"); an
    // admin tightens this later if they want a stricter flow.
    const { error: rErr } = await admin.from("status_transition_rule").insert(
      (statuses as { id: string }[]).map((s) => ({
        tenant_id: tenantId, status_profile_id: created.id, from_custom_status_id: null, to_custom_status_id: s.id,
      })),
    );
    if (rErr) console.error(`[leadStatus] transition rules not created: ${rErr.message}`);
    return await read();
  } catch (e) {
    console.error("[leadStatus] ensureLeadStatusProfile failed", e);
    return null;
  }
}

export type SetLeadStageResult =
  | { ok: true; stage: LeadStageKey; from: LeadStageKey }
  | { ok: false; status: number; error: string };

/**
 * Moves a lead to a stage through the status engine: validates the move
 * against the tenant's transition rules, writes custom_status_id and keeps the
 * old `status` column in step, records the status_history row and emits
 * lead.stage_changed. Refuses outright when marketing_scoring is off.
 */
export async function setLeadStage(p: {
  tenantId: string;
  leadId: string;
  to: LeadStageKey;
  userId: string;
  role: "admin" | "member";
  comment?: string | null;
  source?: "manual" | "system_action" | "api" | "integration";
  client?: SupabaseClient;
}): Promise<SetLeadStageResult> {
  const admin = p.client ?? createAdminSupabase();
  try {
    const { data: tenant } = await admin.from("tenants").select("features").eq("id", p.tenantId).maybeSingle();
    if (!marketingScoringOn(tenant?.features as Record<string, boolean> | null)) {
      return { ok: false, status: 404, error: "Lead stages aren't enabled for your workspace" };
    }
    if (!isLeadStageKey(p.to)) return { ok: false, status: 400, error: "Unknown stage" };

    const { data: lead, error: lErr } = await admin
      .from("leads").select("id, account_id, contact_id, status, custom_status_id")
      .eq("id", p.leadId).eq("tenant_id", p.tenantId).maybeSingle();
    if (lErr) return { ok: false, status: isSchemaPending(lErr) ? 503 : 500, error: isSchemaPending(lErr) ? "Lead stages need a database update that has not been applied yet" : lErr.message };
    if (!lead) return { ok: false, status: 404, error: "Lead not found" };

    const stages = await ensureLeadStatusProfile(admin, p.tenantId);
    if (!stages) return { ok: false, status: 503, error: "Lead stages need a database update that has not been applied yet" };

    const byId = new Map<string, LeadStageKey>([...stages].map(([k, id]) => [id, k]));
    const storedStage = lead.custom_status_id ? byId.get(lead.custom_status_id) ?? null : null;
    const from = effectiveLeadStage(lead as { status: string }, storedStage);
    if (from === p.to) return { ok: true, stage: p.to, from };

    const fromId = stages.get(from) ?? null;
    const toId = stages.get(p.to)!;
    const check = await validateStatusTransition(admin, {
      tenantId: p.tenantId, userId: p.userId, role: p.role,
      fromCustomStatusId: fromId, toCustomStatusId: toId, comment: p.comment,
    });
    if (!check.ok) return { ok: false, status: 409, error: check.error };

    const { error: uErr } = await admin
      .from("leads")
      .update({ custom_status_id: toId, status: legacyStatusForStage(p.to), last_activity_at: new Date().toISOString() })
      .eq("id", p.leadId).eq("tenant_id", p.tenantId);
    if (uErr) return { ok: false, status: 500, error: uErr.message };

    await recordStatusTransition(admin, {
      tenantId: p.tenantId, entityType: "leads", entityId: p.leadId,
      fromCustomStatusId: fromId, toCustomStatusId: toId,
      fromSystemCode: check.fromSystemCode, toSystemCode: check.toSystemCode,
      changedByUserId: p.userId, comment: p.comment, source: p.source ?? "manual",
    });
    await emitEvent(p.tenantId, {
      name: EVENTS.LEAD_STAGE_CHANGED, object_type: "lead", object_id: p.leadId, actor_id: p.userId,
      lead_id: p.leadId, account_id: lead.account_id, contact_id: lead.contact_id,
      key: `${p.leadId}:${from}->${p.to}:${new Date().toISOString().slice(0, 16)}`,
      payload: { from, to: p.to },
    }, admin);
    return { ok: true, stage: p.to, from };
  } catch (e) {
    console.error("[leadStatus] setLeadStage failed", e);
    return { ok: false, status: 500, error: "Could not change the stage" };
  }
}
