// What a supplier receives -- pure, so the exact wording and escaping are
// tested (rfq.compose.test.ts). Everything a supplier sees is built from the
// SupplierView projection only: no customer, no quote ref, no sell price, no
// other supplier (docs/rfq-architecture.md §4.2).

import { subjectTag } from "./token";

export type SupplierViewLine = {
  id: string;
  sl_no: number;
  description: string;
  spec: string | null;
  uom: string | null;
  qty: number | null;
  required_by: string | null;
};

export type SupplierView = {
  tenantName: string;
  ref: string;
  title: string;
  respondBy: string | null;
  requiredBy: string | null;
  deliveryTerms: string | null;
  notesToSupplier: string | null;
  terms: string | null;
  supplierName: string;
  buyerName: string | null;
  buyerEmail: string | null;
  lines: SupplierViewLine[];
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtQty(q: number | null, uom: string | null): string {
  if (q === null || q === undefined) return uom ?? "";
  const n = Number.isInteger(Number(q)) ? String(Number(q)) : String(Number(q));
  return uom ? `${n} ${uom}` : n;
}

export function rfqSubject(v: Pick<SupplierView, "ref" | "title" | "tenantName">, code: string | null, kind: "request" | "reminder" | "message" = "request"): string {
  const lead = kind === "reminder" ? "Reminder: request for quotation" : kind === "message" ? "Request for quotation" : "Request for quotation";
  return `${subjectTag(v.ref, code)} ${lead} — ${v.title} (${v.tenantName})`.slice(0, 240);
}

/** The request email. `link` is the signed reply page; null when the secret
 *  isn't configured (then the supplier replies by email or the buyer keys it). */
export function buildRequestEmail(v: SupplierView, opts: { link: string | null; code: string | null; reminder?: boolean; message?: string | null }): { subject: string; text: string; html: string } {
  const subject = rfqSubject(v, opts.code, opts.reminder ? "reminder" : "request");
  const intro = opts.reminder
    ? `This is a reminder of our request for quotation ${v.ref}. We haven't received your prices yet.`
    : `${v.tenantName} requests your best price and lead time for the items below.`;
  const dueLine = v.respondBy ? `Please reply by ${v.respondBy}.` : "Please reply at your earliest convenience.";
  const how = opts.link
    ? `Enter your prices online (no login needed): ${opts.link}\nOr reply to this email with your quotation attached — keep the reference ${v.ref} in the subject.`
    : `Reply to this email with your quotation attached — keep the reference ${v.ref} in the subject.`;

  const textLines = v.lines.map((l) => {
    const bits = [`${l.sl_no}. ${l.description}`, fmtQty(l.qty, l.uom)];
    if (l.spec) bits.push(`Spec: ${l.spec}`);
    if (l.required_by) bits.push(`Needed by ${l.required_by}`);
    return bits.filter(Boolean).join(" — ");
  });

  const extra: string[] = [];
  if (v.deliveryTerms) extra.push(`Delivery: ${v.deliveryTerms}`);
  if (v.requiredBy) extra.push(`Required by: ${v.requiredBy}`);

  const text = [
    `Dear ${v.supplierName},`,
    "",
    intro,
    "",
    `Reference: ${v.ref} — ${v.title}`,
    ...extra,
    "",
    ...textLines,
    "",
    ...(opts.message?.trim() ? [opts.message.trim(), ""] : []),
    ...(v.notesToSupplier ? [v.notesToSupplier, ""] : []),
    dueLine,
    how,
    "",
    "Please include unit price, currency, lead time, minimum order quantity and how long your price is valid.",
    ...(v.terms ? ["", v.terms] : []),
    "",
    "Regards,",
    v.buyerName ?? v.tenantName,
    v.tenantName,
    ...(v.buyerEmail ? [v.buyerEmail] : []),
  ].join("\n");

  const row = (l: SupplierViewLine) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;vertical-align:top;">${l.sl_no}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
          <div style="font-weight:600;color:#111827;">${escapeHtml(l.description)}</div>
          ${l.spec ? `<div style="color:#4b5563;font-size:12px;margin-top:2px;">${escapeHtml(l.spec)}</div>` : ""}
          ${l.required_by ? `<div style="color:#6b7280;font-size:12px;margin-top:2px;">Needed by ${escapeHtml(l.required_by)}</div>` : ""}
        </td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;vertical-align:top;">${escapeHtml(fmtQty(l.qty, l.uom))}</td>
      </tr>`;

  const html = `<div style="font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937;max-width:640px;">
  <p>Dear ${escapeHtml(v.supplierName)},</p>
  <p>${escapeHtml(intro)}</p>
  <p style="margin:0 0 4px;"><strong>${escapeHtml(v.ref)}</strong> — ${escapeHtml(v.title)}</p>
  ${extra.map((e) => `<div style="color:#4b5563;font-size:13px;">${escapeHtml(e)}</div>`).join("")}
  <table style="border-collapse:collapse;width:100%;margin:14px 0;font-size:13px;">
    <thead><tr>
      <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;color:#6b7280;font-weight:600;">#</th>
      <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;color:#6b7280;font-weight:600;">Item</th>
      <th style="text-align:right;padding:8px;border-bottom:2px solid #d1d5db;color:#6b7280;font-weight:600;">Quantity</th>
    </tr></thead>
    <tbody>${v.lines.map(row).join("")}</tbody>
  </table>
  ${opts.message?.trim() ? `<p style="white-space:pre-wrap;">${escapeHtml(opts.message.trim())}</p>` : ""}
  ${v.notesToSupplier ? `<p style="white-space:pre-wrap;">${escapeHtml(v.notesToSupplier)}</p>` : ""}
  <p>${escapeHtml(dueLine)}</p>
  ${opts.link ? `<p style="margin:18px 0;"><a href="${escapeHtml(opts.link)}" style="display:inline-block;padding:10px 18px;background:#1f4e8c;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Enter your prices</a></p>
  <p style="color:#6b7280;font-size:12px;">No login needed. You can also reply to this email with your quotation attached — keep <strong>${escapeHtml(v.ref)}</strong> in the subject.</p>`
    : `<p style="color:#6b7280;font-size:12px;">Reply to this email with your quotation attached — keep <strong>${escapeHtml(v.ref)}</strong> in the subject.</p>`}
  <p style="color:#4b5563;font-size:13px;">Please include unit price, currency, lead time, minimum order quantity and how long your price is valid.</p>
  ${v.terms ? `<p style="color:#6b7280;font-size:12px;white-space:pre-wrap;">${escapeHtml(v.terms)}</p>` : ""}
  <p>Regards,<br>${escapeHtml(v.buyerName ?? v.tenantName)}<br>${escapeHtml(v.tenantName)}${v.buyerEmail ? `<br>${escapeHtml(v.buyerEmail)}` : ""}</p>
</div>`;

  return { subject, text, html };
}

/** A free-form message in an existing RFQ conversation. */
export function buildMessageEmail(v: Pick<SupplierView, "ref" | "title" | "tenantName" | "supplierName" | "buyerName">, code: string | null, body: string, link: string | null): { subject: string; text: string; html: string } {
  const subject = `Re: ${rfqSubject(v, code, "message")}`.slice(0, 240);
  const sig = `${v.buyerName ?? v.tenantName}\n${v.tenantName}`;
  const text = [`Dear ${v.supplierName},`, "", body.trim(), "", ...(link ? [`Your reply page: ${link}`, ""] : []), "Regards,", sig].join("\n");
  const html = `<div style="font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937;max-width:640px;">
  <p>Dear ${escapeHtml(v.supplierName)},</p>
  <p style="white-space:pre-wrap;">${escapeHtml(body.trim())}</p>
  ${link ? `<p><a href="${escapeHtml(link)}">Open your reply page</a></p>` : ""}
  <p>Regards,<br>${escapeHtml(v.buyerName ?? v.tenantName)}<br>${escapeHtml(v.tenantName)}</p>
</div>`;
  return { subject, text, html };
}

/** The WhatsApp share text -- the same link, nothing the email wouldn't say. */
export function whatsappText(v: Pick<SupplierView, "ref" | "title" | "tenantName" | "respondBy">, link: string | null): string {
  return [
    `${v.tenantName}: request for quotation ${v.ref} — ${v.title}.`,
    v.respondBy ? `Please reply by ${v.respondBy}.` : "",
    link ? `Enter your prices here (no login): ${link}` : "",
  ].filter(Boolean).join(" ");
}

/**
 * The printable RFQ document (A4) -- the same projection as the email, so
 * the PDF can never show a customer, a price or another supplier. It names
 * no supplier either, so one render serves every recipient of a send.
 */
export function buildRfqDocumentHtml(v: Omit<SupplierView, "supplierName">, opts: { logoUrl: string | null; issuedOn: string; companyAddress?: string | null }): string {
  const logo = opts.logoUrl && /^https:\/\//.test(opts.logoUrl) ? `<img src="${escapeHtml(opts.logoUrl)}" alt="" style="max-height:48px;max-width:180px;object-fit:contain;">` : "";
  const meta: [string, string | null][] = [
    ["RFQ number", v.ref],
    ["Issued", opts.issuedOn],
    ["Reply by", v.respondBy],
    ["Needed by", v.requiredBy],
    ["Delivery", v.deliveryTerms],
  ];
  const rows = v.lines.map((l) => `
    <tr>
      <td class="n">${l.sl_no}</td>
      <td><div class="d">${escapeHtml(l.description)}</div>${l.spec ? `<div class="s">${escapeHtml(l.spec)}</div>` : ""}${l.required_by ? `<div class="s">Needed by ${escapeHtml(l.required_by)}</div>` : ""}</td>
      <td class="q">${l.qty ?? ""}</td>
      <td>${escapeHtml(l.uom ?? "")}</td>
      <td class="blank"></td>
      <td class="blank"></td>
    </tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(v.ref)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 11px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2937; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #1f4e8c; padding-bottom: 12px; margin-bottom: 14px; }
  h1 { font-size: 18px; margin: 0 0 2px; color: #1f4e8c; letter-spacing: .3px; }
  .co { font-size: 12px; font-weight: 700; }
  .addr { color: #6b7280; white-space: pre-line; }
  .meta { display: grid; grid-template-columns: repeat(5, auto); gap: 4px 18px; margin: 0 0 12px; }
  .meta div span { display: block; color: #6b7280; font-size: 9px; text-transform: uppercase; letter-spacing: .5px; }
  .title { font-size: 13px; font-weight: 700; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .5px; color: #6b7280; border-bottom: 1px solid #9ca3af; padding: 6px; }
  td { border-bottom: 1px solid #e5e7eb; padding: 7px 6px; vertical-align: top; }
  td.n { width: 28px; color: #6b7280; }
  td.q { text-align: right; width: 60px; }
  td.blank { width: 90px; background: #fffbea; }
  .d { font-weight: 600; } .s { color: #4b5563; font-size: 10px; }
  .note { margin-top: 14px; white-space: pre-wrap; }
  .ask { margin-top: 14px; padding: 10px 12px; background: #f3f6fb; border-radius: 6px; }
  .terms { margin-top: 14px; color: #6b7280; font-size: 9.5px; white-space: pre-wrap; }
  footer { margin-top: 22px; color: #6b7280; font-size: 10px; }
</style></head><body>
<header>
  <div><h1>Request for quotation</h1><div class="co">${escapeHtml(v.tenantName)}</div>${opts.companyAddress ? `<div class="addr">${escapeHtml(opts.companyAddress)}</div>` : ""}</div>
  ${logo}
</header>
<div class="meta">${meta.filter(([, x]) => x).map(([k, x]) => `<div><span>${k}</span>${escapeHtml(x!)}</div>`).join("")}</div>
<div class="title">${escapeHtml(v.title)}</div>
<table>
  <thead><tr><th>#</th><th>Item</th><th style="text-align:right">Qty</th><th>UOM</th><th>Unit price</th><th>Lead time</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${v.notesToSupplier ? `<div class="note">${escapeHtml(v.notesToSupplier)}</div>` : ""}
<div class="ask">Please quote unit price, currency, lead time, minimum order quantity and how long your price is valid${v.respondBy ? `, by <strong>${escapeHtml(v.respondBy)}</strong>` : ""}. Reply through the link in our email, return the attached Excel sheet, or reply to the email with your quotation — keep <strong>${escapeHtml(v.ref)}</strong> in the subject.</div>
${v.terms ? `<div class="terms">${escapeHtml(v.terms)}</div>` : ""}
<footer>${escapeHtml(v.buyerName ?? v.tenantName)}${v.buyerEmail ? ` · ${escapeHtml(v.buyerEmail)}` : ""}</footer>
</body></html>`;
}
