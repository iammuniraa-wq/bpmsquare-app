import { NextResponse } from "next/server";
import { guard } from "../../../../_guard";
import { tryEndpoint } from "@/lib/connections/endpointOps";

// Read the first rows of an In endpoint. POST -> { result: { ok, message, fix, rows, fields } } (field NAMES, never values).
// Nothing is written to the system; the call is recorded in the Monitor.
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await tryEndpoint(g.ctx, (await params).id);
  return NextResponse.json(o.body, { status: o.status });
}
