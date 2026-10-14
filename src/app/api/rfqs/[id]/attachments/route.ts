import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, ATTACHMENT_BUCKET } from "@/lib/rfq/server";

// GET ?path=<storage path> -- a short-lived download link for one file on
// this RFQ's conversation. The path must sit under this tenant's and this
// RFQ's folder AND be referenced by one of its messages: a path is never
// signed just because someone typed it.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, tenantId } = await rfqAccess(false);
    const { id } = await params;
    const path = req.nextUrl.searchParams.get("path") ?? "";
    if (!path.startsWith(`${tenantId}/rfq/${id}/`) || path.includes("..")) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data: msgs } = await admin.from("rfq_messages").select("attachments").eq("tenant_id", tenantId).eq("rfq_id", id);
    const known = ((msgs ?? []) as { attachments: { path: string; filename: string }[] }[]).flatMap((m) => m.attachments ?? []).find((a) => a.path === path);
    if (!known) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await admin.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 120, { download: known.filename });
    if (error || !data?.signedUrl) return NextResponse.json({ error: "File unavailable" }, { status: 404 });
    return NextResponse.redirect(data.signedUrl);
  } catch (e) {
    return errorResponse(e);
  }
}
