import { NextResponse, type NextRequest } from "next/server";
import { htmlToPdf } from "@/lib/pdf/htmlToPdf";
import { getCapabilityCatalog, catalogById } from "@/lib/capability/catalog";
import { buildStudyHtml } from "@/lib/studio/pdfHtml";
import { studioAccess, errorResponse, ownedStudy, loadBundle } from "@/lib/studio/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// The package for the client's own team: the whole study as a PDF, "Indicative"
// on every page. Built server-side from the stored rows (no page navigation, no
// cookie forwarded) and fully escaped by buildStudyHtml.
//
// GET -> application/pdf

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await studioAccess("view");
    const study = await ownedStudy(ctx, (await params).id);
    const bundle = await loadBundle(ctx, study);
    const byId = catalogById(getCapabilityCatalog());
    const html = buildStudyHtml(bundle, {
      version: Math.max(1, study.current_version),
      labelOf: (id) => byId.get(id)?.label ?? id,
      reviewed: !!study.reviewed_at,
      generatedOn: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    });
    const pdf = await htmlToPdf(html);
    const file = `${(study.ref ?? "study").replace(/[^A-Za-z0-9_-]/g, "")}-${study.name.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
