import { createAdminSupabase } from "@/lib/supabase-server";
import { abmPage } from "../pageData";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";
import { requireWorkcenterView, canCreateWorkcenter, resolvePermissions } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import NewProgramForm from "./NewProgramForm";

export default async function NewAbmProgramPage() {
  const ctx = await abmPage();
  await requireWorkcenterView("abm");
  const perms = await resolvePermissions(ctx.supabase, ctx.tenantId, ctx.userId, ctx.role);
  if (!canCreateWorkcenter(perms, "abm")) redirect(ROUTES.marketingAbm);

  const admin = createAdminSupabase();
  const [members, { data: groups }, { data: segments }] = await Promise.all([
    listMembersForPicker(admin, ctx.tenantId),
    ctx.supabase.from("marketing_target_groups").select("id, name").eq("tenant_id", ctx.tenantId).order("name").limit(200),
    ctx.supabase.from("segments").select("id, name").eq("tenant_id", ctx.tenantId).order("name").limit(200),
  ]);
  return (
    <NewProgramForm
      members={members}
      groups={(groups ?? []) as { id: string; name: string }[]}
      segments={(segments ?? []) as { id: string; name: string }[]}
      currentUserId={ctx.userId}
    />
  );
}
