import { NextResponse, type NextRequest } from "next/server";
import { ROUTES } from "@/lib/constants";
import { createVersion, errorResponse, newsletterAccess, ownedBundle, pendingResponse } from "@/lib/newsletter/server";

// GET  /api/newsletters/[id]/versions -> the versions kept so far
// POST /api/newsletters/[id]/versions -> "Use in a campaign": keeps an immutable copy (or reuses the latest when
//      nothing changed) and says where to go next: { id, version, reused, next }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await newsletterAccess("view");
    const { id } = await params;
    const b = await ownedBundle(ctx, id);
    return NextResponse.json({ versions: b.versions });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await newsletterAccess("edit");
    const { id } = await params;
    const b = await ownedBundle(ctx, id);
    if (b.newsletter.is_template) return NextResponse.json({ error: "A template is a starting point. Start a newsletter from it, then use that in a campaign." }, { status: 422 });
    if (b.newsletter.status === "archived") return NextResponse.json({ error: "This newsletter is archived." }, { status: 422 });
    const v = await createVersion(ctx, b);
    if ("missing" in v) return pendingResponse();
    return NextResponse.json({ id: v.id, version: v.version, reused: v.reused, next: `${ROUTES.marketingNew}?newsletter=${v.id}` });
  } catch (e) {
    return errorResponse(e);
  }
}
