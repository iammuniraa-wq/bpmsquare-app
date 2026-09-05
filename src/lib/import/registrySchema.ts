import "server-only";
import type { FieldConfigResult, SalesConfig } from "@/lib/fieldConfig";
import type { WidgetType } from "@/lib/fieldRegistry";
import type { FieldSpec, FieldType, ImportObjectId, ObjectSpec } from "./types";

/**
 * Everything on this page is deliberately NOT part of FIELD_REGISTRY:
 *
 * - Reference fields (account_name, supplier_name, ...) resolve a
 *   relationship by name for import purposes. The registry excludes raw
 *   *_id columns everywhere — they have dedicated link/picker UI, not a
 *   generic editable field — so import needs its own small, explicit
 *   supplement. Same reasoning as quote's line items below.
 * - Quote's line items were never customizable in any system (old or
 *   new) — see FIELD_REGISTRY_ROLLOUT.md, Decision A. Fixed columns here.
 * - REQUIRED_KEYS covers DB NOT NULL columns. field-config marks every
 *   standard field's `required` as false at the base level (required-ness
 *   for standard fields is entirely rule-driven, evaluated against a live
 *   record) — there's no static "required" signal to read for import
 *   validation, so the small set of genuinely-NOT-NULL columns is listed
 *   here explicitly instead of guessed at.
 *
 * If a future object needs the same treatment, add it here — this file,
 * not FIELD_REGISTRY, is where import-specific structure belongs.
 */

export const REGISTRY_OBJECT_TYPE: Record<ImportObjectId, string | null> = {
  accounts: "account",
  contacts: "contact",
  assets: "asset",
  suppliers: "supplier",
  quotes: "quote",
  quote_lines: null,
  cases: "case",
  work_orders: "work_order",
  invoices: "invoice",
  purchase_orders: "purchase_order",
  inventory: "inventory",
  users: null,
  employees: null,
  products: "product",
  wfm_projects: "project",
};

export type ReferenceFieldDef = {
  key: string;
  label: string;
  hint: string;
  /** Which workbench object this name is looked up against. */
  target: ImportObjectId;
  required?: boolean;
  /** Lookup column on the target — defaults to "name". */
  targetColumn?: "name" | "ref";
};

export const REFERENCE_FIELDS: Partial<Record<ImportObjectId, ReferenceFieldDef[]>> = {
  accounts: [
    { key: "referred_by_account_name", label: "Referred by", hint: "Name of the OEM account that referred this one — only used when type is end_customer", target: "accounts" },
  ],
  contacts: [
    { key: "account_name", label: "Account", hint: "Must match an account already in the system", target: "accounts", required: true },
  ],
  assets: [
    { key: "account_name", label: "Account", hint: "Owning account — leave blank for company-owned loaner stock", target: "accounts" },
  ],
  quotes: [
    { key: "account_name", label: "Account", hint: "Must match an account already in the system", target: "accounts", required: true },
    { key: "contact_name", label: "Contact", hint: "Contact person at the account", target: "contacts" },
  ],
  wfm_projects: [
    { key: "parent_ref", label: "Sits under", hint: "Project ID of the parent (e.g. PRJ-0003) to create a sub-project — blank for a top-level project", target: "wfm_projects" },
    { key: "account_name", label: "Account", hint: "Optional customer account this project is for", target: "accounts" },
  ],
  cases: [
    { key: "account_name", label: "Account", hint: "Must match an account already in the system", target: "accounts", required: true },
    { key: "asset_names", label: "Assets", hint: "One or more asset names, separated by semicolons", target: "assets" },
  ],
  work_orders: [
    { key: "account_name", label: "Account", hint: "Must match an account already in the system", target: "accounts", required: true },
    { key: "case_ref", label: "Case", hint: "Case ID this work order relates to, e.g. CS-2026-0089", target: "cases" },
    { key: "asset_name", label: "Asset", hint: "Asset under service", target: "assets" },
    // Work orders can be authorized by a quote or a contract (auth_kind/auth_id in the DB),
    // but contract-authorized import isn't supported yet — every imported work order is
    // quote-authorized, so this is required.
    { key: "quote_ref", label: "Authorizing quote", hint: "Quote ID that authorizes this work — required, contract-authorized work orders aren't importable yet", target: "quotes", required: true },
  ],
  invoices: [
    { key: "account_name", label: "Account", hint: "Must match an account already in the system", target: "accounts", required: true },
    { key: "contact_name", label: "Contact", hint: "Billing contact", target: "contacts" },
    { key: "quote_ref", label: "Quote", hint: "Quote ID this invoice bills against", target: "quotes" },
    { key: "work_order_ref", label: "Work order", hint: "Work order ID this invoice bills against", target: "work_orders" },
  ],
  purchase_orders: [
    { key: "supplier_name", label: "Supplier", hint: "Must match a supplier already in the system", target: "suppliers", required: true },
    { key: "quote_ref", label: "Related quote", hint: "Quote ID this PO supports, if any", target: "quotes" },
  ],
  inventory: [
    { key: "supplier_name", label: "Preferred supplier", hint: "Must match a supplier already in the system, or leave blank", target: "suppliers" },
  ],
};

