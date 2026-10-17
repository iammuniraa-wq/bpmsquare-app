import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/estimator/requests";
import { buildScheduleTemplateCsv, buildScheduleTemplateWorkbook } from "@/lib/estimator/schedule";
import { estimatorAccess, errorResponse, pendingResponse, loadEstimate, loadTemplate, templateBody } from "@/lib/estimator/server";

// GET /api/estimates/schedule-template?template_id=<id>|estimate_id=<id>&format=xlsx|csv
// The blank element-schedule file for a template: the documented columns, a sample
// row, and (xlsx) a sheet listing the element types that template accepts.
export async function GET(req: NextRequest) {
  try {
    const { supabase, tenantId } = await estimatorAccess("view");
    const sp = req.nextUrl.searchParams;
    let templateId = sp.get("template_id");
    const estimateId = sp.get("estimate_id");
    if (!templateId && estimateId) {
      if (!isUuid(estimateId)) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
      const est = await loadEstimate(supabase, tenantId, estimateId);
      if (est.missing) return pendingResponse();
      templateId = est.data?.template_id ?? null;
    }
    if (!isUuid(templateId)) return NextResponse.json({ error: "Give a template_id or an estimate_id." }, { status: 422 });
    const tpl = await loadTemplate(supabase, tenantId, templateId);
    if (tpl.missing) return pendingResponse();
    if (!tpl.data) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    const body = templateBody(tpl.data);
    if (sp.get("format") === "csv") {
      return new Response(buildScheduleTemplateCsv(body), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="element-schedule-template.csv"', "Cache-Control": "no-store" },
      });
    }
    const buf = await buildScheduleTemplateWorkbook(body);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="element-schedule-template.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
