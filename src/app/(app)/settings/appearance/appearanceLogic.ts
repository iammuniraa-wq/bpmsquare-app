import { NAV, type NavItem, type TenantConfig, type TenantFeatures } from "@/lib/constants";
import { ACCENT_PRESETS } from "@/lib/settings";
import { resolveTenderDeskStyle } from "@/lib/tenderDesk/style";
import type { TenderDeskStyle } from "@/lib/tenderDesk/types";

// Pure rules behind the Appearance screen. Three tabs (Theme, Menu, Dashboard) edit one draft with one Save; this
// file turns the draft into the writes the existing routes expect.

export type ThemeId = "classic" | "modern" | "nextgen" | "nextgen2" | "enterprise" | "spectacular" | "spectacular_purple";
export type DashboardMode = "curated" | "adaptive";
export type Chrome = { top_bar_identity: boolean; command_palette: boolean; navy_sidebar: boolean };
export type SpecColors = { shell_from?: string; shell_to?: string; accent?: string };

export type AppearanceDraft = {
  theme: ThemeId;
  /** tenants.accent_color, the colour of the classic, modern, next-gen, enterprise and spectacular chrome. */
  accent: string;
  /** Nova's own hue; "" is Nova's shipped default. */
  novaAccent: string;
  /** Spectacular Purple's shell and accent; null is the shipped violet. */
  spec: SpecColors | null;
  dashboardMode: DashboardMode;
  /** The workspace default for the Tender desk home (only offered, and only written, for a workspace with the tender edition). */
  tenderDeskStyle: TenderDeskStyle;
  compact: boolean;
  chrome: Chrome;
  navHidden: string[];
  news: boolean;
  tips: boolean;
  topics: string;
};

type TenantLike = {
  accent_color?: string | null;
  config?: Partial<TenantConfig> | null;
};

/** The stored theme. A retired "modern2"/"modern3" value is plain modern; "nextgen2" is kept apart from "nextgen" (Nova). */
export function themeOf(raw: string | undefined): ThemeId {
  if (raw === "nextgen" || raw === "nextgen2" || raw === "enterprise" || raw === "spectacular" || raw === "spectacular_purple") return raw;
  if (raw === "modern" || raw === "modern2" || raw === "modern3") return "modern";
  return "classic";
}

export function draftFromTenant(t: TenantLike): AppearanceDraft {
  const ap = t.config?.appearance;
  const extras = (t.config?.dashboard_extras ?? {}) as { business_news?: boolean; product_tips?: boolean; news_topics?: string[] };
  return {
    theme: themeOf(ap?.ui_theme as string | undefined),
    accent: t.accent_color || ACCENT_PRESETS.blue.color,
    novaAccent: ap?.nova_accent_color ?? "",
    spec: ap?.spectacular_colors ?? null,
    // Unset resolves the way the dashboard itself resolves it: curated on Spectacular, adaptive elsewhere.
    dashboardMode: ap?.dashboard_mode ?? (ap?.ui_theme === "spectacular_purple" || ap?.ui_theme === "spectacular" ? "curated" : "adaptive"),
    tenderDeskStyle: resolveTenderDeskStyle({ tenantDefault: ap?.tender_desk_style, flagOn: true }) ?? "bold",
    compact: ap?.compact_sidebar ?? false,
    chrome: {
      top_bar_identity: ap?.top_bar_identity !== false,
      command_palette: ap?.command_palette !== false,
      navy_sidebar: ap?.navy_sidebar !== false,
    },
    navHidden: t.config?.nav_hidden_hrefs ?? [],
    news: extras.business_news === true,
    tips: extras.product_tips === true,
    topics: (extras.news_topics ?? []).join(", "),
  };
}

export const parseTopics = (text: string) => text.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 4);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a: string[], b: string[]) => [...a].sort().join("|") === [...b].sort().join("|");

export function appearanceDirty(initial: AppearanceDraft, draft: AppearanceDraft): boolean {
  return !same({ ...initial, navHidden: [...initial.navHidden].sort(), topics: parseTopics(initial.topics) },
    { ...draft, navHidden: [...draft.navHidden].sort(), topics: parseTopics(draft.topics) });
}

