import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantFeatures } from "@/lib/constants";
import { canViewWorkcenter, resolvePermissions } from "@/lib/permissions";
import { canSeeFinding } from "../core/visibility";
import { listFindings, loadSettings } from "./store";

/**
 * The "Watch" pill on a tender deal's header (design section 6, slice 2): the open Tender Watch suggestion for THIS deal that THIS viewer may see,
 * or null. It is a result, not a setting, so it only links to the page that holds it. Costs nothing when the flags are off: no query is made.
 */
export async function watchForDeal(
  admin: SupabaseClient, supabase: SupabaseClient,
  p: { tenantId: string; userId: string; role: "admin" | "member"; dealId: string; features: Partial<TenantFeatures> | null | undefined },
): Promise<{ href: string; count: number } | null> {
  if (p.features?.crew !== true || p.features.crew_tender_watch !== true) return null;
  try {
    const perms = await resolvePermissions(supabase, p.tenantId, p.userId, p.role);
    if (!canViewWorkcenter(perms, "crew")) return null;
    const settings = await loadSettings(admin, p.tenantId);
    if (settings.pending || !settings.get("tender_watch").enabled) return null;
    const { rows, pending } = await listFindings(admin, p.tenantId, { agent: "tender_watch", statuses: ["open", "seen"], subjectId: p.dealId, limit: 10 });
    if (pending) return null;
    const mine = rows.filter((f) => canSeeFinding({ role: p.role, userId: p.userId, pipeline: canViewWorkcenter(perms, "pipeline") }, f, settings.get("tender_watch").config.visibility));
    return mine.length ? { href: "/ai-automation/tender_watch?tab=review", count: mine.length } : null;
  } catch {
    return null;
  }
}
