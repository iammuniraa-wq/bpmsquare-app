// The one place a fence project becomes a real, priced Standard Quote
// (Phase D, docs/fence-configurator-architecture.md §8). Reuses the exact
// contract Sales Engine Piece A already established -- same
// priceDocumentLine() call StandardQuoteForm.tsx makes for every other
// line, same insert helpers /api/standard-quotes's POST route uses. No
// fork of the pricing logic (bpmsquarecore §1).
//
// Refuses outright if any line failed to resolve to a real product
// (materials.ts) or failed to price -- the one behaviour Fence Studio's
// own tool never enforces (every quote there can go out "missing unit
// cost"). No margin-floor gate here on purpose (owner decision #4): that
// rides on Sales Engine Piece C, a platform service, not a fence-specific
// build.
//
// Not yet called from anywhere -- fence_projects has no CRUD route yet
// (Phase E). This is the assembly logic Phase E's "Continue to quote"
// action will call once it exists. Can't be usefully unit-tested with
// vitest: every step writes to real tables (standard_quotes,
// standard_quote_lines, products, pricing_documents via
// priceDocumentLine) through createAdminSupabase(), the same boundary
// src/lib/pricing/server.ts's DB-touching functions sit behind and don't
// have .test.ts files for either -- proven by tsc/next build plus manual
// verification against the demo tenant once Phase E exists to call it.

import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { generateNextStandardQuoteRef } from "@/lib/standardQuoteRef";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import { derivePricingFlags, withPricingColumns, insertLinesTolerant, writeHeaderTolerant } from "@/lib/pricing/quoteLineFlags";
import { priceDocumentLine, type PricedLineOutcome } from "@/lib/pricing/quoteLine";
import type { ResolvedMaterialLine } from "./materials";

export class FenceQuoteError extends Error {}

export interface AssembleFenceQuoteParams {
  accountId: string;
  contactId?: string | null;
  createdBy?: string | null;
  lines: ResolvedMaterialLine[];
}

export interface AssembleFenceQuoteResult {
  quoteId: string;
  ref: string;
  subtotal: number;
  total: number;
}

export async function assembleFenceStandardQuote(tenantId: string, params: AssembleFenceQuoteParams): Promise<AssembleFenceQuoteResult> {
  const unresolved = params.lines.filter((l) => !l.product_id);
  if (unresolved.length > 0) {
    throw new FenceQuoteError(
      `${unresolved.length} line${unresolved.length === 1 ? "" : "s"} have no matching product (${unresolved.map((l) => l.fence_kind).join(", ")}) -- seed or tag a product for each before quoting.`
    );
  }
  if (params.lines.length === 0) {
    throw new FenceQuoteError("No BOM lines to quote -- configure the project first.");
  }

  const admin = createAdminSupabase();

  // account_id/contact_id are foreign ids that will eventually arrive from a
  // fence_projects row or request body -- verified tenant-scoped before use,
  // per MULTI_TENANT_GUARDRAILS.md (same shape as the 2026-07-21 invoices/
  // quotes fix: an unverified foreign id here would let a quote in this
  // tenant point at another tenant's real account/contact).
  const { data: acct } = await admin.from("accounts").select("id").eq("id", params.accountId).eq("tenant_id", tenantId).maybeSingle();
  if (!acct) throw new FenceQuoteError("Account not found for this tenant.");
  if (params.contactId) {
    const { data: contact } = await admin.from("contacts").select("id").eq("id", params.contactId).eq("tenant_id", tenantId).maybeSingle();
    if (!contact) throw new FenceQuoteError("Contact not found for this tenant.");
  }

  // Header first, zeroed -- lines need a real quote id for
  // priceDocumentLine's sourceId/trace, same order the Standard Quote
  // form follows.
  let quoteId: string | null = null;
  let ref: string | null = null;
  let quoteErr: { message: string } | null = null;
  for (let attempt = 0; attempt < 3 && !quoteId; attempt++) {
    const candidateRef = await generateNextStandardQuoteRef(admin, tenantId);
    const result = await writeHeaderTolerant(
      {
        tenant_id: tenantId,
        ref: candidateRef,
        account_id: params.accountId,
        contact_id: params.contactId ?? null,
        status: "draft",
        header_discount_pct: 0,
        tax_pct: 0,
        shipping_amount: 0,
        subtotal: 0,
        total: 0,
        created_by: params.createdBy ?? null,
      },
      async (row) => await admin.from("standard_quotes").insert(row).select("id, ref").single()
    );
    if (!result.error) {
      const data = result.data as { id: string; ref: string };
      quoteId = data.id;
      ref = data.ref;
    } else if ((result.error as { code?: string }).code === "23505") {
      quoteErr = result.error; // ref collision -- retry with a fresh one
      continue;
    } else {
      quoteErr = result.error;
      break;
    }
  }
  if (!quoteId || !ref) throw new FenceQuoteError(quoteErr?.message ?? "Failed to create the quote header");

  const priced: { line: ResolvedMaterialLine; outcome: PricedLineOutcome }[] = await Promise.all(
    params.lines.map(async (line) => ({
      line,
      outcome: await priceDocumentLine(tenantId, {
        productId: line.product_id!,
        accountId: params.accountId, // verified tenant-scoped above
        quantity: line.qty,
        documentType: "standard_quote",
        sourceId: quoteId!,
      }),
    }))
  );

  const stillUnpriced = priced.filter((p) => !p.outcome.ok);
  if (stillUnpriced.length > 0) {
    throw new FenceQuoteError(
      `${stillUnpriced.length} line${stillUnpriced.length === 1 ? "" : "s"} could not be priced (${stillUnpriced.map((p) => p.line.fence_kind).join(", ")}) -- needs a cost source, not just a product.`
    );
  }

  const rows = priced.map((p, i) => {
    const o = p.outcome as Extract<PricedLineOutcome, { ok: true }>;
    return {
      tenant_id: tenantId,
      standard_quote_id: quoteId!,
      sl_no: String(i + 1),
      description: p.line.product_name ?? p.line.fence_kind,
      uom: p.line.uom,
      qty: p.line.qty,
      rate: o.unit_rate,
      discount_pct: 0,
      amount: o.net,
      product_id: p.line.product_id,
      pricing_document_id: o.document_id,
      is_selected: true,
      show_on_pdf: true,
    };
  });

  const derived = await derivePricingFlags(admin, tenantId, rows);
  const { error: linesErr } = await insertLinesTolerant(admin, "standard_quote_lines", derived.ok ? withPricingColumns(rows, derived.flagsByDocument) : rows);
  if (linesErr) throw new FenceQuoteError(linesErr.message);

  const subtotal = rows.reduce((s, r) => s + r.amount, 0);
  const totals = computeStandardQuoteTotals(subtotal, 0, 0, 0);
  await admin.from("standard_quotes").update({ subtotal, total: totals.total }).eq("id", quoteId).eq("tenant_id", tenantId);

  return { quoteId, ref, subtotal, total: totals.total };
}
