import { NextResponse, type NextRequest } from "next/server";
import { inboxAccess, errorResponse } from "@/lib/inbox/server";
import { attachmentLink } from "@/lib/inbox/files";

// GET /api/inbox/attachments/[id] -> { url, name }: a 60-second signed link to one file of a message the person may see.
// 404 when the file, its message or its channel is not theirs.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await inboxAccess(false);
    const { id } = await params;
    // ?view=1 opens a PDF in the browser instead of downloading it (used by the estimate review's "Open page").
    const link = await attachmentLink(ctx, id, req.nextUrl.searchParams.get("view") === "1");
    if (!link) return NextResponse.json({ error: "File not found" }, { status: 404 });
    return NextResponse.json(link, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
