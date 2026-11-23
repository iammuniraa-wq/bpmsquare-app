// PDF redesign, slice 0: prove "no visible change". Renders a fixed set of static HTML fixtures through the OLD launch
// paths (function bodies copied from git history at the commit before renderPdf: `git show 708fda13:<path>`) and
// through the NEW renderPdf, then compares the two PDFs.
//
//   node scripts/pdf-compare.mjs [outDir]
//
// What it compares, strongest first:
//   1. normalised bytes (creation/modification dates and the document id blanked) -- identical means identical;
//   2. page count and page size;
//   3. page images (PyMuPDF at 100 dpi) when `python` with `pymupdf`/`fitz` is available, else skipped;
//   4. extracted text via `pdftotext` when it is on PATH, else skipped.
// Exit code 1 when any pair differs. Needs a local Chromium through `puppeteer` (no network, no database, no env files).
// It exercises the LOCAL launch branch only: the Vercel branch (@sparticuz/chromium) cannot run on this machine.

import { spawnSync } from "node:child_process";
import { register } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// renderPdf.ts imports "server-only", a Next.js build-time sentinel that is not installed as a real package: resolve it
// to an empty module for this script (the vitest config aliases it the same way).
register("data:text/javascript," + encodeURIComponent("export async function resolve(s, c, n) { return s === \"server-only\" ? { url: \"data:text/javascript,\", shortCircuit: true } : n(s, c); }"));

delete process.env.VERCEL;
process.env.NODE_ENV = "development";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? path.join(os.tmpdir(), "pdf-compare");
fs.mkdirSync(outDir, { recursive: true });

const { renderPdf, allowHostsRule } = await import(path.join(here, "../src/lib/pdf/renderPdf.ts").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"));
const puppeteer = (await import("puppeteer")).default ?? (await import("puppeteer"));

// ---------------------------------------------------------------- OLD paths, verbatim logic from 708fda13

async function oldLaunch() {
  return puppeteer.launch({ headless: "shell" }); // the non-production branch every old copy had
}

/** src/lib/pdf/htmlToPdf.ts @ 708fda13 */
async function oldHtmlToPdf(html, opts = {}) {
  const allow = new Set((opts.allowHosts ?? []).map((h) => h.toLowerCase()));
  let browser;
  try {
    browser = await oldLaunch();
    const page = await browser.newPage();
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
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "15mm", right: "15mm" } });
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function oldSettle(page) {
  await page.evaluate(async () => {
    await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 8000))]);
  });
  await page.evaluate(async () => {
    const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))]);
    await Promise.all(
      Array.from(document.images).map((img) => {
        const ready = img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            });
        return withTimeout(ready.then(() => img.decode().catch(() => {})), 8000);
      }),
    );
  });
}

/** src/lib/pdf/printUrlToPdf.ts @ 708fda13; also the body of the standard-quote and invoice routes (same 12/12/15/15). */
async function oldPrintUrlToPdf(url, opts = {}) {
  let browser;
  try {
    browser = await oldLaunch();
    const page = await browser.newPage();
    if (opts.cookie) await page.setExtraHTTPHeaders({ cookie: opts.cookie });
    const res = await page.goto(url, { waitUntil: "networkidle0" });
    if (!res || !res.ok()) return { ok: false, status: 502 };
    await oldSettle(page);
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" }, displayHeaderFooter: false });
    return { ok: true, pdf: Buffer.from(pdf) };
  } finally {
    await browser?.close();
  }
}

/** api/quotes/[id]/pdf GET and pdf-public @ 708fda13: dynamic bottom margin from the page's published footer band. */
async function oldQuoteGet(url) {
  let browser;
  try {
    browser = await oldLaunch();
    const page = await browser.newPage();
    const res = await page.goto(url, { waitUntil: "networkidle0" });
    if (!res || !res.ok()) return { ok: false, status: 502 };
    await oldSettle(page);
    await page.waitForFunction(() => document.documentElement.dataset.footerMarginReady != null, { timeout: 8000 }).catch(() => {});
    const publishedMarginMm = await page.evaluate(() => {
      const v = document.documentElement.dataset.footerMarginMm;
      return v ? Number(v) : null;
    });
    const bottomMarginMm = publishedMarginMm ?? await page.evaluate(() => {
      const el = document.querySelector(".doc-footer");
      const heightMm = el ? el.getBoundingClientRect().height / 96 * 25.4 : 0;
      return Math.min(60, Math.max(20, Math.ceil(heightMm) + 10));
    });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: `${bottomMarginMm}mm`, left: "15mm", right: "15mm" }, displayHeaderFooter: false });
    return { ok: true, pdf: Buffer.from(pdf) };
  } finally {
    await browser?.close();
  }
}

