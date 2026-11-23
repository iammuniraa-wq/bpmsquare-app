import "server-only";
import { PdfNavigationError, renderPdf } from "./renderPdf";

// A headless browser prints an already-built print page to PDF, through the one renderer (renderPdf), for the
// documents added after the quote, invoice and standard-quote routes. `cookie` forwards the caller's session to a
// login-gated print page; a public, token-gated page needs none.

export async function printUrlToPdf(url: string, opts: { cookie?: string } = {}): Promise<{ ok: true; pdf: Buffer } | { ok: false; status: number; error: string }> {
  try {
    const pdf = await renderPdf({
      source: { kind: "url", url, cookie: opts.cookie },
      margin: { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" },
      settle: true,
    });
    return { ok: true, pdf };
  } catch (e: unknown) {
    if (e instanceof PdfNavigationError) return { ok: false, status: 502, error: "Failed to render the document for PDF" };
    console.error("[printUrlToPdf] render failed", e);
    return { ok: false, status: 500, error: "PDF generation failed" };
  }
}
