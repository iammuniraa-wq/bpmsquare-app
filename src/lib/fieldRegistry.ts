// Import from the client-safe labels mirror, not "@/lib/data" (the barrel
// re-exports server-only live.ts data functions, which would otherwise leak
// into every client component that imports this registry).
import {
  ACCOUNT_TYPE_LABEL, ASSET_KIND_LABEL, SUPPLIER_TYPE_LABEL, SUPPLIER_STATUS_LABEL,
  CASE_TYPE_LABEL, INVENTORY_ITEM_STATUS_LABEL,
} from "@/lib/data/labels";
import { UOM_OPTIONS, OFFER_TYPE_LABEL, type TenantFeatures } from "@/lib/constants";
import { QTY_BREAKS_FORMAT } from "@/lib/products/qtyBreaks";
import type { AccountType, Asset, Supplier, ServiceCase, InventoryItem, QuoteOfferType } from "@/lib/types";

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

// product_category / product_sub_category resolve via useSalesConfig(); product_item_type is resolved
// on the server (getEffectiveFieldConfig puts the tenant's types into enumOptions).
export type SelectSource = "product_category" | "product_sub_category" | "product_item_type";

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
  /** Data Workbench: exported as a column, but stripped from Import/Update templates (system-computed). */
  exportOnly?: boolean;
  /** widget === "select" only */
  selectSource?: SelectSource;
  /** widget === "enum" only */
  enumOptions?: { value: string; label: string }[];
  placeholder?: string;
  /** What the cell holds and how it is written -- shown as the Data Workbench column hint. */
  description?: string;
  /** A sample value for the Data Workbench template (otherwise a generic one is made up). */
  example?: string;
  /**
   * The field exists only for a workspace that has this (platform-admin) feature on, and only while the
   * database has the column. Used by preferred_language (0143) so a workspace without the Newsletter
   * Studio sees no new field on its forms, exports or imports. See getEffectiveFieldConfig().
   */
  requiresFeature?: keyof TenantFeatures;
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
  exportOnly?: boolean;
  kind: "standard" | "custom";
  /** custom_fields.id — only set when kind === "custom" (needed to DELETE the definition). */
  id?: string;
  options?: string[];
  selectSource?: SelectSource;
  enumOptions?: { value: string; label: string }[];
  placeholder?: string;
  description?: string;
  example?: string;
};

export type PilotObjectType =
  | "account" | "contact" | "asset" | "supplier"
  | "case" | "work_order" | "quote" | "invoice" | "purchase_order" | "inventory"
  | "employee" | "product" | "project" | "opportunity" | "rfq" | "estimate" | "process_study" | "newsletter" | "abm_program" | "abm_target" | "abm_member";

// ISO 639-1 codes the Newsletter Studio can write in (src/lib/newsletter/types.ts LANGUAGES); duplicated as data
// here because this registry is imported by client code and must not pull the studio in.
const PREFERRED_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "en", label: "English" }, { value: "ar", label: "Arabic" }, { value: "hi", label: "Hindi" }, { value: "ur", label: "Urdu" }, { value: "fr", label: "French" },
];

