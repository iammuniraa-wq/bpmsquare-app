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

    // The self-hosted PrintSans @font-face (see QuotePrint.tsx) carries the Indian
    // Rupee glyph that @sparticuz/chromium's bundled Open Sans lacks -- but the font
    // file loads asynchronously, same as images below, so wait for it explicitly
    // rather than risk snapshotting before it's ready and silently falling back to
    // a font missing the ₹ glyph.
    await page.evaluate(async () => {
      await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 8000))]);
    });

    // "networkidle0" only guarantees network requests finished -- it does NOT
    // guarantee images have finished decoding/painting yet. That gap was
    // silently dropping every image (company logo, tenant signature) from
    // the generated PDF, both a remote https:// logo and a local data: URI
    // signature, with no error -- page.pdf() was snapshotting before either
    // had actually painted. Explicitly wait for every <img> to load + decode
    // (each with its own short timeout so one stuck image can't hang the
    // whole request past maxDuration) before printing.
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
    console.error("[quotes/pdf] render failed", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF generation failed: ${detail}` }, { status: 500 });
  } finally {
    await browser?.close();
  }
}
