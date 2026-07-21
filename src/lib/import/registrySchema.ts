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
  cases: "case",
  work_orders: "work_order",
  invoices: "invoice",
  purchase_orders: "purchase_order",
  inventory: "inventory",
  users: null,
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

const REFERENCE_FIELDS: Partial<Record<ImportObjectId, ReferenceFieldDef[]>> = {
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
};

/** Quote line items — fixed shape, one row per line, never tenant-customizable. */
export const QUOTE_LINE_FIELDS: FieldSpec[] = [
  { key: "line_description", label: "Line description", type: "text", required: true, scope: "line", hint: "Line item description — required on every row", aliases: ["description", "item", "particulars", "work description", "line item"] },
  { key: "line_uom", label: "Line UOM", type: "text", scope: "line", hint: "Nos · Job · Set · Mtr · Kg", aliases: ["uom", "unit", "units"] },
  { key: "line_qty", label: "Line qty", type: "number", scope: "line", hint: "Quantity — defaults to 1", aliases: ["qty", "quantity", "nos"] },
  { key: "line_rate", label: "Line rate", type: "number", scope: "line", hint: "Rate in INR", aliases: ["rate", "price", "unit price", "unit rate"] },
  { key: "line_discount_pct", label: "Line discount %", type: "number", scope: "line", hint: "Line discount 0-100", aliases: ["line discount", "item discount"] },
];

/** quote_name is the grouping key that ties header + line rows together — structural, not a DB column. */
export const QUOTE_GROUP_FIELD: FieldSpec = {
  key: "quote_name", label: "Quote name", type: "text", required: true, scope: "header",
  hint: "Groups rows into one quote — repeat on every line of the same quote",
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
  quotes: { label: "Quotes", icon: "₹", description: "Quotations with line items — one row per line, header fields on the first row of each quote", dependsOn: ["accounts", "contacts"] },
  cases: { label: "Cases", icon: "◉", description: "Service cases — repair jobs tracked from intake to close", dependsOn: ["accounts", "assets"] },
  work_orders: { label: "Work Orders", icon: "▤", description: "Field/workshop jobs authorized by a quote or contract", dependsOn: ["accounts", "cases", "assets", "quotes"] },
  invoices: { label: "Invoices", icon: "⊟", description: "Billing documents against a quote or work order", dependsOn: ["accounts", "contacts", "quotes", "work_orders"] },
  purchase_orders: { label: "Purchase Orders", icon: "◫", description: "Orders placed with suppliers", dependsOn: ["suppliers", "quotes"] },
  inventory: { label: "Inventory", icon: "◧", description: "Stocked parts and spares", dependsOn: ["suppliers"] },
  users: { label: "Users", icon: "◍", description: "Invite team members and assign roles — each person receives an email invite", dependsOn: [] },
};

function resolveOptions(field: FieldConfigResult["sections"][number]["fields"][number], salesConfig: SalesConfig): string[] | undefined {
  if (field.selectSource === "territory") return salesConfig.territories;
  if (field.selectSource === "sales_org") return salesConfig.sales_orgs;
  if (field.enumOptions?.length) return field.enumOptions.map((o) => o.value);
  if (field.options?.length) return field.options;
  return undefined;
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
