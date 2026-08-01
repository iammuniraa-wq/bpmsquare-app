import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { describeDbError, fetchAllRows, insertRows, nameKey, readImportBody, type PreparedRow } from "@/lib/import/server";
import { logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";
import type { RowOutcome } from "@/lib/import/types";

type QuoteRow = { id: string; ref: string; discount_type: string; discount_pct: number; discount_fixed: number };

/**
 * Adds new lines to quotes that already exist -- the chicken-and-egg problem
 * a genuinely separate header+lines file pair would hit on CREATE (a new
 * quote's lines can't reference a header id that doesn't exist yet) doesn't
 * apply here, since every row targets an existing quote by ref. Recomputes
 * each touched quote's total afterward and logs one change_log entry per
 * quote (not per line -- keeps a multi-line add from becoming a wall of
 * near-identical audit rows) against the quote's own history, same as
 * PO/invoice line-item routes log against their parent.
 */
export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const quotes = await fetchAllRows<QuoteRow>(supabase, "quotes", "id, ref, discount_type, discount_pct, discount_fixed", tenantId);
  const quoteByRef = new Map(quotes.map((q) => [nameKey(q.ref), q]));

  const prepared: (PreparedRow & { quoteId: string })[] = [];
  const outcomes: RowOutcome[] = [];

  for (const { rowNum, values } of rows) {
    const quote = quoteByRef.get(nameKey(values.quote_ref ?? ""));
    if (!quote) {
      outcomes.push({ rowNum, status: "failed", reason: `Quote "${values.quote_ref ?? ""}" was not found — import quotes first` });
      continue;
    }
    if (!values.description?.trim()) {
      outcomes.push({ rowNum, status: "failed", reason: "description is required" });
      continue;
    }

    const qty = Math.max(0, parseFloat(values.qty) || 1);
    const rate = Math.max(0, parseFloat(values.rate) || 0);
    const discountPct = Math.max(0, Math.min(100, parseFloat(values.discount_pct) || 0));

    prepared.push({
      rowNum,
      quoteId: quote.id,
      record: {
        tenant_id: tenantId,
        quote_id: quote.id,
        sl_no: values.sl_no?.trim() || null,
        description: values.description.trim(),
        uom: values.uom || null,
        qty,
        rate,
        discount_pct: discountPct,
        amount: qty * rate * (1 - discountPct / 100),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json({ inserted: 0, skipped: 0, failed: outcomes.length, outcomes });

  const result = await insertRows(supabase, "quote_lines", prepared, outcomes);

  const insertedRowNums = new Set(result.outcomes.filter((o) => o.status === "inserted").map((o) => o.rowNum));
  const touchedQuoteIds = new Set(prepared.filter((p) => insertedRowNums.has(p.rowNum)).map((p) => p.quoteId));

  if (touchedQuoteIds.size > 0) {
    const user = await getAuthUser();
    const logRows: ChangeLogEntryParams[] = [];
    for (const quoteId of touchedQuoteIds) {
      const quote = quotes.find((q) => q.id === quoteId)!;
      const addedLines = prepared.filter((p) => p.quoteId === quoteId && insertedRowNums.has(p.rowNum));

      await recomputeQuoteTotal(supabase, quoteId, tenantId, quote);

      logRows.push({
        tenantId, objectType: "quotes", objectId: quoteId, objectLabel: quote.ref,
        action: "update", actorId: user?.id, actorEmail: user?.email,
        changes: addedLines.map((l) => ({
          field: "Line added", from: null,
          to: `${l.record.description}: qty ${l.record.qty} × rate ${l.record.rate} = ${l.record.amount}`,
        })),
      });
    }
    await logChangeBatch(supabase, logRows);
  }

  return NextResponse.json(result);
}

/**
 * Simplified recompute (subtotal minus quote-level discount minus material
 * deductions) -- doesn't re-apply the "alternative option group" exclusion
 * the full quote editor's total does (src/app/api/quotes/[id]/edit), since
 * lines added in bulk here aren't expected to carry an alternative-option
 * group_id. A quote using that feature should still finish line edits in
 * the quote editor to get an option-aware total.
 */
async function recomputeQuoteTotal(
  supabase: Awaited<ReturnType<typeof requireTenantUser>>["supabase"],
  quoteId: string,
  tenantId: string,
  quote: QuoteRow
) {
  const { data: lines } = await supabase.from("quote_lines").select("amount, deduction").eq("quote_id", quoteId);
  const subtotal = (lines ?? []).reduce((s, l) => s + (l.amount ?? 0), 0);
  const totalDeductions = (lines ?? []).reduce((s, l) => s + (l.deduction ?? 0), 0);
  const discAmount = quote.discount_type === "fixed"
    ? Math.min(Math.round(quote.discount_fixed ?? 0), subtotal)
    : Math.round(subtotal * (quote.discount_pct ?? 0) / 100);
  const total = subtotal - discAmount - totalDeductions;
  const { error } = await supabase.from("quotes").update({ total }).eq("id", quoteId).eq("tenant_id", tenantId);
  if (error) console.error("[import/quote_lines] total recompute failed", describeDbError(error));
}
