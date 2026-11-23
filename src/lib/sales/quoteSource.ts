import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTES } from "@/lib/constants";
import type { StandardQuoteSourceType } from "@/lib/types";

// Where a Standard Quote was made from (3c rule 7): stored as source_type + source_id (0251), verified against the tenant
// before it is written, and shown on the record as one "Made from" line of chips. The deal link stays in opportunity_id.

export const SOURCE_TYPES: StandardQuoteSourceType[] = ["email", "estimate", "drawing", "lead", "opportunity", "standard_quote", "quotation", "project", "direct"];
export const isSourceType = (v: unknown): v is StandardQuoteSourceType => typeof v === "string" && (SOURCE_TYPES as string[]).includes(v);

export const SOURCE_LABEL: Record<StandardQuoteSourceType, string> = {
  email: "Email", estimate: "Estimate", drawing: "Drawing set", lead: "Lead", opportunity: "Deal",
  standard_quote: "Earlier quotation", quotation: "Quotation", project: "Project", direct: "Typed in directly",
};

/** The table a source id points into and how to name it. A type with no entry (drawing, direct) has no record to link. */
const SOURCE_TABLE: Partial<Record<StandardQuoteSourceType, { table: string; select: string; name: (r: Record<string, unknown>) => string; href: (id: string) => string | null }>> = {
  estimate: { table: "estimates", select: "id, ref, name", name: (r) => String(r.ref ?? r.name ?? "Estimate"), href: ROUTES.estimate },
  opportunity: { table: "opportunities", select: "id, ref, title", name: (r) => String(r.ref ?? r.title ?? "Deal"), href: ROUTES.pipelineDetail },
  standard_quote: { table: "standard_quotes", select: "id, ref", name: (r) => String(r.ref ?? "Quotation"), href: ROUTES.standardQuote },
  quotation: { table: "quotes", select: "id, ref", name: (r) => String(r.ref ?? "Quotation"), href: ROUTES.quotation },
  lead: { table: "leads", select: "id, title", name: (r) => String(r.title ?? "Lead"), href: () => ROUTES.leads },
  project: { table: "contract_projects", select: "id, ref, name", name: (r) => String(r.ref ?? r.name ?? "Project"), href: ROUTES.contractProject },
  email: { table: "inbound_emails", select: "id, subject", name: (r) => String(r.subject ?? "Email"), href: ROUTES.inboxMessage },
};

/** A source id from a request body is a foreign id: it must resolve to a row of the stated type in this tenant. A type with
 *  no record to point at carries no id. */
export async function verifySource(supabase: SupabaseClient, tenantId: string, type: StandardQuoteSourceType, id: string | null): Promise<boolean> {
  const spec = SOURCE_TABLE[type];
  if (!spec) return id === null;
  if (!id) return false;
  const { data, error } = await supabase.from(spec.table).select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return !error && !!data;
}

export type MadeFromChip = { key: string; label: string; text: string; href: string | null };

/** The chain shown on the record: what it was made from (and, for an estimate or an earlier quotation, what that was made
 *  from in turn, one hop), then this quotation. Every lookup is tenant-scoped and a missing table reads as "no chip". */
export async function madeFromChips(admin: SupabaseClient, tenantId: string, quote: { id: string; ref: string; source_type?: StandardQuoteSourceType | null; source_id?: string | null }): Promise<MadeFromChip[]> {
  const chips: MadeFromChip[] = [];
  const lookup = async (type: StandardQuoteSourceType, id: string): Promise<MadeFromChip | null> => {
    const spec = SOURCE_TABLE[type];
    if (!spec) return null;
    const { data, error } = await admin.from(spec.table).select(spec.select).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error || !data) return null;
    return { key: `${type}:${id}`, label: SOURCE_LABEL[type], text: spec.name(data as unknown as Record<string, unknown>), href: spec.href(id) };
  };

  const type = quote.source_type ?? null;
  if (type && type !== "direct") {
    if (quote.source_id) {
      const chip = await lookup(type, quote.source_id);
      if (chip) chips.push(chip);
    } else chips.push({ key: type, label: SOURCE_LABEL[type], text: SOURCE_LABEL[type], href: null });
  } else if (!type) {
    // Made from an email through the inbox: the conversion stored it in record_sources (0214), not in source_*.
    const { data } = await admin.from("record_sources").select("source_email_id, subject").eq("tenant_id", tenantId).eq("object_type", "standard_quotes").eq("object_id", quote.id).order("created_at", { ascending: true }).limit(1);
    const row = (data ?? [])[0] as { source_email_id: string | null; subject: string | null } | undefined;
    if (row) chips.push({ key: "email", label: SOURCE_LABEL.email, text: row.subject?.trim() || "Customer email", href: row.source_email_id ? ROUTES.inboxMessage(row.source_email_id) : null });
  }
  if (chips.length > 0) chips.push({ key: "self", label: "This quotation", text: quote.ref, href: null });
  return chips;
}
