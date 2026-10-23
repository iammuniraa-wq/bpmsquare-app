import "server-only";

// A headless browser prints an already-built print page to PDF: the same approach as the quote, invoice and
// standard-quote PDF routes (Sparticuz Chromium on Vercel, full puppeteer locally), kept in one function for the
// documents added after them. `cookie` forwards the caller's session to a login-gated print page; a public,
// token-gated page needs none.

export async function printUrlToPdf(url: string, opts: { cookie?: string } = {}): Promise<{ ok: true; pdf: Buffer } | { ok: false; status: number; error: string }> {
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
    if (opts.cookie) await page.setExtraHTTPHeaders({ cookie: opts.cookie });
    const res = await page.goto(url, { waitUntil: "networkidle0" });
    if (!res || !res.ok()) return { ok: false, status: 502, error: "Failed to render the document for PDF" };

    await page.evaluate(async () => {
      await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 8000))]);
    });
    await page.evaluate(async () => {
      const withTimeout = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))]);
      await Promise.all(
        Array.from(document.images).map((img) => {
          const ready = img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener("load", () => resolve(), { once: true });
                img.addEventListener("error", () => resolve(), { once: true });
              });
          return withTimeout(ready.then(() => img.decode().catch(() => {})), 8000);
        }),
      );
    });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" },
      displayHeaderFooter: false,
    });
    return { ok: true, pdf: Buffer.from(pdf) };
  } catch (e: unknown) {
    console.error("[printUrlToPdf] render failed", e);
    return { ok: false, status: 500, error: "PDF generation failed" };
  } finally {
    await browser?.close();
  }
}
