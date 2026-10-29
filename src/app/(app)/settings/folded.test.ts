import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

const redirect = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to), useRouter: () => ({}), useSearchParams: () => new URLSearchParams() }));

import { ROUTES } from "@/lib/constants";
import { OLD_SETTINGS_ROUTES, tabHref, COMPANY_TABS, APPEARANCE_TABS, PRODUCT_TABS, QUOTATION_TABS, WORKFORCE_TABS } from "@/lib/settingsFolded";
import { SETTINGS_MENU } from "@/lib/settingsMenu";

import EntitiesRedirect from "./entities/page";
import CurrencyRedirect from "./currency/page";
import NumberRangesRedirect from "./number-ranges/page";
import NavigationRedirect from "./navigation/page";
import ResetRedirect from "./reset/page";
import DashboardRedirect from "./dashboard/page";
import ProductCategoriesRedirect from "./product-categories/page";
import ItemTypesRedirect from "./item-types/page";
import SalesRedirect from "./sales/page";
import StatusesRedirect from "./statuses/page";
import QuoteTypesRedirect from "./quote-types/page";
import TextTemplatesRedirect from "./templates/page";
import EmailTemplatesRedirect from "./email-templates/page";
import AssetPrintFieldsRedirect from "./asset-print-fields/page";
import WfAttendanceRedirect from "./workforce/attendance/page";
import WfVerificationRedirect from "./workforce/verification/page";
import WfShiftsRedirect from "./workforce/shifts/page";
import WfSitesRedirect from "./workforce/sites/page";
import WfKiosksRedirect from "./workforce/kiosks/page";
import WfLeaveRedirect from "./workforce/leave-types/page";
import WfRemindersRedirect from "./workforce/reminders/page";
import WfEmploymentRedirect from "./workforce/employment/page";

const target = (fn: () => void) => {
  try { fn(); } catch (e) { return (e as Error).message.replace("REDIRECT:", ""); }
  return null;
};

beforeEach(() => { redirect.mockClear(); });

describe("old addresses redirect to the tab that holds what they showed (batch S2)", () => {
  const cases: [string, () => void, string][] = [
    ["/settings/entities", EntitiesRedirect, "/settings/company?tab=entities"],
    ["/settings/currency", CurrencyRedirect, "/settings/company?tab=tax"],
    ["/settings/number-ranges", NumberRangesRedirect, "/settings/company?tab=numbering"],
    ["/settings/navigation", NavigationRedirect, "/settings/appearance?tab=menu"],
    ["/settings/reset", ResetRedirect, "/settings/appearance?tab=menu"],
    ["/settings/dashboard", DashboardRedirect, "/settings/appearance?tab=dashboard"],
    ["/settings/product-categories", ProductCategoriesRedirect, "/settings/products"],
    ["/settings/item-types", ItemTypesRedirect, "/settings/products?tab=types"],
    ["/settings/sales", SalesRedirect, "/settings/products"],
    ["/settings/statuses", StatusesRedirect, "/settings/quotations"],
    ["/settings/quote-types", QuoteTypesRedirect, "/settings/quotations?tab=types"],
    ["/settings/templates", TextTemplatesRedirect, "/settings/quotations?tab=templates"],
    ["/settings/email-templates", EmailTemplatesRedirect, "/settings/quotations?tab=templates"],
    ["/settings/asset-print-fields", AssetPrintFieldsRedirect, "/settings/quotations?tab=print"],
    ["/settings/workforce/attendance", WfAttendanceRedirect, "/settings/workforce"],
    ["/settings/workforce/verification", WfVerificationRedirect, "/settings/workforce"],
    ["/settings/workforce/shifts", WfShiftsRedirect, "/settings/workforce?tab=shifts"],
    ["/settings/workforce/sites", WfSitesRedirect, "/settings/workforce?tab=places"],
    ["/settings/workforce/kiosks", WfKiosksRedirect, "/settings/workforce?tab=places"],
    ["/settings/workforce/leave-types", WfLeaveRedirect, "/settings/workforce?tab=leave"],
    ["/settings/workforce/reminders", WfRemindersRedirect, "/settings/workforce?tab=alerts"],
    ["/settings/workforce/employment", WfEmploymentRedirect, "/settings/workforce"],
  ];
  for (const [from, page, to] of cases) {
    it(`${from} -> ${to}`, () => expect(target(page)).toBe(to));
  }

  it("every target tab exists on the screen it points to", () => {
    const tab = (url: string) => new URL(url, "http://x").searchParams.get("tab");
    for (const url of [OLD_SETTINGS_ROUTES.entities, OLD_SETTINGS_ROUTES.currency, OLD_SETTINGS_ROUTES.numberRanges]) expect(COMPANY_TABS).toContain(tab(url));
    for (const url of [OLD_SETTINGS_ROUTES.navigation, OLD_SETTINGS_ROUTES.dashboard]) expect(APPEARANCE_TABS).toContain(tab(url));
    expect(PRODUCT_TABS).toContain(tab(OLD_SETTINGS_ROUTES.itemTypes));
    for (const url of [OLD_SETTINGS_ROUTES.quoteTypes, OLD_SETTINGS_ROUTES.textTemplates, OLD_SETTINGS_ROUTES.emailTemplates, OLD_SETTINGS_ROUTES.assetPrintFields]) expect(QUOTATION_TABS).toContain(tab(url));
    for (const url of Object.values(OLD_SETTINGS_ROUTES).filter((u) => u.startsWith(ROUTES.settingsWorkforce))) expect(WORKFORCE_TABS).toContain(tab(url) ?? "rules");
  });

  it("the first tab keeps the address clean", () => {
    expect(tabHref("/settings/company", "profile", "profile")).toBe("/settings/company");
    expect(tabHref("/settings/company", "tax", "profile")).toBe("/settings/company?tab=tax");
  });
});

