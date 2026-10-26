import { NextResponse, type NextRequest } from "next/server";
import { editBoqLine, openBoqRequest } from "@/lib/tender/boq/server";

// PATCH /api/opportunities/[id]/boq/lines/[boqId]   { qty?, description? }
// The quantity and the description of one row of the Bill of quantities, from the row panel. The rate has its own route (boq/price, a
// manual rate) so the rules for a rate's source live in one place. Behind gcc_tender + pipeline edit access; the row is looked up under
// THIS deal and workspace, so another workspace's id matches nothing. The client's file values are never touched.

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; boqId: string }> }) {
  const { id, boqId } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!/^[0-9a-f-]{36}$/i.test(boqId)) return NextResponse.json({ error: "Line not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const out = await editBoqLine(gate.req, boqId, { qty: body.qty, description: body.description });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
}
