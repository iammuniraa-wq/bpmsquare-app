import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { applyFilters } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import { STANDARD_QUOTE_LINES_SPEC } from "@/lib/import/standardQuoteLinesSchema";
import { selectedLines } from "@/lib/sales/lineTotals";
import type { StandardQuoteLine } from "@/lib/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Every line of every standard quote of the workspace, with its own real id (the Update key) and
// its quote's Quote ID. The engine's pricing flags (the real margin against the floor) and the
// supplier-request link are not exported: they are internal pricing state. Read with "*" and
// mapped to the named columns below, so a database still missing 0116/0118 exports the same file
// (the optional columns read as empty) instead of an empty one.
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
  if (!canViewWorkcenter(perms, "standard_quotes")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };

  const [lines, quotes] = await Promise.all([
    fetchAllRows<StandardQuoteLine>(supabase, "standard_quote_lines", "*", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "standard_quotes", "id, ref", tenantId),
  ]);
  const refById = new Map(quotes.map((q) => [q.id, q.ref]));

  // Whether a line counts toward its quote's total is decided per quote (alternative options,
  // quantity breaks), so the answer is computed on each quote's own line set.
  const byQuote = new Map<string, StandardQuoteLine[]>();
  for (const l of lines) {
    const list = byQuote.get(l.standard_quote_id);
    if (list) list.push(l); else byQuote.set(l.standard_quote_id, [l]);
  }
  const counted = new Set<string>();
  for (const list of byQuote.values()) for (const l of selectedLines(list)) counted.add(l.id);

  const rows: Record<string, string>[] = lines.map((l) => ({
    id: l.id,
    standard_quote_ref: refById.get(l.standard_quote_id) ?? "",
    sl_no: l.sl_no ?? "",
    description: l.description ?? "",
    uom: l.uom ?? "",
    qty: l.qty != null ? String(l.qty) : "",
    rate: l.rate != null ? String(l.rate) : "",
    discount_pct: l.discount_pct != null ? String(l.discount_pct) : "",
    amount: l.amount != null ? String(l.amount) : "",
    group: l.group_label ?? "",
    selected: counted.has(l.id) ? "true" : "false",
  }));

  const typeByKey = new Map(STANDARD_QUOTE_LINES_SPEC.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}
