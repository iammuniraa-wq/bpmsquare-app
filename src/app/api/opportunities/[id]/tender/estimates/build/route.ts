import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { buildUpRate, openEstimatesRequest } from "@/lib/tender/estimates/server";

// "Build up this rate" (migration 0227): POST { boq_id, template_id, margin_pct? } makes an estimate for one BOQ line from a template,
// attached to the deal, with the quantity prefilled where the template has an input for it, and a link that waits until the person
// comes back and prices the line from the estimate's total divided by the quantity.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openEstimatesRequest(id, "create");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await req.json().catch(() => null)) as { boq_id?: unknown; template_id?: unknown; margin_pct?: unknown } | null;
  if (!body) return NextResponse.json({ error: "A JSON body is required" }, { status: 422 });
  const out = await buildUpRate(gate.req, body);
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.extra ?? {}) }, { status: out.status });
  const user = await getAuthUser();
  await logChange(gate.req.supabase, {
    tenantId: gate.req.tenantId, objectType: "opportunity_tenders", objectId: gate.req.opp.id, objectLabel: `${gate.req.opp.ref ?? ""} ${gate.req.opp.title}`.trim(), action: "update",
    actorId: user?.id, actorEmail: user?.email, changes: [{ field: "BOQ rate build-up started", from: null, to: out.ref ?? out.estimate_id }],
  });
  return NextResponse.json({ ok: true, estimate_id: out.estimate_id, ref: out.ref, link_id: out.link_id }, { status: 201 });
}
