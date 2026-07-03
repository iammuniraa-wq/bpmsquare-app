import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id: caseId } = await params;
  const body = await request.json() as {
    findings: string;
    recommendations: string;
    estimated_cost?: number | null;
    action: "save" | "send";
  };

  const { findings, recommendations, estimated_cost, action } = body;

  // Verify case belongs to this tenant before touching it
  const { data: existingCase, error: caseErr } = await supabase
    .from("service_cases")
    .select("id")
    .eq("id", caseId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (caseErr || !existingCase) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  // Look for an existing report for this case
  const { data: existing } = await supabase
    .from("inspection_reports")
    .select("id")
    .eq("case_id", caseId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const reportPayload: Record<string, unknown> = {
    case_id: caseId,
    tenant_id: tenantId,
    findings,
    recommendations,
    estimated_cost: estimated_cost ?? null,
    status: action === "send" ? "sent" : "draft",
    ...(action === "send" ? { sent_at: new Date().toISOString() } : {}),
  };

  let reportData, reportError;

  if (existing?.id) {
    // Update existing report
    ({ data: reportData, error: reportError } = await supabase
      .from("inspection_reports")
      .update(reportPayload)
      .eq("id", existing.id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single());
  } else {
    // Insert new report
    ({ data: reportData, error: reportError } = await supabase
      .from("inspection_reports")
      .insert(reportPayload)
      .select("*")
      .single());
  }

  if (reportError) {
    return NextResponse.json({ error: reportError.message }, { status: 500 });
  }

  // On "send", advance the case to report_sent
  if (action === "send") {
    const { error: caseUpdateErr } = await supabase
      .from("service_cases")
      .update({ status: "report_sent" })
      .eq("id", caseId)
      .eq("tenant_id", tenantId);

    if (caseUpdateErr) {
      return NextResponse.json({ error: caseUpdateErr.message }, { status: 500 });
    }
  }

  return NextResponse.json(reportData);
}
