import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import { logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";
import type { RowOutcome } from "@/lib/import/types";

const ALLOWED = ["sl_no", "description", "uom", "qty", "rate", "discount_pct"];

type LineBefore = { id: string; quote_id: string; description: string; qty: number; rate: number; discount_pct: number };
type QuoteRow = { id: string; ref: string; discount_type: string; discount_pct: number; discount_fixed: number };

/**
 * Bulk-edits lines already on a quote, matched by their own Record ID (the
 * export's "id" column) -- not by quote_ref, since a quote can have several
 * lines and Update always targets one specific row. Logs against the
 * owning quote's history (not a standalone "quote_lines" entry), same
 * reasoning as the import route.
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

  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) {
      outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" });
      continue;
    }

    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (!(key in values)) continue;
      if (key === "qty" || key === "rate") patch[key] = Math.max(0, parseFloat(values[key]) || 0);
      else if (key === "discount_pct") patch[key] = Math.max(0, Math.min(100, parseFloat(values[key]) || 0));
      else patch[key] = values[key] || null;
    }

    if (Object.keys(patch).length === 0) {
      outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" });
      continue;
    }

    prepared.push({ rowNum, id, patch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));

  const { data: beforeRows } = await supabase
    .from("quote_lines")
    .select("id, quote_id, description, qty, rate, discount_pct")
    .in("id", prepared.map((p) => p.id))
    .eq("tenant_id", tenantId);
  const beforeById = new Map((beforeRows as LineBefore[] ?? []).map((r) => [r.id, r]));

  // amount must be recomputed alongside qty/rate/discount_pct changes, same
  // as the single-record PATCH routes for invoice/PO lines.
  for (const row of prepared) {
    const before = beforeById.get(row.id);
    if (!before) continue;
    const qty = "qty" in row.patch ? (row.patch.qty as number) : before.qty;
    const rate = "rate" in row.patch ? (row.patch.rate as number) : before.rate;
    const discountPct = "discount_pct" in row.patch ? (row.patch.discount_pct as number) : before.discount_pct;
    row.patch.amount = qty * rate * (1 - discountPct / 100);
  }

  const result = await updateRows(supabase, "quote_lines", tenantId, prepared, outcomes);

  const updatedIds = new Set(result.outcomes.filter((o) => o.status === "updated").map((o) => prepared.find((p) => p.rowNum === o.rowNum)?.id).filter(Boolean));
  const touchedQuoteIds = new Set([...updatedIds].map((id) => beforeById.get(id as string)?.quote_id).filter(Boolean) as string[]);

  if (touchedQuoteIds.size > 0) {
    const { data: quoteRows } = await supabase
      .from("quotes")
      .select("id, ref, discount_type, discount_pct, discount_fixed")
      .in("id", [...touchedQuoteIds])
      .eq("tenant_id", tenantId);
    const quoteById = new Map((quoteRows as QuoteRow[] ?? []).map((q) => [q.id, q]));

    const user = await getAuthUser();
    const logRows: ChangeLogEntryParams[] = [];

    for (const quoteId of touchedQuoteIds) {
      const quote = quoteById.get(quoteId);
      if (!quote) continue;

      const { data: lines } = await supabase.from("quote_lines").select("amount, deduction").eq("quote_id", quoteId);
      const subtotal = (lines ?? []).reduce((s, l) => s + (l.amount ?? 0), 0);
      const totalDeductions = (lines ?? []).reduce((s, l) => s + (l.deduction ?? 0), 0);
      const discAmount = quote.discount_type === "fixed"
        ? Math.min(Math.round(quote.discount_fixed ?? 0), subtotal)
        : Math.round(subtotal * (quote.discount_pct ?? 0) / 100);
      await supabase.from("quotes").update({ total: subtotal - discAmount - totalDeductions }).eq("id", quoteId).eq("tenant_id", tenantId);

      const changedIds = [...updatedIds].filter((id) => beforeById.get(id as string)?.quote_id === quoteId) as string[];
      const changes = changedIds
        .map((id) => {
          const b = beforeById.get(id)!;
          const p = prepared.find((row) => row.id === id)!.patch;
          const qty = "qty" in p ? p.qty : b.qty;
          const rate = "rate" in p ? p.rate : b.rate;
          if (qty === b.qty && rate === b.rate) return null;
          return { field: `Line: ${b.description}`, from: `qty ${b.qty} × rate ${b.rate}`, to: `qty ${qty} × rate ${rate}` };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      if (changes.length > 0) {
        logRows.push({
          tenantId, objectType: "quotes", objectId: quoteId, objectLabel: quote.ref,
          action: "update", actorId: user?.id, actorEmail: user?.email, changes,
        });
      }
    }

    if (logRows.length > 0) await logChangeBatch(supabase, logRows);
  }

  return NextResponse.json(result);
}
