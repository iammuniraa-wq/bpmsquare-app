import "server-only";
import type { Browser, Page } from "puppeteer-core";

// The ONE place headless Chromium is launched to make a PDF (PDF redesign, slice 0). Every PDF route and builder in
// the product goes through renderPdf: the Vercel-vs-local executable choice, the "shell" headless mode, the request
// allow-list for HTML we build ourselves, the font/image settle, the page options and the browser close live here and
// nowhere else.
//
// "No visible change" is the contract of this slice: the callers still pass exactly the page options they always used
// (A4, background printing, their own margin set, no header or footer template). Margins are therefore a parameter, not
// a default; do not "unify" them here.
//
// ONE DOCUMENT PER CALL. A call takes one source (one print page or one HTML string) and returns the bytes of one PDF.
// A quote and an order are never mixed in one file: to print two documents, call this twice.

export type PdfMargin = { top: string; right: string; bottom: string; left: string };

export type RenderPdfSource =
  /** A print page the browser navigates to. `cookie` forwards the caller's session to a login-gated page; a public,
   *  token-gated page needs none. */
  | { kind: "url"; url: string; cookie?: string }
  /** An HTML string (already escaped by its builder). `cookie` is sent with any sub-request the markup makes. */
  | { kind: "html"; html: string; cookie?: string; timeoutMs?: number };

/** The page frame of a workspace that chose one (src/lib/pdf/frame.ts): paper size, margins and the running header and footer
 *  the browser draws on every page. Absent = today's options exactly. */
export type RenderPdfFrame = {
  pageFormat: "A4" | "Letter";
  marginsMm: { top: number; right: number; bottom: number; left: number };
  headerHtml: string;
  footerHtml: string;
};

export type RenderPdfSpec = {
  source: RenderPdfSource;
  /** When set, replaces `margin` and the paper size, and prints the running header and footer. */
  frame?: RenderPdfFrame | null;
  margin: PdfMargin;
  /** Wait for webfonts and for every image to finish decoding before printing (the print pages need this; the
   *  string-built documents never had it). */
  settle: boolean;
  /** Replace `margin.bottom` with the footer band the print page measured and published on
   *  document.documentElement.dataset.footerMarginMm (the quotation's pinned footer). */
  footerAwareBottomMargin?: boolean;
  /** Request allow-list. When set, every request the page makes is passed through it and the rest are aborted.
   *  An "html" source without one may load data: URIs only. A "url" source without one is not intercepted. */
  allowRequest?: (url: string) => boolean;
  /** Called with each URL the allow-list aborted. */
  onBlocked?: (url: string) => void;
};

/** The print page answered with an error status. Callers turn this into their own 502 response. */
export class PdfNavigationError extends Error {
  readonly status = 502;
  constructor() {
    super("Failed to render the document for PDF");
    this.name = "PdfNavigationError";
  }
}

/** Nothing loads except data: URIs and https from the named hosts (the storage host a workspace's logo lives on). */
export function allowHostsRule(hosts: string[]): (url: string) => boolean {
  const allow = new Set(hosts.map((h) => h.toLowerCase()));
  return (url) => {
    if (url.startsWith("data:")) return true;
    if (url.startsWith("https://")) {
      try { return allow.has(new URL(url).hostname.toLowerCase()); } catch { return false; }
    }
    return false;
  };
}

/** Launch the right Chromium for the environment: the Sparticuz "headless shell" build on Vercel (it requires the
 *  "shell" mode, not a boolean), full puppeteer locally. */
export async function launchBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const puppeteer = await import("puppeteer-core");
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });
  }
  const puppeteer = await import("puppeteer");
  return puppeteer.launch({ headless: "shell" }) as unknown as Promise<Browser>;
}

/** Webfonts and images land asynchronously, and either one landing late shifts the layout after the snapshot. */
async function settlePage(page: Page): Promise<void> {
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
}

/** The quotation print page measures its own pinned footer and publishes the band it needs. Wait for the SETTLED value
 *  (footerMarginReady is set after fonts.ready and a re-measure), then read it; measure directly only if it never came. */
async function publishedFooterMarginMm(page: Page): Promise<number> {
  await page.waitForFunction(() => document.documentElement.dataset.footerMarginReady != null, { timeout: 8000 }).catch(() => {});
  const published = await page.evaluate(() => {
    const v = document.documentElement.dataset.footerMarginMm;
    return v ? Number(v) : null;
  });
  return published ?? await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".doc-footer");
    const heightMm = el ? el.getBoundingClientRect().height / 96 * 25.4 : 0;
    return Math.min(60, Math.max(20, Math.ceil(heightMm) + 10));
  });
}

// The return type is inferred on purpose: Buffer<ArrayBuffer> is what Response bodies accept.
export async function renderPdf(spec: RenderPdfSpec) {
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    const { source } = spec;
    const rule = spec.allowRequest ?? (source.kind === "html" ? allowHostsRule([]) : undefined);
    if (rule) {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const url = req.url();
        if (rule(url)) req.continue();
        else {
          spec.onBlocked?.(url);
          req.abort();
        }
      });
    }
    if (source.cookie) await page.setExtraHTTPHeaders({ cookie: source.cookie });

    if (source.kind === "url") {
      const res = await page.goto(source.url, { waitUntil: "networkidle0" });
      if (!res || !res.ok()) throw new PdfNavigationError();
    } else {
      await page.setContent(source.html, { waitUntil: "load", ...(source.timeoutMs !== undefined ? { timeout: source.timeoutMs } : {}) });
    }

    if (spec.settle) await settlePage(page);

    if (spec.frame) {
      const f = spec.frame;
      const pdf = await page.pdf({
        format: f.pageFormat,
        printBackground: true,
        margin: { top: `${f.marginsMm.top}mm`, bottom: `${f.marginsMm.bottom}mm`, left: `${f.marginsMm.left}mm`, right: `${f.marginsMm.right}mm` },
        displayHeaderFooter: true,
        headerTemplate: f.headerHtml,
        footerTemplate: f.footerHtml,
      });
      return Buffer.from(pdf);
    }

    const bottom = spec.footerAwareBottomMargin ? `${await publishedFooterMarginMm(page)}mm` : spec.margin.bottom;
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: spec.margin.top, bottom, left: spec.margin.left, right: spec.margin.right },
      displayHeaderFooter: false,
    });
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
