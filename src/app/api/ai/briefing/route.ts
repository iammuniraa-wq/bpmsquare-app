import type { NextRequest } from "next/server";
import { briefingResponse } from "@/lib/briefing/access";

// GET /api/ai/briefing?lang= -- the signed-in person's briefing for today: yesterday, open today, where to focus.
// Worked out on the first call of the day in the workspace's time zone, then read from the stored row.
export async function GET(request: NextRequest) {
  return briefingResponse(request.nextUrl.searchParams.get("lang"), false);
}
