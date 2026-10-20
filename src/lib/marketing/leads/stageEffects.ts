import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { marketingConfigOf } from "../config";
import type { LeadStageKey } from "../leadStages";
import { isSchemaPending } from "../pending";
import { pickOwnerForLead } from "./assign";
import { notifyLeadReady } from "./notify";
import { slaDueFrom } from "./timing";

// What happens to a lead the moment it enters a stage. Called by
// setLeadStage after the move has been saved, so it is the same whether the
// scorer moved the lead or a salesperson did:
//   ready    start the response clock, give it an owner if it has none, tell them
//   working  a salesperson picked it up: the clock stops (overdue is only ever
//            asked of a ready lead), and an unowned lead becomes theirs
// It never throws: the stage change has already succeeded and must stay so.

type LeadForEffects = { id: string; account_id: string; contact_id?: string | null; title?: string | null; owner_user_id?: string | null; score?: number | null };

async function writeLead(admin: SupabaseClient, tenantId: string, id: string, full: Record<string, unknown>, base: Record<string, unknown>) {
  const first = await admin.from("leads").update(full).eq("id", id).eq("tenant_id", tenantId);
  if (first.error && isSchemaPending(first.error) && Object.keys(base).length > 0) {
    await admin.from("leads").update(base).eq("id", id).eq("tenant_id", tenantId);
  }
}

export async function applyStageEffects(
  admin: SupabaseClient,
  p: { tenantId: string; lead: LeadForEffects; to: LeadStageKey; actorUserId: string | null; now?: Date },
): Promise<void> {
  try {
    if (p.to !== "ready" && p.to !== "working") return;
    const now = p.now ?? new Date();
    const { tenantId, lead } = p;

    if (p.to === "working") {
      if (!lead.owner_user_id && p.actorUserId) {
        const at = now.toISOString();
        await writeLead(admin, tenantId, lead.id, { owner_user_id: p.actorUserId, assigned_at: at, assignment_reason: "claimed" }, { owner_user_id: p.actorUserId });
      }
      return;
    }

    const { data: tenant } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
    const features = (tenant?.features ?? {}) as Partial<TenantFeatures>;
    const config = (tenant?.config ?? {}) as Partial<TenantConfig>;
    const due = slaDueFrom(now, marketingConfigOf(config).lifecycle);

    let ownerId = lead.owner_user_id ?? null;
    let assignedNow = false;
    const full: Record<string, unknown> = { ready_at: now.toISOString(), sla_due_at: due.toISOString() };
    const base: Record<string, unknown> = { sla_due_at: due.toISOString() };
    let reason: string | null = null;
    if (!ownerId) {
      const pick = await pickOwnerForLead(admin, tenantId, lead, features);
      reason = pick.reason;
      ownerId = pick.owner_user_id;
      assignedNow = !!ownerId;
      full.assignment_reason = pick.reason;
      if (ownerId) {
        full.owner_user_id = ownerId;
        full.assigned_at = now.toISOString();
        base.owner_user_id = ownerId;
      }
    }
    await writeLead(admin, tenantId, lead.id, full, base);

    if (assignedNow && ownerId) {
      await emitEvent(tenantId, {
        name: EVENTS.LEAD_ASSIGNED, object_type: "lead", object_id: lead.id, actor_id: p.actorUserId,
        lead_id: lead.id, account_id: lead.account_id, contact_id: lead.contact_id ?? null,
        key: `${lead.id}:assigned:${ownerId}:${now.toISOString().slice(0, 16)}`,
        payload: { owner: ownerId, reason },
      }, admin);
    }
    if (ownerId && ownerId !== p.actorUserId) {
      await notifyLeadReady(admin, tenantId, { leadId: lead.id, title: lead.title ?? "", ownerUserId: ownerId, score: lead.score ?? null, dueAt: due, features });
    }
  } catch (e) {
    console.error("[leads] stage effects failed", e);
  }
}
