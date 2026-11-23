import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody } from "../../../_guard";
import { testDraft } from "@/lib/connections/ops";
import type { ConnectionInput } from "@/lib/connections/spec";

// Test what is on screen, before saving (step 3 of Add connection). Same body as POST /connections plus an optional `id`: with an
// id, a blank secret is filled from the stored one. Nothing is stored. -> { result }.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await testDraft(g.ctx, await jsonBody<ConnectionInput & { id?: unknown }>(req));
  return NextResponse.json(o.body, { status: o.status });
}
