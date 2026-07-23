import type { ReactNode } from "react";
import type { Quote, QuoteLine, QuoteRevision, Account, Contact, Site, Asset } from "@/lib/types";
import type { CompanyInfo } from "@/lib/tenant";
import type { TenantEntity, TenantTaxConfig } from "@/lib/constants";
import { MapPin, Mail, Globe } from "@/components/Icons";

const OFFER_TITLE: Record<string, string> = {
  quotation: "Quotation",
  technical: "Technical Offer",
  budgetary: "Budgetary Offer",
  supply: "Supply Quotation",
  repair: "Repair Quotation",
};

const ASSET_FIELD_LABELS: Record<string, string> = {
  name:   "Equipment name",
  kind:   "Type",
  make:   "Make / OEM",
  model:  "Model / Frame",
  rating: "Rating",
  rpm:    "RPM",
  serial: "Serial no.",
  notes:  "Remarks",

  // Motor/generator nameplate fields — see FIELD_REGISTRY.asset (src/lib/fieldRegistry.ts).
  frame_type:         "Frame / Type",
  insulation_class:   "Insulation class",
  connection:         "Connection",
  duty:               "Duty",
  ambient_temp:       "Ambient temp.",
  output_kw:          "Output (kW)",
  stator_voltage:     "Stator voltage",
  stator_current:     "Stator current",
  excitation_voltage: "Excitation voltage",
  excitation_current: "Excitation current",
  frequency:          "Frequency",
};