/** DB NOT NULL columns — see file header. Keys are registry field keys. */
const REQUIRED_KEYS: Partial<Record<ImportObjectId, string[]>> = {
  accounts: ["name", "type"],
  contacts: ["name"],
  assets: ["name", "kind"],
  suppliers: ["name"],
  quotes: ["name"],
  cases: ["type", "equipment_label", "complaint"],
  work_orders: [],
  invoices: [],
  purchase_orders: [],
  inventory: ["name"],
  users: ["name", "email", "role"],
  products: ["name"],
  wfm_projects: ["name"],
};

/** Quote line items — fixed shape, one row per line, never tenant-customizable. */
export const QUOTE_LINE_FIELDS: FieldSpec[] = [
  { key: "line_sl_no", label: "Line S.No", type: "text", scope: "line", hint: "Optional serial label shown on the printed quote, e.g. 1 · 1a · A", aliases: ["sl no", "sl.no", "s.no", "sno", "serial no", "serial"] },
  { key: "line_description", label: "Line description", type: "text", required: true, scope: "line", hint: "Line item description — required on every row", aliases: ["description", "item", "particulars", "work description", "line item"] },
  { key: "line_uom", label: "Line UOM", type: "text", scope: "line", hint: "Nos · Job · Set · Mtr · Kg", aliases: ["uom", "unit", "units"] },
  { key: "line_qty", label: "Line qty", type: "number", scope: "line", hint: "Quantity — defaults to 1", aliases: ["qty", "quantity", "nos"] },
  { key: "line_rate", label: "Line rate", type: "number", scope: "line", hint: "Rate in INR", aliases: ["rate", "price", "unit price", "unit rate"] },
  { key: "line_discount_pct", label: "Line discount %", type: "number", scope: "line", hint: "Line discount 0-100", aliases: ["line discount", "item discount"] },
  // Export-only line columns — computed or structural values the flat
  // import format can't set (amount is recomputed; groups/options and
  // repair categories are built in the quote form, not via CSV).
  { key: "line_amount", label: "Line amount", type: "number", scope: "line", exportOnly: true, hint: "Computed qty × rate − discount" },
  { key: "line_category", label: "Line category", type: "text", scope: "line", exportOnly: true, hint: "labour · material · testing · transport" },
  { key: "line_deduction", label: "Line deduction", type: "number", scope: "line", exportOnly: true, hint: "Material deduction amount" },
  { key: "line_group", label: "Line group", type: "text", scope: "line", exportOnly: true, hint: "Group / option label this line belongs to" },
];

/**
 * quote_name is the grouping key that ties header + line rows together —
 * structural, not a DB column. Optional: leave it blank and it's generated
 * from the account name (see validateQuoteRows in validate.ts) — only fill
 * it in yourself if you want a specific name instead of the automatic one.
 */
export const QUOTE_GROUP_FIELD: FieldSpec = {
  key: "quote_name", label: "Quote name", type: "text", required: false, scope: "header",
  hint: "Optional — groups rows into one quote. Leave blank and it's auto-named from the account; repeat the same value on every line if you do set it",
  aliases: ["quote", "quotation", "quote title", "title"],
};

const WIDGET_TO_TYPE: Record<WidgetType, FieldType> = {
  text: "text", textarea: "longtext", number: "number", date: "date",
  select: "enum", checkbox: "boolean", tel: "text", email: "email",
  url: "text", enum: "enum",
};

