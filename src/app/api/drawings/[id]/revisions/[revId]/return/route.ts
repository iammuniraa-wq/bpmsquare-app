import { NextResponse, type NextRequest } from "next/server";
import { failResponse, jsonBody } from "@/lib/drawings/http";
import { openRevision } from "@/lib/drawings/open";
import { returnRevision } from "@/lib/drawings/writes";

// POST { reason }: in review -> draft. By the person who submitted it, a named approver of the type, or a workspace admin. A reason is
// required. "Returned" is not a status: the revision is a draft again, with the reason shown.

type Ctx = { params: Promise<{ id: string; revId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id, revId } = await params;
  // Not `write`: a named approver may hold a view grant only; mayReturn() decides who may send it back.
  const opened = await openRevision(id, revId);
  if (!opened.ok) return failResponse(opened);
  const body = (await jsonBody(request)) ?? {};
  const out = await returnRevision(opened.req, opened.drawing, opened.revision, body.reason);
  if (!out.ok) return failResponse(out);
  return NextResponse.json(out.revision);
}
