import { DEFAULT_QUOTE_ID_FORMAT, type QuoteIdFormat, type TenantConfig, type TenantEntity, type TenantFeatures, type TenantTaxConfig } from "@/lib/constants";
import { DEFAULT_CURRENCY, isCurrencyCode, type CurrencyCode } from "@/lib/currency";
import type { CompanyInfo } from "@/lib/tenant";
import { COMPANY_TABS, type CompanyTab } from "@/lib/settingsFolded";

// The Company screen keeps everything in one draft and writes it with one Save: switching tabs never loses an
// edit, and only the groups that changed are sent (each to the route that already owned it).

export const DEFAULT_TAX: TenantTaxConfig = { label: "GST", rate: 18, inclusive: false };

export type CompanyDraft = {
  /** The one company name: the workspace name shown in the sidebar and, by default, the name on printed documents. */
  name: string;
  /** Only set when the letterhead already carried a name that differs from the workspace name. Empty means "same". */
  printName: string;
  /** Everything else on the letterhead (company_info without its name). */
  profile: Omit<CompanyInfo, "name">;
  entities: TenantEntity[];
  tax: TenantTaxConfig;
  currency: CurrencyCode;
  quoteFormat: QuoteIdFormat;
};

export function draftFrom(
  workspaceName: string,
  info: CompanyInfo | null | undefined,
  config: Partial<TenantConfig> | null | undefined,
  currency: string | null | undefined,
): CompanyDraft {
  const { name: letterheadName, ...profile } = info ?? {};
  const differs = !!letterheadName && letterheadName.trim() !== workspaceName.trim();
  return {
    name: workspaceName,
    printName: differs ? letterheadName! : "",
    profile,
    entities: config?.entities ?? [],
    tax: { ...DEFAULT_TAX, ...(config?.tax ?? {}) },
    currency: isCurrencyCode(currency) ? currency : DEFAULT_CURRENCY,
    quoteFormat: { ...DEFAULT_QUOTE_ID_FORMAT, ...(config?.quote_id_format ?? {}) },
  };
}

/** The name that prints on documents: the workspace name unless the letterhead already had its own. */
export function printedName(d: Pick<CompanyDraft, "name" | "printName">): string {
  return d.printName.trim() || d.name.trim();
}

/** Which tabs this workspace gets: the letterhead, entities and tax belong to the modules that print documents. */
export function companyTabs(features: Partial<TenantFeatures> | undefined, hasOtherRanges: boolean): CompanyTab[] {
  const prints = printsLetterhead(features);
  return COMPANY_TABS.filter((t) => {
    if (t === "entities") return prints;
    if (t === "numbering") return features?.quotations === true || hasOtherRanges;
    return true;
  });
}

export function printsLetterhead(features: Partial<TenantFeatures> | undefined): boolean {
  return features?.quotations === true || features?.invoices === true || features?.standard_quotes === true;
}

export type SaveStep =
  | { id: "workspace"; url: string; method: "PATCH"; body: { name: string } }
  | { id: "company"; url: string; method: "PATCH"; body: CompanyInfo }
  | { id: "config"; url: string; method: "PATCH"; body: Partial<TenantConfig> }
  | { id: "currency"; url: string; method: "PUT"; body: { code: CurrencyCode } };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Entities with no name are dropped: they are what an abandoned "+ Add entity" leaves behind. */
export function cleanEntities(list: TenantEntity[]): TenantEntity[] {
  const named = list.filter((e) => e.name.trim() !== "");
  if (named.length > 0 && !named.some((e) => e.is_default)) return named.map((e, i) => (i === 0 ? { ...e, is_default: true } : e));
  return named;
}

export function companyDirty(initial: CompanyDraft, draft: CompanyDraft): boolean {
  return !same(initial, draft);
}

export function companyProblem(draft: CompanyDraft): string | null {
  if (!draft.name.trim()) return "Give the company a name.";
  if (!Number.isFinite(draft.tax.rate) || draft.tax.rate < 0 || draft.tax.rate > 100) return "The tax rate is between 0 and 100.";
  return null;
}

/** The writes a Save makes, one per group that changed, each to the route that already owned that group. */
export function planCompanySave(initial: CompanyDraft, draft: CompanyDraft): SaveStep[] {
  const steps: SaveStep[] = [];
  const name = draft.name.trim();
  if (name !== initial.name.trim()) steps.push({ id: "workspace", url: "/api/settings/workspace", method: "PATCH", body: { name } });

  if (!same(initial.profile, draft.profile) || printedName(initial) !== printedName(draft)) {
    steps.push({ id: "company", url: "/api/settings/company-info", method: "PATCH", body: { ...draft.profile, name: printedName(draft) } });
  }

  const config: Partial<TenantConfig> = {};
  const entities = cleanEntities(draft.entities);
  if (!same(initial.entities, draft.entities)) config.entities = entities;
  if (!same(initial.tax, draft.tax)) config.tax = draft.tax;
  if (!same(initial.quoteFormat, draft.quoteFormat)) config.quote_id_format = draft.quoteFormat;
  if (Object.keys(config).length > 0) steps.push({ id: "config", url: "/api/settings/entities", method: "PATCH", body: config });

  if (initial.currency !== draft.currency) steps.push({ id: "currency", url: "/api/settings/currency", method: "PUT", body: { code: draft.currency } });
  return steps;
}

export function blankEntity(): TenantEntity {
  return { id: crypto.randomUUID(), name: "", short_name: "", tagline: "", address: "", phone: "", email: "", gstin: "", is_default: false };
}

/** The IDs the system generates itself (generation code is the source of truth for each). */
export const FIXED_RANGES: { object: string; example: string; reset: string; feature: keyof TenantFeatures }[] = [
  { object: "Accounts", example: "ACC-0001", reset: "Never", feature: "accounts" },
  { object: "Contacts", example: "CON-0001", reset: "Never", feature: "contacts" },
  { object: "Assets", example: "AST-0001", reset: "Never", feature: "assets" },
  { object: "Suppliers", example: "SUP-0001", reset: "Never", feature: "suppliers" },
  { object: "Inventory items", example: "INV-0001", reset: "Never", feature: "purchasing" },
  { object: "Employees", example: "EMP-0001", reset: "Never", feature: "business_roles" },
  { object: "Standard Quotes", example: "SQ-2026-0001", reset: "Yearly", feature: "standard_quotes" },
  { object: "Invoices", example: "INV-2026-0001", reset: "Yearly", feature: "invoices" },
  { object: "Purchase Orders", example: "PO-2026-0001", reset: "Yearly", feature: "purchasing" },
  { object: "Cases", example: "CS-2026-0001", reset: "Yearly", feature: "cases" },
];

export function visibleRanges(features: Partial<TenantFeatures> | undefined) {
  return FIXED_RANGES.filter((r) => features?.[r.feature] === true);
}
