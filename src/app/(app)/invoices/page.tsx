import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { listInvoices } from "@/lib/data/live";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

const STATUS_TONE: Record<InvoiceStatus, PillarKey> = {
  draft: "blue", sent: "amber", paid: "green", overdue: "red",
};
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft", sent: "Sent", paid: "Paid", overdue: "Overdue",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5,
};
const td: React.CSSProperties = {
  padding: "10px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "middle",
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireFeature("invoices");
  const { status: statusFilter } = await searchParams;
  const invoices = await listInvoices();

  const summary = (["draft", "sent", "paid", "overdue"] as InvoiceStatus[]).map((s) => ({
    status: s,
    count: invoices.filter((i) => i.status === s).length,
    total: invoices.filter((i) => i.status === s).reduce((acc, i) => acc + i.total, 0),
  }));

  const filtered = statusFilter ? invoices.filter((i) => i.status === statusFilter) : invoices;

  return (
    <>
      <PageHeader title="Invoices" subtitle={`${filtered.length}${statusFilter ? ` ${STATUS_LABEL[statusFilter as InvoiceStatus] ?? statusFilter}` : ""} of ${invoices.length} total · Finance & billing`} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: statusFilter ? 8 : 20 }}>
        {summary.map(({ status, count, total }) => (
          <Link key={status} href={statusFilter === status ? ROUTES.invoices : `${ROUTES.invoices}?status=${status}`} style={{ textDecoration: "none" }}>
            <div style={{ ...cardStyle, textAlign: "center", borderColor: statusFilter === status ? pillar[STATUS_TONE[status]].base : undefined }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                {STATUS_LABEL[status]}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: pillar[STATUS_TONE[status]].base }}>{inr(total)}</div>
              <div style={{ fontSize: 11, color: c.hint, marginTop: 2 }}>{count} invoice{count !== 1 ? "s" : ""}</div>
            </div>
          </Link>
        ))}
      </div>

      {statusFilter && (
        <div style={{ marginBottom: 12 }}>
          <Link href={ROUTES.invoices} style={{ fontSize: 12, color: c.hint, textDecoration: "none" }}>← Show all invoices</Link>
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px", color: c.muted }}>
          No invoices yet. Raise one from a completed work order.
        </div>
      ) : (
        <div style={cardStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Ref</th>
                <th style={th}>Account</th>
                <th style={th}>Status</th>
                <th style={th}>Total</th>
                <th style={th}>Issued</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id}>
                  <td style={td}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: c.accent, fontWeight: 600 }}>
                      {inv.ref}
                    </span>
                  </td>
                  <td style={td}>{inv.account_name}</td>
                  <td style={td}>
                    <Pill
                      label={STATUS_LABEL[inv.status as InvoiceStatus] ?? inv.status}
                      tone={STATUS_TONE[inv.status as InvoiceStatus] ?? "blue"}
                    />
                  </td>
                  <td style={{ ...td, fontWeight: 700 }}>{inr(inv.total)}</td>
                  <td style={{ ...td, color: c.muted }}>{inv.issued_at ? fmtDate(inv.issued_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
