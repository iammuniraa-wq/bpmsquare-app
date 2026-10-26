import { NextResponse, type NextRequest } from "next/server";
import { openRateSheet, previewRateSheet, readUpload } from "@/lib/estimator/rateSheet/server";

// POST /api/estimate-templates/rate-sheet/preview  multipart: file, as_of (YYYY-MM-DD, optional).
// Reads the sheet and says, row by row, what it matches in the catalogue and how well, which rows are stale, and which cannot be
// applied. Nothing is stored and no table is written: the same file is sent again to /rate-sheet to apply it. Administrators only.

export async function POST(request: NextRequest) {
  const gate = await openRateSheet();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const form = await readUpload(request);
  if (!form.ok) return NextResponse.json({ error: form.error }, { status: form.status });
  const done = await previewRateSheet(gate.ctx, form.input);
  if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.status });
  return NextResponse.json(done.view);
}
