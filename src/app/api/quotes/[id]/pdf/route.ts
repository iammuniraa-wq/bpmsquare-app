import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Server-rendered PDF, replacing the browser's own print dialog (which stamps its own
// timestamp/title into the header and footer that no amount of CSS can suppress — CR-002).
// Rather than re-implementing the print layout via react-dom/server (which the App Router's
// route-handler graph forbids importing), a headless browser navigates to the existing,
// already-tested print page and prints *that* — same auth, same markup, single source of truth.
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

  let browser;
  try {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      const chromium = (await import("@sparticuz/chromium")).default;
      const puppeteer = await import("puppeteer-core");
      // @sparticuz/chromium ships a "headless shell" build -- it requires the
      // "shell" headless mode specifically, not a plain boolean. Launching
      // with `headless: true` (the old default) fails to start the browser
      // process on this prebuilt binary, which is what was surfacing as a
      // blanket "PDF generation failed" with no further detail.
      browser = await puppeteer.launch({
        args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
        executablePath: await chromium.executablePath(),
        headless: "shell",
      });
    } else {
      const puppeteer = await import("puppeteer");
      browser = await puppeteer.launch({ headless: "shell" });
    }

    const page = await browser.newPage();
    if (cookieHeader) await page.setExtraHTTPHeaders({ cookie: cookieHeader });
    const res = await page.goto(printUrl, { waitUntil: "networkidle0" });
    if (!res || !res.ok()) {
      return NextResponse.json({ error: "Failed to render quote for PDF" }, { status: 502 });
    }

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" },
      displayHeaderFooter: false,
    });

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${quoteRow.ref}.pdf"`,
      },
    });
  } catch (e: unknown) {
    console.error("[quotes/pdf] render failed", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF generation failed: ${detail}` }, { status: 500 });
  } finally {
    await browser?.close();
  }
}
