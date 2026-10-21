import { NextResponse, type NextRequest } from "next/server";
import { guard, fail, objectOf } from "../_guard";
import { tokensFor } from "@/lib/webhooks/library";

// GET ?object_type=accounts|standard_quotes -> { tokens: [{ token, label, pii, kind }] }  (the closed whitelist, for the picker)
export async function GET(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const tokens = tokensFor(objectOf(req.nextUrl.searchParams.get("object_type")));
  if (!tokens) return fail(422, "Choose an object: accounts or standard_quotes.");
  return NextResponse.json({ tokens });
}