/** api/quotes/[id]/pdf POST @ 708fda13: the browser's own settled DOM, origin + data/blob + stored logos only. */
async function oldQuotePost(html, origin, bottomMarginMm) {
  let browser;
  try {
    browser = await oldLaunch();
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith(origin)) req.continue();
      else req.abort();
    });
    await page.setContent(html, { waitUntil: "load" });
    await oldSettle(page);
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: `${bottomMarginMm}mm`, left: "15mm", right: "15mm" }, displayHeaderFooter: false });
    return Buffer.from(pdf);
  } finally {
    await browser?.close();
  }
}

// ---------------------------------------------------------------- fixtures

const css = `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #1c2733; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 8px; } table { border-collapse: collapse; width: 100%; }
  th { background: #dbe5f1; text-align: left; } td, th { border: 1px solid #333; padding: 4px 8px; }
  .band { background: #7f7f7f; color: #fff; padding: 6px 10px; font-weight: bold; }
`;
const wrap = (body, extra = "") => `<!doctype html><html><head><meta charset="utf-8"><style>${css}${extra}</style></head><body>${body}</body></html>`;

const rows = (n) => Array.from({ length: n }, (_, i) => `<tr><td>${i + 1}</td><td>Precast element ${i + 1} - hollow core slab 200 mm</td><td>m2</td><td style="text-align:right">${(i + 3) * 12}</td><td style="text-align:right">${(95.5 + i).toFixed(2)}</td><td style="text-align:right">${((i + 3) * 12 * (95.5 + i)).toFixed(2)}</td></tr>`).join("");

const FIXTURES = {
  "table-heavy": wrap(`<div class="band">QUOTATION</div><h1>Bill of quantity</h1><table><thead><tr><th>SL</th><th>Description</th><th>Unit</th><th>Qty</th><th>Rate</th><th>Value</th></tr></thead><tbody>${rows(60)}</tbody></table>`),
  "arabic-line": wrap(`<div class="band">QUOTATION</div><h1>Customer</h1><p dir="rtl" lang="ar" style="font-size:16pt">شركة الأمل للمقاولات - عرض سعر رقم ١٦٧ / ٢٠٢٦</p><p>Mixed line: Al Amal Contracting (<span dir="rtl" lang="ar">الأمل</span>) - Riyadh</p><table><tr><th>Item</th><th>Amount</th></tr><tr><td>Slab</td><td>SAR 12,500.00</td></tr></table>`),
  "footer-pinned": wrap(
    `<div class="band">QUOTATION</div>${Array.from({ length: 18 }, (_, i) => `<p>Clause ${i + 1}. The supplier shall deliver the elements to site in the agreed sequence, subject to the payment terms stated in section F.</p>`).join("")}<div class="doc-footer"><hr><div>P.O. Box 1234, Riyadh - C.R. No. 1010 - VAT 3000</div><div>Page footer pinned on every page</div></div>
     <script>document.fonts.ready.then(() => { document.documentElement.dataset.footerMarginMm = "34"; document.documentElement.dataset.footerMarginReady = "1"; });</script>`,
    `.doc-footer { position: fixed; left: 0; right: 0; bottom: 0; font-size: 9pt; }`,
  ),
  "multi-page": wrap(Array.from({ length: 8 }, (_, i) => `<h1 style="${i ? "page-break-before: always;" : ""}">Section ${i + 1}</h1>${Array.from({ length: 6 }, (_, j) => `<p>Paragraph ${j + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>`).join("")}`).join("")),
};

// ---------------------------------------------------------------- local server for the "url" sources

const server = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? "/").slice(1));
  if (name in FIXTURES) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(FIXTURES[name]); }
  else { res.writeHead(404); res.end("no"); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------- compare helpers

const normalise = (buf) =>
  createHash("sha256").update(buf.toString("latin1").replace(/\/(CreationDate|ModDate) \(D:[^)]*\)/g, "/$1 ()").replace(/\/ID\s*\[[^\]]*\]/g, "/ID []").replace(/<xmp:(CreateDate|ModifyDate|MetadataDate)>[^<]*</g, "<$1><"), "latin1").digest("hex");

const PY = `
import sys, json
try:
    import pymupdf as fz
except Exception:
    import fitz as fz
a, b = fz.open(sys.argv[1]), fz.open(sys.argv[2])
out = {"pagesA": a.page_count, "pagesB": b.page_count, "sizeA": [list(map(round, p.rect)) for p in a][:1], "sizeB": [list(map(round, p.rect)) for p in b][:1], "diffPages": []}
for i in range(min(a.page_count, b.page_count)):
    pa = a[i].get_pixmap(dpi=100); pb = b[i].get_pixmap(dpi=100)
    if (pa.width, pa.height) != (pb.width, pb.height): out["diffPages"].append([i + 1, "size"]); continue
    if pa.samples != pb.samples:
        n = sum(1 for x, y in zip(pa.samples, pb.samples) if x != y)
        out["diffPages"].append([i + 1, n])
print(json.dumps(out))
`;

