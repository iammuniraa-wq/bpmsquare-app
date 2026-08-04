import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeRichText } from "@/lib/sanitizeHtml";
import { sortBySlNo } from "@/lib/lineOrder";
import { DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import { computeQuoteTotals, lineAmount, type ComputableLine } from "./quotes";

/** Change-log actor for API-key writes -- there is no signed-in user to attribute. */
export const API_ACTOR_EMAIL = "api:v1";

/**
 * Foreign ids arrive straight from the request body. Each must be confirmed to
 * belong to the calling tenant before it is written: otherwise a tenant-A key
 * could splice in a tenant-B contact and have that tenant's decrypted PII
 * rendered on this quotation, including through the public print link.
 */
export async function verifyQuoteRelations(
  supabase: SupabaseClient,
  tenantId: string,
  v: { account_id?: unknown; contact_id?: unknown; asset_ids?: unknown },
  lines?: Record<string, unknown>[]
): Promise<string | null> {
  if (typeof v.account_id === "string") {
    const { data } = await supabase.from("accounts").select("id").eq("id", v.account_id).eq("tenant_id", tenantId).maybeSingle();
    if (!data) return "Account not found in this tenant";
  }
  if (typeof v.contact_id === "string") {
    const { data } = await supabase.from("contacts").select("id").eq("id", v.contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (!data) return "Contact not found in this tenant";
  }
  if (Array.isArray(v.asset_ids) && v.asset_ids.length > 0) {
    const ids = v.asset_ids as string[];
    const { data } = await supabase.from("assets").select("id").in("id", ids).eq("tenant_id", tenantId);
    if (!data || data.length !== new Set(ids).size) return "One or more assets not found in this tenant";
  }
  // Line-level inventory references get the same treatment as header foreign
  // ids -- API_V1.md promises this check, and without it a foreign key that
  // merely exists SOMEWHERE would be accepted (a cross-tenant UUID-existence
  // oracle at best, a stored foreign reference at worst).
  if (lines) {
    const invIds = [...new Set(lines.map((l) => l.inventory_item_id).filter((x): x is string => typeof x === "string"))];
    if (invIds.length > 0) {
      const { data } = await supabase.from("inventory_items").select("id").in("id", invIds).eq("tenant_id", tenantId);
      if (!data || data.length !== invIds.length) return "One or more inventory items not found in this tenant";
    }
  }
  return null;
}

export type NormalizedLine = ComputableLine & Record<string, unknown>;

/**
 * Turns validated line input into insert-ready rows. Amount is always derived
 * here -- a caller cannot assert a line's value -- and `deduction` is forced to
 * zero on any line that is not material, matching the app's own rule.
 */
export function buildLineRows(
  validated: Record<string, unknown>[],
  tenantId: string,
  quoteId: string
): NormalizedLine[] {
  return validated.map((l) => {
    const qty = typeof l.qty === "number" ? l.qty : 1;
    const rate = typeof l.rate === "number" ? l.rate : 0;
    const discount_pct = typeof l.discount_pct === "number" ? l.discount_pct : 0;
    const category = (l.category as string | null) ?? null;
    const deduction = category === "material" && typeof l.deduction === "number" ? l.deduction : 0;

    return {
      tenant_id: tenantId,
      quote_id: quoteId,
      description: String(l.description),
      uom: (l.uom as string | null) ?? null,
      qty,
      rate,
      discount_pct,
      amount: lineAmount(qty, rate, discount_pct),
      sl_no: (l.sl_no as string | null) ?? null,
      group_id: (l.group_id as string | null) ?? null,
      group_label: (l.group_label as string | null) ?? null,
      group_type: (l.group_type as string | null) ?? null,
      group_description: (l.group_description as string | null) ?? null,
      category,
      deduction,
      inventory_item_id: (l.inventory_item_id as string | null) ?? null,
    };
  });
}

/** Recomputes and returns the header total for a set of lines. */
export function totalsFor(
  lines: NormalizedLine[],
  header: { discount_type?: string | null; discount_pct?: number | null; discount_fixed?: number | null; selected_option_id?: string | null }
) {
  return computeQuoteTotals(lines, header);
}

/** scope_of_work is the one rich-text field on a quotation, so it is sanitised on every write path. */
export function sanitizeQuoteValues(values: Record<string, unknown>): Record<string, unknown> {
  if ("scope_of_work" in values) {
    values.scope_of_work = values.scope_of_work ? sanitizeRichText(String(values.scope_of_work)) : null;
  }
  return values;
}

/**
 * The date-profile rules from migration 0059, applied identically here to the
 * way the in-app routes apply them -- a quote moved through the API must end up
 * with the same submitted/closed stamps as one moved through the UI.
 *
 * An explicit value from the caller always wins: a quote handed over on
 * WhatsApp or closed verbally happened outside the system, and historical
 * imports need to state their own dates.
 */
export async function applyDateProfile(
  supabase: SupabaseClient,
  tenantId: string,
  before: Record<string, unknown>,
  patch: Record<string, unknown>
): Promise<void> {
  if ("status" in patch) {
    const { data: tenant } = await supabase.from("tenants").select("config").eq("id", tenantId).maybeSingle();
    const statuses: QuoteStatusDef[] =
      (tenant?.config as { quote_statuses?: QuoteStatusDef[] } | null)?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;
    const def = statuses.find((s) => s.value === patch.status);

    if (!("outcome" in patch)) {
      patch.outcome = def?.is_terminal ? (def.is_lost ? "lost" : "won") : "open";
    }
    if (!before.submitted_at && !("submitted_at" in patch) && def && !def.is_initial) {
      patch.submitted_at = new Date().toISOString();
    }
  }

  const effectiveOutcome = ("outcome" in patch ? patch.outcome : before.outcome) as string;
  if (!("closed_at" in patch)) {
    if (effectiveOutcome !== "open" && before.outcome === "open") patch.closed_at = new Date().toISOString();
    else if (effectiveOutcome === "open" && before.outcome !== "open") patch.closed_at = null;
  }

  patch.updated_at = new Date().toISOString();
}

type QuoteRow = Record<string, unknown>;

export function serializeLine(l: QuoteRow) {
  return {
    id: l.id,
    sl_no: l.sl_no,
    description: l.description,
    uom: l.uom,
    qty: l.qty,
    rate: l.rate,
    discount_pct: l.discount_pct,
    amount: l.amount,
    group_id: l.group_id,
    group_label: l.group_label,
    group_type: l.group_type,
    group_description: l.group_description,
    category: l.category,
    deduction: l.deduction,
    inventory_item_id: l.inventory_item_id,
  };
}

export function serializeQuote(
  q: QuoteRow,
  lines: QuoteRow[] | null,
  related?: { account?: { id: string; name: string } | null; contact?: { id: string; name: string } | null }
) {
  const ordered = lines ? sortBySlNo(lines as { sl_no?: string | null }[]) as QuoteRow[] : null;
  const totals = ordered
    ? computeQuoteTotals(ordered as unknown as ComputableLine[], {
        discount_type: q.discount_type as string | null,
        discount_pct: q.discount_pct as number | null,
        discount_fixed: q.discount_fixed as number | null,
        selected_option_id: q.selected_option_id as string | null,
      })
    : null;

  return {
    id: q.id,
    ref: q.ref,
    account_id: q.account_id,
    contact_id: q.contact_id,
    entity_id: q.entity_id,
    type: q.type,
    status: q.status,
    business_status: q.business_status ?? null,
    outcome: q.outcome,
    name: q.name,
    ref_no: q.ref_no,
    pr_no: q.pr_no,
    po_number: q.po_number,
    po_amount: q.po_amount,
    quote_date: q.quote_date ?? null,
    valid_until: q.valid_until,
    inquiry_date: q.inquiry_date ?? null,
    submitted_at: q.submitted_at ?? null,
    closed_at: q.closed_at ?? null,
    updated_at: q.updated_at ?? null,
    notes: q.notes,
    terms: q.terms,
    scope_of_work: q.scope_of_work,
    discount_type: q.discount_type,
    discount_pct: q.discount_pct,
    discount_fixed: q.discount_fixed,
    gst_rate: q.gst_rate,
    asset_ids: q.asset_ids ?? [],
    selected_option_id: q.selected_option_id,
    territory: q.territory,
    sales_org: q.sales_org,
    custom_data: q.custom_data,
    meta: q.meta,
    total: q.total,
    revision: q.revision,
    created_at: q.created_at,
    ...(related?.account !== undefined ? { account: related.account } : {}),
    ...(related?.contact !== undefined ? { contact: related.contact } : {}),
    ...(ordered ? { lines: ordered.map(serializeLine), line_count: ordered.length } : {}),
    ...(totals
      ? { totals: { subtotal: totals.subtotal, discount: totals.discount, deductions: totals.deductions, total: totals.total } }
      : {}),
    _links: {
      self: `/api/v1/quotations/${q.id}`,
      account: `/api/v1/accounts/${q.account_id}`,
      pdf: `/quotations/${q.id}/print`,
    },
  };
}
