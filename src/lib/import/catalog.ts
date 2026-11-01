import type { TenantFeatures } from "@/lib/constants";
import type { ImportObjectId, ObjectSpec } from "./types";

// The Data Workbench catalog: the ONE place that says where an object sits in the picker, which modes it has, what a
// person may type to find it and the single sentence worth knowing before using it (docs/design/data-workbench-redesign.md
// section 3). Client-safe on purpose: no server-only import, no database, no import of objectFeatures.ts (the page passes
// the module resolver in). Label, icon, description and dependsOn stay with the specs; the module that owns an object
// stays in OBJECT_FEATURE. Adding an object is one entry here and no screen code (bpmsquarecore 3b, point 4).

export type DwGroupId = "master" | "sales" | "service" | "marketing" | "workforce" | "people";

/** Picker order. A group with no owned object is not drawn. */
export const DW_GROUPS: { id: DwGroupId; label: string }[] = [
  { id: "master", label: "Master data" },
  { id: "sales", label: "Sales" },
  { id: "service", label: "Service" },
  { id: "marketing", label: "Marketing" },
  { id: "workforce", label: "Workforce" },
  { id: "people", label: "People" },
];

export type DwMode = "import" | "export" | "update";
export const DW_MODES: DwMode[] = ["import", "export", "update"];

export type DwCatalogEntry = {
  group: DwGroupId;
  /** Lines nest under this object in the picker. Same group, and the parent must not itself have a parent. */
  parent?: ImportObjectId;
  /** Exactly the modes that have a route folder under src/app/api/{mode}/{id}; catalog.test.ts enforces it. */
  modes: readonly DwMode[];
  /** Picker search and assistant aliases, beyond the label. */
  keywords: readonly string[];
  /** Module flags the object needs on top of featureForObject(id). */
  alsoNeeds?: readonly (keyof TenantFeatures)[];
  /** The one thing to know before using it, behind the "i" on the object header. At most 160 characters. */
  note?: string;
  /** Why a mode is off, behind the "i" next to the greyed tab. At most 160 characters. */
  modeNote?: Partial<Record<DwMode, string>>;
};

const ALL: readonly DwMode[] = ["import", "export", "update"];

