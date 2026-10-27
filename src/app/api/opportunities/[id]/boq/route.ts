import { NextResponse, type NextRequest } from "next/server";
import { applyUpload, buildBoqState, openBoqRequest, unpricedList } from "@/lib/tender/boq/server";
import { readUploadForm } from "@/lib/tender/boq/upload";

// GET  /api/opportunities/[id]/boq  the BOQ of a tender deal: source file, lines, price sources, totals (and the unpriced list).
// POST /api/opportunities/[id]/boq  multipart: file, optional sheet / header_row / map. Reads the workbook, then creates or updates
//                                   the deal's lines (a revised file updates by item number; priced lines are never silently removed).
// Behind gcc_tender + pipeline; a workspace without them, or a deal that is not a tender of THIS workspace, gets a 404 and nothing is read.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const state = await buildBoqState(gate.req);
  return NextResponse.json({ ...state, unpriced: unpricedList(state) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const form = await readUploadForm(request);
  if (!form.ok) return NextResponse.json({ error: form.error }, { status: form.status });
  const result = await applyUpload(gate.req, form.input);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
