import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { PdfNavigationError, renderPdf } from "@/lib/pdf/renderPdf";

export const runtime = "nodejs";
export const maxDuration = 60;

// Mirrors src/app/api/quotes/[id]/pdf/route.ts exactly -- a headless browser navigates to the
// existing, already-tested print page and prints that, rather than importing react-dom/server
// (which the App Router's route-handler graph forbids).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data: invoiceRow } = await supabase.from("invoices").select("ref").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!invoiceRow) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const cookieHeader = request.headers.get("cookie") ?? "";
  const printUrl = new URL(`/invoices/${id}/print`, request.nextUrl.origin).toString();

  try {
    // "networkidle0" doesn't guarantee images have decoded, and the self-hosted PrintSans @font-face (it carries the
    // rupee glyph the render host lacks) loads asynchronously: renderPdf waits for both before printing.
    const pdf = await renderPdf({
      source: { kind: "url", url: printUrl, cookie: cookieHeader },
      margin: { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" },
      settle: true,
    });

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoiceRow.ref}.pdf"`,
      },
    });
  } catch (e: unknown) {
    if (e instanceof PdfNavigationError) return NextResponse.json({ error: "Failed to render invoice for PDF" }, { status: 502 });
    console.error("[invoices/pdf] render failed", e);
    // The message names the failing step (browser launch, navigation, print), which a blanket "failed" hides.
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF generation failed: ${detail}` }, { status: 500 });
  }
}
