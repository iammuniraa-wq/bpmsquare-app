import { NextResponse, type NextRequest } from "next/server";
import { failResponse, jsonBody } from "@/lib/drawings/http";
import { openRevision } from "@/lib/drawings/open";
import { releaseRevision } from "@/lib/drawings/writes";

// POST { effective_from? }: in review -> released, superseding the revision that was released before, in ONE database transaction.
// Authority is the drawing TYPE's, checked here on the server (not a Business Role, not the module's edit grant): a named approver, or an admin
// when the type names none; and, when the type asks for a second person, never the person who submitted it. This route needs a signed-in
// person, so a connector can never release. A member's own session cannot do it directly either: the table has no member write policy and the
// release function is executable by the service role only.

type Ctx = { params: Promise<{ id: string; revId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id, revId } = await params;
  // `write` is deliberately NOT required: a named approver may hold only a view grant on the module. The type's approver list decides.
  const opened = await openRevision(id, revId);
  if (!opened.ok) return failResponse(opened);
  const body = (await jsonBody(request)) ?? {};
  const out = await releaseRevision(opened.req, opened.drawing, opened.revision, body);
  if (!out.ok) return failResponse(out);
  return NextResponse.json({ revision: out.revision, superseded_id: out.supersededId });
}
