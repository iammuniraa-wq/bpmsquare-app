import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

export const runtime = "nodejs";
export const maxDuration = 60;

// Same headless-browser-prints-the-existing-page approach as
// api/invoices/[id]/pdf/route.ts and api/quotes/[id]/pdf/route.ts -- generic
// PDF-rendering plumbing, not specific to any one object, so reused verbatim
// even though Standard Quote's print page/component itself is independent.
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
  const printUrl = new URL(`/standard-quotes/${id}/print`, request.nextUrl.origin).toString();

  let browser;
  try {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      const chromium = (await import("@sparticuz/chromium")).default;
      const puppeteer = await import("puppeteer-core");
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

    await page.evaluate(async () => {
      await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 8000))]);
    });
    await page.evaluate(async () => {
      const withTimeout = (p: Promise<unknown>, ms: number) =>
        Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))]);
      await Promise.all(
        Array.from(document.images).map((img) => {
          const ready = img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener("load", () => resolve(), { once: true });
                img.addEventListener("error", () => resolve(), { once: true });
              });
          return withTimeout(ready.then(() => img.decode().catch(() => {})), 8000);
        })
      );
    });

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
    console.error("[standard-quotes/pdf] render failed", e);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  } finally {
    await browser?.close();
  }
}
