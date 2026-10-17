import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/estimator/requests";
import { toExportLine, templateGroupNames } from "@/lib/estimator/lines";
import {
  resolveErpProfile, buildBomTable, buildWbsTable, tableToCsv, tableToXlsx, exportFilename,
  ERP_EXPORT_PROFILES, type ExportKind, type ExportFormat,
} from "@/lib/estimator/exports";
import { estimatorAccess, errorResponse, pendingResponse, loadEstimate, loadLines, loadTemplate } from "@/lib/estimator/server";

// GET /api/estimates/[id]/export?format=bom|wbs&type=csv|xlsx&profile=generic|dynamics365|sap&include=items|all
// INTERNAL: the files carry unit costs and line costs, so they are for people who can
// see the estimate (admin, or a Business Role with view on Estimates), never for a
// customer context. 400 for an unknown format, type or profile.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenantId } = await estimatorAccess("view");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    const sp = req.nextUrl.searchParams;

    const kind = (sp.get("format") ?? "bom").toLowerCase();
    if (kind !== "bom" && kind !== "wbs") return NextResponse.json({ error: 'format must be "bom" or "wbs".' }, { status: 400 });
    const type = (sp.get("type") ?? "xlsx").toLowerCase();
    if (type !== "csv" && type !== "xlsx") return NextResponse.json({ error: 'type must be "csv" or "xlsx".' }, { status: 400 });
    const profile = resolveErpProfile(sp.get("profile"));
    if (!profile) {
      return NextResponse.json({ error: `Unknown profile "${(sp.get("profile") ?? "").slice(0, 40)}". Available: ${Object.keys(ERP_EXPORT_PROFILES).join(", ")}.` }, { status: 400 });
    }

    const est = await loadEstimate(supabase, tenantId, id);
    if (est.missing) return pendingResponse();
    if (!est.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    const tpl = est.data.template_id ? (await loadTemplate(supabase, tenantId, est.data.template_id)).data : null;
    const groups = tpl ? templateGroupNames(tpl.rules) : new Map<string, string>();
    const lines = (await loadLines(supabase, tenantId, id)).map((l) => toExportLine(l, groups));

    const table = kind === "bom"
      ? buildBomTable(lines, profile, { include: sp.get("include") === "all" ? "all" : "items" })
      : buildWbsTable(lines, profile);
    const filename = exportFilename(est.data.ref, kind as ExportKind, profile.key, type as ExportFormat);
    const headers = { "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" };
    if (type === "csv") {
      return new Response(tableToCsv(table, { bom: true }), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
    }
    const buf = await tableToXlsx(table, kind === "bom" ? "BOM" : "WBS");
    return new Response(new Uint8Array(buf), {
      headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
