import { NextResponse, type NextRequest } from "next/server";
import { failResponse, jsonBody } from "@/lib/drawings/http";
import { openDrawing } from "@/lib/drawings/open";
import { loadRevisions } from "@/lib/drawings/server";
import { startRevision } from "@/lib/drawings/writes";

// GET  /api/drawings/[id]/revisions  the revisions, oldest first (superseded ones stay readable).
// POST /api/drawings/[id]/revisions  { rev_label?, notes?, source?, source_ref? } starts the next revision as a DRAFT. One open revision (draft
//        or in review) at a time: 409 while another is open. A connector's `source_ref` (a file hash, an ACC version id) can arrive only once.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const opened = await openDrawing(id);
  if (!opened.ok) return failResponse(opened);
  const { rows } = await loadRevisions(opened.req.admin, opened.req.tenantId, id);
  return NextResponse.json({ revisions: rows });
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const opened = await openDrawing(id, { write: true });
  if (!opened.ok) return failResponse(opened);
  const body = (await jsonBody(request)) ?? {};
  const started = await startRevision(opened.req, opened.drawing, body);
  if (!started.ok) return failResponse(started);
  return NextResponse.json(started.revision, { status: 201 });
}
