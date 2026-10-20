import "server-only";
import type { ModuleCtx } from "@/lib/marketing/moduleAccess";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";

/** The three lists the event form chooses from: this workspace's forms and journeys (not archived) and its colleagues. */
export async function formPickers(ctx: ModuleCtx) {
  const [forms, journeys, members] = await Promise.all([
    ctx.supabase.from("forms").select("id, name, status").eq("tenant_id", ctx.tenantId).neq("status", "archived").order("name").limit(200),
    ctx.supabase.from("journeys").select("id, name, status").eq("tenant_id", ctx.tenantId).neq("status", "archived").order("name").limit(200),
    listMembersForPicker(ctx.admin, ctx.tenantId).catch(() => []),
  ]);
  return {
    forms: (forms.error ? [] : forms.data ?? []) as { id: string; name: string; status: string }[],
    journeys: (journeys.error ? [] : journeys.data ?? []) as { id: string; name: string; status: string }[],
    members,
  };
}
