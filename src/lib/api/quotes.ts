import { UOM_OPTIONS } from "@/lib/constants";
import type { EntityDef, FieldDef } from "./schema";

const OFFER_TYPES = ["quotation", "technical", "budgetary", "supply", "repair"] as const;
const QUOTE_STATUSES = ["draft", "sent", "approved", "rejected"] as const;
const OUTCOMES = ["open", "won", "lost"] as const;
const BUSINESS_STATUSES = ["pending", "po_received"] as const;
const DISCOUNT_TYPES = ["pct", "fixed"] as const;
const GROUP_TYPES = ["additive", "alternative"] as const;
const LINE_CATEGORIES = ["labour", "material", "testing", "transport"] as const;

// ── Quote line ───────────────────────────────────────────────────────────────

const LINE_FIELDS: FieldDef[] = [
  { key: "id", type: "uuid", label: "Line ID", description: "Server-generated identifier for this line.", readOnly: true },
  {
    key: "description", type: "text", label: "Description", required: true,
    description: "What is being quoted. A line with a blank description is rejected. Long multi-line specifications are kept in full — there is no truncation.",
    example: "Rewinding of 180 kW squirrel cage motor",
  },
  {
    key: "sl_no", type: "string", label: "Sl no.", maxLength: 40,
    description: "Your own line number. Sorted in natural numeric order on read (1, 2, 10 — not 1, 10, 2), so \"2.10\" correctly follows \"2.9\". Leave blank to have lines numbered by position.",
    example: "1",
  },
  {
    key: "uom", type: "string", label: "Unit of measure", maxLength: 20,
    description: `Free text so bulk loads are never rejected. The values the app's own picker offers are: ${UOM_OPTIONS.join(", ")}.`,
    example: "Nos",
  },
  { key: "qty", type: "number", label: "Quantity", min: 0, defaultValue: 1, description: "Quantity. Defaults to 1.", example: 2 },
  { key: "rate", type: "number", label: "Rate", min: 0, defaultValue: 0, description: "Unit rate in the tenant's currency.", example: 45000 },
  {
    key: "discount_pct", type: "number", label: "Line discount %", min: 0, max: 100, defaultValue: 0,
    description: "Per-line discount percentage, applied before the header-level discount.",
  },
  {
    key: "amount", type: "number", label: "Amount", computed: true,
    description: "qty × rate × (1 − discount_pct/100). Always calculated by the server; sending it is an error.",
  },
  {
    key: "group_id", type: "string", label: "Group ID", maxLength: 64,
    description: "Groups lines together. Any string you choose; lines sharing a value form one group. Omit for a standalone line.",
    example: "group-a",
  },
  { key: "group_label", type: "string", label: "Group label", maxLength: 200, description: "Heading shown for the group on the quotation and PDF.", example: "Option A — Full rewind" },
  { key: "group_description", type: "text", label: "Group description", description: "Optional sub-heading shown beside the group label." },
  {
    key: "group_type", type: "enum", label: "Group type", enumValues: GROUP_TYPES, defaultValue: "additive",
    description: "\"additive\" groups all count toward the total. \"alternative\" groups are mutually exclusive options — only the one named by the quote's selected_option_id counts toward the total; the rest are quoted but excluded.",
  },
  {
    key: "category", type: "enum", label: "Category", enumValues: LINE_CATEGORIES,
    description: "Cost category. Only \"material\" lines may carry a deduction.",
  },
  {
    key: "deduction", type: "number", label: "Deduction", min: 0, defaultValue: 0,
    description: "Salvage/scrap value subtracted from the quote total (e.g. recovered copper). Ignored unless category is \"material\".",
  },
  {
    key: "inventory_item_id", type: "uuid", label: "Inventory item", relation: { entity: "inventory_item", endpoint: "/api/v1/inventory" },
    description: "Optional link to a stock item. Reporting only — it does not consume stock.",
  },
];

export const QUOTE_LINE_ENTITY: EntityDef = {
  name: "quote_line",
  plural: "quote_lines",
  table: "quote_lines",
  endpoint: "/api/v1/quotations/:id (nested under `lines`)",
  description: "A single line item on a quotation. Lines are always written as a complete set — see the `lines` child on the quotation entity.",
  fields: LINE_FIELDS,
};

