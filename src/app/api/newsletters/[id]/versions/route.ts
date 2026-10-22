import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, newsletterAccess, ownedBundle } from "@/lib/newsletter/server";

// GET /api/newsletters/[id]/versions -> the versions kept so far. A version is kept by the send itself
// (POST /api/newsletters/[id]/send) and by a journey picking the newsletter, never by hand.

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
