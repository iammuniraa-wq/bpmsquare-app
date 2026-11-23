import { NextResponse, type NextRequest } from "next/server";
import { failResponse } from "@/lib/drawings/http";
import { openRevision } from "@/lib/drawings/open";
import { pathBelongsTo } from "@/lib/drawings/files";
import { signedDownload } from "@/lib/drawings/server";

// GET -> 303 to a 5-minute signed link, as an ATTACHMENT (never rendered in our origin). The revision must belong to this drawing of this
// workspace and the stored path must sit under this tenant's own folder; otherwise 404. The bytes are never public.

type Ctx = { params: Promise<{ id: string; revId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id, revId } = await params;
  const opened = await openRevision(id, revId);
  if (!opened.ok) return failResponse(opened);
  const rev = opened.revision;
  if (!rev.file_path || !pathBelongsTo(rev.file_path, opened.req.tenantId, id, rev.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = await signedDownload(opened.req.admin, rev);
  if (!url) return NextResponse.json({ error: "The file is not available" }, { status: 404 });
  return NextResponse.redirect(url, 303);
}
