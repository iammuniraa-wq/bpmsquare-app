import { NextResponse, type NextRequest } from "next/server";
import { applyPin, dismissPin, openPinRequest, unpinLine } from "@/lib/drawings/boqPins";

// PATCH  { action: "apply" }                  take the newly released revision's quantity and pin to it.
// PATCH  { action: "dismiss", reason }        keep the quantity as it is for that release; the reason is required and kept.
// DELETE                                       remove the pin (the client's quantity and the deal line are untouched).
// The BOQ line is looked up under THIS deal and workspace; another workspace's id matches nothing.

type Ctx = { params: Promise<{ id: string; boqId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id, boqId } = await params;
  const gate = await openPinRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  const out = action === "apply" ? await applyPin(gate.req, boqId)
    : action === "dismiss" ? await dismissPin(gate.req, boqId, body?.reason)
    : null;
  if (!out) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ pin: out.pin });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id, boqId } = await params;
  const gate = await openPinRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const out = await unpinLine(gate.req, boqId);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return new NextResponse(null, { status: 204 });
}