// ── Quotation ────────────────────────────────────────────────────────────────

const QUOTE_FIELDS: FieldDef[] = [
  { key: "id", type: "uuid", label: "ID", description: "Server-generated identifier. Use this in the URL for GET/PATCH/DELETE.", readOnly: true },
  {
    key: "ref", type: "string", label: "Quote ID", readOnly: true,
    description: "Sequential, per-tenant reference generated on create using the tenant's configured Quote ID format (Settings → Entities & Tax). Unique within the tenant.",
    example: "QT-2026-0042",
  },
  {
    key: "account_id", type: "uuid", label: "Account", required: true, relation: { entity: "account", endpoint: "/api/v1/accounts" },
    description: "The customer this quotation is for. Must belong to your tenant; a foreign id is rejected with 404.",
  },
  {
    key: "contact_id", type: "uuid", label: "Contact", relation: { entity: "contact", endpoint: "/api/v1/accounts/:id" },
    description: "Person the quotation is addressed to. Must belong to your tenant.",
  },
  {
    key: "entity_id", type: "string", label: "Issuing entity", maxLength: 64,
    description: "Which of the tenant's legal entities issues this quotation (letterhead, GSTIN). Configured in Settings → Entities & Tax; omit to use the default.",
  },
  {
    key: "type", type: "enum", label: "Offer type", enumValues: OFFER_TYPES, defaultValue: "quotation",
    description: "\"technical\" hides all pricing on the document. \"supply\" uses a separate per-line GST model in the UI.",
  },
  {
    key: "status", type: "enum", label: "Status", enumValues: QUOTE_STATUSES, defaultValue: "draft",
    description: "Pipeline status. Tenants may define additional statuses in Settings → Quote statuses; those custom values are also accepted.",
  },
  {
    key: "business_status", type: "enum", label: "Business status", enumValues: BUSINESS_STATUSES,
    description: "Whether a purchase order has been received against this quotation.",
  },
  {
    key: "outcome", type: "enum", label: "Outcome", enumValues: OUTCOMES, defaultValue: "open",
    description: "Won/lost, independent of status. Set automatically when status reaches a terminal state, unless you set it explicitly in the same request.",
  },
  { key: "name", type: "string", label: "Title", maxLength: 300, description: "Subject line of the quotation.", example: "Rewinding of 180 kW motor" },
  { key: "ref_no", type: "string", label: "Ref no.", maxLength: 100, description: "Your own free-text reference, distinct from the system-generated Quote ID. Shown in-app, never printed." },
  { key: "pr_no", type: "string", label: "PR no.", maxLength: 100, description: "Customer's purchase requisition number." },
  { key: "po_number", type: "string", label: "PO number", maxLength: 100, description: "Customer's purchase order number." },
  { key: "po_amount", type: "number", label: "PO amount", min: 0, description: "Value of the customer's purchase order." },
  {
    key: "quote_date", type: "date", label: "Quotation date",
    description: "The business date on the document. Accepts past dates. Defaults to today when omitted.",
    example: "2026-04-09",
  },
  { key: "valid_until", type: "date", label: "Valid until", description: "Expiry date shown on the quotation.", example: "2026-05-09" },
  { key: "notes", type: "text", label: "Notes", description: "Internal or customer-facing notes." },
  { key: "terms", type: "text", label: "Terms & conditions", description: "Terms printed on the quotation." },
  {
    key: "scope_of_work", type: "richtext", label: "Scope of work",
    description: "Rich text. Sanitised server-side before storage — scripts and event handlers are stripped.",
  },
  {
    key: "discount_type", type: "enum", label: "Discount type", enumValues: DISCOUNT_TYPES, defaultValue: "pct",
    description: "Whether the header discount is a percentage (discount_pct) or an absolute amount (discount_fixed).",
  },
  { key: "discount_pct", type: "number", label: "Discount %", min: 0, max: 100, defaultValue: 0, description: "Header discount percentage, applied to the subtotal. Used when discount_type is \"pct\"." },
  { key: "discount_fixed", type: "number", label: "Discount amount", min: 0, defaultValue: 0, description: "Absolute header discount. Used when discount_type is \"fixed\". Capped at the subtotal." },
  {
    key: "gst_rate", type: "number", label: "GST rate %", min: 0, max: 100,
    description: "Per-quote tax rate. Leave null for no tax row at all on the document (the standing wording in Terms covers it). Tax is a display-layer figure and is NOT included in `total`.",
  },
  {
    key: "asset_ids", type: "uuid[]", label: "Assets", relation: { entity: "asset", endpoint: "/api/v1/accounts/:id" },
    description: "Equipment this quotation covers. Every id must belong to your tenant.",
  },
  {
    key: "selected_option_id", type: "string", label: "Selected option", maxLength: 64,
    description: "The group_id of the alternative group that counts toward the total. Only meaningful when lines use group_type \"alternative\".",
  },
  { key: "territory", type: "string", label: "Territory", maxLength: 100, description: "Sales territory. Copied from the account on create when omitted." },
  { key: "sales_org", type: "string", label: "Sales org", maxLength: 100, description: "Sales organisation. Copied from the account on create when omitted." },
  { key: "custom_data", type: "json", label: "Custom fields", description: "Values for tenant-defined custom fields, keyed by field_key (Settings → Custom fields)." },
  { key: "meta", type: "json", label: "Metadata", description: "Free-form object for your own use. Stored and returned untouched." },
  {
    key: "total", type: "number", label: "Total", computed: true,
    description: "subtotal − header discount − material deductions, where subtotal counts only effective lines (unselected alternative groups excluded). Pre-tax. Always recalculated server-side on create and on any update that touches lines or discounts.",
  },
  { key: "revision", type: "integer", label: "Revision", readOnly: true, description: "Revision number. Starts at 1." },
  { key: "created_at", type: "datetime", label: "Created at", readOnly: true, description: "When the record was created. Distinct from quote_date, which is the business date you control." },
];

