import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

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

  let browser;
  try {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      const chromium = (await import("@sparticuz/chromium")).default;
      const puppeteer = await import("puppeteer-core");
      // @sparticuz/chromium ships a "headless shell" build -- it requires the
      // "shell" headless mode specifically, not a plain boolean. Launching
      // with `headless: true` fails to start the browser process on this
      // prebuilt binary (see the identical fix already applied in
      // api/quotes/[id]/pdf/route.ts -- this route had drifted out of sync
      // with it despite the comment above claiming to mirror it exactly).
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
      return NextResponse.json({ error: "Failed to render invoice for PDF" }, { status: 502 });
    }

    // Same fixes as api/quotes/[id]/pdf/route.ts: "networkidle0" doesn't guarantee
    // images have finished decoding/painting, and the self-hosted PrintSans
    // @font-face (carrying the ₹ glyph @sparticuz/chromium's bundled Open Sans
    // lacks) loads asynchronously too. Wait for both before snapshotting.
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
        "Content-Disposition": `attachment; filename="${invoiceRow.ref}.pdf"`,
      },
    });
  } catch (e: unknown) {
    console.error("[invoices/pdf] render failed", e);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  } finally {
    await browser?.close();
  }
}
