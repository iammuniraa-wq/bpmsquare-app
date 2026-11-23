import { NextResponse, type NextRequest } from "next/server";
import { failResponse, jsonBody } from "@/lib/drawings/http";
import { openRevision } from "@/lib/drawings/open";
import { requestUpload } from "@/lib/drawings/writes";

// POST { name, size } -> { path, token, signedUrl }: step 1 of attaching a file to a DRAFT revision. The name's type and the size are checked
// BEFORE any bytes move; the bytes then go from the browser straight to the private bucket (a function cannot take a 50 MB body), and
// step 2 (finalize) reads what actually arrived. The target is always <tenant>/<drawing>/<revision>/<safe name>: the tenant and the ids come
// from the route and the session, never from the body.

type Ctx = { params: Promise<{ id: string; revId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id, revId } = await params;
  const opened = await openRevision(id, revId, { write: true });
  if (!opened.ok) return failResponse(opened);
  const body = (await jsonBody(request)) ?? {};
  const out = await requestUpload(opened.req, opened.drawing, opened.revision, body);
  if (!out.ok) return failResponse(out);
  return NextResponse.json({ path: out.path, token: out.token, signedUrl: out.signedUrl });
}
