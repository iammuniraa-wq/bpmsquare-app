import type { DashLayoutItem, TenantFeatures } from "@/lib/constants";
import { ANALYTICS_META, isAnalyticsId } from "@/components/DashboardLayout";

/**
 * Nova Stream's own "Adapt" layer -- reuses the exact same DashLayoutItem[]
 * persistence the classic dashboard already has (tenants.config.
 * dashboard_layout for the tenant-wide default via PATCH /api/settings/
 * entities, tenant_users.dashboard_layout_override for a personal layer via
 * PATCH /api/dashboard/layout) and the same AnalyticsMetricId widget
 * catalog -- only the native block ids are Nova's own (the fixed
 * command-bar/greeting are not blocks; everything below them is).
 *
 * Deliberately NOT reusing the classic dashboard's Business-Role-derived
 * layout layer -- that's a bigger feature than "let people adapt their own
 * Stream" calls for; only tenant-wide default + personal override exist
 * here. Add role-derived Nova layouts later if that's actually wanted.
 */

// nova_action_stream was dropped (2026-08-23 nav overhaul): "Needs You Now"
// in NovaSidebar now shows that exact same signal set on every page, so
// repeating it on the Stream screen was a straight duplicate. Replaced with
// nova_rankings -- real leaderboards (top customers, best-selling products,
// most-repaired asset kind) that tell a genuinely different story.
export type NovaBlockId = "nova_kpis" | "nova_quick_actions" | "nova_rankings" | "nova_recent_wins";

export const NOVA_NATIVE_META: Record<NovaBlockId, { label: string }> = {
  nova_kpis: { label: "KPI strip" },
  nova_quick_actions: { label: "Quick actions" },
  nova_rankings: { label: "Rankings" },
  nova_recent_wins: { label: "Recent wins" },
};

export const NOVA_DEFAULT_LAYOUT: DashLayoutItem[] = [
  { id: "nova_kpis" },
  { id: "nova_quick_actions" },
  { id: "nova_rankings" },
  { id: "nova_recent_wins" },
];

export function isNovaNativeId(id: string): id is NovaBlockId {
  return id in NOVA_NATIVE_META;
}

export function novaBlockLabel(id: string): string {
  if (isNovaNativeId(id)) return NOVA_NATIVE_META[id].label;
  if (isAnalyticsId(id)) return ANALYTICS_META[id].label;
  return id;
}

export function novaBlockAllowed(id: string, features: TenantFeatures): boolean {
  if (isNovaNativeId(id)) return true;
  if (isAnalyticsId(id)) {
    const feat = ANALYTICS_META[id].feature;
    return !feat || features[feat] === true;
  }
  return false;
}

/**
 * Mirrors the classic dashboard's resolveLayout(): an empty/missing saved
 * layout falls back to the default; a saved one is reconciled against any
 * native blocks it predates (added as hidden, so a future block never
 * silently vanishes for tenants who saved before it existed) and against
 * the tenant's current feature set (an analytics widget for a module the
 * tenant no longer has is dropped rather than rendered as a stray label).
 */
export function resolveNovaLayout(saved: DashLayoutItem[] | undefined | null, features: TenantFeatures): DashLayoutItem[] {
  if (!saved || saved.length === 0) return NOVA_DEFAULT_LAYOUT;
  const savedIds = new Set(saved.map((b) => b.id));
  const missingNative = (Object.keys(NOVA_NATIVE_META) as NovaBlockId[]).filter((id) => !savedIds.has(id));
  const merged = [...saved, ...missingNative.map((id) => ({ id, hidden: true }))];
  return merged.filter((b) => novaBlockAllowed(b.id, features));
}
