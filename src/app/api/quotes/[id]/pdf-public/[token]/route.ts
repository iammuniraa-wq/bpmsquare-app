import { NextResponse, type NextRequest } from "next/server";
import { verifyQuotePublicToken } from "@/lib/quotePublicLink";
import { getQuoteByPublicToken } from "@/lib/data";

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
        "Content-Disposition": `attachment; filename="${data.quote.ref}.pdf"`,
      },
    });
  } catch (e: unknown) {
    console.error("[quotes/pdf-public] render failed", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF generation failed: ${detail}` }, { status: 500 });
  } finally {
    await browser?.close();
  }
}
