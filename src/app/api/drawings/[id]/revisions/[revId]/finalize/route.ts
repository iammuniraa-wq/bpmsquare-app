import { NextResponse, type NextRequest } from "next/server";
import { failResponse, jsonBody } from "@/lib/drawings/http";
import { openRevision } from "@/lib/drawings/open";
import { finalizeUpload } from "@/lib/drawings/writes";

// POST { name, sha256 } -> the revision with its file recorded: step 2 of attaching a file. The server reads the first bytes of what is in
// storage, decides what it really is (SVG and HTML are refused whatever the name), takes the size from storage, and keeps the fingerprint the
// browser computed. That fingerprint is checked again, against the stored bytes, when the revision is released.

type Ctx = { params: Promise<{ id: string; revId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id, revId } = await params;
  const opened = await openRevision(id, revId, { write: true });
  if (!opened.ok) return failResponse(opened);
  const body = (await jsonBody(request)) ?? {};
  const out = await finalizeUpload(opened.req, opened.drawing, opened.revision, body);
  if (!out.ok) return failResponse(out);
  return NextResponse.json(out.revision);
}
