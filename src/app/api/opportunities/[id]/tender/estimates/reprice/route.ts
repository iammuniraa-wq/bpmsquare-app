import { NextResponse, type NextRequest } from "next/server";
import { openEstimatesRequest, repriceRequest } from "@/lib/tender/estimates/server";

// "Estimate changed, re-price" (migration 0227): POST { link_ids?, boq_ids?, all_stale?, markup_pct? } prices the named lines again from
// their estimates as they are now. It is a person's act: only an RFQ award re-prices by itself, and never once the bid is in.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openEstimatesRequest(id, "write");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const out = await repriceRequest(gate.req, body);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true, repriced: out.repriced, failed: out.failed });
}
