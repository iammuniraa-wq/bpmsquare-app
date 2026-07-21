// Import from the client-safe labels mirror, not "@/lib/data" (the barrel
// re-exports server-only live.ts data functions, which would otherwise leak
// into every client component that imports this registry).
import {
  ACCOUNT_TYPE_LABEL, ASSET_KIND_LABEL, SUPPLIER_TYPE_LABEL, SUPPLIER_STATUS_LABEL,
  CASE_TYPE_LABEL, INVENTORY_ITEM_STATUS_LABEL,
} from "@/lib/data/labels";
import { OFFER_TYPE_LABEL, UOM_OPTIONS } from "@/lib/constants";
import type { AccountType, Asset, Supplier, QuoteOfferType, ServiceCase, InventoryItem } from "@/lib/types";

// ── Widget types ─────────────────────────────────────────────────────────────
//
// Superset of custom_fields.field_type ("text"|"number"|"date"|"select"|
// "checkbox"|"textarea") plus standard-field-only refinements that carry
// display/edit conventions the app already has (tel: links, mailto: links,
// https:// prefixing, fixed enums, sales-config-sourced dropdowns). Custom
// fields only ever use the shared subset — a tenant can never accidentally
// create a custom field that requires code-defined enum options.
export type WidgetType =
  | "text" | "textarea" | "number" | "date" | "select" | "checkbox"
  | "tel" | "email" | "url"
  | "enum";

export type SelectSource = "territory" | "sales_org"; // resolved via useSalesConfig()

export type StandardFieldDef = {
  /** Permanent DB column name — never renamed, never changes. */
  key: string;
  /** Label shown unless a field_overrides row sets a different one. */
  defaultLabel: string;
  widget: WidgetType;
  /** Seed section — tenant can reassign via field_overrides.section. */
  defaultSection: string;
  /** Cannot be hidden via a field_overrides.is_hidden override (e.g. name). Rename is still allowed. */
  locked?: boolean;
  /** Exists in the registry (discoverable via Adapt) but not shown out of the box. */
  hiddenByDefault?: boolean;
  /** False = read-only in the generic edit form (e.g. referred_by_account_id, created_at). Default true. */
  editable?: boolean;
  /** widget === "select" only */
  selectSource?: SelectSource;
  /** widget === "enum" only */
  enumOptions?: { value: string; label: string }[];
  placeholder?: string;
};

export type ObjectFieldRegistry = {
  /** Seed section order — also the section list offered in the Adapt drawer's pickers. */
  sections: string[];
  fields: StandardFieldDef[];
};

/**
 * The merged, effective shape of one field (standard or custom) after
 * applying tenant field_overrides — what the server's /api/settings/
 * field-config route returns and what every rendering component consumes.
 * Rule-derived hidden/required (via applyRules) are computed on TOP of
 * this at render time, since that needs live form values, not just config.
 */
export type EffectiveField = {
  field_key: string;
  label: string;
  widget: WidgetType;
  section: string;
  position: number;
  hidden: boolean;
  required: boolean;
  locked: boolean;
  editable: boolean;
  kind: "standard" | "custom";
  /** custom_fields.id — only set when kind === "custom" (needed to DELETE the definition). */
  id?: string;
  options?: string[];
  selectSource?: SelectSource;
  enumOptions?: { value: string; label: string }[];
  placeholder?: string;
};

export type PilotObjectType =
  | "account" | "contact" | "asset" | "supplier" | "quote"
  | "case" | "work_order" | "invoice" | "purchase_order" | "inventory";

