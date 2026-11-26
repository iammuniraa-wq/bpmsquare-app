import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse } from "@/lib/rfq/server";
import { loadAwardChecks } from "@/lib/suppliers/check/awardGateServer";

// GET ?ids=a,b -- the newest saved Supplier check of each supplier about to be awarded: verdict and its strongest two findings, for the
// warning in the award dialogs. Read-only and tenant-scoped; the award routes ask the same question again before anything is written.
export async function GET(req: NextRequest) {
  try {
    const { admin, tenantId } = await rfqAccess(false);
    const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const { checks, failed } = await loadAwardChecks(admin, tenantId, ids);
    return NextResponse.json({ checks, failed });
  } catch (e) {
    return errorResponse(e);
  }
}
