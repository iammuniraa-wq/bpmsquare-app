import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { PdfNavigationError, renderPdf } from "@/lib/pdf/renderPdf";
import { loadStandardQuoteForFrame, standardQuoteFrame } from "@/lib/pdf/standardQuoteFrame";

export const runtime = "nodejs";
export const maxDuration = 60;

// Same headless-browser-prints-the-existing-page approach as
// api/invoices/[id]/pdf/route.ts and api/quotes/[id]/pdf/route.ts -- generic
// PDF-rendering plumbing, not specific to any one object, so reused verbatim
// even though Standard Quote's print page/component itself is independent.
//
// A workspace that chose a page frame (config.pdf_design) gets the framed document: the browser draws the running header and
// footer, the print page is asked for its body alone (?pdf=1). A workspace without one takes the original code path below,
// options and URL unchanged. One call = one document.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Standard Quotes isn't enabled for your workspace" }, { status: 403 });
  }

  const { id } = await params;
  const { data: quoteRow } = await supabase.from("standard_quotes").select("ref").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!quoteRow) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const cookieHeader = request.headers.get("cookie") ?? "";
  const tenant = await getTenant();
  const loaded = tenant?.config?.pdf_design ? await loadStandardQuoteForFrame(createAdminSupabase(), tenantId, id) : null;
  const frame = loaded && tenant ? await standardQuoteFrame(tenant, loaded.quote, loaded.account, loaded.blocks, null) : null;
  const printUrl = new URL(`/standard-quotes/${id}/print${frame ? "?pdf=1" : ""}`, request.nextUrl.origin).toString();

  try {
    const pdf = await renderPdf({
      source: { kind: "url", url: printUrl, cookie: cookieHeader },
      margin: { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" },
      settle: true,
      frame,
    });

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${String(quoteRow.ref).replace(/[^A-Za-z0-9._ -]+/g, "-")}.pdf"`,
      },
    });
  } catch (e: unknown) {
    if (e instanceof PdfNavigationError) return NextResponse.json({ error: "Failed to render quote for PDF" }, { status: 502 });
    console.error("[standard-quotes/pdf] render failed", e);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }
}
