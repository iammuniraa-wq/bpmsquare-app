import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { fetchAllRows, insertRows, nameKey, readImportBody, type PreparedRow } from "@/lib/import/server";
import { recomputeStandardQuoteTotals } from "@/lib/import/standardQuoteLinesServer";
import { logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";
import type { RowOutcome } from "@/lib/import/types";

type QuoteRow = { id: string; ref: string; status: string };

const num = (v: string | undefined, fallback: number): number => {
  if (v == null || v.trim() === "") return fallback;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Adds new lines to standard quotes that already exist, found by Quote ID. Only DRAFT quotes take
 * lines: a sent quote is an offer the customer holds, and its lines change through the quote
 * form. A line made here is a free-text line (no product, no engine price, no option group), so
 * it carries no pricing guardrail state; the quote's subtotal and total are re-derived afterwards
 * with the form's own rules. One change-history entry per quote, not per line.
 */
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk
  // either -- the gate is the same question the nav and the v1 API ask.
  const gate = await assertObjectFeature(tenantId, "standard_quote_lines");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canEditWorkcenter(perms, "standard_quotes")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const quotes = await fetchAllRows<QuoteRow>(supabase, "standard_quotes", "id, ref, status", tenantId);
  const quoteByRef = new Map(quotes.map((q) => [nameKey(q.ref), q]));

  const prepared: (PreparedRow & { quoteId: string })[] = [];
  const outcomes: RowOutcome[] = [];
  const resolved: { rowNum: number; quote: QuoteRow; values: Record<string, string> }[] = [];

  for (const { rowNum, values } of rows) {
    const quote = quoteByRef.get(nameKey(values.standard_quote_ref ?? ""));
    if (!quote) {
      outcomes.push({ rowNum, status: "failed", reason: `Quote "${values.standard_quote_ref ?? ""}" was not found. Check the Quote ID against an export of Standard Quotes` });
      continue;
    }
    if (quote.status !== "draft") {
      outcomes.push({ rowNum, status: "failed", reason: `Quote ${quote.ref} is ${quote.status}. Lines can only be added to a draft quote` });
      continue;
    }
    if (!values.description?.trim()) {
      outcomes.push({ rowNum, status: "failed", reason: "description is required" });
      continue;
    }
    resolved.push({ rowNum, quote, values });
  }

  // The next serial number on each quote the file touches, so a blank S.No continues the quote's
  // own numbering instead of repeating "1".
  const existing = new Map<string, number>();
  const touched = [...new Set(resolved.map((r) => r.quote.id))];
  for (let i = 0; i < touched.length; i += 150) {
    const { data } = await supabase.from("standard_quote_lines").select("standard_quote_id").in("standard_quote_id", touched.slice(i, i + 150)).eq("tenant_id", tenantId);
    for (const l of (data ?? []) as { standard_quote_id: string }[]) existing.set(l.standard_quote_id, (existing.get(l.standard_quote_id) ?? 0) + 1);
  }

  for (const { rowNum, quote, values } of resolved) {
    const qty = Math.max(0, num(values.qty, 1));
    const rate = Math.max(0, num(values.rate, 0));
    const discountPct = Math.max(0, Math.min(100, num(values.discount_pct, 0)));
    const serial = (existing.get(quote.id) ?? 0) + 1;
    existing.set(quote.id, serial);
    prepared.push({
      rowNum,
      quoteId: quote.id,
      record: {
        tenant_id: tenantId,
        standard_quote_id: quote.id,
        sl_no: values.sl_no?.trim() || String(serial),
        description: values.description.trim(),
        uom: values.uom?.trim() || null,
        qty,
        rate,
        discount_pct: discountPct,
        amount: qty * rate * (1 - discountPct / 100),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json({ inserted: 0, skipped: 0, failed: outcomes.length, outcomes });

  const result = await insertRows(supabase, "standard_quote_lines", prepared, outcomes);

  const insertedRowNums = new Set(result.outcomes.filter((o) => o.status === "inserted").map((o) => o.rowNum));
  const touchedQuoteIds = [...new Set(prepared.filter((p) => insertedRowNums.has(p.rowNum)).map((p) => p.quoteId))];

  if (touchedQuoteIds.length > 0) {
    await recomputeStandardQuoteTotals(supabase, tenantId, touchedQuoteIds);

    const user = await getAuthUser();
    const quoteById = new Map(quotes.map((q) => [q.id, q]));
    const logRows: ChangeLogEntryParams[] = touchedQuoteIds.map((quoteId) => ({
      tenantId, objectType: "standard_quotes", objectId: quoteId, objectLabel: quoteById.get(quoteId)?.ref ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email,
      changes: prepared.filter((p) => p.quoteId === quoteId && insertedRowNums.has(p.rowNum)).map((l) => ({
        field: "Line added", from: null,
        to: `${l.record.description}: qty ${l.record.qty} × rate ${l.record.rate} = ${l.record.amount}`,
      })),
    }));
    await logChangeBatch(supabase, logRows);
  }

  return NextResponse.json(result);
}