const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] =
  (Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((value) => ({ value, label: ACCOUNT_TYPE_LABEL[value] }));

const ASSET_KIND_OPTIONS: { value: Asset["kind"]; label: string }[] =
  (Object.keys(ASSET_KIND_LABEL) as Asset["kind"][]).map((value) => ({ value, label: ASSET_KIND_LABEL[value] }));

const SUPPLIER_TYPE_OPTIONS: { value: Supplier["type"]; label: string }[] =
  (Object.keys(SUPPLIER_TYPE_LABEL) as Supplier["type"][]).map((value) => ({ value, label: SUPPLIER_TYPE_LABEL[value] }));

const SUPPLIER_STATUS_OPTIONS: { value: Supplier["status"]; label: string }[] =
  (Object.keys(SUPPLIER_STATUS_LABEL) as Supplier["status"][]).map((value) => ({ value, label: SUPPLIER_STATUS_LABEL[value] }));

const QUOTE_TYPE_OPTIONS: { value: QuoteOfferType; label: string }[] =
  (Object.keys(OFFER_TYPE_LABEL) as QuoteOfferType[]).map((value) => ({ value, label: OFFER_TYPE_LABEL[value] }));

const DISCOUNT_TYPE_OPTIONS: { value: "pct" | "fixed"; label: string }[] = [
  { value: "pct",   label: "Percentage" },
  { value: "fixed", label: "Fixed amount" },
];

const CASE_TYPE_OPTIONS: { value: ServiceCase["type"]; label: string }[] =
  (Object.keys(CASE_TYPE_LABEL) as ServiceCase["type"][]).map((value) => ({ value, label: CASE_TYPE_LABEL[value] }));

const CASE_DISPOSITION_OPTIONS: { value: NonNullable<ServiceCase["disposition"]>; label: string }[] = [
  { value: "repair",  label: "Repair" },
  { value: "buyback", label: "Buyback" },
  { value: "scrap",   label: "Scrap" },
];

const INVENTORY_STATUS_OPTIONS: { value: InventoryItem["status"]; label: string }[] =
  (Object.keys(INVENTORY_ITEM_STATUS_LABEL) as InventoryItem["status"][]).map((value) => ({ value, label: INVENTORY_ITEM_STATUS_LABEL[value] }));

const UOM_ENUM_OPTIONS: { value: string; label: string }[] = UOM_OPTIONS.map((u) => ({ value: u, label: u }));

export const FIELD_REGISTRY: Record<PilotObjectType, ObjectFieldRegistry> = {
  account: {
    sections: ["Identity", "Address", "Communication", "Sales", "Business", "Notes"],
    fields: [
      { key: "name", defaultLabel: "Name", widget: "text", defaultSection: "Identity", locked: true },
      { key: "type", defaultLabel: "Type", widget: "enum", defaultSection: "Identity", enumOptions: ACCOUNT_TYPE_OPTIONS },

      { key: "address_line1", defaultLabel: "Address line 1", widget: "text", defaultSection: "Address", placeholder: "Street / building" },
      { key: "address_line2", defaultLabel: "Address line 2", widget: "text", defaultSection: "Address", placeholder: "Area / landmark" },
      { key: "city", defaultLabel: "City", widget: "text", defaultSection: "Address" },
      { key: "state", defaultLabel: "State", widget: "text", defaultSection: "Address" },
      { key: "postal_code", defaultLabel: "Postal code", widget: "text", defaultSection: "Address" },
      { key: "country", defaultLabel: "Country", widget: "text", defaultSection: "Address" },

      { key: "phone", defaultLabel: "Primary phone", widget: "tel", defaultSection: "Communication" },
      { key: "phone2", defaultLabel: "Secondary phone", widget: "tel", defaultSection: "Communication" },
      { key: "email", defaultLabel: "Primary email", widget: "email", defaultSection: "Communication" },
      { key: "email2", defaultLabel: "Secondary email", widget: "email", defaultSection: "Communication" },
      { key: "website", defaultLabel: "Website", widget: "url", defaultSection: "Communication" },

      { key: "territory", defaultLabel: "Territory", widget: "select", defaultSection: "Sales", selectSource: "territory" },
      { key: "sales_org", defaultLabel: "Sales org", widget: "select", defaultSection: "Sales", selectSource: "sales_org" },

      { key: "industry", defaultLabel: "Industry", widget: "text", defaultSection: "Business" },
      { key: "employee_count", defaultLabel: "Employees", widget: "text", defaultSection: "Business" },
      { key: "annual_revenue", defaultLabel: "Annual revenue", widget: "text", defaultSection: "Business" },
      { key: "gstin", defaultLabel: "GSTIN", widget: "text", defaultSection: "Business" },

      { key: "notes", defaultLabel: "Notes", widget: "textarea", defaultSection: "Notes" },

      { key: "referred_by_account_id", defaultLabel: "Referred by", widget: "text", defaultSection: "Business", locked: true, editable: false, hiddenByDefault: true },
      { key: "created_at", defaultLabel: "Created", widget: "date", defaultSection: "Identity", locked: true, editable: false, hiddenByDefault: true },
    ],
  },

  contact: {
    sections: ["Identity", "Phone numbers", "Email & web", "Address", "Sales", "Notes"],
    fields: [
      { key: "name", defaultLabel: "Name", widget: "text", defaultSection: "Identity", locked: true },
      { key: "role", defaultLabel: "Role", widget: "text", defaultSection: "Identity" },
      { key: "department", defaultLabel: "Department", widget: "text", defaultSection: "Identity" },
      { key: "birthday", defaultLabel: "Birthday", widget: "date", defaultSection: "Identity" },
      { key: "linkedin_url", defaultLabel: "LinkedIn", widget: "url", defaultSection: "Identity" },

      { key: "phone", defaultLabel: "Primary", widget: "tel", defaultSection: "Phone numbers" },
      { key: "phone2", defaultLabel: "Secondary", widget: "tel", defaultSection: "Phone numbers" },
      { key: "phone3", defaultLabel: "Third", widget: "tel", defaultSection: "Phone numbers" },

      { key: "email", defaultLabel: "Primary email", widget: "email", defaultSection: "Email & web" },
      { key: "email2", defaultLabel: "Secondary email", widget: "email", defaultSection: "Email & web" },
      { key: "website", defaultLabel: "Website", widget: "url", defaultSection: "Email & web" },

      { key: "address_line1", defaultLabel: "Address line 1", widget: "text", defaultSection: "Address" },
      { key: "address_line2", defaultLabel: "Address line 2", widget: "text", defaultSection: "Address" },
      { key: "city", defaultLabel: "City", widget: "text", defaultSection: "Address" },
      { key: "state", defaultLabel: "State", widget: "text", defaultSection: "Address" },
      { key: "postal_code", defaultLabel: "Postal code", widget: "text", defaultSection: "Address" },
      { key: "country", defaultLabel: "Country", widget: "text", defaultSection: "Address" },

      { key: "territory", defaultLabel: "Territory", widget: "select", defaultSection: "Sales", selectSource: "territory" },
      { key: "sales_org", defaultLabel: "Sales org", widget: "select", defaultSection: "Sales", selectSource: "sales_org" },

      { key: "notes", defaultLabel: "Notes", widget: "textarea", defaultSection: "Notes" },
    ],
  },

  asset: {
    sections: ["Identity", "Specifications", "Nameplate", "Notes"],
    fields: [
      { key: "name", defaultLabel: "Name", widget: "text", defaultSection: "Identity", locked: true },
      { key: "kind", defaultLabel: "Kind", widget: "enum", defaultSection: "Identity", enumOptions: ASSET_KIND_OPTIONS },

      { key: "make", defaultLabel: "Make / Brand", widget: "text", defaultSection: "Specifications" },
      { key: "model", defaultLabel: "Model", widget: "text", defaultSection: "Specifications" },
      { key: "serial", defaultLabel: "Serial no.", widget: "text", defaultSection: "Specifications" },
      { key: "rating", defaultLabel: "Rating / specs", widget: "text", defaultSection: "Specifications" },

      // Motor/generator nameplate spec fields — core product, all tenants (see
      // supabase/migrations/0033_asset_nameplate_fields.sql). Only relevant to
      // rotating equipment, so DEFAULT_FIELD_RULES below hides them by default
      // unless kind === "motor". A tenant can still show them for other kinds
      // via their own field_rules, same as any other rule-driven field.
      { key: "rpm", defaultLabel: "Speed (RPM)", widget: "text", defaultSection: "Nameplate" },
      { key: "frame_type", defaultLabel: "Frame / Type", widget: "text", defaultSection: "Nameplate" },
      { key: "insulation_class", defaultLabel: "Insulation class", widget: "text", defaultSection: "Nameplate" },
      { key: "connection", defaultLabel: "Connection", widget: "text", defaultSection: "Nameplate" },
      { key: "duty", defaultLabel: "Duty", widget: "text", defaultSection: "Nameplate" },
      { key: "ambient_temp", defaultLabel: "Ambient temp.", widget: "text", defaultSection: "Nameplate" },
      { key: "output_kw", defaultLabel: "Output (kW)", widget: "text", defaultSection: "Nameplate" },
      { key: "stator_voltage", defaultLabel: "Stator voltage", widget: "text", defaultSection: "Nameplate" },
      { key: "stator_current", defaultLabel: "Stator current", widget: "text", defaultSection: "Nameplate" },
      { key: "excitation_voltage", defaultLabel: "Excitation voltage", widget: "text", defaultSection: "Nameplate" },
      { key: "excitation_current", defaultLabel: "Excitation current", widget: "text", defaultSection: "Nameplate" },
      { key: "frequency", defaultLabel: "Frequency", widget: "text", defaultSection: "Nameplate" },

      { key: "notes", defaultLabel: "Notes", widget: "textarea", defaultSection: "Notes" },

      // account_id (parent link) and is_loaner/loaner_status (no live loan
      // workflow sets loaner_status today — see FIELD_REGISTRY_ROLLOUT.md)
      // are deliberately excluded, not just hidden.
    ],
  },

  supplier: {
    sections: ["Identity", "Contact", "Notes"],
    fields: [
      { key: "name",   defaultLabel: "Name",   widget: "text", defaultSection: "Identity", locked: true },
      { key: "type",   defaultLabel: "Type",   widget: "enum", defaultSection: "Identity", enumOptions: SUPPLIER_TYPE_OPTIONS },
      { key: "status", defaultLabel: "Status", widget: "enum", defaultSection: "Identity", enumOptions: SUPPLIER_STATUS_OPTIONS },

      { key: "city",   defaultLabel: "City",   widget: "text",  defaultSection: "Contact" },
      { key: "phone",  defaultLabel: "Phone",  widget: "tel",   defaultSection: "Contact" },
      { key: "email",  defaultLabel: "Email",  widget: "email", defaultSection: "Contact" },
      { key: "gstin",  defaultLabel: "GSTIN",  widget: "text",  defaultSection: "Contact" },

      { key: "notes",  defaultLabel: "Notes",  widget: "textarea", defaultSection: "Notes" },
    ],
  },

  quote: {
    sections: ["Identity", "Reference", "Commercial", "Sales", "Notes"],
    fields: [
      // "ref" is already the page's H1 (PageHeader title) — kept here too,
      // locked, so it's visible/renameable-label like every object's identity
      // field, consistent with the rest of the registry.
      { key: "ref",  defaultLabel: "Quote ID", widget: "text", defaultSection: "Identity", locked: true, editable: false },
      { key: "name", defaultLabel: "Name",     widget: "text", defaultSection: "Identity" },
      { key: "type", defaultLabel: "Type",     widget: "enum", defaultSection: "Identity", enumOptions: QUOTE_TYPE_OPTIONS },
      { key: "valid_until", defaultLabel: "Valid until", widget: "date", defaultSection: "Identity" },

      { key: "ref_no", defaultLabel: "Reference no.", widget: "text", defaultSection: "Reference" },
      { key: "pr_no",  defaultLabel: "PR no.",         widget: "text", defaultSection: "Reference" },

      { key: "po_number", defaultLabel: "PO number", widget: "text",   defaultSection: "Commercial" },
      { key: "po_amount", defaultLabel: "PO amount",  widget: "number", defaultSection: "Commercial" },
      // Discount/GST feed the quote's stored `total`, which only the full
      // edit flow (/quotations/[id]/edit) recalculates. Read-only here so an
      // inline edit can't leave `total` stale — same PATCH route also simply
      // doesn't accept these fields.
      { key: "discount_type",  defaultLabel: "Discount type",   widget: "enum",   defaultSection: "Commercial", enumOptions: DISCOUNT_TYPE_OPTIONS, editable: false },
      { key: "discount_pct",   defaultLabel: "Discount %",      widget: "number", defaultSection: "Commercial", editable: false },
      { key: "discount_fixed", defaultLabel: "Discount amount", widget: "number", defaultSection: "Commercial", editable: false },
      { key: "gst_rate",       defaultLabel: "GST %",           widget: "number", defaultSection: "Commercial", editable: false },

      { key: "territory", defaultLabel: "Territory", widget: "select", defaultSection: "Sales", selectSource: "territory" },
      { key: "sales_org", defaultLabel: "Sales org",  widget: "select", defaultSection: "Sales", selectSource: "sales_org" },

      { key: "scope_of_work", defaultLabel: "Scope of work", widget: "textarea", defaultSection: "Notes" },
      { key: "notes",         defaultLabel: "Notes",          widget: "textarea", defaultSection: "Notes" },
      { key: "terms",         defaultLabel: "Terms",          widget: "textarea", defaultSection: "Notes" },

      { key: "created_at", defaultLabel: "Created", widget: "date", defaultSection: "Identity", locked: true, editable: false, hiddenByDefault: true },

      // account_id / contact_id / entity_id (relationship pointers, already
      // shown via dedicated sidebar cards + links) and status / total /
      // revision / asset_ids / business_status / selected_option_id
      // (dedicated UI or computed/internal) are deliberately excluded.
    ],
  },

  case: {
    sections: ["Identity", "Case details", "Sales", "Timeline"],
    fields: [
      { key: "ref",  defaultLabel: "Case ID", widget: "text", defaultSection: "Identity", locked: true, editable: false },
      { key: "type", defaultLabel: "Type",    widget: "enum", defaultSection: "Identity", enumOptions: CASE_TYPE_OPTIONS, editable: false },
      { key: "disposition", defaultLabel: "Disposition", widget: "enum", defaultSection: "Identity", enumOptions: CASE_DISPOSITION_OPTIONS, editable: false },

      { key: "equipment_label", defaultLabel: "Equipment",  widget: "text",     defaultSection: "Case details" },
      { key: "complaint",       defaultLabel: "Complaint",  widget: "textarea", defaultSection: "Case details" },
      { key: "symptom",         defaultLabel: "Symptom",    widget: "textarea", defaultSection: "Case details" },
      { key: "notes",           defaultLabel: "Internal notes", widget: "textarea", defaultSection: "Case details" },

      { key: "territory", defaultLabel: "Territory", widget: "select", defaultSection: "Sales", selectSource: "territory" },
      { key: "sales_org", defaultLabel: "Sales org",  widget: "select", defaultSection: "Sales", selectSource: "sales_org" },

      { key: "intake_at", defaultLabel: "Intake",  widget: "date", defaultSection: "Timeline", locked: true, editable: false, hiddenByDefault: true },
      { key: "closed_at", defaultLabel: "Closed",   widget: "date", defaultSection: "Timeline", locked: true, editable: false, hiddenByDefault: true },

      // account_id / asset_id / assigned_to / quote_id / contract_id /
      // loaner_asset_id / parent_case_id (relationship pointers, all shown
      // via dedicated sidebar cards + links) and status / has_loaner
      // (own stage-stepper UI, driven by CaseActions) are deliberately
      // excluded. asset_ids stays on its own picker in CaseAssetsPanel —
      // a multi-select relationship editor, not a flat field.
    ],
  },

  work_order: {
    sections: ["Identity", "Details"],
    fields: [
      { key: "ref",           defaultLabel: "Work Order ID", widget: "text", defaultSection: "Identity", locked: true, editable: false },
      { key: "scheduled_for", defaultLabel: "Scheduled for", widget: "date", defaultSection: "Identity", editable: false },

      { key: "description", defaultLabel: "Scope of work",      widget: "textarea", defaultSection: "Details" },
      { key: "notes",        defaultLabel: "Technician notes",   widget: "textarea", defaultSection: "Details" },

      // account_id / case_id / asset_id / technician_id (relationship
      // pointers) and authorized_by (a {kind,id} union, not a flat field)
      // and status (own action UI via WorkOrderActions) are excluded.
    ],
  },

  invoice: {
    sections: ["Identity", "Commercial", "Notes"],
    fields: [
      { key: "ref",       defaultLabel: "Invoice ID", widget: "text", defaultSection: "Identity", locked: true, editable: false },
      { key: "due_date",  defaultLabel: "Due date",    widget: "date", defaultSection: "Identity" },
      { key: "issued_at", defaultLabel: "Issued",      widget: "date", defaultSection: "Identity", locked: true, editable: false, hiddenByDefault: true },
      { key: "created_at", defaultLabel: "Created",    widget: "date", defaultSection: "Identity", locked: true, editable: false, hiddenByDefault: true },

      // Same reasoning as quote: these feed the stored `total`, which only
      // dedicated flows (creation, payment recording) recalculate.
      { key: "discount_type",  defaultLabel: "Discount type",   widget: "enum",   defaultSection: "Commercial", enumOptions: DISCOUNT_TYPE_OPTIONS, editable: false },
      { key: "discount_pct",   defaultLabel: "Discount %",      widget: "number", defaultSection: "Commercial", editable: false },
      { key: "discount_fixed", defaultLabel: "Discount amount", widget: "number", defaultSection: "Commercial", editable: false },

      { key: "notes", defaultLabel: "Notes", widget: "textarea", defaultSection: "Notes" },
      { key: "terms", defaultLabel: "Terms", widget: "textarea", defaultSection: "Notes" },

      // account_id / contact_id / work_order_id / quote_id / case_id /
      // contract_id / entity_id (relationship pointers, shown via
      // dedicated sidebar links) and status / total / paid_amount /
      // created_by (own status buttons + RecordPaymentPanel, or
      // computed/internal) are excluded.
    ],
  },

  purchase_order: {
    sections: ["Identity", "Notes"],
    fields: [
      { key: "ref",           defaultLabel: "PO ID",      widget: "text", defaultSection: "Identity", locked: true, editable: false },
      { key: "order_date",    defaultLabel: "Order date",  widget: "date", defaultSection: "Identity" },
      { key: "expected_date", defaultLabel: "Expected delivery", widget: "date", defaultSection: "Identity" },
      { key: "created_at",    defaultLabel: "Created",     widget: "date", defaultSection: "Identity", locked: true, editable: false, hiddenByDefault: true },

      { key: "notes", defaultLabel: "Notes", widget: "textarea", defaultSection: "Notes" },
      { key: "terms", defaultLabel: "Terms", widget: "textarea", defaultSection: "Notes" },

      // supplier_id / quote_id / case_id (relationship pointers, shown via
      // dedicated sidebar links) and status / total / created_by (own
      // status buttons + ReceivePanel, or computed/internal) are excluded.
    ],
  },

  inventory: {
    sections: ["Identity", "Stock", "Notes"],
    fields: [
      { key: "name",     defaultLabel: "Name",     widget: "text", defaultSection: "Identity", locked: true },
      { key: "sku",      defaultLabel: "SKU",      widget: "text", defaultSection: "Identity" },
      { key: "category", defaultLabel: "Category", widget: "text", defaultSection: "Identity" },
      { key: "status",   defaultLabel: "Status",   widget: "enum", defaultSection: "Identity", enumOptions: INVENTORY_STATUS_OPTIONS },

      { key: "uom",           defaultLabel: "UOM",           widget: "enum",   defaultSection: "Stock", enumOptions: UOM_ENUM_OPTIONS },
      { key: "reorder_level", defaultLabel: "Reorder level", widget: "number", defaultSection: "Stock" },
      { key: "unit_cost",     defaultLabel: "Unit cost",     widget: "number", defaultSection: "Stock" },

      { key: "description", defaultLabel: "Description", widget: "textarea", defaultSection: "Notes" },
      { key: "notes",        defaultLabel: "Notes",       widget: "textarea", defaultSection: "Notes" },

      // supplier_id kept on its own picker in InventorySupplierPanel (no
      // "reference"/lookup widget type exists yet — see
      // FIELD_REGISTRY_ROLLOUT.md). qty_on_hand is excluded: it's a
      // derived running balance from InventoryTransaction rows, changed
      // only via AdjustStockPanel, never a free-edit field.
    ],
  },
};

/** Fields hidden unless the record's kind matches — see the Nameplate section above. */
const ASSET_NAMEPLATE_FIELD_KEYS = [
  "rpm", "frame_type", "insulation_class", "connection", "duty", "ambient_temp",
  "output_kw", "stator_voltage", "stator_current", "excitation_voltage",
  "excitation_current", "frequency",
] as const;

/**
 * Code-level default field_rules — universal across every tenant (current and
 * future) because they're a source-code constant, not a tenant-scoped DB row.
 * Merged into the rules array served by /api/settings/field-config, ahead of
 * any tenant-authored field_rules (which can still override them).
 */
export const DEFAULT_FIELD_RULES: Partial<Record<PilotObjectType, FieldRule[]>> = {
  asset: ASSET_NAMEPLATE_FIELD_KEYS.map((key, i) => ({
    id: `default:asset:${key}:motor_only`,
    object_type: "asset",
    target_field_key: key,
    effect: "hide",
    conditions: { type: "condition", field_key: "kind", operator: "not_equals", value: "motor" },
    is_active: true,
    position: 1000 + i, // after any tenant rule at the default position
  })),
};

const PILOT_OBJECT_TYPES: readonly PilotObjectType[] = [
  "account", "contact", "asset", "supplier", "quote",
  "case", "work_order", "invoice", "purchase_order", "inventory",
];

export function isPilotObjectType(objectType: string): objectType is PilotObjectType {
  return (PILOT_OBJECT_TYPES as readonly string[]).includes(objectType);
}

// ── Rule condition tree ──────────────────────────────────────────────────────

export type ConditionOperator =
  | "equals" | "not_equals"
  | "contains" | "not_contains"
  | "is_empty" | "is_not_empty"
  | "in" | "not_in";

export type FieldCondition = {
  type: "condition";
  /** Another field on the SAME object (standard registry key or custom cf_ key). */
  field_key: string;
  operator: ConditionOperator;
  /** Omitted for is_empty / is_not_empty. */
  value?: string | number | boolean | (string | number)[] | null;
};

export type ConditionGroup = {
  type: "group";
  logic: "AND" | "OR";
  children: ConditionNode[];
};

export type ConditionNode = FieldCondition | ConditionGroup;

export type FieldRuleEffect = "hide" | "show" | "require" | "optional";

export type FieldRule = {
  id: string;
  object_type: string;
  target_field_key: string;
  effect: FieldRuleEffect;
  conditions: ConditionNode;
  is_active: boolean;
  position: number;
};

const CONDITION_OPERATORS: readonly ConditionOperator[] =
  ["equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty", "in", "not_in"];

/** Structural validator for a ConditionNode tree coming from an API request body (untyped JSON). */
export function isValidConditionNode(node: unknown): node is ConditionNode {
  if (typeof node !== "object" || node === null) return false;
  const n = node as Record<string, unknown>;
  if (n.type === "condition") {
    return typeof n.field_key === "string" && n.field_key.length > 0
      && typeof n.operator === "string" && CONDITION_OPERATORS.includes(n.operator as ConditionOperator);
  }
  if (n.type === "group") {
    return (n.logic === "AND" || n.logic === "OR")
      && Array.isArray(n.children) && n.children.length > 0
      && n.children.every(isValidConditionNode);
  }
  return false;
}

/** Pure, side-effect-free — safe to run identically on server and client. */
export function evaluateConditionNode(node: ConditionNode, values: Record<string, unknown>): boolean {
  if (node.type === "group") {
    const results = node.children.map((child) => evaluateConditionNode(child, values));
    return node.logic === "AND" ? results.every(Boolean) : results.some(Boolean);
  }
  const actual = values[node.field_key];
  switch (node.operator) {
    case "equals": return String(actual ?? "") === String(node.value ?? "");
    case "not_equals": return String(actual ?? "") !== String(node.value ?? "");
    case "contains": return String(actual ?? "").toLowerCase().includes(String(node.value ?? "").toLowerCase());
    case "not_contains": return !String(actual ?? "").toLowerCase().includes(String(node.value ?? "").toLowerCase());
    case "is_empty": return actual === null || actual === undefined || actual === "";
    case "is_not_empty": return !(actual === null || actual === undefined || actual === "");
    case "in": return Array.isArray(node.value) && node.value.map(String).includes(String(actual ?? ""));
    case "not_in": return Array.isArray(node.value) && !node.value.map(String).includes(String(actual ?? ""));
    default: {
      const _exhaustive: never = node.operator;
      return _exhaustive;
    }
  }
}

/**
 * Evaluation precedence per field (SAP C4C convention: hide wins over show,
 * require wins over optional — the safer outcome always wins so a
 * misconfigured rule fails closed, not open):
 *   1. Start from the field's base hidden/required state (registry default
 *      + field_overrides.is_hidden / custom_fields.is_required).
 *   2. Any ACTIVE matching rule with effect 'hide'     -> hidden = true  (wins over 'show').
 *   3. Any ACTIVE matching rule with effect 'show'     -> hidden = false, unless a hide-rule also matched.
 *   4. Any ACTIVE matching rule with effect 'require'  -> required = true (wins over 'optional').
 *   5. Any ACTIVE matching rule with effect 'optional' -> required = false, unless a require-rule also matched.
 */
export function applyRules(
  rules: FieldRule[],
  fieldKey: string,
  baseHidden: boolean,
  baseRequired: boolean,
  values: Record<string, unknown>,
): { hidden: boolean; required: boolean } {
  let hideMatched = false;
  let showMatched = false;
  let requireMatched = false;
  let optionalMatched = false;

  for (const rule of rules) {
    if (!rule.is_active || rule.target_field_key !== fieldKey) continue;
    if (!evaluateConditionNode(rule.conditions, values)) continue;
    if (rule.effect === "hide") hideMatched = true;
    if (rule.effect === "show") showMatched = true;
    if (rule.effect === "require") requireMatched = true;
    if (rule.effect === "optional") optionalMatched = true;
  }

  return {
    hidden: hideMatched ? true : showMatched ? false : baseHidden,
    required: requireMatched ? true : optionalMatched ? false : baseRequired,
  };
}
