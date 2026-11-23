import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { TenantConfig } from "@/lib/constants";
import type { StandardQuoteSourceType, StandardQuoteTemplateBlock } from "@/lib/types";
import { defaultStandardQuoteBlocks } from "@/lib/standardQuoteTemplateBlocks";
import { cleanDocSections } from "@/lib/pdf/framedQuote";
import { isSourceType, verifySource } from "@/lib/sales/quoteSource";

// The framed-document fields of a Standard Quote (0251): project title, subject, the issuing legal entity, the per-quotation
// sections, and where it was made from. One reader for the create and the edit route, so both validate the same way. Every
// foreign id from the body (entity, template, source) is checked against THIS tenant before it is written
// (MULTI_TENANT_GUARDRAILS.md). The columns may not exist yet; writeHeaderTolerant in the caller drops a column the database
// does not have, so a pending migration never fails a save.

export type DocFields = Record<string, unknown>;
export type DocFieldsResult = { ok: true; fields: DocFields } | { ok: false; error: string; status: number };

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function readDocFields(
  supabase: SupabaseClient,
  tenantId: string,
  body: Record<string, unknown>,
  opts: { templateId: string | null; allowSource: boolean },
): Promise<DocFieldsResult> {
  const fields: DocFields = {};
  if ("project_title" in body) fields.project_title = text(body.project_title, 300);
  if ("subject" in body) fields.subject = text(body.subject, 300);

  if ("entity_id" in body) {
    const id = text(body.entity_id, 64);
    if (id) {
      const { data } = await createAdminSupabase().from("tenants").select("config").eq("id", tenantId).maybeSingle();
      const known = ((data?.config ?? {}) as Partial<TenantConfig>).entities ?? [];
      if (!known.some((e) => e.id === id)) return { ok: false, error: "That legal entity is not in your company settings", status: 422 };
    }
    fields.entity_id = id;
  }

  if ("doc_sections" in body) {
    let blocks: StandardQuoteTemplateBlock[] = defaultStandardQuoteBlocks();
    if (opts.templateId) {
      const { data } = await supabase.from("standard_quote_templates").select("blocks").eq("id", opts.templateId).eq("tenant_id", tenantId).maybeSingle();
      if (data?.blocks && Array.isArray(data.blocks)) blocks = data.blocks as StandardQuoteTemplateBlock[];
    }
    const clean = cleanDocSections(body.doc_sections, blocks);
    fields.doc_sections = Object.keys(clean).length > 0 ? clean : null;
  }

  if (opts.allowSource && "source_type" in body) {
    if (!isSourceType(body.source_type)) return { ok: false, error: "Unknown source type", status: 422 };
    const type = body.source_type as StandardQuoteSourceType;
    const sourceId = text(body.source_id, 64);
    if (!(await verifySource(supabase, tenantId, type, sourceId))) return { ok: false, error: "That source record was not found", status: 404 };
    fields.source_type = type;
    fields.source_id = sourceId;
  }
  return { ok: true, fields };
}
