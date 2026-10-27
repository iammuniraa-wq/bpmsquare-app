import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import { recomputeStandardQuoteTotals } from "@/lib/import/standardQuoteLinesServer";
import { STANDARD_QUOTE_LINE_MONEY_KEYS, STANDARD_QUOTE_LINE_TEXT_KEYS } from "@/lib/import/standardQuoteLinesSchema";
import { logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";
import type { RowOutcome } from "@/lib/import/types";

type LineBefore = {
  id: string; standard_quote_id: string; description: string;
  qty: number; rate: number; discount_pct: number; pricing_document_id?: string | null;
};

const num = (v: string): number | null => {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * Bulk-edits lines already on a standard quote, matched by their own Record ID (the export's "id"
 * column), never by Quote ID: a quote has many lines and Update always targets one row.
 *
 * Narrower than the quote form on purpose. Only lines of DRAFT quotes change. S.No, description
 * and UOM change freely. Quantity, rate and discount change only on a free-text line: a line the
 * pricing engine priced carries a stored margin check (pricing_document_id) that a file would
 * silently leave stale, so those are edited on the quote, where the guardrail runs again. The
 * line's amount and the quote's subtotal/total are re-derived with the form's own rules, and the
 * change is logged against the owning quote.
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

  const ids = [...new Set(rows.map((r) => r.values.id?.trim()).filter((x): x is string => !!x))];
  // "*" so a database without the pricing columns (0113/0114) still answers.
  const beforeRows: LineBefore[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from("standard_quote_lines").select("*").in("id", ids.slice(i, i + 150)).eq("tenant_id", tenantId);
    beforeRows.push(...((data ?? []) as LineBefore[]));
  }
  const beforeById = new Map(beforeRows.map((b) => [b.id, b]));

  const quoteIds = [...new Set(beforeRows.map((b) => b.standard_quote_id))];
  const quoteById = new Map<string, { id: string; ref: string; status: string }>();
  for (let i = 0; i < quoteIds.length; i += 150) {
    const { data } = await supabase.from("standard_quotes").select("id, ref, status").in("id", quoteIds.slice(i, i + 150)).eq("tenant_id", tenantId);
    for (const q of (data ?? []) as { id: string; ref: string; status: string }[]) quoteById.set(q.id, q);
  }

  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    const before = beforeById.get(id);
    if (!before) { outcomes.push({ rowNum, status: "failed", reason: `No record with id "${id}" found in this workspace` }); continue; }
    const quote = quoteById.get(before.standard_quote_id);
    if (!quote || quote.status !== "draft") {
      outcomes.push({ rowNum, status: "failed", reason: `Quote ${quote?.ref ?? ""} is ${quote?.status ?? "not available"}. Lines can only change on a draft quote` });
      continue;
    }

    const patch: Record<string, unknown> = {};
    if ("description" in values && !values.description?.trim()) {
      outcomes.push({ rowNum, status: "failed", reason: "description cannot be empty" });
      continue;
    }
    for (const key of STANDARD_QUOTE_LINE_TEXT_KEYS) {
      if (key in values) patch[key] = values[key]?.trim() || null;
    }

    const moneyKeys = STANDARD_QUOTE_LINE_MONEY_KEYS.filter((k) => k in values && values[k]?.trim());
    if (moneyKeys.length > 0) {
      if (before.pricing_document_id) {
        outcomes.push({ rowNum, status: "failed", reason: "This line was priced by the pricing engine. Change its quantity, rate or discount on the quote so the margin check runs again" });
        continue;
      }
      let bad = false;
      for (const key of moneyKeys) {
        const n = num(values[key]);
        if (n === null || n < 0) { outcomes.push({ rowNum, status: "failed", reason: `${key} must be a number, zero or more` }); bad = true; break; }
        patch[key] = key === "discount_pct" ? Math.min(100, n) : n;
      }
      if (bad) continue;
      const qty = (patch.qty as number | undefined) ?? before.qty;
      const rate = (patch.rate as number | undefined) ?? before.rate;
      const discountPct = (patch.discount_pct as number | undefined) ?? before.discount_pct;
      patch.amount = qty * rate * (1 - discountPct / 100);
    }

    if (Object.keys(patch).length === 0) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    prepared.push({ rowNum, id, patch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));

  const result = await updateRows(supabase, "standard_quote_lines", tenantId, prepared, outcomes);

  const updatedIds = new Set(
    result.outcomes.filter((o) => o.status === "updated").map((o) => prepared.find((p) => p.rowNum === o.rowNum)?.id).filter((x): x is string => !!x)
  );
  const touchedQuoteIds = [...new Set([...updatedIds].map((id) => beforeById.get(id)?.standard_quote_id).filter((x): x is string => !!x))];

  if (touchedQuoteIds.length > 0) {
    await recomputeStandardQuoteTotals(supabase, tenantId, touchedQuoteIds);

    const user = await getAuthUser();
    const logRows: ChangeLogEntryParams[] = [];
    for (const quoteId of touchedQuoteIds) {
      const quote = quoteById.get(quoteId);
      if (!quote) continue;
      const changes = [...updatedIds]
        .filter((id) => beforeById.get(id)?.standard_quote_id === quoteId)
        .map((id) => {
          const b = beforeById.get(id)!;
          const p = prepared.find((row) => row.id === id)!.patch;
          const qty = "qty" in p ? p.qty : b.qty;
          const rate = "rate" in p ? p.rate : b.rate;
          const description = "description" in p ? (p.description as string) : b.description;
          if (qty === b.qty && rate === b.rate && description === b.description) return null;
          return { field: `Line: ${b.description}`, from: `qty ${b.qty} × rate ${b.rate}`, to: `${description !== b.description ? `${description}, ` : ""}qty ${qty} × rate ${rate}` };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);
      if (changes.length > 0) {
        logRows.push({ tenantId, objectType: "standard_quotes", objectId: quoteId, objectLabel: quote.ref, action: "update", actorId: user?.id, actorEmail: user?.email, changes });
      }
    }
    if (logRows.length > 0) await logChangeBatch(supabase, logRows);
  }

  return NextResponse.json(result);
}
