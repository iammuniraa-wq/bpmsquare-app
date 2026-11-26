import "server-only";
import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { canViewWorkcenter, resolvePermissions } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import type { SiteModule } from "./server";

/**
 * The gate every site PAGE starts with: signed in, the module (and Contract projects) switched on for this workspace, and the menu item not hidden by
 * the person's Business Role. A page that is not for them goes to the dashboard. The routes behind it make their own decisions: the workcenter
 * keys only hide menu items and are not a security boundary.
 */
export async function requireSitePage(which: SiteModule | "any"): Promise<{ supabase: Awaited<ReturnType<typeof requireTenantUser>>["supabase"]; tenantId: string; userId: string; role: "admin" | "member"; expenses: boolean; receipts: boolean }> {
  let ctx;
  try { ctx = await requireTenantUser(); } catch { redirect(ROUTES.login); }
  const tenant = await getTenant();
  const f = tenant?.features;
  const expenses = f?.site_expenses === true;
  const receipts = f?.site_receipts === true;
  const on = which === "any" ? expenses || receipts : which === "site_expenses" ? expenses : receipts;
  if (!on || f?.contract_projects !== true) redirect(ROUTES.dashboard);
  const perms = await resolvePermissions(ctx.supabase, ctx.tenantId, ctx.userId, ctx.role);
  const sees = (k: "site_expenses" | "site_receipts") => canViewWorkcenter(perms, k);
  const allowed = which === "any" ? (expenses && sees("site_expenses")) || (receipts && sees("site_receipts")) : sees(which);
  if (!allowed) redirect(ROUTES.dashboard);
  return { ...ctx, expenses: expenses && sees("site_expenses"), receipts: receipts && sees("site_receipts") };
}
