import type React from "react";
import type { AnalyticsMetricId, TenantFeatures, DashLayoutItem } from "@/lib/constants";
import { ANALYTICS_META, analyticsFeatureOn, isAnalyticsId } from "@/lib/analyticsMeta";

// The dashboard's block catalogue and layout rules, held apart from DashboardLayout.tsx (a "use client" file full of JSX) so they can be
// tested and shared. Moved here unchanged except for the tender blocks (docs/design/tender-desk.md, "Integrated dashboard").

export const SIDEBAR_IDS = new Set(["quick_create"]);

// `features` = show when ANY of these module flags is on (0067). Native
// blocks predate the core-module flags and were rendered unconditionally --
// a WFM-only tenant saw pipeline/case/work-order tiles for modules it
// never bought.
export const NATIVE_META: Record<string, { label: string; sidebar?: boolean; features?: (keyof TenantFeatures)[] }> = {
  overview_strip:  { label: "Overview", features: ["quotations", "cases", "work_orders", "assets"] },
  revenue_card:    { label: "Revenue", features: ["quotations"] },
  invoice_budget:  { label: "Invoiced vs paid", features: ["invoices"] },
  overdue_tasks:   { label: "Overdue tasks", features: ["accounts", "cases", "quotations", "work_orders"] },
  tech_workload:   { label: "Work orders by technician", features: ["technicians", "work_orders"] },
  top_accounts:    { label: "Top accounts by revenue", features: ["accounts"] },
  quick_create:    { label: "Quick create", sidebar: true, features: ["accounts", "cases", "contacts", "quotations", "assets"] },
  // Not an analytics widget: it fetches /api/wfm/summary itself rather than
  // reading the precomputed analytics payload, which is why it lives here
  // and renders through the native switch below.
  wfm_summary:     { label: "Attendance summary (day + month)", features: ["wfm"] },
  // Carries its own content rather than the tenant's data, so no `features`
  // gate -- whether it appears at all is config.dashboard_extras.product_tips,
  // handled in resolveLayout. Individual tips are still module-filtered, in
  // tipsFor().
  product_tips:    { label: "Tips & shortcuts" },
};

/** Blocks whose presence is an ADMIN SETTING rather than a module flag or a
 * user's own layout choice (owner decision 2026-09-20). Both are off by
 * default; when on they are forced VISIBLE even if a saved layout hid them,
 * which is what "always on, admin-controlled" means. Order and size stay the
 * user's business. */
export const EXTRA_BLOCK_IDS = { business_news: "business_news", product_tips: "product_tips" } as const;
export type DashboardExtras = { business_news?: boolean; product_tips?: boolean } | undefined;

export function applyExtras(layout: DashLayoutItem[], extras: DashboardExtras): DashLayoutItem[] {
  const out = layout.filter((b) => {
    if (b.id === EXTRA_BLOCK_IDS.business_news) return extras?.business_news === true;
    if (b.id === EXTRA_BLOCK_IDS.product_tips) return extras?.product_tips === true;
    return true;
  });
  const present = new Set(out.map((b) => b.id));
  for (const id of [EXTRA_BLOCK_IDS.business_news, EXTRA_BLOCK_IDS.product_tips]) {
    if (extras?.[id] !== true) continue;
    const at = out.findIndex((b) => b.id === id);
    // Forced visible: an admin turning it on outranks a stale saved `hidden`.
    if (at >= 0) out[at] = { ...out[at], hidden: false };
    else if (!present.has(id)) out.push({ id });
  }
  return out;
}

export const DEFAULT_LAYOUT: DashLayoutItem[] = [
  { id: "overview_strip" },
  { id: "revenue_card" },
  { id: "invoice_budget" },
  { id: "overdue_tasks" },
  { id: "tech_workload" },
  { id: "top_accounts" },
  { id: "quick_create" },
];

/** The tender edition's blocks (feature gcc_tender, a platform-admin flag): five KPI tiles, then the stage / closing / won-lost / client /
 * attention / trend blocks in pairs, then the deadline timeline and the buy-out card full width. This is the order a gcc_tender workspace opens
 * on, in Curated and in My layout alike; every other workspace never sees any of it. Each is its own block, so each can be moved, resized or
 * hidden in Adapt. */