export type AppearanceSave = {
  /** PATCH /api/settings/workspace */
  workspace?: { accent_color: string };
  /** PATCH /api/settings/entities */
  config?: Partial<TenantConfig>;
  /** A theme or chrome change swaps which components mount, so the page reloads instead of refreshing. */
  reload: boolean;
};

/**
 * The writes a Save makes. The route replaces `appearance` wholesale, so the stored object is carried forward and
 * only the keys the draft changed are overwritten; nothing is sent for a group that did not change.
 */
export function planAppearanceSave(initial: AppearanceDraft, draft: AppearanceDraft, stored: NonNullable<TenantConfig["appearance"]> | undefined): AppearanceSave {
  const out: AppearanceSave = { reload: false };
  if (draft.accent.toLowerCase() !== initial.accent.toLowerCase()) out.workspace = { accent_color: draft.accent };

  const ap: Record<string, unknown> = { ...(stored ?? {}) };
  let appearanceChanged = false;
  const set = (key: string, value: unknown) => { if (value === undefined) delete ap[key]; else ap[key] = value; appearanceChanged = true; };
  if (draft.theme !== initial.theme) { set("ui_theme", draft.theme); out.reload = true; }
  if (draft.novaAccent !== initial.novaAccent) set("nova_accent_color", draft.novaAccent || undefined);
  if (!same(draft.spec, initial.spec)) set("spectacular_colors", draft.spec ?? undefined);
  if (draft.dashboardMode !== initial.dashboardMode) set("dashboard_mode", draft.dashboardMode);
  if (draft.tenderDeskStyle !== initial.tenderDeskStyle) set("tender_desk_style", draft.tenderDeskStyle);
  if (draft.compact !== initial.compact) set("compact_sidebar", draft.compact);
  for (const k of Object.keys(draft.chrome) as (keyof Chrome)[]) {
    if (draft.chrome[k] !== initial.chrome[k]) { set(k, draft.chrome[k]); out.reload = true; }
  }

  const config: Partial<TenantConfig> = {};
  if (appearanceChanged) config.appearance = ap as TenantConfig["appearance"];
  if (!sameSet(draft.navHidden, initial.navHidden)) config.nav_hidden_hrefs = draft.navHidden;
  if (draft.news !== initial.news || draft.tips !== initial.tips || !same(parseTopics(draft.topics), parseTopics(initial.topics))) {
    config.dashboard_extras = { business_news: draft.news, product_tips: draft.tips, news_topics: parseTopics(draft.topics) };
  }
  if (Object.keys(config).length > 0) out.config = config;
  return out;
}

export type MenuRow = NavItem & { group: string; sub: string | null; indent: boolean };

/**
 * The rows of the menu list: every sidebar item this workspace has (module on), its sub-items indented under it.
 * A bundled parent whose children are all filtered out is dropped rather than offered as an empty switch.
 */
export function menuRows(features: Partial<TenantFeatures> | undefined): MenuRow[] {
  const flags = features as Record<string, boolean> | undefined;
  const has = (k?: string) => !k || flags?.[k] === true;
  return NAV.flatMap((grp) =>
    grp.items
      .filter((item) => !item.adminOnly && has(item.featureKey))
      .flatMap((item) => {
        const parent: MenuRow = { ...item, group: grp.group, sub: null, indent: false };
        if (!item.children?.length) return [parent];
        const kids = item.children.filter((ch) => has(ch.featureKey)).map((ch): MenuRow => ({ ...ch, group: grp.group, sub: item.label, indent: true }));
        return kids.length === 0 ? [] : [parent, ...kids];
      }),
  );
}

/** Rows grouped under the sidebar's own section names, in order. */
export function menuGroups(rows: MenuRow[]): { group: string; items: MenuRow[] }[] {
  const out: { group: string; items: MenuRow[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.group === r.group) last.items.push(r);
    else out.push({ group: r.group, items: [r] });
  }
  return out;
}