export const QUOTE_ENTITY: EntityDef = {
  name: "quotation",
  plural: "quotations",
  table: "quotes",
  endpoint: "/api/v1/quotations",
  description:
    "A customer quotation: a header carrying commercial terms plus an ordered set of line items, optionally organised into additive or mutually-exclusive alternative groups.",
  fields: QUOTE_FIELDS,
  children: [
    {
      key: "lines",
      description:
        "Line items. Sent as a complete array — on update the existing lines are replaced wholesale by what you send, so always PATCH the full set, never a partial one. Omit `lines` entirely to leave the existing lines untouched.",
      maxItems: 200,
      entity: QUOTE_LINE_ENTITY,
    },
  ],
};

// ── Totals ───────────────────────────────────────────────────────────────────

export type ComputableLine = {
  qty: number;
  rate: number;
  discount_pct: number;
  deduction: number;
  category: string | null;
  group_id: string | null;
  group_type: string | null;
};

export type QuoteTotals = { subtotal: number; deductions: number; discount: number; total: number };

/**
 * The single definition of what a quotation is worth.
 *
 * Lines in an alternative group other than the selected one are quoted but do
 * not count -- they are options the customer did not take. Tax is deliberately
 * absent: gst_rate is applied at display/print time and has never been part of
 * the stored total.
 */
export function computeQuoteTotals(
  lines: ComputableLine[],
  header: {
    discount_type?: string | null;
    discount_pct?: number | null;
    discount_fixed?: number | null;
    selected_option_id?: string | null;
  }
): QuoteTotals {
  const effective = lines.filter(
    (l) => !l.group_id || l.group_type !== "alternative" || l.group_id === (header.selected_option_id ?? null)
  );

  const subtotal = effective.reduce((s, l) => s + l.qty * l.rate * (1 - l.discount_pct / 100), 0);
  const deductions = effective.reduce((s, l) => s + (l.category === "material" ? l.deduction : 0), 0);

  const pct = Math.max(0, Math.min(100, header.discount_pct ?? 0));
  const fixed = Math.max(0, header.discount_fixed ?? 0);
  const discount =
    header.discount_type === "fixed" ? Math.min(Math.round(fixed), subtotal) : Math.round((subtotal * pct) / 100);

  return { subtotal, deductions, discount, total: subtotal - discount - deductions };
}

/** Line amount, using the same rule the totals above rely on. */
export function lineAmount(qty: number, rate: number, discountPct: number): number {
  return qty * rate * (1 - discountPct / 100);
}