const OBJECT_META: Record<ImportObjectId, { label: string; icon: string; description: string; dependsOn: ImportObjectId[] }> = {
  accounts: { label: "Accounts", icon: "▣", description: "Companies and organisations — the hub every other record links to", dependsOn: [] },
  contacts: { label: "Contacts", icon: "◉", description: "People at accounts — matched to an account by name", dependsOn: ["accounts"] },
  assets: { label: "Assets", icon: "⚙", description: "Motors, transformers, pumps and panels — owned by an account or held as loaner stock", dependsOn: ["accounts"] },
  suppliers: { label: "Suppliers", icon: "◫", description: "Vendors and subcontractors", dependsOn: [] },
  quotes: { label: "Quotes", icon: "₹", description: "Creates new quotations — line items must be in this same file (one row per line, header fields on the first row of each quote). To add lines to a quote that already exists, use Quote Lines instead.", dependsOn: ["accounts", "contacts"] },
  // Never read -- quote_lines is null in REGISTRY_OBJECT_TYPE above, so
  // buildObjectSpec() is never called for it (see data-workbench/page.tsx's
  // STATIC_SPECS branch, same as "users"). Present only because OBJECT_META
  // is typed Record<ImportObjectId, ...>, not Partial.
  quote_lines: { label: "Quote Lines", icon: "≣", description: "", dependsOn: ["quotes"] },
  cases: { label: "Cases", icon: "◉", description: "Service cases — repair jobs tracked from intake to close", dependsOn: ["accounts", "assets"] },
  work_orders: { label: "Work Orders", icon: "▤", description: "Field/workshop jobs authorized by a quote or contract", dependsOn: ["accounts", "cases", "assets", "quotes"] },
  invoices: { label: "Invoices", icon: "⊟", description: "Billing documents against a quote or work order", dependsOn: ["accounts", "contacts", "quotes", "work_orders"] },
  purchase_orders: { label: "Purchase Orders", icon: "◫", description: "Orders placed with suppliers", dependsOn: ["suppliers", "quotes"] },
  inventory: { label: "Inventory", icon: "◧", description: "Stocked parts and spares", dependsOn: ["suppliers"] },
  products: { label: "Products", icon: "▩", description: "Sellable catalog — goods and service plans with list/cost prices", dependsOn: [] },
  wfm_projects: { label: "Projects (workforce)", icon: "▦", description: "Project costing — projects and sub-projects that worked hours are attributed to. Import parents before children.", dependsOn: [] },
  users: { label: "Users", icon: "◍", description: "Invite team members and assign roles — each person receives an email invite", dependsOn: [] },
  // Never read -- employees is null in REGISTRY_OBJECT_TYPE (static spec,
  // same as users/quote_lines). Present only for the Record type.
  employees: { label: "Employees", icon: "👥", description: "", dependsOn: [] },
};

function resolveOptions(field: FieldConfigResult["sections"][number]["fields"][number], salesConfig: SalesConfig): string[] | undefined {
  // Picklists are {code, name}; files carry the CODE (same contract as the
  // API and the DB) — an Export emits codes, so round-tripping just works.
  if (field.selectSource === "product_category") {
    const codes = salesConfig.product_categories.map((pc) => pc.code);
    return codes.length ? codes : undefined; // no tree configured -> free text
  }
  if (field.selectSource === "product_sub_category") {
    const codes = [...new Set(salesConfig.product_categories.flatMap((pc) => pc.subs.map((s) => s.code)))];
    return codes.length ? codes : undefined;
  }
  if (field.enumOptions?.length) return field.enumOptions.map((o) => o.value);
  if (field.options?.length) return field.options;
  return undefined;
}

/**
 * A tenant's custom fields as importable columns, for objects whose spec is
 * hand-authored (employees) instead of built from field-config. Without this
 * the definitions exist and the import route accepts cf_ values, but the
 * downloadable template never offers the columns — so nobody could actually
 * fill them in.
 */
