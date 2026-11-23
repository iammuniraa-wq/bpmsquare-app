import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { PdfNavigationError, renderPdf } from "@/lib/pdf/renderPdf";

export const runtime = "nodejs";
export const maxDuration = 60;

// Server-rendered PDF, replacing the browser's own print dialog (which stamps its own
// timestamp/title into the header and footer that no amount of CSS can suppress — CR-002).
// Rather than re-implementing the print layout via react-dom/server (which the App Router's
// route-handler graph forbids importing), a headless browser navigates to the existing,
// already-tested print page and prints *that* — same auth, same markup, single source of truth.
/**
 * POST — print the page the user is ACTUALLY LOOKING AT.
 *
 * The GET handler below navigates a fresh headless browser to the print URL
 * and prints its own render. That has never reliably matched the screen: a
 * cold navigation re-runs hydration, refetches fonts and images, and settles
 * at a different moment than the live page that has been sitting open. Three
 * rounds of server-side waits (networkidle0, fonts.ready, image decode, and
 * finally reusing the client's published footer margin on 2026-09-20) each
 * narrowed the gap without closing it, and the client reported it still
 * wrong -- which is why "Download PDF" had been reduced to window.print(),
 * and why Chrome then stamped its own timestamp and URL on the output.
 *
 * So stop re-rendering. The browser posts its own settled DOM and this route
 * prints THAT. There is no second render to disagree with the first.
 *
 * Three things make the posted DOM safe to hand to a headless browser:
 *   - it is authenticated and tenant-checked, exactly like the GET below;
 *   - every <script> is stripped, so nothing re-hydrates and mutates the DOM
 *     after it arrives (and no posted script can run at all);
 *   - requests are intercepted and only this deployment's own origin plus
 *     data:/blob: URIs are allowed, so a crafted <img src> cannot make the
 *     server fetch an internal address (MULTI_TENANT_GUARDRAILS.md's rule for
 *     server-side fetches of client-supplied URLs).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data: quoteRow } = await supabase.from("quotes").select("ref").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!quoteRow) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { html?: string; footerMarginMm?: number } | null;
  const html = body?.html;
  if (typeof html !== "string" || html.length < 200) {
    return NextResponse.json({ error: "No page content received" }, { status: 400 });
  }

  // Clamped to the same range QuotePrint.tsx computes, so a tampered or
  // stale value can't produce a page with no body area or none reserved.
  const rawMargin = typeof body?.footerMarginMm === "number" ? body.footerMarginMm : 30;
  const bottomMarginMm = Math.min(60, Math.max(20, Math.round(rawMargin)));

  // The tenant's logos are uploaded to Supabase Storage, so they are NOT
  // same-origin -- the blanket abort below rendered every one of them as a
  // broken image in the PDF (reported by Vikas, 2026-09-29). Allowing "any
  // remote image" would hand back exactly the SSRF the interception exists
  // to prevent, so the allowlist is built server-side from the URLs THIS
  // tenant has actually stored. A crafted <img src> in the posted markup
  // matches nothing and is still aborted.
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("logo_url, company_info")
    .eq("id", tenantId)
    .maybeSingle();
  const companyInfo = (tenantRow?.company_info ?? {}) as {
    logo_url?: string;
    certifications?: { logo_url?: string }[];
    partners?: { logo_url?: string }[];
  };
  // https only: a stored http:// URL is the shape an internal address takes,
  // and every real logo host (Supabase Storage included) is https.
  const allowedImages = new Set(
    [
      tenantRow?.logo_url as string | null | undefined,
      companyInfo.logo_url,
      ...(companyInfo.certifications ?? []).map((c) => c.logo_url),
      ...(companyInfo.partners ?? []).map((p) => p.logo_url),
    ].filter((u): u is string => typeof u === "string" && /^https:\/\//i.test(u))
  );

  const origin = request.nextUrl.origin;
  // Scripts stripped, <base> injected so the relative font/image URLs the
  // live page used still resolve once the markup is set directly.
  const cleaned = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const withBase = cleaned.includes("<head")
    ? cleaned.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/">`)
    : `<base href="${origin}/">${cleaned}`;

  try {
    const cookieHeader = request.headers.get("cookie") ?? "";
    // "load" already waits for images; settle adds fonts.ready and per-image decode, the pair that actually matters
    // for layout.
    const pdf = await renderPdf({
      source: { kind: "html", html: withBase, cookie: cookieHeader },
      margin: { top: "12mm", bottom: `${bottomMarginMm}mm`, left: "15mm", right: "15mm" },
      settle: true,
      allowRequest: (url) =>
        url.startsWith("data:") || url.startsWith("blob:") ||
        url.startsWith(origin) || allowedImages.has(url),
      // Worth a line: a logo silently vanishing from a customer-facing
      // quotation is how this went unnoticed until Vikas reported it.
      onBlocked: (url) => console.error(`quote pdf: blocked ${url.slice(0, 120)}`),
    });

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${quoteRow.ref}.pdf"`,
      },
    });
  } catch (e: unknown) {
    console.error("[quotes/pdf POST] render failed", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF generation failed: ${detail}` }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data: quoteRow } = await supabase.from("quotes").select("ref").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!quoteRow) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const cookieHeader = request.headers.get("cookie") ?? "";
  const printUrl = new URL(`/quotations/${id}/print`, request.nextUrl.origin).toString();

  try {
    // The self-hosted PrintSans @font-face (see QuotePrint.tsx) carries the Indian Rupee glyph that
    // @sparticuz/chromium's bundled Open Sans lacks, and images (logo, tenant signature) paint after networkidle0:
    // renderPdf waits for both before printing. The bottom margin is the footer band QuotePrint.tsx measured and
    // published (document.documentElement.dataset.footerMarginMm), read once settled -- never a second, independent
    // measurement and never the old flat constant (client reports, Vikas 2026-09-20).
    const pdf = await renderPdf({
      source: { kind: "url", url: printUrl, cookie: cookieHeader },
      margin: { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" },
      settle: true,
      footerAwareBottomMargin: true,
    });

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${quoteRow.ref}.pdf"`,
      },
    });
  } catch (e: unknown) {
    if (e instanceof PdfNavigationError) return NextResponse.json({ error: "Failed to render quote for PDF" }, { status: 502 });
    console.error("[quotes/pdf] render failed", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF generation failed: ${detail}` }, { status: 500 });
  }
}