const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] =
  (Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((value) => ({ value, label: ACCOUNT_TYPE_LABEL[value] }));

const ASSET_KIND_OPTIONS: { value: Asset["kind"]; label: string }[] =
  (Object.keys(ASSET_KIND_LABEL) as Asset["kind"][]).map((value) => ({ value, label: ASSET_KIND_LABEL[value] }));

const SUPPLIER_TYPE_OPTIONS: { value: Supplier["type"]; label: string }[] =
  (Object.keys(SUPPLIER_TYPE_LABEL) as Supplier["type"][]).map((value) => ({ value, label: SUPPLIER_TYPE_LABEL[value] }));

const SUPPLIER_STATUS_OPTIONS: { value: Supplier["status"]; label: string }[] =
  (Object.keys(SUPPLIER_STATUS_LABEL) as Supplier["status"][]).map((value) => ({ value, label: SUPPLIER_STATUS_LABEL[value] }));

const PRODUCT_STATUS_OPTIONS: { value: "active" | "inactive"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const DISCOUNT_TYPE_OPTIONS: { value: "pct" | "fixed"; label: string }[] = [
  { value: "pct",   label: "Percentage" },
  { value: "fixed", label: "Fixed amount" },
];

const QUOTE_TYPE_OPTIONS: { value: QuoteOfferType; label: string }[] =
  (Object.keys(OFFER_TYPE_LABEL) as QuoteOfferType[]).map((value) => ({ value, label: OFFER_TYPE_LABEL[value] }));

const QUOTE_BUSINESS_STATUS_OPTIONS: { value: "pending" | "po_received"; label: string }[] = [
  { value: "pending",     label: "Pending" },
  { value: "po_received", label: "PO received" },
];

const QUOTE_OUTCOME_OPTIONS: { value: "open" | "won" | "lost" | "dropped"; label: string }[] = [
  { value: "open",    label: "Open" },
  { value: "won",     label: "Won" },
  { value: "lost",    label: "Lost" },
  { value: "dropped", label: "Dropped" },
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
      { key: "ref", defaultLabel: "Account ID", widget: "text", defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
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
      { key: "preferred_language", defaultLabel: "Preferred language", widget: "enum", defaultSection: "Communication", enumOptions: PREFERRED_LANGUAGE_OPTIONS, requiresFeature: "newsletter_studio" },

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
      { key: "ref", defaultLabel: "Contact ID", widget: "text", defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
      { key: "name", defaultLabel: "Name", widget: "text", defaultSection: "Identity", locked: true },
      { key: "role", defaultLabel: "Role", widget: "text", defaultSection: "Identity" },
      { key: "department", defaultLabel: "Department", widget: "text", defaultSection: "Identity" },
      { key: "birthday", defaultLabel: "Birthday", widget: "date", defaultSection: "Identity" },
      { key: "linkedin_url", defaultLabel: "LinkedIn", widget: "url", defaultSection: "Identity" },
      { key: "preferred_language", defaultLabel: "Preferred language", widget: "enum", defaultSection: "Identity", enumOptions: PREFERRED_LANGUAGE_OPTIONS, requiresFeature: "newsletter_studio" },

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

      { key: "notes", defaultLabel: "Notes", widget: "textarea", defaultSection: "Notes" },
    ],
  },

  asset: {
    sections: ["Identity", "Specifications", "Nameplate", "Notes"],
    fields: [
      { key: "ref", defaultLabel: "Asset ID", widget: "text", defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
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
      { key: "ref", defaultLabel: "Supplier ID", widget: "text", defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
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

  product: {
    sections: ["Identity", "Pricing", "Details"],
    fields: [
      { key: "ref",    defaultLabel: "Product ID", widget: "text", defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
      { key: "name",   defaultLabel: "Name",     widget: "text", defaultSection: "Identity", locked: true },
      { key: "sku",    defaultLabel: "SKU",      widget: "text", defaultSection: "Identity" },
      // Category values come from the tenant's own two-level tree
      // (Settings -> Sales config -> Product categories), not free text.
      { key: "category",     defaultLabel: "Category",     widget: "select", defaultSection: "Identity", selectSource: "product_category" },
      { key: "sub_category", defaultLabel: "Sub-category", widget: "select", defaultSection: "Identity", selectSource: "product_sub_category" },
      { key: "status", defaultLabel: "Status",   widget: "enum", defaultSection: "Identity", enumOptions: PRODUCT_STATUS_OPTIONS },
      // Item type (0133): the options are the tenant's own list (Settings -> Item types),
      // filled in server-side; the stored value is the type KEY. Empty = unclassified.
      { key: "item_type", defaultLabel: "Item type", widget: "select", defaultSection: "Identity", selectSource: "product_item_type" },

      { key: "list_price",  defaultLabel: "List price", widget: "number", defaultSection: "Pricing" },
      { key: "cost_price",  defaultLabel: "Cost price", widget: "number", defaultSection: "Pricing" },
      // When the cost price was last confirmed (0113): BPMSquare Pricing's
      // source ladder treats a stale figure as unusable, never as current.
      { key: "cost_price_as_of", defaultLabel: "Cost price as of", widget: "date", defaultSection: "Pricing" },
      { key: "tax_percent", defaultLabel: "Tax %",          widget: "number", defaultSection: "Pricing" },
      // The product's price-list scales (0118): bands above the list price, replicated from
      // the ERP or kept here, read by the pricing engine. One text cell so Data Workbench
      // moves a price list with its scales. Edited in the product page's own card, so the
      // generic sections exclude it there.
      {
        key: "qty_breaks", defaultLabel: "Quantity breaks", widget: "text", defaultSection: "Pricing",
        description: QTY_BREAKS_FORMAT, example: "100:390; 500:360", placeholder: "100:390; 500:360",
      },

      { key: "uom",        defaultLabel: "Unit of measure", widget: "text",     defaultSection: "Details" },
      { key: "description", defaultLabel: "Description",     widget: "textarea", defaultSection: "Details" },

      // Preferred supplier (0132). There is no "reference/lookup" widget yet
      // (same gap InventorySupplierPanel documents), so the editable control
      // is a dedicated picker (ProductSupplierPanel) and Data Workbench
      // resolves the supplier by NAME through REFERENCE_FIELDS. What the
      // registry carries is the real id as an export-only column -- the
      // contract a later Update or integration keys off, never the name.
      { key: "supplier_id", defaultLabel: "Supplier ID", widget: "text", defaultSection: "Details", locked: true, editable: false, exportOnly: true },
    ],
  },

  // Opportunity / deal (0120). Stage values come from the tenant's own
  // stage list; amount and probability are computed (§4.4) -- export-only.
  // team and probability_override_reason are internal, managed on the deal
  // screen, not fields a form or an import edits directly.
  opportunity: {
    sections: ["Deal", "Customer", "Forecast", "Ownership"],
    fields: [
      { key: "ref",    defaultLabel: "Deal ID", widget: "text", defaultSection: "Deal", locked: true, editable: false, exportOnly: true },
      { key: "title",  defaultLabel: "Title",   widget: "text", defaultSection: "Deal", locked: true },
      { key: "description", defaultLabel: "Description", widget: "textarea", defaultSection: "Deal" },
      { key: "stage",  defaultLabel: "Stage",   widget: "text", defaultSection: "Deal", locked: true },
      { key: "source", defaultLabel: "Source",  widget: "enum", defaultSection: "Deal", enumOptions: [
        { value: "lead", label: "Lead" }, { value: "campaign", label: "Campaign" }, { value: "direct", label: "Direct" },
        { value: "referral", label: "Referral" }, { value: "other", label: "Other" },
      ] },
      { key: "competitor", defaultLabel: "Competitor", widget: "text", defaultSection: "Customer" },
      { key: "expected_close", defaultLabel: "Expected close", widget: "date", defaultSection: "Forecast" },
      { key: "amount",      defaultLabel: "Amount",        widget: "number", defaultSection: "Forecast", locked: true, editable: false, exportOnly: true },
      { key: "probability", defaultLabel: "Probability %", widget: "number", defaultSection: "Forecast", locked: true, editable: false, exportOnly: true },
      { key: "outcome", defaultLabel: "Outcome", widget: "enum", defaultSection: "Forecast", locked: true, enumOptions: [
        { value: "open", label: "Open" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "dropped", label: "Dropped" },
      ] },
      { key: "loss_reason", defaultLabel: "Loss reason", widget: "enum", defaultSection: "Forecast", enumOptions: [
        { value: "price", label: "Price too high" }, { value: "silent", label: "Went silent" }, { value: "competitor", label: "Chose competitor" },
        { value: "budget", label: "Budget cut" }, { value: "timing", label: "Bad timing" }, { value: "other", label: "Other" },
      ] },
      { key: "loss_note", defaultLabel: "Loss note", widget: "textarea", defaultSection: "Forecast" },
      { key: "currency", defaultLabel: "Currency", widget: "text", defaultSection: "Ownership" },
    ],
  },

  // RFQ (0128). Lines, suppliers and replies are structure managed on the
  // RFQ screen -- only the header is a form. Status and origin are set by
  // the flow, never typed.
  rfq: {
    sections: ["Request", "Timing", "Notes"],
    fields: [
      { key: "ref",    defaultLabel: "RFQ ID", widget: "text", defaultSection: "Request", locked: true, editable: false, exportOnly: true },
      { key: "title",  defaultLabel: "Title",  widget: "text", defaultSection: "Request", locked: true },
      { key: "status", defaultLabel: "Status", widget: "enum", defaultSection: "Request", locked: true, editable: false, exportOnly: true, enumOptions: [
        { value: "draft", label: "Draft" }, { value: "sent", label: "Sent" }, { value: "partially_replied", label: "Partly replied" },
        { value: "replied", label: "All replied" }, { value: "awarded", label: "Awarded" }, { value: "closed", label: "Closed" }, { value: "cancelled", label: "Cancelled" },
      ] },
      { key: "origin_label", defaultLabel: "Raised from", widget: "text", defaultSection: "Request", locked: true, editable: false, exportOnly: true },
      { key: "delivery_terms", defaultLabel: "Delivery terms", widget: "text", defaultSection: "Request" },
      { key: "currency", defaultLabel: "Preferred currency", widget: "text", defaultSection: "Request" },
      { key: "respond_by", defaultLabel: "Reply by", widget: "date", defaultSection: "Timing" },
      { key: "required_by", defaultLabel: "Needed by", widget: "date", defaultSection: "Timing" },
      { key: "notes_to_supplier", defaultLabel: "Note to suppliers", widget: "textarea", defaultSection: "Notes" },
      { key: "notes_internal", defaultLabel: "Internal note", widget: "textarea", defaultSection: "Notes" },
    ],
  },

  // Estimate (0131, docs/estimator-architecture.md). Header only: the template,
  // its input values, the computed lines and the totals are managed by the
  // estimator screens and routes, never typed into a generic form. Account and
  // contact are chosen on the screen and resolved by name on import.
  estimate: {
    sections: ["Estimate", "Pricing", "Notes"],
    fields: [
      { key: "ref",    defaultLabel: "Estimate ID", widget: "text", defaultSection: "Estimate", locked: true, editable: false, exportOnly: true },
      { key: "name",   defaultLabel: "Name",        widget: "text", defaultSection: "Estimate", locked: true },
      { key: "status", defaultLabel: "Status",      widget: "enum", defaultSection: "Estimate", enumOptions: [
        { value: "draft", label: "Draft" }, { value: "quoted", label: "Quoted" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" },
      ] },
      { key: "currency",   defaultLabel: "Currency",     widget: "text",   defaultSection: "Pricing" },
      { key: "margin_pct", defaultLabel: "Margin %",     widget: "number", defaultSection: "Pricing" },
      { key: "notes",      defaultLabel: "Notes",        widget: "textarea", defaultSection: "Notes" },
    ],
  },

  // Process study (0152, docs/process-design-studio-architecture.md). Header only:
  // the conversation, map, fit report, changes and plan are produced by the studio
  // screens, never typed into a generic form. Contact details are entered on the
  // Talk to us step (the email is encrypted there), so they are not registry fields.
  process_study: {
    sections: ["Study"],
    fields: [
      { key: "ref",    defaultLabel: "Study ID", widget: "text", defaultSection: "Study", locked: true, editable: false, exportOnly: true },
      { key: "name",   defaultLabel: "Name",     widget: "text", defaultSection: "Study", locked: true },
      { key: "status", defaultLabel: "Status",   widget: "enum", defaultSection: "Study", locked: true, editable: false, exportOnly: true, enumOptions: [
        { value: "telling", label: "Telling us" }, { value: "mapped", label: "Mapped" }, { value: "fit_ready", label: "Fit ready" },
        { value: "changes_ready", label: "Changes ready" }, { value: "plan_ready", label: "Plan ready" }, { value: "submitted", label: "Sent to BPMSquare" },
        { value: "reviewed", label: "Reviewed" }, { value: "accepted", label: "Accepted" }, { value: "rescoped", label: "Re-scoped" }, { value: "closed", label: "Closed" },
      ] },
      { key: "plan_start_date", defaultLabel: "Plan start date", widget: "date", defaultSection: "Study" },
    ],
  },

  // Newsletter (0141, docs/newsletter-studio-architecture.md section 8). Header
  // only: the blocks and the words per language are a document, edited in the
  // studio, never a generic form (same reason an estimate's lines are not fields).
  newsletter: {
    sections: ["Newsletter"],
    fields: [
      { key: "ref",      defaultLabel: "Newsletter ID", widget: "text", defaultSection: "Newsletter", locked: true, editable: false, exportOnly: true },
      { key: "name",     defaultLabel: "Name",          widget: "text", defaultSection: "Newsletter", locked: true },
      { key: "category", defaultLabel: "Category",      widget: "enum", defaultSection: "Newsletter", enumOptions: [
        { value: "Newsletter", label: "Newsletter" }, { value: "Offer", label: "Offer" }, { value: "Event", label: "Event" },
        { value: "Announcement", label: "Announcement" }, { value: "Festival", label: "Festival" },
      ] },
      { key: "status",   defaultLabel: "Status",        widget: "enum", defaultSection: "Newsletter", locked: true, editable: false, exportOnly: true, enumOptions: [
        { value: "draft", label: "Draft" }, { value: "ready", label: "Ready to use" }, { value: "archived", label: "Archived" },
      ] },
      { key: "source_language", defaultLabel: "Written first in", widget: "text", defaultSection: "Newsletter", locked: true, editable: false, exportOnly: true },
    ],
  },

  // ABM (0180-0182, docs/abm-architecture.md section 11). Program: the goal and
  // the window. Target: one company in one program -- progress is rule-derived
  // (an override needs a reason, so it is changed on the screen, not by a form
  // or a bulk update). Member: a person's role in one target's buying group.
  abm_program: {
    sections: ["Program", "Goal", "Window"],
    fields: [
      { key: "ref",  defaultLabel: "Program ID", widget: "text", defaultSection: "Program", locked: true, editable: false, exportOnly: true },
      { key: "name", defaultLabel: "Name",       widget: "text", defaultSection: "Program", locked: true },
      { key: "kind", defaultLabel: "Kind",       widget: "enum", defaultSection: "Program", enumOptions: [
        { value: "new_business", label: "New business" }, { value: "expansion", label: "Expansion" },
      ] },
      { key: "status", defaultLabel: "Status", widget: "enum", defaultSection: "Program", enumOptions: [
        { value: "draft", label: "Draft" }, { value: "active", label: "Live" }, { value: "paused", label: "Paused" },
        { value: "completed", label: "Done" }, { value: "archived", label: "Archived" },
      ] },
      { key: "default_tier", defaultLabel: "Default tier", widget: "enum", defaultSection: "Program", enumOptions: [
        { value: "one_to_one", label: "1:1" }, { value: "one_to_few", label: "1:few" }, { value: "one_to_many", label: "1:many" },
      ] },
      { key: "goal",        defaultLabel: "Goal",        widget: "textarea", defaultSection: "Goal" },
      { key: "goal_metric", defaultLabel: "Goal is measured in", widget: "enum", defaultSection: "Goal", enumOptions: [
        { value: "deals_won", label: "Deals won" }, { value: "deals_opened", label: "Deals opened" },
        { value: "accounts_engaged", label: "Accounts engaged" }, { value: "revenue", label: "Revenue" },
      ] },
      { key: "goal_target", defaultLabel: "Goal target", widget: "number", defaultSection: "Goal" },
      { key: "starts_on", defaultLabel: "Starts on", widget: "date", defaultSection: "Window" },
      { key: "ends_on",   defaultLabel: "Ends on",   widget: "date", defaultSection: "Window" },
    ],
  },
  abm_target: {
    sections: ["Target", "Next step"],
    fields: [
      { key: "program_ref",  defaultLabel: "Program",  widget: "text", defaultSection: "Target", locked: true, editable: false, exportOnly: true },
      { key: "tier", defaultLabel: "Tier", widget: "enum", defaultSection: "Target", enumOptions: [
        { value: "one_to_one", label: "1:1" }, { value: "one_to_few", label: "1:few" }, { value: "one_to_many", label: "1:many" },
      ] },
      { key: "progress", defaultLabel: "Progress", widget: "enum", defaultSection: "Target", locked: true, editable: false, exportOnly: true, enumOptions: [
        { value: "planned", label: "Planned" }, { value: "reached", label: "Reached" }, { value: "engaged", label: "Responding" },
        { value: "in_talks", label: "In talks" }, { value: "deal_open", label: "Deal open" }, { value: "won", label: "Won" },
        { value: "lost", label: "Lost" }, { value: "dropped", label: "Dropped" },
      ] },
      { key: "next_step",     defaultLabel: "Next step", widget: "text", defaultSection: "Next step" },
      { key: "next_step_due", defaultLabel: "Due on",    widget: "date", defaultSection: "Next step" },
    ],
  },
  abm_member: {
    sections: ["Person"],
    fields: [
      { key: "program_ref",  defaultLabel: "Program",   widget: "text", defaultSection: "Person", locked: true, editable: false, exportOnly: true },
      { key: "role", defaultLabel: "Role", widget: "enum", defaultSection: "Person", enumOptions: [
        { value: "decision_maker", label: "Decision maker" }, { value: "influencer", label: "Influencer" },
        { value: "user", label: "User" }, { value: "blocker", label: "Blocker" }, { value: "unknown", label: "Unknown" },
      ] },
    ],
  },

  // Workforce project (project costing). parent_id and the linked people /
  // shifts / sites are structure, managed on the project screens and the
  // roster -- not fields a form or an import edits directly.
  project: {
    sections: ["Identity", "Schedule", "Details"],
    fields: [
      { key: "ref",    defaultLabel: "Project ID", widget: "text", defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
      { key: "name",   defaultLabel: "Name",       widget: "text", defaultSection: "Identity", locked: true },
      { key: "code",   defaultLabel: "Contract / PO number", widget: "text", defaultSection: "Identity" },
      { key: "status", defaultLabel: "Status",     widget: "enum", defaultSection: "Identity", enumOptions: [
        { value: "planned", label: "Planned" }, { value: "active", label: "Active" }, { value: "on_hold", label: "On hold" },
        { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" },
      ] },
      { key: "start_date",   defaultLabel: "Runs from",    widget: "date",   defaultSection: "Schedule" },
      { key: "end_date",     defaultLabel: "Until",        widget: "date",   defaultSection: "Schedule" },
      { key: "budget_hours", defaultLabel: "Budget hours", widget: "number", defaultSection: "Schedule" },
      { key: "bill_rate",    defaultLabel: "Bill rate per hour", widget: "number", defaultSection: "Details" },
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

  quote: {
    sections: ["Identity", "Commercial", "Sales", "Notes"],
    fields: [
      { key: "ref",         defaultLabel: "Quote ID",     widget: "text",   defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
      { key: "type",        defaultLabel: "Offer type",   widget: "enum",   defaultSection: "Identity", enumOptions: QUOTE_TYPE_OPTIONS },
      // Read-only business state -- exported for reporting, never settable
      // via Import (the import flow computes status/total/revision itself)
      // or bulk Update (own action UI / dedicated flows).
      { key: "status",          defaultLabel: "Status",          widget: "text",   defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
      { key: "business_status", defaultLabel: "Business status", widget: "enum",   defaultSection: "Identity", enumOptions: QUOTE_BUSINESS_STATUS_OPTIONS, locked: true, editable: false, exportOnly: true },
      { key: "outcome",         defaultLabel: "Outcome",         widget: "enum",   defaultSection: "Identity", enumOptions: QUOTE_OUTCOME_OPTIONS, locked: true, editable: false, exportOnly: true },
      { key: "total",           defaultLabel: "Total",           widget: "number", defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
      { key: "revision",        defaultLabel: "Revision",        widget: "number", defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
      { key: "created_at",      defaultLabel: "Created",         widget: "date",   defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
      // The business/document date (settable in QuoteForm, defaults to
      // today) -- distinct from created_at above, which is the immutable DB
      // insert timestamp. This is what the list's own "Date" column actually
      // shows (quote_date ?? created_at), so it needs to be filterable
      // separately or "Created" silently filters the wrong date entirely.
      { key: "quote_date",  defaultLabel: "Quote date",   widget: "date",   defaultSection: "Identity" },
      { key: "valid_until", defaultLabel: "Valid until",  widget: "date",   defaultSection: "Identity" },
      { key: "ref_no",      defaultLabel: "Customer ref", widget: "text",   defaultSection: "Identity" },
      { key: "pr_no",       defaultLabel: "PR number",    widget: "text",   defaultSection: "Identity" },

      { key: "po_number",   defaultLabel: "PO number",    widget: "text",   defaultSection: "Commercial" },
      { key: "po_amount",   defaultLabel: "PO amount",    widget: "number", defaultSection: "Commercial" },
      // These feed the stored `total`, which only the quote form's own
      // dedicated flow recalculates -- visible/exportable, never bulk-edited.
      { key: "discount_type",  defaultLabel: "Discount type",   widget: "enum",   defaultSection: "Commercial", enumOptions: DISCOUNT_TYPE_OPTIONS, editable: false },
      { key: "discount_pct",   defaultLabel: "Discount %",      widget: "number", defaultSection: "Commercial", editable: false },
      { key: "discount_fixed", defaultLabel: "Discount amount", widget: "number", defaultSection: "Commercial", editable: false },
      { key: "gst_rate",       defaultLabel: "GST rate %",      widget: "number", defaultSection: "Commercial", editable: false },

      { key: "scope_of_work", defaultLabel: "Scope of work", widget: "textarea", defaultSection: "Notes" },
      { key: "notes",         defaultLabel: "Notes",         widget: "textarea", defaultSection: "Notes" },
      { key: "terms",         defaultLabel: "Terms",         widget: "textarea", defaultSection: "Notes" },

      // name (the workbench's quote_name group field owns naming there; the
      // form's own header edits it) and account_id/contact_id/entity_id/
      // asset_ids/selected_option_id/meta (relationship pointers or
      // internal) are excluded. Line items are fixed columns in
      // registrySchema.ts (QUOTE_LINE_FIELDS), never registry fields.
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
      { key: "ref", defaultLabel: "Item ID", widget: "text", defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
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

  // Employees joined the custom-fields family late (2026-08-18, first
  // requested by a WFM-only tenant for HR master data). The standard
  // fields below are all hand-rendered by the existing Employee surfaces
  // (Employee Hub, Employees master) — those surfaces mount ObjectSections
  // with these keys EXCLUDED, so in practice this entry's job is to let
  // tenant custom fields (cf_*) attach to the object. WFM-operational
  // fields (shift/site/supervisor/wfm_role) stay off the registry: they
  // have dedicated pickers and side effects.
  employee: {
    sections: ["Identity", "Contact", "Employment", "Custom fields"],
    fields: [
      { key: "employee_code", defaultLabel: "Employee code", widget: "text", defaultSection: "Identity", locked: true, editable: false, exportOnly: true },
      { key: "first_name", defaultLabel: "First name", widget: "text", defaultSection: "Identity", locked: true },
      { key: "last_name", defaultLabel: "Last name", widget: "text", defaultSection: "Identity" },
      { key: "email", defaultLabel: "Email", widget: "email", defaultSection: "Contact" },
      { key: "phone", defaultLabel: "Phone", widget: "tel", defaultSection: "Contact" },
      { key: "department", defaultLabel: "Department", widget: "text", defaultSection: "Employment" },
      { key: "designation", defaultLabel: "Designation", widget: "text", defaultSection: "Employment" },
      { key: "valid_from", defaultLabel: "Valid from", widget: "date", defaultSection: "Employment" },
      { key: "valid_to", defaultLabel: "Valid to", widget: "date", defaultSection: "Employment" },
      {
        key: "status", defaultLabel: "Status", widget: "enum", defaultSection: "Employment",
        enumOptions: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Obsolete" },
        ],
      },
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
  "account", "contact", "asset", "supplier",
  "case", "work_order", "quote", "invoice", "purchase_order", "inventory",
  "employee", "product", "project", "opportunity", "rfq", "estimate", "process_study", "newsletter", "abm_program", "abm_target", "abm_member",
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
