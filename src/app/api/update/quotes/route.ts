import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import { sanitizeRichText } from "@/lib/sanitizeHtml";
import type { RowOutcome } from "@/lib/import/types";

// Header scalars only -- mirrors the conservative shape of the other update
// routes. status/outcome (own action UI), discounts/gst/total (computed by
// the quote form's dedicated flow), relationships and line items are all
// deliberately not bulk-editable.
const ALLOWED = [
  "type", "valid_until", "ref_no", "pr_no", "po_number", "po_amount",
  "territory", "sales_org", "notes", "terms", "scope_of_work", "custom_data",
];

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
  // Exported quote CSVs repeat the quote's header on every line row -- the
  // first row of each quote carries the update, the rest are duplicates.
  const firstRowByQuote = new Map<string, number>();

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) {
      outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" });
      continue;
    }

    const firstRow = firstRowByQuote.get(id);
    if (firstRow !== undefined) {
      outcomes.push({ rowNum, status: "skipped", reason: `Line row of the quote already updated by row ${firstRow}` });
      continue;
    }
    firstRowByQuote.set(id, rowNum);

    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (!(key in values)) continue;
      patch[key] = key === "scope_of_work" ? sanitizeRichText(values[key]) : (values[key] || null);
    }

    if (Object.keys(patch).length === 0) {
      outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" });
      continue;
    }

    prepared.push({ rowNum, id, patch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  return NextResponse.json(await updateRows(supabase, "quotes", tenantId, prepared, outcomes));
}
