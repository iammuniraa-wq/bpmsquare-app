import Link from "next/link";
import { listQuotes, QUOTE_STATUS_LABEL } from "@/lib/data";
import type { Quote } from "@/lib/types";
import { c } from "@/lib/theme";
import type { PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";

const statusTone: Record<Quote["status"], PillarKey> = {
  draft: "blue",
  sent:  "purple",
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
  padding: "10px 12px",
  borderBottom: `1px solid ${c.line}`,
  fontSize: 12,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "11px 12px",
  borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5,
  verticalAlign: "middle",
};

export default async function QuotationsPage() {
  const rows = await listQuotes();

  const totalApproved = rows
    .filter((r) => r.quote.status === "approved")
    .reduce((s, r) => s + r.quote.total, 0);

  const totalPipeline = rows
    .filter((r) => r.quote.status === "sent")
    .reduce((s, r) => s + r.quote.total, 0);

  return (
    <>
      <PageHeader
        title="Quotations"
        subtitle={`Sales · ${rows.length} quotes`}
      />

      {/* summary strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {[
          { label: "Total quotes", value: rows.length, color: c.ink },
          { label: "Approved value", value: inr(totalApproved), color: "#0F6E56" },
          { label: "In pipeline", value: inr(totalPipeline), color: "#185FA5" },
          { label: "Awaiting approval", value: rows.filter((r) => r.quote.status === "sent").length, color: c.muted },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: c.panel,
              border: `1px solid ${c.line}`,
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 11, color: c.muted }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: s.color, marginTop: 4 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Ref</th>
              <th style={th}>Account</th>
              <th style={th}>Status</th>
              <th style={th}>Lines</th>
              <th style={{ ...th, textAlign: "right" }}>Total</th>
              <th style={th}>Date</th>
              <th style={th}>Valid until</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ quote, account, lineCount }) => (
              <tr key={quote.id} style={{ cursor: "pointer" }}>
                <td style={td}>
                  <Link
                    href={ROUTES.quotation(quote.id)}
                    style={{ fontWeight: 600, color: c.accent, fontFamily: "monospace" }}
                  >
                    {quote.ref}
                  </Link>
                </td>
                <td style={td}>
                  <Link
                    href={ROUTES.account(account.id)}
                    style={{ color: c.ink }}
                  >
                    {account.name}
                  </Link>
                </td>
                <td style={td}>
                  <Pill
                    label={QUOTE_STATUS_LABEL[quote.status]}
                    tone={statusTone[quote.status]}
                  />
                </td>
                <td style={{ ...td, color: c.muted }}>{lineCount} items</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>
                  {inr(quote.total)}
                </td>
                <td style={{ ...td, color: c.muted }}>{fmtDate(quote.created_at)}</td>
                <td style={{ ...td, color: c.muted }}>
                  {quote.valid_until ? fmtDate(quote.valid_until) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
