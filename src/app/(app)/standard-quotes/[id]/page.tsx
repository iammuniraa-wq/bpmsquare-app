import { notFound } from "next/navigation";
import Link from "next/link";
import { requireWorkcenterView } from "@/lib/permissions";
import { getStandardQuoteLive } from "@/lib/data/live";
import { c, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import { ROUTES } from "@/lib/constants";
import type { StandardQuoteStatus } from "@/lib/types";
import StandardQuoteActionsPanel from "./StandardQuoteActionsPanel";

const STATUS_TONE: Record<StandardQuoteStatus, PillarKey> = {
  draft: "blue", sent: "amber", accepted: "green", rejected: "red", expired: "red",
};
const STATUS_LABEL: Record<StandardQuoteStatus, string> = {
  draft: "Draft", sent: "Sent", accepted: "Accepted", rejected: "Rejected", expired: "Expired",
};

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

function CtxRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginTop: 5 }}>
      <span style={{ color: c.hint, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", color: c.muted, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}
function CtxLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.7, marginTop: 14, marginBottom: 4 }}>
      {children}
    </div>
  );
}

export default async function StandardQuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("standard_quotes");
  const { id } = await params;
  const data = await getStandardQuoteLive(id);
  if (!data) notFound();
  const { quote, lines, account, contact } = data;

  return (
    <>
      <TabTitle title={quote.ref} />

      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.standardQuotes} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>
          ← All standard quotes
        </Link>
      </div>

      <PageHeader
        title={quote.ref}
        subtitle={`Standard Quote · ${account?.name ?? ""}`}
        action={
          <Link href={ROUTES.standardQuoteEdit(quote.id)} style={{ fontSize: 12.5, fontWeight: 600, color: c.accent, background: c.accentbg, borderRadius: 7, padding: "6px 12px", textDecoration: "none" }}>
            Edit
          </Link>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16, alignItems: "start", marginTop: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          <section style={{ ...cardStyle, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>Total</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: c.ink }}>{inr(quote.total)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>Valid until</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: c.ink }}>{fmtDate(quote.valid_until)}</div>
            </div>
          </section>

          <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
            <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${c.line}` }}>
              <h3 style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>Line items</h3>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: c.panel2 }}>
                  <th style={{ textAlign: "left", padding: "7px 14px", fontSize: 11, color: c.hint, fontWeight: 600 }}>Description</th>
                  <th style={{ textAlign: "center", padding: "7px 12px", fontSize: 11, color: c.hint, fontWeight: 600 }}>UOM</th>
                  <th style={{ textAlign: "right", padding: "7px 12px", fontSize: 11, color: c.hint, fontWeight: 600 }}>Qty</th>
                  <th style={{ textAlign: "right", padding: "7px 12px", fontSize: 11, color: c.hint, fontWeight: 600 }}>Rate</th>
                  <th style={{ textAlign: "right", padding: "7px 12px", fontSize: 11, color: c.hint, fontWeight: 600 }}>Disc %</th>
                  <th style={{ textAlign: "right", padding: "7px 14px", fontSize: 11, color: c.hint, fontWeight: 600 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} style={{ borderTop: `1px solid ${c.line}` }}>
                    <td style={{ padding: "8px 14px", fontSize: 13 }}>{l.description}</td>
                    <td style={{ padding: "8px 12px", textAlign: "center", fontSize: 12.5, color: c.muted }}>{l.uom ?? ""}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12.5 }}>{l.qty}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12.5, color: c.muted }}>{inr(l.rate)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12.5, color: c.muted }}>{l.discount_pct > 0 ? `${l.discount_pct}%` : "—"}</td>
                    <td style={{ padding: "8px 14px", textAlign: "right", fontSize: 13, fontWeight: 500 }}>{inr(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {(quote.notes || quote.terms) && (
            <section style={cardStyle}>
              {quote.notes && (
                <>
                  <CtxLabel>Notes</CtxLabel>
                  <div style={{ fontSize: 13, color: c.ink, whiteSpace: "pre-wrap" }}>{quote.notes}</div>
                </>
              )}
              {quote.terms && (
                <>
                  <CtxLabel>Terms</CtxLabel>
                  <div style={{ fontSize: 13, color: c.ink, whiteSpace: "pre-wrap" }}>{quote.terms}</div>
                </>
              )}
            </section>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <section style={{ ...cardStyle, padding: "14px" }}>
            <div style={{ marginBottom: 10 }}>
              <Pill label={STATUS_LABEL[quote.status]} tone={STATUS_TONE[quote.status]} />
            </div>
            {contact && (
              <>
                <CtxLabel>Contact</CtxLabel>
                <div style={{ fontSize: 13, color: c.ink }}>{contact.name}</div>
              </>
            )}

            <CtxLabel>Dates</CtxLabel>
            <CtxRow label="Created" value={fmtDate(quote.created_at)} />
            <CtxRow label="Sent" value={fmtDate(quote.sent_at)} />
          </section>

          <StandardQuoteActionsPanel quote={quote} />
        </div>
      </div>
    </>
  );
}
