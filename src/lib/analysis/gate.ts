import { webAvailability } from "@/lib/assistant/webConsent";
import { canViewWorkcenter, type PermissionSet } from "@/lib/permissions";
import type { TenantConfig } from "@/lib/constants";

// Whether this person may use company analysis at all, and why not. One answer for the route, the AI slider, the Account 360
// drawer and the screens that show an Analyse button (docs/design/account-analysis.md 7).

export function analysisAccess(a: { features: Record<string, boolean | undefined>; config: Partial<TenantConfig>; perms: PermissionSet }): { ok: true } | { ok: false; status: 403; error: string; code: string } {
  const web = webAvailability(a.features, a.config);
  if (!web.enabled) return { ok: false, status: 403, code: web.reason, error: "Company analysis is not switched on for this workspace." };
  if (!canViewWorkcenter(a.perms, "accounts")) return { ok: false, status: 403, code: "no_access", error: "You do not have access to Accounts." };
  return { ok: true };
}