export const DW_CATALOG: Record<ImportObjectId, DwCatalogEntry> = {
  // ── Master data ──
  accounts: { group: "master", modes: ALL, keywords: ["companies", "customers", "organisations"] },
  contacts: { group: "master", modes: ALL, keywords: ["people", "persons"] },
  assets: { group: "master", modes: ALL, keywords: ["equipment", "motors", "machines"] },
  suppliers: { group: "master", modes: ALL, keywords: ["vendors", "subcontractors"] },
  products: { group: "master", modes: ALL, keywords: ["catalog", "sku", "items"] },
  product_bom_lines: {
    group: "master", parent: "products", modes: ALL, keywords: ["kit", "bill of materials", "components"],
    note: "Adds components to a BOM or kit product that already exists, or corrects quantity, unit, scrap and kind on lines already there.",
  },
  inventory: { group: "master", modes: ALL, keywords: ["stock", "spares", "parts"] },

  // ── Sales ──
  opportunities: {
    group: "sales", modes: ALL, keywords: ["opportunities", "pipeline", "tenders", "deals"],
    note: "A pursuit with a customer, its stage and expected close. Amount and probability are computed, not imported.",
  },
  tender_boq_lines: {
    group: "sales", parent: "opportunities", modes: ALL, keywords: ["bill of quantities", "boq", "tender lines"], alsoNeeds: ["pipeline"],
    note: "Adds or revises lines of an existing tender by item number. A line is never removed, whatever the file leaves out.",
  },
  rfqs: {
    group: "sales", modes: ["export", "update"], keywords: ["request for quotation", "suppliers", "rfq"],
    note: "Export with real IDs, then update header fields in bulk.",
    modeNote: { import: "An RFQ is raised from a record or the RFQ screen, with its lines and suppliers. A file cannot carry that." },
  },
  estimates: {
    group: "sales", modes: ALL, keywords: ["estimator", "project cost"],
    note: "Header fields only. Import makes a draft from a template name; lines, quantities and costs come from the estimator.",
  },
  quotes: {
    group: "sales", modes: ALL, keywords: ["quotations", "offers"],
    note: "Import creates a quote with its lines in one file, one row per line. To add lines to a quote that already exists, use Quote Lines.",
  },
  quote_lines: {
    group: "sales", parent: "quotes", modes: ALL, keywords: ["line items"],
    note: "Only adds lines to a quote that already exists. To create a new quote, use Quotes: its file carries the header and the lines.",
  },
  standard_quotes: {
    group: "sales", modes: ALL, keywords: ["sq", "quotations"],
    note: "Creates draft quotes without lines. Export them to see each Quote ID, then add the lines with Standard Quote Lines.",
  },
  standard_quote_lines: {
    group: "sales", parent: "standard_quotes", modes: ALL, keywords: ["line items"],
    note: "Only adds lines to a draft standard quote that already exists, found by its Quote ID.",
  },
  sales_orders: {
    group: "sales", modes: ALL, keywords: ["orders", "so"],
    note: "Creates draft orders without lines. Export them to see each Order ID, then add the lines with Sales Order Lines.",
  },
  sales_order_lines: {
    group: "sales", parent: "sales_orders", modes: ALL, keywords: ["line items"],
    note: "Only adds lines to a draft sales order that already exists, found by its Order ID.",
  },
  invoices: { group: "sales", modes: ALL, keywords: ["billing", "bills"] },
  purchase_orders: { group: "sales", modes: ALL, keywords: ["po", "purchasing", "buying"] },

  // ── Service ──
  cases: { group: "service", modes: ALL, keywords: ["tickets", "repairs", "service cases"] },
  work_orders: { group: "service", modes: ALL, keywords: ["jobs", "field", "workshop"] },

  // ── Marketing ──
  abm_programs: {
    group: "marketing", modes: ALL, keywords: ["account based marketing", "abm"],
    note: "A goal, a window and an owner. Target lists and buying groups are their own objects.",
  },
  abm_targets: {
    group: "marketing", parent: "abm_programs", modes: ALL, keywords: ["targets", "target accounts"],
    note: "One company in one program. Progress is set by rules or on the screen with a reason, never by a file.",
  },
  abm_members: {
    group: "marketing", parent: "abm_programs", modes: ALL, keywords: ["buying group", "buying committee", "members"],
    note: "People and their role in a target account's buying group, for one program. Private notes are not included.",
  },
  consents: {
    group: "marketing", modes: ["import", "export"], keywords: ["opt in", "gdpr", "pdpl", "permission"], alsoNeeds: ["marketing"],
    note: "Opt-ins and withdrawals, matched to existing contacts by email. A row never creates a contact and old answers are never edited.",
    modeNote: { update: "The consent ledger is append-only. An answer is changed by importing a new one." },
  },

  // ── Workforce ──
  wfm_projects: {
    group: "workforce", modes: ALL, keywords: ["project costing", "hours", "sub-projects"],
    note: "Projects and sub-projects that worked hours are attributed to. Import parents before children.",
  },

  // ── People ──
  employees: { group: "people", modes: ALL, keywords: ["staff", "hr", "workforce"] },
  users: {
    group: "people", modes: ["import", "export"], keywords: ["logins", "team", "members", "invite"],
    modeNote: { update: "Access changes are made in Settings > People, never by a file." },
  },
};

/** What the page hands the client for each object the workspace owns: the built spec and its catalog entry. */
export type DwObject = { spec: ObjectSpec; catalog: DwCatalogEntry };

/** Every object, in catalog order: the order the picker lists them within a group. */
export const DW_OBJECT_IDS = Object.keys(DW_CATALOG) as ImportObjectId[];

export const dwGroupLabel = (id: DwGroupId): string => DW_GROUPS.find((g) => g.id === id)?.label ?? id;

/**
 * The objects a workspace may use: the module that owns the object (resolved by the caller, from OBJECT_FEATURE) plus
 * the extra flags the catalog names. `null` from the resolver means "ungated".
 */
export function ownedObjectIds(
  features: Partial<Record<keyof TenantFeatures, boolean | undefined>> | null | undefined,
  featureFor: (id: ImportObjectId) => keyof TenantFeatures | null,
): ImportObjectId[] {
  return DW_OBJECT_IDS.filter((id) => {
    const key = featureFor(id);
    const extra = DW_CATALOG[id].alsoNeeds ?? [];
    return (key === null || features?.[key] === true) && extra.every((k) => features?.[k] === true);
  });
}

/** The mode to land on when `mode` is not one the object has: the first one it supports. */
export function supportedMode(id: ImportObjectId, mode: string): DwMode {
  const modes = DW_CATALOG[id].modes;
  return (modes as readonly string[]).includes(mode) ? (mode as DwMode) : modes[0];
}
