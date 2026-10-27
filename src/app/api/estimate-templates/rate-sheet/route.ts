import { NextResponse, type NextRequest } from "next/server";
import { applyRateSheet, openRateSheet, readUpload, starterRateSheetCsv } from "@/lib/estimator/rateSheet/server";

// GET  /api/estimate-templates/rate-sheet  -> a CSV to fill in: every starter catalogue item this workspace has, rate blank.
// POST /api/estimate-templates/rate-sheet  multipart: file, as_of (YYYY-MM-DD, optional), decisions (JSON, optional).
//   Writes the rates of the sheet to the catalogue (products.cost_price, cost_price_as_of) as the person chose in the preview, keeps the
//   rate it replaces, clears the "illustrative" mark of the items it prices, and logs every change. The file is read again here; nothing
//   the browser sends back about a row, a match or a price is trusted. Administrators only.

export async function GET() {
  const gate = await openRateSheet();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const csv = await starterRateSheetCsv(gate.ctx);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="rate-sheet-starter-items.csv"', "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const gate = await openRateSheet();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const form = await readUpload(request);
  if (!form.ok) return NextResponse.json({ error: form.error }, { status: form.status });
  const done = await applyRateSheet(gate.ctx, form.input);
  if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.status });
  return NextResponse.json(done.view);
}