function images(fileA, fileB) {
  const r = spawnSync("python", ["-I", "-c", PY, fileA, fileB], { encoding: "utf8" });
  if (r.status !== 0) return { skipped: true, why: (r.stderr || r.error?.message || "python/pymupdf unavailable").split("\n").filter(Boolean).pop() };
  return JSON.parse(r.stdout);
}

function text(file) {
  const r = spawnSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}

const results = [];
async function compare(label, oldBytes, newBytes) {
  const fa = path.join(outDir, `${label}.old.pdf`);
  const fb = path.join(outDir, `${label}.new.pdf`);
  fs.writeFileSync(fa, oldBytes);
  fs.writeFileSync(fb, newBytes);
  const sameBytes = normalise(oldBytes) === normalise(newBytes);
  const img = images(fa, fb);
  const ta = text(fa), tb = text(fb);
  const sameText = ta === null || tb === null ? null : ta === tb;
  const pixelsIdentical = img.skipped ? null : img.diffPages.length === 0 && img.pagesA === img.pagesB;
  const identical = sameBytes || pixelsIdentical === true;
  results.push({ label, identical, sameBytes, pixelsIdentical, sameText, pages: img.skipped ? null : [img.pagesA, img.pagesB], size: img.skipped ? null : img.sizeA, diffPages: img.skipped ? img.why : img.diffPages, bytes: [oldBytes.length, newBytes.length] });
}

// ---------------------------------------------------------------- the runs

try {
  for (const [name, html] of Object.entries(FIXTURES)) {
    // htmlToPdf: string source, 14mm margins, allow-list of one host.
    await compare(`htmlToPdf-${name}`, await oldHtmlToPdf(html, { allowHosts: ["storage.example.com"] }),
      await renderPdf({ source: { kind: "html", html, timeoutMs: 20_000 }, margin: { top: "14mm", bottom: "14mm", left: "15mm", right: "15mm" }, settle: false, allowRequest: allowHostsRule(["storage.example.com"]) }));

    // printUrlToPdf / standard quote / invoice: url source, 12mm margins, settle.
    const url = `${origin}/${name}`;
    const o = await oldPrintUrlToPdf(url);
    await compare(`printUrl-${name}`, o.pdf, await renderPdf({ source: { kind: "url", url }, margin: { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" }, settle: true }));

    // quotation GET / pdf-public: dynamic footer-aware bottom margin.
    const q = await oldQuoteGet(url);
    await compare(`quoteGet-${name}`, q.pdf, await renderPdf({ source: { kind: "url", url }, margin: { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" }, settle: true, footerAwareBottomMargin: true }));

    // quotation POST: the browser's own DOM as a string, origin allow-list, clamped bottom margin.
    const postHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    await compare(`quotePost-${name}`, await oldQuotePost(postHtml, origin, 30),
      await renderPdf({ source: { kind: "html", html: postHtml, cookie: "" }, margin: { top: "12mm", bottom: "30mm", left: "15mm", right: "15mm" }, settle: true, allowRequest: (u) => u.startsWith("data:") || u.startsWith("blob:") || u.startsWith(origin) }));
  }
  // Negative control: the comparison must be able to see a change. A 20 mm top margin instead of 14 mm has to show up.
  await compare("CONTROL-must-differ", await oldHtmlToPdf(FIXTURES["table-heavy"]),
    await renderPdf({ source: { kind: "html", html: FIXTURES["table-heavy"], timeoutMs: 20_000 }, margin: { top: "20mm", bottom: "14mm", left: "15mm", right: "15mm" }, settle: false, allowRequest: allowHostsRule([]) }));
} finally {
  server.close();
}

console.log(`\nOutput folder: ${outDir}\n`);
for (const r of results) {
  console.log(`${r.identical ? "IDENTICAL" : "DIFFERENT"}  ${r.label.padEnd(30)} bytes(normalised)=${r.sameBytes} pixels=${r.pixelsIdentical} text=${r.sameText} pages=${JSON.stringify(r.pages)} size=${JSON.stringify(r.size)}${r.identical ? "" : ` diff=${JSON.stringify(r.diffPages)}`}`);
}
const control = results.find((r) => r.label.startsWith("CONTROL"));
const real = results.filter((r) => r !== control);
const bad = real.filter((r) => !r.identical);
const controlBroken = control?.identical === true; // the control must differ, or the comparison is blind
console.log(`
${real.length - bad.length}/${real.length} pairs identical${bad.length ? `, ${bad.length} differ` : ""}.`);
if (controlBroken) console.log("CONTROL PROBLEM: the deliberately different render compared as identical, so this comparison cannot be trusted.");
else if (control) console.log("Control (a deliberately different margin) was detected as different, so the comparison can see changes.");
console.log("Not covered: the Vercel launch branch (@sparticuz/chromium), real tenant print pages, remote logo images.");
process.exit(bad.length || controlBroken ? 1 : 0);
