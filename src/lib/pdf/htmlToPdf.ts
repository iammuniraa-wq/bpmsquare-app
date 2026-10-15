import "server-only";

// HTML string -> PDF, with the same headless Chromium setup the quote and
// invoice PDF routes use (Sparticuz build on Vercel, full puppeteer locally).
// For documents built server-side from data we already hold -- no page
// navigation, no session cookie, so it also works where there is no logged-in
// request (a cron, an inbound webhook). The HTML must be fully escaped by its
// builder; images may load only over https.

export async function htmlToPdf(html: string, opts: { timeoutMs?: number; allowHosts?: string[] } = {}): Promise<Buffer> {
  const allow = new Set((opts.allowHosts ?? []).map((h) => h.toLowerCase()));
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
    // Nothing loads except data: URIs and https from the hosts the caller
    // names (the storage host the tenant's logo lives on) -- a headless
    // browser on our server must not be steerable at other addresses.
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const url = r.url();
      let ok = url.startsWith("data:");
      if (!ok && url.startsWith("https://")) {
        try { ok = allow.has(new URL(url).hostname.toLowerCase()); } catch { ok = false; }
      }
      if (ok) r.continue(); else r.abort();
    });
    await page.setContent(html, { waitUntil: "load", timeout: opts.timeoutMs ?? 20_000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "15mm", right: "15mm" },
    });
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
