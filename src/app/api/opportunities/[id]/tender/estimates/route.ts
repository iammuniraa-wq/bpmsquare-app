import { NextResponse } from "next/server";
import { tenantHasFeature } from "@/lib/tenant";
import { buildEstimatesState, openEstimatesRequest } from "@/lib/tender/estimates/server";

// The Estimates tab of a tender deal (GCC tender deals, slice 3c-1, migration 0227): the estimates made for this deal with their cost,
// price and last change, the templates a new one can start from, and what the person may do. Creating an estimate is the ordinary
// estimate screen (/estimates/new?opportunity=<id>) and the ordinary POST /api/estimates, which attaches it to this deal.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openEstimatesRequest(id, "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const r = gate.req;
  const [state, rich, rfqOn] = await Promise.all([
    buildEstimatesState(r),
    r.admin.from("estimate_templates").select("id, name, description, trade, keywords, inputs").eq("tenant_id", r.tenantId).eq("is_active", true).order("name").limit(200),
    tenantHasFeature(r.admin, r.tenantId, "rfq"),
  ]);
  // keywords come with migration 0213; without it the picker still lists the templates, it just cannot suggest one.
  const tpl = rich.error ? await r.admin.from("estimate_templates").select("id, name, description, trade, inputs").eq("tenant_id", r.tenantId).eq("is_active", true).order("name").limit(200) : rich;
  type Row = { id: string; name: string; description: string | null; trade?: string | null; keywords?: string[] | null; inputs?: unknown };
  return NextResponse.json({
    ...state,
    templates: ((tpl.error ? [] : tpl.data ?? []) as Row[]).map((t) => ({
      id: t.id, name: t.name, description: t.description, trade: t.trade ?? null, keywords: Array.isArray(t.keywords) ? t.keywords : [],
      inputs: Array.isArray(t.inputs) ? (t.inputs as { key: string; label?: string; type: string; unit?: string; boq_units?: string[] }[]).map((i) => ({ key: i.key, label: i.label, type: i.type, unit: i.unit, boq_units: i.boq_units })) : [],
    })),
    can_create: r.canCreateEstimates, rfq_enabled: rfqOn,
  });
}
