import { NextResponse, type NextRequest } from "next/server";
import { verifyQuotePublicToken } from "@/lib/quotePublicLink";
import { getQuoteByPublicToken } from "@/lib/data";
import { PdfNavigationError, renderPdf } from "@/lib/pdf/renderPdf";

export const runtime = "nodejs";
export const maxDuration = 60;

// Public counterpart to /api/quotes/[id]/pdf -- no session, reached via a signed
// link (see lib/quotePublicLink.ts). Same render approach (headless browser prints
// the already-built print page) but navigates to the token-gated print-public page
// instead of forwarding a session cookie, since there isn't one.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  if (!verifyQuotePublicToken(id, token)) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
  }

  const data = await getQuoteByPublicToken(id);
  if (!data) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const printUrl = new URL(`/quotations/${id}/print-public/${token}`, request.nextUrl.origin).toString();

  try {
    // Same render as ../../pdf/route.ts: fonts and images settle first, and the bottom margin is the footer band the
    // print page measured and published, so no flat constant (see renderPdf).
    const pdf = await renderPdf({
      source: { kind: "url", url: printUrl },
      margin: { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" },
      settle: true,
      footerAwareBottomMargin: true,
    });

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${data.quote.ref}.pdf"`,
      },
    });
  } catch (e: unknown) {
    if (e instanceof PdfNavigationError) return NextResponse.json({ error: "Failed to render quote for PDF" }, { status: 502 });
    console.error("[quotes/pdf-public] render failed", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF generation failed: ${detail}` }, { status: 500 });
  }
}
