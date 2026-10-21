import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listScoredLeads } from "@/lib/marketing/leads/queries";
import { canViewWorkcenter } from "@/lib/permissions";
import { canUseObject, type AssistantCtx } from "./sources";
import { objectDef } from "./objects";
import { DRAFT_STALE_DAYS, type OwnWork } from "./suggestions";

// "Your own open work", for the suggestions strip when no record is open. Every read is explicit about both the
// workspace and the person: tenant_id from the session, and the person's own user id (created_by / owner_user_id),
// never a value from the request. A module the workspace does not own or the person may not view is not read.

const DAY = 86_400_000;

export async function loadOwnWork(admin: SupabaseClient, ctx: AssistantCtx, userId: string, now: Date = new Date()): Promise<OwnWork> {
  const work: OwnWork = {};
  const today = now.toISOString().slice(0, 10);

  const jobs: Promise<void>[] = [];

  if (canUseObject(ctx, objectDef("quote"))) {
    jobs.push((async () => {
      const cutoff = new Date(now.getTime() - DRAFT_STALE_DAYS * DAY).toISOString();
      const { data, error } = await admin.from("quotes").select("id, ref")
        .eq("tenant_id", ctx.tenantId).eq("created_by", userId).eq("status", "draft").lt("created_at", cutoff)
        .order("created_at", { ascending: true }).limit(10);
      if (!error) work.staleDrafts = (data ?? []).map((q) => ({ id: String(q.id), ref: String(q.ref) }));
    })());
  }

  if (ctx.features.marketing_scoring === true && canViewWorkcenter(ctx.perms, "leads")) {
    jobs.push((async () => {
      const { leads, pending } = await listScoredLeads(admin, ctx.tenantId);
      if (!pending) work.readyLeads = leads.filter((l) => l.owner_user_id === userId && l.stage === "ready").length;
    })());
  }

  if (ctx.features.abm === true && canViewWorkcenter(ctx.perms, "abm")) {
    jobs.push((async () => {
      const { count, error } = await admin.from("abm_target_accounts").select("id", { count: "exact", head: true })
        .eq("tenant_id", ctx.tenantId).eq("owner_user_id", userId).lt("next_step_due", today);
      if (!error) work.overdueSteps = count ?? 0;
    })());
  }

  await Promise.all(jobs.map((j) => j.catch(() => undefined)));
  return work;
}
