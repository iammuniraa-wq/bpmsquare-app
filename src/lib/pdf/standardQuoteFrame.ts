import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StandardQuote, StandardQuoteTemplate, StandardQuoteTemplateBlock } from "@/lib/types";
import type { Tenant } from "@/lib/tenant";
import { defaultStandardQuoteBlocks } from "@/lib/standardQuoteTemplateBlocks";
import { frameTitleParts } from "./framedQuote";
import { buildDocFrame, readPdfDesign } from "./frameServer";
import type { PdfFrame } from "./frame";

// Which page frame a Standard Quote prints with, and how it is called by the print page and the PDF route alike, so the
// page the browser shows and the PDF the server renders can never disagree. Returns null for a workspace with no
// pdf_design: both callers then take the code path they always had.

/** The blocks a quote prints with: its layout, or the built-in default when it has none (a quote made before layouts existed). */
export function quoteBlocks(template: Pick<StandardQuoteTemplate, "blocks"> | null | undefined): StandardQuoteTemplateBlock[] {
  return template?.blocks?.length ? template.blocks : defaultStandardQuoteBlocks();
}

export async function standardQuoteFrame(
  tenant: Tenant,
  quote: Pick<StandardQuote, "ref" | "entity_id">,
  account: { print_ids?: string[] | null } | null,
  blocks: StandardQuoteTemplateBlock[],
  revisionNo: number | null,
): Promise<PdfFrame | null> {
  if (!readPdfDesign(tenant.config)) return null;
  const { title, referenceLabel } = frameTitleParts(blocks);
  return buildDocFrame({
    tenant, entityId: quote.entity_id, printIds: account?.print_ids, title, referenceLabel, reference: quote.ref, revisionNo,
  });
}

/** What the PDF route needs without loading the whole record: the quote, its customer's print ids and its layout. Tenant-scoped. */
export async function loadStandardQuoteForFrame(admin: SupabaseClient, tenantId: string, id: string) {
  const { data: quote } = await admin.from("standard_quotes").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!quote) return null;
  const q = quote as StandardQuote;
  const [{ data: account }, { data: template }] = await Promise.all([
    admin.from("accounts").select("*").eq("id", q.account_id).eq("tenant_id", tenantId).maybeSingle(),
    q.template_id
      ? admin.from("standard_quote_templates").select("*").eq("id", q.template_id).eq("tenant_id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return { quote: q, account: (account as { print_ids?: string[] | null } | null) ?? null, blocks: quoteBlocks(template as StandardQuoteTemplate | null) };
}