export function customFieldSpecs(fieldConfig: FieldConfigResult): FieldSpec[] {
  return fieldConfig.sections
    .flatMap((s) => s.fields)
    .filter((f) => f.kind === "custom" && !f.hidden)
    .map((f) => ({
      key: f.field_key,
      label: f.label,
      type: WIDGET_TO_TYPE[f.widget],
      required: f.required,
      hint: f.options?.length ? f.options.join(" · ") : `Custom field — ${f.label}`,
      options: f.options,
      aliases: [f.label],
      custom: true,
    } satisfies FieldSpec));
}

/**
 * Builds an ObjectSpec for the import/export pipeline from live field-config
 * — the same merged standard+custom+overrides data the Adapt UI reads.
 * Hidden fields are excluded (a tenant who hid a field doesn't want it in
 * their template). Reference fields and quote's line items are appended
 * from the constants above, since neither comes from the registry.
 */
export function buildObjectSpec(
  id: ImportObjectId,
  fieldConfig: FieldConfigResult,
  salesConfig: SalesConfig
): ObjectSpec {
  const meta = OBJECT_META[id];
  const requiredKeys = new Set(REQUIRED_KEYS[id] ?? []);

  const registryFields: FieldSpec[] = fieldConfig.sections
    .flatMap((s) => s.fields)
    .filter((f) => !f.hidden)
    .map((f) => {
      const options = resolveOptions(f, salesConfig);
      return {
        key: f.field_key,
        label: f.label,
        type: WIDGET_TO_TYPE[f.widget],
        required: requiredKeys.has(f.field_key) || f.required,
        hint: options?.length ? options.join(" · ") : (f.kind === "custom" ? `Custom field — ${f.label}` : f.label),
        options,
        aliases: [f.label],
        custom: f.kind === "custom",
        exportOnly: f.exportOnly,
        scope: id === "quotes" ? "header" : undefined,
      } satisfies FieldSpec;
    });

  const referenceFields: FieldSpec[] = (REFERENCE_FIELDS[id] ?? []).map((r) => ({
    key: r.key,
    label: r.label,
    type: "ref" as const,
    required: r.required,
    hint: r.hint,
    aliases: [r.label],
    scope: id === "quotes" ? "header" : undefined,
  }));

  // Reference fields first (name/account before the rest reads naturally),
  // then registry fields, then quote's fixed line columns last.
  const fields = id === "quotes"
    ? [QUOTE_GROUP_FIELD, ...referenceFields, ...registryFields, ...QUOTE_LINE_FIELDS]
    : [...referenceFields, ...registryFields];

  return {
    id,
    label: meta.label,
    icon: meta.icon,
    description: meta.description,
    dependsOn: meta.dependsOn,
    fields,
    sampleRows: buildSampleRows(id, fields),
  };
}

/**
 * Generic, tenant-neutral example values — deliberately not hand-crafted
 * fictional company data. An earlier version of the asset template shipped
 * with one specific tenant's real company/GSTIN baked in as the "example"
 * for every tenant; this generates a placeholder from each field's own
 * type/options instead, so it's honest for whoever downloads it.
 */
function exampleValue(field: FieldSpec, index: number): string {
  if (field.type === "ref") return "(name of an existing record)";
  if (field.options?.length) return field.options[index % field.options.length];
  switch (field.type) {
    case "email": return index === 0 ? "name@example.com" : "name2@example.com";
    case "date": return "2026-01-15";
    case "number": return String(100 * (index + 1));
    case "integer": return String(index + 1);
    case "boolean": return "false";
    default: return index === 0 ? `Example ${field.label.toLowerCase()}` : `Example ${field.label.toLowerCase()} 2`;
  }
}

function buildSampleRows(id: ImportObjectId, fields: FieldSpec[]): Record<string, string>[] {
  const row = (index: number, filter: (f: FieldSpec) => boolean): Record<string, string> => {
    const r: Record<string, string> = {};
    for (const f of fields) {
      if (!filter(f)) continue;
      const v = exampleValue(f, index);
      if (v) r[f.key] = v;
    }
    return r;
  };

  if (id === "quotes") {
    // Two rows: header + first line, then a second line with no header repeat.
    return [
      row(0, () => true),
      row(0, (f) => f.scope === "line" || f.key === QUOTE_GROUP_FIELD.key),
    ];
  }

  return [row(0, () => true), row(1, (f) => !!f.required)];
}