export const TENDER_BLOCKS: (DashLayoutItem & { size: "compact" | "half" | "full" })[] = [
  { id: "tender_open_pipeline", size: "compact" },
  { id: "tender_weighted", size: "compact" },
  { id: "tender_closing_soon", size: "compact" },
  { id: "tender_win_rate", size: "compact" },
  { id: "tender_buyout_committed", size: "compact" },
  { id: "tender_by_stage", size: "half" },
  { id: "tender_closing_list", size: "half" },
  { id: "tender_won_lost", size: "half" },
  { id: "tender_by_client", size: "half" },
  { id: "tender_attention", size: "half" },
  { id: "tender_trend", size: "half" },
  { id: "tender_deadlines", size: "full" },
  { id: "tender_buyout", size: "full" },
];
export const TENDER_BLOCK_IDS: ReadonlySet<string> = new Set(TENDER_BLOCKS.map((b) => b.id));
export const isTenderBlockId = (id: string): boolean => TENDER_BLOCK_IDS.has(id);
/** The five KPI tiles: they sit five to a row where the width allows (see blockFlex). */
export const TENDER_TILE_IDS: ReadonlySet<string> = new Set(TENDER_BLOCKS.slice(0, 5).map((b) => b.id));

/** The tender blocks a workspace opens on: all of them with the flag, none without it. */
export function tenderLead(features: TenantFeatures): DashLayoutItem[] {
  if (features.gcc_tender !== true) return [];
  // Only the blocks whose modules the workspace owns: buy-out needs Contract projects, every block needs Pipeline.
  return TENDER_BLOCKS.filter((b) => blockAllowed(b.id, features)).map((b) => ({ id: b.id, size: b.size }));
}

/** THE CURATED DASHBOARD (owner request 2026-09-21).
 *
 * A fixed, ordered composition -- the design board's page -- rather than a
 * layout. It exists because a layout can be wrong: this workspace had three
 * analytics tiles saved from months ago, so the board's own panels ("the
 * tiles which I wanted") simply were not on it, and no amount of theme work
 * was going to put them there.
 *
 * These are all EXISTING blocks, which is the whole trick: curated mode is a
 * different choice of blocks, not a second rendering engine, so every panel
 * here is one the Adapt drawer already offers and one renderWidget already
 * knows how to draw. Order is the composition -- the two board panels
 * (Overdue tasks is its task list, Top accounts its rows-with-values) sit
 * directly under the KPI row, where the board puts them.
 *
 * Still filtered by blockAllowed(), so a Workforce-only workspace gets its
 * own subset rather than six empty CRM cards. business_news is added
 * separately: it is an admin setting (config.dashboard_extras), and curated
 * mode bypasses applyExtras, so including it unconditionally would start
 * fetching news for a tenant that never asked for it. */
export const CURATED_LAYOUT: DashLayoutItem[] = [
  { id: "overview_strip" },
  { id: "overdue_tasks", size: "half" },
  { id: "top_accounts", size: "half" },
  { id: "revenue_card", size: "half" },
  { id: "invoice_budget", size: "half" },
  { id: "tech_workload", size: "half" },
  { id: "wfm_summary" },
  { id: "quick_create" },
];

// Standard per-object starter bundles -- one click adds a sensible combo of
// already-existing blocks (native or analytics) instead of hand-picking each
// one. Sizes are only specified where the block's own default isn't already
// right for the bundle; everything else falls back to blockSize()'s default.
export type BundleBlock = { id: string; size?: "compact" | "half" | "full" };
export const BUNDLES: { id: string; label: string; feature?: keyof TenantFeatures; blocks: BundleBlock[] }[] = [
  { id: "accounts",     label: "Accounts",      feature: "accounts", blocks: [
    { id: "accounts" }, { id: "accounts_by_type" }, { id: "top_accounts" }, { id: "account_news" },
  ] },
  { id: "contacts",     label: "Contacts",      feature: "contacts", blocks: [{ id: "contacts" }] },
  { id: "quotations",   label: "Quotations",    feature: "quotations", blocks: [
    { id: "quote_trend" }, { id: "revenue_card" }, { id: "quote_outcomes" },
    { id: "quote_overdue", size: "compact" }, { id: "quote_source", size: "half" },
  ] },
  { id: "cases",        label: "Cases",         feature: "cases", blocks: [{ id: "open_cases" }, { id: "case_status" }] },
  { id: "work_orders",  label: "Work orders",   feature: "work_orders", blocks: [
    { id: "work_orders" }, { id: "work_order_status" }, { id: "tech_workload" },
  ] },
  { id: "assets",       label: "Assets",        feature: "assets", blocks: [
    { id: "assets" }, { id: "assets_by_kind" }, { id: "loaner_availability", size: "half" },
  ] },
  { id: "contracts",    label: "AMC / Contracts", feature: "amc", blocks: [{ id: "contracts", size: "half" }] },
  { id: "leads",        label: "Leads",         feature: "leads", blocks: [{ id: "leads" }, { id: "lead_funnel" }] },
  { id: "technicians",  label: "Technicians",   feature: "technicians", blocks: [
    { id: "technicians" }, { id: "technician_availability" }, { id: "tech_workload" },
  ] },
  { id: "invoices",     label: "Invoices",      feature: "invoices", blocks: [
    { id: "invoice_budget" }, { id: "invoices_by_status" }, { id: "revenue_overview" },
  ] },
  { id: "wfm",          label: "Workforce",     feature: "wfm", blocks: [
    { id: "wfm_summary", size: "full" },
    { id: "wfm_attendance_today" }, { id: "wfm_corrections_queue" }, { id: "wfm_leave_requests_queue" },
    { id: "wfm_site_headcount" }, { id: "wfm_workforce_composition", size: "half" }, { id: "wfm_night_shift_cost", size: "compact" },
  ] },
  { id: "wfm_projects",  label: "Project costing", feature: "wfm_projects", blocks: [
    { id: "wfm_project_hours" }, { id: "wfm_project_budget" }, { id: "wfm_project_billing", size: "compact" },
  ] },
  { id: "tenders",      label: "Tenders",       feature: "gcc_tender", blocks: TENDER_BLOCKS.map((b) => ({ id: b.id, size: b.size })) },
];

