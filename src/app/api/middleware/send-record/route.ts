import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, needsUpdate } from "../_guard";
import { sendRecord, SENDABLE_OBJECTS } from "@/lib/middleware/ops";

// POST { object_type: "accounts" | "standard_quotes", id } -- "Send a record" (replaces the
// Push to ERP button on an account). The record is looked up by id AND this workspace.
//   accounts         -> the account push path (the ERP endpoint under Other lanes)
//   standard_quotes  -> the same engine as Send now (awarded / rejected by its status)
// GET lists the object types it accepts.
// -> { ok, message, number?, link? }  or  { ok:false, headline, fix }
export const maxDuration = 120;

export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  return NextResponse.json({ object_types: SENDABLE_OBJECTS });
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const body = await jsonBody<{ object_type?: string; id?: string }>(req);
  const r = await sendRecord(g.ctx.admin, g.ctx.tenantId, g.ctx.userId, String(body.object_type ?? ""), String(body.id ?? ""));
  if (!r.ok && r.needsDatabaseUpdate) return needsUpdate();
  return NextResponse.json(r, { status: r.ok ? 200 : r.status });
}
