import { NextResponse, type NextRequest } from "next/server";
import { openTenderDealRequest } from "@/lib/tender/dealAccess";
import { chooseTemplate, termsState } from "@/lib/contractProjects/paymentTermsServer";

// GET   /api/opportunities/[id]/tender/payment-terms -> { templates: [{ id, name, milestones }], chosen: { template_id, name, milestones, chosen_at } | null }
// PATCH /api/opportunities/[id]/tender/payment-terms  { template_id: string | null }
//        Chooses (or clears) the payment-term template that prints in the tender's bid documents and is kept with the bid version that
//        is submitted next. The template must be one of this workspace's; the tender is the session's workspace's (openTenderDealRequest).

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return NextResponse.json(await termsState(gate.req.tender.custom_data));
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || !("template_id" in body)) return NextResponse.json({ error: "template_id is required" }, { status: 400 });
  const templateId = body.template_id === null ? null : typeof body.template_id === "string" ? body.template_id : undefined;
  if (templateId === undefined) return NextResponse.json({ error: "template_id must be an id or null" }, { status: 400 });
  const done = await chooseTemplate(gate.req, templateId);
  if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.status });
  return NextResponse.json(done.state);
}