/** Central feature gate for a dashboard block: native blocks show when ANY
 * of their module flags is on, analytics widgets follow their own flag.
 * Applied at RENDER time (not just in the customize picker) so a saved or
 * default layout can never surface a module the tenant doesn't have. */
export function blockAllowed(id: string, features: TenantFeatures): boolean {
  const native = NATIVE_META[id];
  if (native) return !native.features || native.features.some((f) => features[f] === true);
  if (isAnalyticsId(id)) {
    return analyticsFeatureOn(id, features);
  }
  return true;
}

export function resolveLayout(savedLayout: DashLayoutItem[], features: TenantFeatures, extras: DashboardExtras): DashLayoutItem[] {
  if (!savedLayout || savedLayout.length === 0) return applyExtras(defaultLayoutFor(features), extras);
  // A layout saved before the tender blocks existed (or before the workspace got the tender edition) holds none of them, and the owner of a
  // tender workspace opens the dashboard for exactly those. When a layout mentions no tender block at all, they lead it, once; a layout that
  // mentions any (visible or hidden) is the person's own choice and is left alone.
  const saved = features.gcc_tender === true && !savedLayout.some((b) => isTenderBlockId(b.id))
    ? [...tenderLead(features), ...savedLayout]
    : savedLayout;
  // Ensure native blocks that aren't in saved layout appear (as hidden) so user can un-hide them
  const savedIds = new Set(saved.map((b) => b.id));
  const missing = Object.keys(NATIVE_META).filter((id) => !savedIds.has(id));
  const merged = [...saved, ...missing.map((id) => ({ id, hidden: true }))];

  // A saved layout was never reconciled against the tenant's MODULES. A
  // workspace whose saved blocks all belong to modules it doesn't have --
  // a layout stamped at provisioning, or one left behind when modules
  // changed -- filtered down to nothing and opened on a blank screen, with
  // the module's own widgets sitting unused because defaultLayoutFor is
  // only consulted when nothing is saved at all.
  //
  // Deliberately keyed on feature-allowed, NOT on hidden: a user who hid
  // every block chose that, and is left alone (the empty state below
  // explains how to bring them back). This only rescues a layout that
  // cannot show anything no matter what the user un-hides.
  //
  // Checked against SAVED, not merged: the merge above injects every
  // native block as hidden, and on a scoped tenant those injected blocks
  // are feature-allowed -- which made this check always pass and the
  // rescue never fire, landing e.g. a WFM-only workspace with a stale
  // CRM-only saved layout on a blank dashboard instead of its defaults.
  if (!saved.some((b) => blockAllowed(b.id, features))) return applyExtras(defaultLayoutFor(features), extras);
  return applyExtras(merged, extras);
}

/** The default layout was written when every tenant had every module: all
 * six native CRM blocks. For a scoped tenant (e.g. WFM-only) those are all
 * feature-blocked, which used to resolve to an EMPTY dashboard. When that
 * happens, fall back to composing the default from the enabled modules'
 * starter bundles instead -- a Workforce-only tenant opens to the WFM
 * widgets with zero setup. Tenants with a saved layout are untouched. */
export function defaultLayoutFor(features: TenantFeatures): DashLayoutItem[] {
  const base = baseDefaultLayout(features);
  if (features.gcc_tender !== true) return base;
  // Tender workspace: the tender blocks lead, then what the workspace would otherwise have had. The Quick create rail is left to Adapt: a
  // 280 px rail would squeeze the five tiles out of one row.
  return [...tenderLead(features), ...base.filter((b) => !isTenderBlockId(b.id) && !SIDEBAR_IDS.has(b.id))];
}

