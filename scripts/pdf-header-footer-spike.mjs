// PDF redesign, slice 0: a SPIKE, not wired into anything. Proves (locally) the technique slice 1 wants for a running
// header and a "Page X of Y" footer on every page: Chromium's own displayHeaderFooter with a header template, a footer
// template, a repeating table header (thead) and an Arabic line.
//
//   node scripts/pdf-header-footer-spike.mjs [outDir]
//
// Writes pdf-header-footer-spike.pdf to outDir (default: the OS temp folder) and checks, from the PDF's own text, that
// every page carries the header and "Page N of 5".
//
// NOT PROVEN ON VERCEL. This runs full `puppeteer` on a developer machine. The production build uses
// @sparticuz/chromium (a headless shell build with a small font set), whose handling of header/footer templates and of
// fonts inside them has not been exercised here. Facts that matter there: the header and footer templates render in a
// separate context, so they cannot see the page's CSS or webfonts (inline everything, use only fonts the binary ships,
// embed the logo as a data: URI) and they ignore the page's @font-face. FALLBACK if that misbehaves on Vercel: the
// technique the quotation already uses, a `position: fixed` element repeated on every page with a measured bottom margin
// (see renderPdf's footerAwareBottomMargin), with "Page X of Y" from CSS `@page` margin boxes or a post-pass that stamps
// the numbers on the finished PDF.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer";

const outDir = process.argv[2] ?? os.tmpdir();
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "pdf-header-footer-spike.pdf");

const PAGES = 5;
const rows = (n) => Array.from({ length: n }, (_, i) => `<tr><td>${i + 1}</td><td>Hollow core slab ${i + 1}, 200 mm, 6 m span</td><td>m2</td><td class="n">${(i + 3) * 12}</td><td class="n">${(95.5 + i).toFixed(2)}</td><td class="n">${((i + 3) * 12 * (95.5 + i)).toFixed(2)}</td></tr>`).join("");

// Page body: stylesheet allowed here. thead repeats on each page; rows do not split.
const body = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; margin: 0; color: #111; }
  h2 { font-size: 12pt; margin: 14px 0 6px; break-after: avoid; }
  table { border-collapse: collapse; width: 100%; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th { background: #dbe5f1; text-align: left; } td, th { border: 1px solid #222; padding: 3px 6px; }
  td.n { text-align: right; }
  .ar { direction: rtl; font-size: 12pt; }
</style></head><body>
  <h2>B. Requirements</h2>
  <p class="ar" lang="ar">شركة الأمل للمقاولات - عرض سعر رقم ١٦٧ / ٢٠٢٦</p>
  <h2>D. Price / bill of quantity</h2>
  <table><thead><tr><th>SL</th><th>Description</th><th>Unit</th><th>Qty</th><th>U-Rate</th><th>T-Value (SR)</th></tr></thead>
  <tbody>${rows(175)}</tbody></table>
  <h2>E. Commercial terms</h2>
  <p>Prices exclude VAT. Delivery is ex-works unless stated otherwise in the scope matrix.</p>
</body></html>`;

// Templates: inline styles only, explicit font-size (the template context defaults to 0), full-width via the page margin.
const headerTemplate = `
  <div style="width:100%; font-family: Arial, Helvetica, sans-serif; font-size:9px; padding: 0 15mm; box-sizing: border-box; -webkit-print-color-adjust: exact;">
    <div style="display:flex; justify-content:space-between; align-items:flex-end;">
      <div style="font-size:14px; font-weight:bold;">ACME PRECAST</div>
      <div style="text-align:right;">VENDOR NO. 100 428 64<br><span dir="rtl" lang="ar">شركة الأمل</span></div>
    </div>
    <div style="background:#7f7f7f; color:#fff; margin-top:4px; padding:3px 8px; display:flex; justify-content:space-between; font-size:11px; font-weight:bold;">
      <span>QUOTATION</span><span>RFQ # 167 / 2026 Rev. No. 00</span>
    </div>
  </div>`;
const footerTemplate = `
  <div style="width:100%; font-family: Arial, Helvetica, sans-serif; font-size:8px; padding: 0 15mm; box-sizing: border-box; -webkit-print-color-adjust: exact;">
    <div style="border-top:1px solid #888; padding-top:3px; display:flex; justify-content:space-between;">
      <span>P.O. Box 1234, Riyadh - C.R. No. 1010 - VAT 3000</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>
    <div style="display:flex; height:4px; margin-top:3px;"><div style="flex:1; background:#7f7f7f"></div><div style="flex:1; background:#ffd700"></div><div style="flex:1; background:#7f7f7f"></div></div>
  </div>`;

const browser = await puppeteer.launch({ headless: "shell" });
try {
  const page = await browser.newPage();
  await page.setContent(body, { waitUntil: "load" });
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate,
    footerTemplate,
    margin: { top: "34mm", bottom: "22mm", left: "15mm", right: "15mm" },
  });
  fs.writeFileSync(outFile, pdf);
} finally {
  await browser.close();
}

// Check from the PDF's own text (PyMuPDF), when available.
const py = `
import sys, json
try:
    import pymupdf as fz
except Exception:
    import fitz as fz
d = fz.open(sys.argv[1])
out = {"pages": d.page_count, "perPage": []}
for i, p in enumerate(d):
    t = p.get_text()
    out["perPage"].append({"page": i + 1, "header": "RFQ # 167 / 2026" in t, "footer": ("Page %d of %d" % (i + 1, d.page_count)) in t.replace("\\n", " "), "arabicHeader": any(0x600 <= ord(c) <= 0x6FF or 0xFB50 <= ord(c) <= 0xFEFF for c in t), "theadRepeats": "T-Value (SR)" in t})
print(json.dumps(out))
`;
const r = spawnSync("python", ["-I", "-c", py, outFile], { encoding: "utf8" });
console.log(`Wrote ${outFile} (${fs.statSync(outFile).size} bytes)`);
if (r.status !== 0) {
  console.log("Text check skipped: python with pymupdf is not available.");
} else {
  const res = JSON.parse(r.stdout);
  console.log(`Pages: ${res.pages}${res.pages === PAGES ? "" : ` (expected ${PAGES}; adjust the row count)`}`);
  for (const p of res.perPage) console.log(`  page ${p.page}: header=${p.header} footer(Page N of ${res.pages})=${p.footer} arabic=${p.arabicHeader} repeatedTableHead=${p.theadRepeats}`);
  const ok = res.perPage.every((p) => p.header && p.footer && p.arabicHeader && p.theadRepeats);
  console.log(ok ? "OK locally: running header, Page X of Y footer, Arabic and repeating table header on every page." : "PROBLEM: see the per-page lines above.");
}
console.log("NOT proven on Vercel (@sparticuz/chromium). Fallback: pinned fixed footer with a measured margin (the quotation's technique).");
