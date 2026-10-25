import { NextResponse, type NextRequest } from "next/server";
import { candidatesForLine, openBoqRequest } from "@/lib/tender/boq/server";

// GET /api/opportunities/[id]/boq/candidates?line=<boq line id>  every price the sources offer for one line, with its age and whether
// it is stale (older than the workspace's price validity). Read-only.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const line = new URL(request.url).searchParams.get("line") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(line)) return NextResponse.json({ error: "Line not found" }, { status: 404 });
  const out = await candidatesForLine(gate.req, line);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
}
