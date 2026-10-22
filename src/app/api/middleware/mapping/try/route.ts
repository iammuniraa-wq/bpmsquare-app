import { NextResponse } from "next/server";
import { guard, jsonBody } from "../../_guard";
import { tryOp } from "@/lib/middleware/mapping/engineOps";

export const maxDuration = 60;

// POST { connection, document: "quote", record_id? } -> { words: string[], request: { method, url, headers: string[] /* names only */, body }, problems: [{ code, message, fix, rowId? }] }
// The exact body the target would get for one Standard Quote (the ZZ sample when no record_id is given), through the SAVED
// mapping, converters and value lists applied. An unmapped value is a problem here, not an error. Nothing is sent or recorded.
export async function POST(req: Request) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await tryOp(g.ctx, await jsonBody(req));
  return NextResponse.json(o.body, { status: o.status });
}
