import { NextResponse, type NextRequest } from "next/server";
import { analyseUpload, openBoqRequest } from "@/lib/tender/boq/server";
import { readUploadForm } from "@/lib/tender/boq/upload";

// POST /api/opportunities/[id]/boq/preview  multipart: file, optional sheet / header_row / map.
// Reads the workbook and says what it found (sheet, header row, column map, a sample, and for a revised file the diff against the
// deal). Nothing is stored and no table is written: the same file is sent again to /boq to apply it.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const form = await readUploadForm(request);
  if (!form.ok) return NextResponse.json({ error: form.error }, { status: form.status });
  const a = await analyseUpload(gate.req, form.input);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  return NextResponse.json(a.view);
}
