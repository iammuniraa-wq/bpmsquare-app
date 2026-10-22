import type { NextRequest } from "next/server";
import { briefingResponse } from "@/lib/briefing/access";

// POST /api/ai/briefing/refresh -- work today's briefing out again. Recomputes at most once per five minutes per
// person; inside that window the stored briefing comes back with `refreshableAt`.
export async function POST(request: NextRequest) {
  return briefingResponse(request.nextUrl.searchParams.get("lang"), true);
}
