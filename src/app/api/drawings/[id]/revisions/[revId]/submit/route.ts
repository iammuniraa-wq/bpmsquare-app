import { NextResponse, type NextRequest } from "next/server";
import { failResponse } from "@/lib/drawings/http";
import { openRevision } from "@/lib/drawings/open";
import { submitRevision } from "@/lib/drawings/writes";

// POST: draft -> in review. Needs the drawing number (and the type's numbering pattern), a revision label, a file or a loaded element schedule,
// and whatever the type makes required. 422 names the first missing thing and carries the whole list as `problems`.

type Ctx = { params: Promise<{ id: string; revId: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id, revId } = await params;
  const opened = await openRevision(id, revId, { write: true });
  if (!opened.ok) return failResponse(opened);
  const out = await submitRevision(opened.req, opened.drawing, opened.revision);
  if (!out.ok) return failResponse(out);
  return NextResponse.json(out.revision);
}
