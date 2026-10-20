import { NextResponse, type NextRequest } from "next/server";
import { loadDidItWork } from "@/lib/signals/didItWork";
import { errorResponse, isUuid, signalsAccess } from "@/lib/signals/access";

// GET /api/signals/campaign/[id] -> "Did it work?" for one sent campaign or newsletter send.
// The campaign id comes from the URL and is matched with the caller's tenant before anything is read.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await signalsAccess("view");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const out = await loadDidItWork(ctx.admin, ctx.tenantId, id);
    if (!out) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
