import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

function esc(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;

  const { data: quote } = await supabase
    .from("quotes")
    .select("ref, name, type, status, total, valid_until, notes, terms, scope_of_work, created_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: lines } = await supabase
    .from("quote_lines")
    .select("description, uom, qty, rate, discount_pct, amount, group_label")
    .eq("quote_id", id)
    .eq("tenant_id", tenantId)
    .order("id");

  const rows: string[] = [];

  // Header block
  rows.push(`Ref,${esc(quote.ref)}`);
  rows.push(`Name,${esc(quote.name)}`);
  rows.push(`Type,${esc(quote.type)}`);
  rows.push(`Status,${esc(quote.status)}`);
  rows.push(`Date,${esc(quote.created_at?.slice(0, 10))}`);
  rows.push(`Valid Until,${esc(quote.valid_until?.slice(0, 10))}`);
  rows.push(``);

  if (quote.scope_of_work) {
    rows.push(`Scope of Work,${esc(quote.scope_of_work)}`);
    rows.push(``);
  }

  // Line items table
  rows.push(`#,Description,Group,UOM,Qty,Rate (INR),Disc %,Amount (INR)`);
  (lines ?? []).forEach((l, i) => {
    rows.push([
      i + 1,
      esc(l.description),
      esc(l.group_label),
      esc(l.uom),
      l.qty,
      l.rate,
      l.discount_pct ?? 0,
      l.amount,
    ].join(","));
  });

  rows.push(``);
  rows.push(`,,,,,,,Total (excl. tax),${quote.total}`);

  if (quote.notes) {
    rows.push(``);
    rows.push(`Notes,${esc(quote.notes)}`);
  }
  if (quote.terms) {
    rows.push(``);
    rows.push(`Terms & Conditions,${esc(quote.terms)}`);
  }

  const csv = rows.join("\r\n");
  const filename = `${quote.ref}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