describe("the menu points at the folded screens, not the old pages", () => {
  const ids = SETTINGS_MENU.map((m) => m.id);
  it("has one entry where there were four, four, and two", () => {
    for (const gone of ["entities", "currency", "number-ranges", "navigation", "dashboard", "reset", "product-categories", "item-types"]) expect(ids, gone).not.toContain(gone);
    expect(SETTINGS_MENU.find((m) => m.id === "company")?.href).toBe(ROUTES.settingsCompany);
    expect(SETTINGS_MENU.find((m) => m.id === "appearance")?.href).toBe(ROUTES.settingsAppearance);
    expect(SETTINGS_MENU.find((m) => m.id === "products")?.href).toBe(ROUTES.settingsProducts);
  });

  it("no menu entry points at a page that only redirects", () => {
    const redirectsOnly = [ROUTES.settingsEntities, ROUTES.settingsCurrency, ROUTES.settingsNumberRanges, ROUTES.settingsNavigation, ROUTES.settingsReset, ROUTES.settingsDashboard, ROUTES.settingsProductCategories, ROUTES.settingsItemTypes, ROUTES.settingsSales, ROUTES.settingsStatuses, ROUTES.settingsQuoteTypes, ROUTES.configTemplates, ROUTES.settingsEmailTemplates, ROUTES.settingsAssetPrintFields];
    for (const m of SETTINGS_MENU) expect(redirectsOnly, m.id).not.toContain(m.href);
  });
});

describe("the removed screens leave no component behind", () => {
  const dir = join(process.cwd(), "src/app/(app)/settings");
  it("the eight Workforce pages and their five components are gone, leaving redirect stubs", () => {
    const wf = join(dir, "workforce");
    for (const folder of ["attendance", "verification", "shifts", "sites", "kiosks", "leave-types", "reminders", "employment"]) expect(readdirSync(join(wf, folder)), folder).toEqual(["page.tsx"]);
    for (const old of ["WorkforceConfigClient", "ShiftsClient", "SitesClient", "LeaveTypesClient", "KiosksClient"]) expect(existsSync(join(wf, `${old}.tsx`)), old).toBe(false);
  });
  it("the old pages are redirect stubs only", () => {
    for (const folder of ["entities", "currency", "number-ranges", "navigation", "reset", "dashboard", "product-categories", "item-types", "sales", "statuses", "quote-types", "templates", "email-templates", "asset-print-fields"]) {
      const files = readdirSync(join(dir, folder));
      expect(files, folder).toEqual(["page.tsx"]);
    }
  });
  it("the folded screens exist", () => {
    for (const f of ["company/CompanyClient.tsx", "appearance/AppearanceClient.tsx", "products/ProductsClient.tsx", "quotations/QuotationsClient.tsx", "pricing/PricingClient.tsx"]) expect(existsSync(join(dir, f)), f).toBe(true);
  });
});

describe("PC and 375 px", () => {
  const css = (p: string) => readFileSync(join(process.cwd(), "src/app/(app)/settings", p), "utf8");
  it("Company is one column under 900 px with 44 px targets", () => {
    const c = css("company/company.module.css");
    expect(c).toMatch(/@media \(max-width: 900px\)[\s\S]*grid-template-columns: 1fr/);
    expect(c).toMatch(/min-height: 44px/);
  });
  it("Appearance has 44 px chips, tiles and menu rows", () => {
    const a = css("appearance/appearance.module.css");
    for (const cls of ["tile", "chip", "menuRow"]) expect(a, cls).toMatch(new RegExp(`\\.${cls}[^{]*\\{[^}]*min-height: 44px`));
  });
  it("Products has 44 px flags and buttons on a phone", () => {
    const p = css("products/products.module.css");
    expect(p).toMatch(/\.flag\s*\{[^}]*min-height: 44px/);
    expect(p).toMatch(/@media \(max-width: 780px\)[\s\S]*min-height: 44px/);
  });
});
