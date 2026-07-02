import Link from "next/link";
import { notFound } from "next/navigation";
import { getQuote, QUOTE_STATUS_LABEL, ACCOUNT_TYPE_LABEL } from "@/lib/data";
import type { Quote } from "@/lib/types";
import { c } from "@/lib/theme";
import type { PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import ComingSoon from "@/components/ComingSoon";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import CustomFieldsSection from "@/components/CustomFieldsSection";

const statusTone: Record<Quote["status"], PillarKey> = {
  draft:    "blue",
  sent:     "purple",
  approved: "teal",
  rejected: "red",
};

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const th: React.CSSProperties = {
  textAlign: "left",
  color: c.hint,
  fontWeight: 500,
  padding: "9px 12px",
  borderBottom: `1px solid ${c.line}`,
  fontSize: 11.5,
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5,
  verticalAlign: "top",
};

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getQuote(id);
  if (!data) notFound();

  const { quote, account, contact, lines, workOrders } = data;

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const gst = Math.round(subtotal * 0.18);
  const grandTotal = subtotal + gst;

  return (
    <>
      <TabTitle title={quote.ref} />
      <PageHeader
        title={quote.ref}
        subtitle={`Sales · Quotation · ${account?.name ?? ""}`}
      />

      <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Link href={ROUTES.quotations} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All quotations
        </Link>
        <Pill label={QUOTE_STATUS_LABEL[quote.status]} tone={statusTone[quote.status]} />
        {quote.status === "approved" && workOrders.length > 0 && (
          <span style={{ fontSize: 12, color: c.muted }}>
            · WO: <span style={{ fontWeight: 600, color: c.ink }}>{workOrders[0].ref}</span>
          </span>
        )}

        {/* Action bar */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Email — Coming Soon */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f4f6f9", color: c.hint, borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 500, cursor: "not-allowed" }}>
            📧 Email quote <ComingSoon size="xs" />
          </span>
          {/* WhatsApp — Coming Soon */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f0faf5", color: "#3d7a5a", borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 500, cursor: "not-allowed" }}>
            💬 WhatsApp <ComingSoon size="xs" />
          </span>
          {/* PDF — works */}
          <Link
            href={ROUTES.quotationPrint(id)}
            target="_blank"
            rel="noopener"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c.accent, color: "#fff", borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 500, textDecoration: "none" }}
          >
            ↓ Download PDF
          </Link>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 12 }} className="hub-grid">

        {/* Left — line items */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Document header */}
          <section style={{ ...cardStyle, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, color: c.muted, marginBottom: 2 }}>Quotation ref</div>
              <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace", color: c.ink }}>{quote.ref}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: c.muted, marginBottom: 2 }}>Issued</div>
              <div style={{ fontSize: 13 }}>{fmtDate(quote.created_at)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: c.muted, marginBottom: 2 }}>Valid until</div>
              <div style={{ fontSize: 13 }}>{quote.valid_until ? fmtDate(quote.valid_until) : "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: c.muted, marginBottom: 2 }}>Status</div>
              <Pill label={QUOTE_STATUS_LABEL[quote.status]} tone={statusTone[quote.status]} />
            </div>
          </section>

          {/* Line items */}
          <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
            <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${c.line}` }}>
              <h3 style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>Scope of work</h3>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 28 }}>#</th>
                  <th style={th}>Description</th>
                  <th style={{ ...th, textAlign: "right", whiteSpace: "nowrap" }}>Qty</th>
                  <th style={{ ...th, textAlign: "right", whiteSpace: "nowrap" }}>Rate (₹)</th>
                  <th style={{ ...th, textAlign: "right", whiteSpace: "nowrap" }}>Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={line.id}>
                    <td style={{ ...td, color: c.hint, fontSize: 11 }}>{i + 1}</td>
                    <td style={td}>{line.description}</td>
                    <td style={{ ...td, textAlign: "right", color: c.muted }}>{line.qty}</td>
                    <td style={{ ...td, textAlign: "right", color: c.muted }}>
                      {line.rate.toLocaleString("en-IN")}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 500 }}>
                      {inr(line.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div
              style={{
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                alignItems: "flex-end",
                borderTop: `1px solid ${c.line}`,
              }}
            >
              <TotalRow label="Subtotal" value={inr(subtotal)} />
              <TotalRow label="GST @ 18%" value={inr(gst)} muted />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  width: 220,
                  paddingTop: 8,
                  borderTop: `2px solid ${c.ink}`,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>Grand total</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: c.accent }}>{inr(grandTotal)}</span>
              </div>
            </div>
          </section>

          {/* Notes */}
          {quote.notes && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, margin: "0 0 8px", fontWeight: 600 }}>Notes & terms</h3>
              <p style={{ fontSize: 12.5, color: c.muted, margin: 0, lineHeight: 1.6 }}>
                {quote.notes}
              </p>
            </section>
          )}

          {/* Linked work orders */}
          {workOrders.length > 0 && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>
                Work order — authorized by this quote
              </h3>
              {workOrders.map((wo) => (
                <div
                  key={wo.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 0",
                    borderTop: `1px solid ${c.line}`,
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{wo.ref}</span>
                  <Pill
                    label={wo.status.replace("_", " ")}
                    tone="amber"
                  />
                </div>
              ))}
            </section>
          )}
        </div>

        {/* Right — account context */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <section style={cardStyle}>
            <h3 style={{ fontSize: 13, margin: "0 0 12px", fontWeight: 600 }}>Account</h3>
            {account && (
              <>
                <Link
                  href={ROUTES.account(account.id)}
                  style={{ fontSize: 14, fontWeight: 600, color: c.accent, display: "block", marginBottom: 4 }}
                >
                  {account.name}
                </Link>
                <Pill
                  label={ACCOUNT_TYPE_LABEL[account.type]}
                  tone={account.type === "prospect" ? "amber" : account.type === "oem" ? "purple" : account.type === "direct" ? "green" : "teal"}
                />
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  {account.city && <Detail label="City" value={account.city} />}
                  {account.phone && <Detail label="Phone" value={account.phone} />}
                  {account.email && <Detail label="Email" value={account.email} />}
                </div>
              </>
            )}
          </section>

          {contact && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Contact</h3>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{contact.name}</div>
              {contact.role && (
                <div style={{ fontSize: 12, color: c.muted, marginBottom: 8 }}>{contact.role}</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {contact.phone && <Detail label="Phone" value={contact.phone} />}
                {contact.email && <Detail label="Email" value={contact.email} />}
              </div>
            </section>
          )}

          <section style={cardStyle}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Summary</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Detail label="Line items" value={String(lines.length)} />
              <Detail label="Subtotal" value={inr(subtotal)} />
              <Detail label="GST 18%" value={inr(gst)} />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingTop: 8,
                  borderTop: `1px solid ${c.line}`,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <span>Total</span>
                <span style={{ color: c.accent }}>{inr(grandTotal)}</span>
              </div>
            </div>
          </section>
        </div>

      </div>

      <CustomFieldsSection
        objectType="quote"
        recordId={quote.id}
        customData={(quote as Record<string, unknown>).custom_data as Record<string, unknown> | null}
        patchUrl={`/api/quotes/${quote.id}`}
      />
    </>
  );
}

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", width: 220, fontSize: 12.5 }}>
      <span style={{ color: muted ? c.muted : c.ink }}>{label}</span>
      <span style={{ color: muted ? c.muted : c.ink }}>{value}</span>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
      <span style={{ color: c.muted }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}