/** Curated mode for a workspace: the fixed composition, led by the tender blocks when the workspace has the tender edition. */
export function curatedLayoutFor(features: TenantFeatures): DashLayoutItem[] {
  if (features.gcc_tender !== true) return CURATED_LAYOUT;
  return [...tenderLead(features), ...CURATED_LAYOUT.filter((b) => !SIDEBAR_IDS.has(b.id))];
}

function baseDefaultLayout(features: TenantFeatures): DashLayoutItem[] {
  const nativeVisible = DEFAULT_LAYOUT.filter((b) => blockAllowed(b.id, features));
  if (nativeVisible.some((b) => !NATIVE_META[b.id]?.sidebar)) return DEFAULT_LAYOUT;
  const seen = new Set<string>();
  const fromBundles: DashLayoutItem[] = [];
  for (const bundle of BUNDLES) {
    if (bundle.feature && features[bundle.feature] !== true) continue;
    for (const b of bundle.blocks) {
      if (seen.has(b.id) || !blockAllowed(b.id, features)) continue;
      seen.add(b.id);
      fromBundles.push(b.size ? { id: b.id, size: b.size } : { id: b.id });
    }
  }
  return [...fromBundles, ...nativeVisible];
}

// Single/dual stat-tile widgets are narrow by nature -- default them to compact
// so they sit side by side in a wrapping row instead of each claiming a
// full-width row of mostly empty space. Users can still override via block.size.
export const COMPACT_ANALYTICS_IDS = new Set<AnalyticsMetricId>([
  "accounts", "contacts", "assets", "open_cases", "work_orders", "leads", "technicians", "quote_overdue",
]);

export function blockSize(block: DashLayoutItem): "compact" | "half" | "full" {
  if (block.size) return block.size;
  const tender = TENDER_BLOCKS.find((b) => b.id === block.id);
  if (tender) return tender.size;
  return isAnalyticsId(block.id) && COMPACT_ANALYTICS_IDS.has(block.id) ? "compact" : "full";
}

export const SIZE_FLEX: Record<"compact" | "half" | "full", React.CSSProperties> = {
  // Compact tiles GROW to share the row evenly rather than leaving a ragged
  // gap on the right -- but maxWidth caps a lone tile so it can't stretch
  // absurdly wide when it's the only one on its row. (grow:0 previously left
  // a large dead zone whenever the tiles didn't happen to fill the width.)
  compact: { flex: "1 1 240px", minWidth: 200, maxWidth: 520 },
  half:    { flex: "1 1 calc(50% - 7px)", minWidth: 260 },
  full:    { flex: "1 1 100%", minWidth: 0 },
};

/** The flex box of one block: its size's, except a small tender tile, which is narrower so all five share one row on a desktop. */
export function blockFlex(block: DashLayoutItem): React.CSSProperties {
  const size = blockSize(block);
  if (size === "compact" && TENDER_TILE_IDS.has(block.id)) return { flex: "1 1 150px", minWidth: 140 };
  return SIZE_FLEX[size];
}

export function blockLabel(id: string): string {
  if (id in NATIVE_META) return NATIVE_META[id].label;
  if (id in ANALYTICS_META) return ANALYTICS_META[id as AnalyticsMetricId].label;
  return id;
}

// ── What the Adapt drawer does to a layout, held here so it can be tested ─────────────────────────────────────────────────────────────

/** Quick add: put the bundle's blocks in the layout. One already there is un-hidden (and takes the bundle's size); the others are appended. */
export function addBundleBlocks(layout: DashLayoutItem[], blocks: BundleBlock[]): DashLayoutItem[] {
  const next = [...layout];
  for (const b of blocks) {
    const idx = next.findIndex((x) => x.id === b.id);
    if (idx >= 0) next[idx] = { ...next[idx], hidden: false, ...(b.size ? { size: b.size } : {}) };
    else next.push({ id: b.id, ...(b.size ? { size: b.size } : {}) });
  }
  return next;
}

export function toggleHiddenAt(layout: DashLayoutItem[], idx: number): DashLayoutItem[] {
  return layout.map((b, i) => (i === idx ? { ...b, hidden: !b.hidden } : b));
}

export function setSizeAt(layout: DashLayoutItem[], idx: number, size: "compact" | "half" | "full"): DashLayoutItem[] {
  return layout.map((b, i) => (i === idx ? { ...b, size } : b));
}

/** Drag a block from one place to another. */
export function moveBlock(layout: DashLayoutItem[], from: number, to: number): DashLayoutItem[] {
  if (from === to || from < 0 || from >= layout.length) return layout;
  const next = [...layout];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The analytics picker's checkbox: pin the widget at the end, or take it out. */
export function toggleAnalyticsPin(layout: DashLayoutItem[], id: AnalyticsMetricId): DashLayoutItem[] {
  return layout.some((b) => b.id === id) ? layout.filter((b) => b.id !== id) : [...layout, { id }];
}
