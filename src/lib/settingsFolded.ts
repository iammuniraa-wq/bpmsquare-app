import { ROUTES } from "@/lib/constants";

// Batch S2 of docs/design/settings-simplification.md: pages that used to be separate menu entries are now tabs of
// three screens. Each old address redirects to the tab that holds what it showed, so bookmarks and links keep working.

export const COMPANY_TABS = ["profile", "entities", "tax", "numbering"] as const;
export type CompanyTab = (typeof COMPANY_TABS)[number];

export const APPEARANCE_TABS = ["theme", "menu", "dashboard"] as const;
export type AppearanceTab = (typeof APPEARANCE_TABS)[number];

export const PRODUCT_TABS = ["categories", "types"] as const;
export type ProductTab = (typeof PRODUCT_TABS)[number];

/** The address of one tab. The first tab of a screen is its default and keeps the address clean. */
export function tabHref(base: string, tab: string, defaultTab: string): string {
  return tab === defaultTab ? base : `${base}?tab=${tab}`;
}

export const OLD_SETTINGS_ROUTES = {
  entities: tabHref(ROUTES.settingsCompany, "entities", "profile"),
  currency: tabHref(ROUTES.settingsCompany, "tax", "profile"),
  numberRanges: tabHref(ROUTES.settingsCompany, "numbering", "profile"),
  navigation: tabHref(ROUTES.settingsAppearance, "menu", "theme"),
  reset: tabHref(ROUTES.settingsAppearance, "menu", "theme"),
  dashboard: tabHref(ROUTES.settingsAppearance, "dashboard", "theme"),
  productCategories: tabHref(ROUTES.settingsProducts, "categories", "categories"),
  itemTypes: tabHref(ROUTES.settingsProducts, "types", "categories"),
} as const;
