import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Server-rendered PDF, replacing the browser's own print dialog (which stamps its own
// timestamp/title into the header and footer that no amount of CSS can suppress — CR-002).
// Rather than re-implementing the print layout via react-dom/server (which the App Router's
// route-handler graph forbids importing), a headless browser navigates to the existing,
// already-tested print page and prints *that* — same auth, same markup, single source of truth.
/** Launch the right Chromium for the environment. Shared by both handlers. */
async function launchBrowser() {
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
  return puppeteer.launch({ headless: "shell" });
}

/** Wait for webfonts and for every image to finish decoding. Either one
 *  landing late is enough to shift the layout after the snapshot. */
async function settle(page: { evaluate: (fn: () => Promise<void>) => Promise<unknown> }) {
  await page.evaluate(async () => {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]);
  });
  await page.evaluate(async () => {
    const withTimeout = (p: Promise<unknown>, ms: number) =>
      Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
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
}

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

  const origin = request.nextUrl.origin;
  // Scripts stripped, <base> injected so the relative font/image URLs the
  // live page used still resolve once the markup is set directly.
  const cleaned = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const withBase = cleaned.includes("<head")
    ? cleaned.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/">`)
    : `<base href="${origin}/">${cleaned}`;

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith(origin)) req.continue();
      else req.abort();
    });

    const cookieHeader = request.headers.get("cookie") ?? "";
    if (cookieHeader) await page.setExtraHTTPHeaders({ cookie: cookieHeader });

    // setContent takes "load"/"domcontentloaded" only (no networkidle in this
    // Puppeteer version). "load" already waits for images; settle() then adds
    // fonts.ready and per-image decode, which is the pair that actually
    // matters for layout.
    await page.setContent(withBase, { waitUntil: "load" });
    await settle(page);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: `${bottomMarginMm}mm`, left: "15mm", right: "15mm" },
      displayHeaderFooter: false,
    });

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${quoteRow.ref}.pdf"`,
      },
    });
  } catch (e: unknown) {
    console.error("[quotes/pdf POST] render failed", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF generation failed: ${detail}` }, { status: 500 });
  } finally {
    await browser?.close();
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

    // The reserved bottom margin has to fit THIS tenant's actual footer, not
    // a guessed constant -- .doc-footer is position:fixed (see QuotePrint.tsx),
    // so it doesn't reserve its own space, and page.pdf()'s own `margin`
    // option below overrides the page's @page CSS entirely (Puppeteer
    // ignores the CSS value once this is set).
    //
    // QuotePrint.tsx's own useEffect computes this exact number (footer
    // height -> mm -> +buffer) and publishes it to
    // document.documentElement.dataset.footerMarginMm -- read THAT instead
    // of independently re-measuring the footer here. An earlier version of
    // this route did its own separate getBoundingClientRect() call, and a
    // real client report ("Print / Save PDF (browser)" -- which uses the
    // client's computed value directly as CSS -- came out correct, but
    // "Download PDF" via this route still showed the signature overlapping
    // the footer) confirmed the two independent computations, taken at
    // different points in the page's lifecycle, can drift apart. Waiting
    // for and reusing the client's own published value guarantees this
    // route produces byte-for-byte the same margin the browser print path
    // already proved correct. Falls back to a direct measurement only if
    // the attribute never appears (JS error, timeout) -- never a silent
    // regression to the old flat constant.
    // Wait for footerMarginReady, NOT for footerMarginMm to merely exist --
    // client bug, Vikas, 2026-09-20. The attribute is written by the effect's
    // very first apply(), which on a cold load runs before the self-hosted
    // DejaVu webfont has arrived; the footer text wraps to a different number
    // of lines in the fallback font, so that first value reserved a band a
    // line too short and the last lines before each page break were clipped
    // under the footer. Reloading fixed it only because the font was then
    // cached -- hence "takes a few refreshes". QuotePrint.tsx now sets
    // footerMarginReady only after fonts.ready and a re-measure, so waiting
    // on that is waiting on the settled number rather than the first guess.
    await page.waitForFunction(
      () => document.documentElement.dataset.footerMarginReady != null,
      { timeout: 8000 }
    ).catch(() => {});
    const publishedMarginMm = await page.evaluate(() => {
      const v = document.documentElement.dataset.footerMarginMm;
      return v ? Number(v) : null;
    });
    const bottomMarginMm = publishedMarginMm ?? await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".doc-footer");
      const heightMm = el ? el.getBoundingClientRect().height / 96 * 25.4 : 0;
      return Math.min(60, Math.max(20, Math.ceil(heightMm) + 10));
    });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: `${bottomMarginMm}mm`, left: "15mm", right: "15mm" },
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
