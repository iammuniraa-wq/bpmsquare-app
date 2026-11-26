import { NextResponse, type NextRequest } from "next/server";
import { isSession, resolveCheckSession } from "@/lib/suppliers/check/access";
import { checkGate, readSummaries } from "@/lib/suppliers/check/service";

// GET /api/suppliers/check-summary?ids=a,b,c -- the newest saved check of each supplier: verdict, rating and how many RFQs it rests on.
// Read-only and small, for the chip beside a supplier's name on the RFQ screens. Internal like the check itself: not in the v1 API.
export async function GET(request: NextRequest) {
  const s = await resolveCheckSession();
  if (!isSession(s)) return s;
  const gate = checkGate(s, "view");
  if (!gate.ok) return NextResponse.json({ summaries: [] });
  const ids = (request.nextUrl.searchParams.get("ids") ?? "").split(",").map((x) => x.trim().toLowerCase())
    .filter((x) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x));
  const { summaries, pending } = await readSummaries(s, ids);
  return NextResponse.json({ summaries, pending });
}