export type QuotePrintDocumentProps = {
  quote: Quote;
  account: Account | null;
  contact: Contact | null;
  site: Site | null;
  lines: QuoteLine[];
  revisions: QuoteRevision[];
  companyInfo?: CompanyInfo;
  logoUrl?: string | null;
  tenantEntities?: TenantEntity[];
  tenantTax?: TenantTaxConfig;
  assets?: Asset[];
  assetPrintFields?: string[];
  /** Labels for tenant-defined custom asset fields (key -> label), e.g. "cf_stator_voltage" -> "Stator Voltage" */
  assetCustomFieldLabels?: Record<string, string>;
  /** Extension slots — resolved server-side via loadExtension(tenant.slug) */
  ext?: {
    quoteSignatureSlot?: ReactNode;
    quoteExtraSection?: ReactNode;
  };
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const brand = { dark: "#152233", blue: "#378ADD", amber: "#F6B23C", line: "#d0d7e0", bg2: "#f4f6f9" };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// Pure printable document markup, shared by the on-screen preview (QuotePrint.tsx) and the
// server-rendered PDF route (api/quotes/[id]/pdf) — no client-only toolbar bits here.
export default function QuotePrintDocument({
  quote, account, contact, site, lines,
  companyInfo = {}, logoUrl, tenantEntities = [], tenantTax,
  assets = [], assetPrintFields = [], assetCustomFieldLabels = {},
  ext = {},
}: QuotePrintDocumentProps) {
  const isTechnical = quote.type === "technical";

  // If quote has an entity_id, override company details from that entity
  const entity = tenantEntities.find((e) => e.id === quote.entity_id) ?? null;

  const co = {
    name:           entity?.name             ?? companyInfo.name           ?? "",
    tagline:        entity?.tagline          ?? companyInfo.tagline        ?? "",
    address:        entity?.address          ?? companyInfo.address        ?? "",
    phone:          entity?.phone            ?? null,
    email:          entity?.email            ?? companyInfo.email          ?? "",
    web:            companyInfo.web          ?? "",
    gstin:          entity?.gstin            ?? companyInfo.gstin          ?? "",
    logo_url:       companyInfo.logo_url     ?? logoUrl                    ?? null,
    logo_bg:        companyInfo.logo_bg      ?? brand.blue,
    undertaking:    companyInfo.undertaking  ?? "",
    iso:            companyInfo.iso          ?? "",
    certifications: companyInfo.certifications ?? [],
    footer_tagline: companyInfo.footer_tagline ?? "",
    partners:       companyInfo.partners     ?? [],
    // Generic phones list; fall back to legacy fields if present
    phones: companyInfo.phones ?? [
      companyInfo.phone_dir_tech    ? { label: "Dir / Tech",   number: companyInfo.phone_dir_tech }    : null,
      companyInfo.phone_commercial  ? { label: "Commercial",   number: companyInfo.phone_commercial }  : null,
      companyInfo.phone_work        ? { label: "Work",         number: companyInfo.phone_work }        : null,
      companyInfo.landline          ? { label: "Landline",     number: companyInfo.landline }          : null,
    ].filter((p): p is { label: string; number: string } => p !== null),
    tax_label: companyInfo.tax_label ?? tenantTax?.label ?? "GST",
    email2: companyInfo.email2 ?? "",
  };

  // CR-010: GST is optional per quote — no rate entered means no tax row at all
  // (the "GST @ 18%" statement lives in Terms & Conditions text instead).
  const hasGst = quote.gst_rate !== null && quote.gst_rate !== undefined;

  const selectedAltId = quote.selected_option_id ?? null;
  const effectiveLines = lines.filter((l) => !l.group_id || l.group_type !== "alternative" || l.group_id === selectedAltId);
  const subtotal = effectiveLines.reduce((s, l) => s + l.amount, 0);
  const totalDeductions = effectiveLines
    .filter((l) => l.category === "material")
    .reduce((s, l) => s + (l.deduction ?? 0), 0);
  const discountAmt =
    quote.discount_type === "pct"   ? Math.round(subtotal * (quote.discount_pct ?? 0) / 100) :
    quote.discount_type === "fixed" ? (quote.discount_fixed ?? 0) : 0;
  const afterDiscount = subtotal - discountAmt - totalDeductions;
  const tax = hasGst ? Math.round(afterDiscount * (quote.gst_rate ?? 0) / 100) : 0;
  const grandTotal = afterDiscount + tax;

  const logoIni = initials(co.name || "?");

  return (
    <div className="doc">

      {/* ── WHITE LETTERHEAD HEADER — 55mm target, grows (never clips) for longer tenant content ── */}
      <div style={{ background: "#fff", borderBottom: `2px solid ${brand.dark}`, breakInside: "avoid", minHeight: "55mm", display: "flex", flexDirection: "column" }}>

        {/* Row 1: certification/accreditation logos top-left, GST on the same line, right-aligned. */}
        {(co.certifications.length > 0 || co.iso || co.gstin) && (
          <div style={{ padding: "2px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottom: "1px solid #dde2e8" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {co.certifications.length > 0 ? (
                co.certifications.map((cert, i) =>
                  cert.logo_url ? (
                    <img key={i} src={cert.logo_url} alt={cert.name} title={cert.name} style={{ height: 18, maxWidth: 52, objectFit: "contain" }} />
                  ) : (
                    <span key={i} style={{ fontSize: 8.5, fontWeight: 700, color: "#333", border: "1px solid #999", padding: "1px 5px", borderRadius: 2, letterSpacing: 0.4 }}>
                      {cert.name}
                    </span>
                  )
                )
              ) : co.iso ? (
                <span style={{ fontSize: 8.5, fontWeight: 700, color: "#333", border: "1px solid #999", padding: "1px 5px", borderRadius: 2, letterSpacing: 0.4 }}>
                  {co.iso}
                </span>
              ) : null}
            </div>
            {co.gstin && (
              <span style={{ fontSize: 10, fontWeight: 700, color: "#1a2733", flexShrink: 0 }}>GST No. {co.gstin}</span>
            )}
          </div>
        )}

        {/* Row 2: Logo + Company name + tagline | Doc title */}
        <div style={{ padding: "7px 22px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>

          {/* Left: logo + name + tagline */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {co.logo_url ? (
              <img src={co.logo_url} alt={co.name} style={{ height: 48, maxWidth: 68, objectFit: "contain", flexShrink: 0 }} />
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: 9, flexShrink: 0, background: co.logo_bg || brand.dark, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: "#fff" }}>
                {logoIni}
              </div>
            )}
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#B91C1C", letterSpacing: 0.4, textTransform: "uppercase", lineHeight: 1.15 }}>
                {co.name}
              </div>
              {co.tagline && (
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "#1a4fa0", fontStyle: "italic", marginTop: 2 }}>
                  {co.tagline}
                </div>
              )}
            </div>
          </div>

          {/* Right: document type */}
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: brand.dark, letterSpacing: 2, textTransform: "uppercase" }}>
              {OFFER_TITLE[quote.type] ?? "Quotation"}
            </div>
          </div>
        </div>

        {/* Row 3: Authorised Channel Partner pill + partner logos */}
        {co.partners.length > 0 && (
          <>
            <div style={{ borderTop: "1px solid #dde2e8", margin: "0 22px" }} />
            <div style={{ padding: "2px 22px 1px", textAlign: "center" }}>
              <span style={{ display: "inline-block", border: "1px solid #555", borderRadius: 20, padding: "1.5px 16px", fontSize: 9.5, fontWeight: 700, color: "#333", letterSpacing: 0.6 }}>
                Authorised Channel Partner
              </span>
            </div>
            <div style={{ padding: "2px 22px 4px", display: "flex", justifyContent: "center", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              {co.partners.map((p, i) => (
                p.logo_url ? (
                  <img key={i} src={p.logo_url} alt={p.name} title={p.name} style={{ height: 26, maxWidth: 74, objectFit: "contain" }} />
                ) : (
                  <span key={i} style={{ fontSize: 11, fontWeight: 800, color: "#111", letterSpacing: 0.1 }}>{p.name}</span>
                )
              ))}
            </div>
          </>
        )}

        {/* Row 4: Undertaking strip */}
        {co.undertaking && (
          <div style={{ borderTop: "1px solid #dde2e8", padding: "2px 22px", textAlign: "center", fontSize: 9.5, color: "#444", background: "#f8f9fb" }}>
            We Undertake: {co.undertaking}
          </div>
        )}

        {/* Row 5: Email | Web contact strip */}
        <div style={{ borderTop: "1px solid #dde2e8", padding: "2px 22px", display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap", fontSize: 10, color: "#555", background: "#f4f5f7" }}>
          {(co.email || co.email2) && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Mail size={10} color="#888" />
              {co.email}{co.email2 ? <span style={{ color: "#888" }}> | {co.email2}</span> : ""}
            </span>
          )}
          {co.web && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Globe size={10} color="#888" /> {co.web}
            </span>
          )}
        </div>
      </div>

      {/* Date row */}
      <div style={{ padding: "7px 28px", display: "flex", justifyContent: "flex-end", alignItems: "center", borderBottom: `1px solid ${brand.line}`, background: "#fff", breakInside: "avoid" }}>
        <span style={{ fontSize: 12.5 }}>Date: <strong>{fmtDate(quote.created_at)}</strong>{quote.valid_until ? <span style={{ marginLeft: 24, color: "#5f6b7a" }}>Valid until: {fmtDate(quote.valid_until)}</span> : ""}</span>
      </div>

      {/* Bill To / Attention */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderBottom: `1px solid ${brand.line}`, breakInside: "avoid" }}>
        <div style={{ padding: "11px 28px", borderRight: `1px solid ${brand.line}` }}>
          <SectionLabel>Bill to</SectionLabel>
          {account ? (
            <>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{account.name}</div>
              {account.city && <div style={{ color: "#5f6b7a", marginTop: 2 }}>{account.city}</div>}
              {account.phone && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{account.phone}</div>}
              {account.email && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{account.email}</div>}
              {quote.pr_no && <div style={{ color: "#5f6b7a", fontSize: 12, marginTop: 4 }}>PR No.: <strong style={{ color: "#1c2733" }}>{quote.pr_no}</strong></div>}
            </>
          ) : <div style={{ color: "#8a96a5" }}>—</div>}
        </div>
        <div style={{ padding: "11px 28px" }}>
          <SectionLabel>Attention</SectionLabel>
          {contact ? (
            <>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{contact.name}</div>
              {contact.role && <div style={{ color: "#5f6b7a", marginTop: 2 }}>{contact.role}</div>}
              {contact.phone && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{contact.phone}</div>}
              {contact.email && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{contact.email}</div>}
            </>
          ) : <div style={{ color: "#8a96a5" }}>—</div>}
          {site && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${brand.line}` }}>
              <SectionLabel>Site</SectionLabel>
              <div style={{ fontWeight: 500 }}>{site.label}</div>
              {site.address && <div style={{ color: "#5f6b7a", fontSize: 12 }}>{site.address}</div>}
            </div>
          )}
        </div>
      </div>

      {/* Subject & salutation */}
      {quote.name && (
        <div style={{ padding: "9px 28px", borderBottom: `1px solid ${brand.line}`, breakInside: "avoid" }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <strong>Subject:</strong> Quotation for the Rewinding of {quote.name}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Dear Sir,</div>
          <div style={{ fontSize: 12.5, color: "#5f6b7a", marginTop: 3, lineHeight: 1.5 }}>
            With reference to the above subject, we are herewith submitting our quotation for the above said work.
          </div>
        </div>
      )}

      {/* Equipment Details — shown when assets are linked and tenant has chosen fields.
          Fields render as a real <table> (3 per row), not a CSS grid: Chromium's print
          pagination never fragments a grid/flex container internally — with
          breakInside:avoid on the whole grid it jumps to the next page as one atomic
          block the moment it doesn't fit, and without it, it *still* jumps as a whole
          (grid layout just isn't fragmentation-aware here), either way stranding a big
          blank gap on the page before it. An actual table's rows DO fragment
          independently in print — confirmed by rendering this exact section through
          headless Chromium — so a long equipment's fields now fill the remaining page
          space and continue on the next page, instead of leaving it empty. Each row
          still keeps breakInside:avoid so a field's label and value never separate. */}
      {assets.length > 0 && assetPrintFields.length > 0 && (
        <div style={{ margin: "0 0", borderBottom: `1px solid ${brand.line}` }}>
          <div style={{ padding: "7px 28px 4px", background: "#e6f1fb", breakAfter: "avoid" }}>
            <SectionLabel>Equipment details</SectionLabel>
          </div>
          {assets.map((asset, ai) => {
            const fields = assetPrintFields
              .map((field) => {
                const raw = (asset as Record<string, unknown>)[field]
                  ?? (asset.custom_data as Record<string, unknown> | null)?.[field];
                return raw ? { field, val: String(raw) } : null;
              })
              .filter((f): f is { field: string; val: string } => f !== null);
            const rows: (typeof fields)[] = [];
            for (let i = 0; i < fields.length; i += 3) rows.push(fields.slice(i, i + 3));

            return (
              <div key={asset.id} style={{
                padding: "10px 28px",
                borderTop: ai > 0 ? `1px solid ${brand.line}` : undefined,
              }}>
                {assets.length > 1 && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: brand.blue, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5, breakAfter: "avoid" }}>
                    Equipment {ai + 1}
                  </div>
                )}
                <table style={{ width: "100%" }}>
                  <tbody>
                    {rows.map((row, ri) => (
                      <tr key={ri} style={{ breakInside: "avoid" }}>
                        {row.map(({ field, val }) => (
                          <td key={field} style={{ width: "33.33%", padding: "0 24px 6px 0", verticalAlign: "top" }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#8a96a5", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                              {ASSET_FIELD_LABELS[field] ?? assetCustomFieldLabels[field] ?? field}
                            </div>
                            <div style={{ fontSize: 12.5, fontWeight: field === "name" ? 600 : 400, color: "#1a2533" }}>
                              {String(val)}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Line items */}
      <table>
        <thead>
          <tr style={{ background: "#e6f1fb" }}>
            <th style={{ padding: "7px 28px 7px 28px", textAlign: "left", fontSize: 11, color: "#0c447c", fontWeight: 600, width: 32 }}>#</th>
            <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 11, color: "#0c447c", fontWeight: 600 }}>Description</th>
            <th style={{ padding: "7px 12px", textAlign: "center", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>UOM</th>
            <th style={{ padding: "7px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>Qty</th>
            {!isTechnical && <th style={{ padding: "7px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>Rate (₹)</th>}
            {!isTechnical && <th style={{ padding: "7px 28px 7px 12px", textAlign: "right", fontSize: 11, color: "#0c447c", fontWeight: 600, whiteSpace: "nowrap" }}>Amount (₹)</th>}
            {isTechnical && <th style={{ padding: "7px 28px 7px 12px" }} />}
          </tr>
        </thead>
        <tbody>
          {(() => {
            const out: React.ReactNode[] = [];
            const seenGroups = new Set<string>();
            let standaloneNum = 0;
            const groupItemCount: Record<string, number> = {};
            const colSpan = isTechnical ? 4 : 6;

            // Pre-compute per-group totals for subtotal rows
            const groupTotals: Record<string, number> = {};
            for (const l of lines) {
              if (l.group_id) groupTotals[l.group_id] = (groupTotals[l.group_id] ?? 0) + l.amount;
            }

            // Track which groups we've already emitted a subtotal for
            const closedGroups = new Set<string>();

            for (let idx = 0; idx < lines.length; idx++) {
              const line = lines[idx];
              const nextLine = lines[idx + 1];

              if (line.group_id) {
                const isAlt = line.group_type === "alternative";
                const isSelected = !isAlt || line.group_id === selectedAltId;
                const headerBg    = isAlt ? (isSelected ? "#fffbeb" : "#fafafa") : "#eaf2fb";
                const headerColor = isAlt ? (isSelected ? "#92400e" : "#9ca3af") : "#0c447c";
                const rowOpacity  = isAlt && !isSelected ? 0.45 : 1;

                if (!seenGroups.has(line.group_id)) {
                  seenGroups.add(line.group_id);
                  standaloneNum++;
                  groupItemCount[line.group_id] = 0;
                  const groupDesc = line.group_description;
                  out.push(
                    <tr key={`gh-${line.group_id}`} style={{ background: headerBg }}>
                      <td colSpan={colSpan} style={{ padding: "6px 28px", fontWeight: 700, fontSize: 11.5, color: headerColor, letterSpacing: 0.3 }}>
                        <span>{isAlt ? (isSelected ? "✓ " : "✗ ") : ""}{line.group_label ?? (isAlt ? "Option" : "Group")}</span>
                        {groupDesc && <span style={{ fontWeight: 400, color: isAlt ? "#92400e" : "#3a6fa8", marginLeft: 8, fontSize: 11 }}>— {groupDesc}</span>}
                        {isAlt && !isSelected && <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 8 }}>(not selected)</span>}
                      </td>
                    </tr>
                  );
                }
                groupItemCount[line.group_id] = (groupItemCount[line.group_id] ?? 0) + 1;
                const slNo = line.sl_no || `${standaloneNum}.${groupItemCount[line.group_id]}`;
                out.push(
                  <tr key={line.id} style={{ opacity: rowOpacity, breakInside: "avoid" }}>
                    <td style={{ padding: "6px 12px 6px 40px", color: "#8a96a5", fontSize: 11, fontFamily: "monospace" }}>{slNo}</td>
                    <td style={{ padding: "6px 12px 6px 8px", fontSize: 12.5 }}>{line.description}</td>
                    <td style={{ padding: "6px 12px", textAlign: "center", color: "#5f6b7a", fontSize: 12 }}>{line.uom ?? ""}</td>
                    <td style={{ padding: "6px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{line.qty}</td>
                    {!isTechnical && <td style={{ padding: "6px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{line.rate.toLocaleString("en-IN")}</td>}
                    {!isTechnical && <td style={{ padding: "6px 28px 6px 12px", textAlign: "right", fontWeight: 500, fontSize: 12.5 }}>{inr(line.amount)}</td>}
                    {isTechnical && <td />}
                  </tr>
                );

                // Emit group subtotal when this is the last line in the group
                const isLastInGroup = !nextLine || nextLine.group_id !== line.group_id;
                if (isLastInGroup && !closedGroups.has(line.group_id) && !isTechnical) {
                  closedGroups.add(line.group_id);
                  out.push(
                    <tr key={`gt-${line.group_id}`} style={{ background: headerBg, breakInside: "avoid" }}>
                      <td colSpan={colSpan - 1} style={{ padding: "5px 12px 5px 28px", textAlign: "right", fontSize: 11.5, fontWeight: 600, color: headerColor }}>
                        {line.group_label ?? "Group"} Total
                      </td>
                      <td style={{ padding: "5px 28px 5px 12px", textAlign: "right", fontSize: 12.5, fontWeight: 700, color: headerColor }}>
                        {inr(groupTotals[line.group_id] ?? 0)}
                      </td>
                    </tr>
                  );
                }
              } else {
                standaloneNum++;
                const slNo = line.sl_no || String(standaloneNum);
                const i = standaloneNum - 1;
                out.push(
                  <tr key={line.id} style={{ background: i % 2 === 1 ? "#fafbfc" : "#fff", breakInside: "avoid" }}>
                    <td style={{ padding: "7px 12px 7px 28px", color: "#8a96a5", fontSize: 11, fontFamily: "monospace" }}>{slNo}</td>
                    <td style={{ padding: "7px 12px", fontSize: 12.5 }}>{line.description}</td>
                    <td style={{ padding: "7px 12px", textAlign: "center", color: "#5f6b7a", fontSize: 12 }}>{line.uom ?? ""}</td>
                    <td style={{ padding: "7px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{line.qty}</td>
                    {!isTechnical && <td style={{ padding: "7px 12px", textAlign: "right", color: "#5f6b7a", fontSize: 12 }}>{line.rate.toLocaleString("en-IN")}</td>}
                    {!isTechnical && <td style={{ padding: "7px 28px 7px 12px", textAlign: "right", fontWeight: 500, fontSize: 12.5 }}>{inr(line.amount)}</td>}
                    {isTechnical && <td style={{ padding: "7px 28px" }} />}
                  </tr>
                );
              }
            }
            return out;
          })()}
        </tbody>
      </table>

      {/* Totals — hidden for technical offers */}
      {!isTechnical && (
        <div style={{ borderTop: `1px solid ${brand.line}`, padding: "9px 28px", display: "flex", justifyContent: "flex-end", breakInside: "avoid", breakBefore: "avoid" }}>
          <table style={{ width: 300 }}>
            <tbody>
              <TotalRow label="Subtotal" value={inr(subtotal)} />
              {discountAmt > 0 && (
                <TotalRow
                  label={quote.discount_type === "pct"
                    ? `Discount @ ${quote.discount_pct}%`
                    : "Discount"}
                  value={`− ${inr(discountAmt)}`}
                  muted
                />
              )}
              {totalDeductions > 0 && <TotalRow label="Deductions (salvage)" value={`− ${inr(totalDeductions)}`} muted />}
              {(discountAmt > 0 || totalDeductions > 0) && <TotalRow label="Net cost" value={inr(afterDiscount)} />}
              {hasGst && <TotalRow label={`${co.tax_label} @ ${quote.gst_rate}%`} value={inr(tax)} muted />}
              <tr>
                <td colSpan={2} style={{ paddingTop: 6 }}>
                  <div style={{ background: brand.dark, color: "#fff", borderRadius: 6, padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Grand total</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: brand.amber }}>{inr(grandTotal)}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Closing sentence */}
      <div style={{ padding: "8px 28px 10px", borderTop: `1px solid ${brand.line}`, breakInside: "avoid" }}>
        <div style={{ fontSize: 12.5, color: "#5f6b7a", fontStyle: "italic" }}>
          We kindly request you to give us an opportunity to serve your organization.
        </div>
      </div>

      {/* Scope of work — after totals, per reference layout */}
      {quote.scope_of_work && (
        <div style={{ padding: "9px 28px 10px", borderTop: `1px solid ${brand.line}`, breakInside: "avoid" }}>
          <SectionLabel>Scope of work</SectionLabel>
          <div style={{ color: "#5f6b7a", fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{quote.scope_of_work}</div>
        </div>
      )}

      {/* Notes */}
      {quote.notes && (
        <div style={{ margin: "0 28px 12px", background: brand.bg2, borderRadius: 6, padding: "9px 14px", borderLeft: `3px solid ${brand.blue}`, breakInside: "avoid" }}>
          <SectionLabel>Notes</SectionLabel>
          <div style={{ color: "#5f6b7a", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{quote.notes}</div>
        </div>
      )}

      {/* Terms & Conditions */}
      {quote.terms && (
        <div style={{ margin: "0 28px 12px", background: brand.bg2, borderRadius: 6, padding: "9px 14px", borderLeft: `3px solid ${brand.amber}`, breakInside: "avoid" }}>
          <SectionLabel>Terms &amp; Conditions</SectionLabel>
          <div style={{ color: "#5f6b7a", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{quote.terms}</div>
        </div>
      )}


      {/* Signature block — company only, right-aligned. Customer acceptance removed. */}
      <div style={{ margin: "6px 28px 20px", display: "flex", justifyContent: "flex-end", breakInside: "avoid", breakBefore: "avoid" }}>
        <div style={{ width: "50%", border: `1px solid ${brand.line}`, borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "#8a96a5", marginBottom: 6 }}>For {co.name}</div>
          {ext.quoteSignatureSlot ?? <div style={{ height: 48, marginBottom: 6 }} />}
          <div style={{ borderTop: `1px solid ${brand.dark}`, paddingTop: 6, fontSize: 11, color: "#5f6b7a" }}>Authorised Signatory</div>
        </div>
      </div>

      {ext.quoteExtraSection ?? null}

      {/* Footer — white, 10mm target: address+GSTIN row · phones+tagline row.
          minHeight (not a fixed height+overflow:hidden box) so it grows instead of silently
          clipping when a tenant has a long address or several phone numbers — a fixed-size
          flex column here previously either cut text off mid-word or, worse, visually collided
          with the block above it when print pagination ran out of room for it. flexWrap on the
          phones row means an overflowing list drops to a second line instead of either. */}
      <div style={{ background: "#fff", borderTop: `2px solid ${co.logo_bg}`, breakInside: "avoid", minHeight: "10mm", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {/* Row 1: address (left) + GSTIN (right) */}
        {co.address && (
          <div style={{ padding: "1.5px 28px", borderBottom: `1px solid ${brand.line}`, display: "flex", alignItems: "center", gap: 6, fontSize: 9.5, color: "#5f6b7a" }}>
            <MapPin size={9} color="#5f6b7a" style={{ flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{co.address}</span>
            {co.gstin && <span style={{ marginLeft: "auto", flexShrink: 0, color: "#b45309", fontWeight: 600 }}>GSTIN: {co.gstin}</span>}
          </div>
        )}
        {/* Row 2: phones (left) + tagline (right, only when the tenant actually set one —
            the company name doesn't need to repeat a third time and was crowding phones out) */}
        {(co.phones.length > 0 || co.phone || co.footer_tagline) && (
          <div style={{ padding: "1.5px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, rowGap: 2, flexWrap: "wrap", fontSize: 9.5 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px" }}>
              {co.phones.map((p, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                  <span style={{ color: "#5f6b7a" }}>{p.label}</span>
                  <span style={{ color: brand.dark, fontWeight: 600 }}> — {p.number}</span>
                </span>
              ))}
              {co.phone && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                  <span style={{ color: "#5f6b7a" }}>Phone</span>
                  <span style={{ color: brand.dark, fontWeight: 600 }}> — {co.phone}</span>
                </span>
              )}
            </div>
            {co.footer_tagline && (
              <span style={{ flexShrink: 0, whiteSpace: "nowrap", color: "#b45309", fontStyle: "italic", fontWeight: 500 }}>
                {co.footer_tagline} ☺
              </span>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: "#378ADD", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
      {children}
    </div>
  );
}

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <tr>
      <td style={{ padding: "4px 0", fontSize: 12.5, color: muted ? "#8a96a5" : "#1c2733" }}>{label}</td>
      <td style={{ padding: "4px 0", fontSize: 12.5, textAlign: "right", color: muted ? "#8a96a5" : "#1c2733" }}>{value}</td>
    </tr>
  );
}
