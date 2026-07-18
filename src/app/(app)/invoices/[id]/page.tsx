import { notFound } from "next/navigation";
import Link from "next/link";
import { requireFeature, getUserRole } from "@/lib/tenant";
import { getInvoiceLive } from "@/lib/data/live";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import { ROUTES } from "@/lib/constants";
import type { InvoiceStatus } from "@/lib/types";
import CustomFieldsSection from "@/components/CustomFieldsSection";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";
import InvoiceEditPanel from "./InvoiceEditPanel";
import RecordPaymentPanel from "./RecordPaymentPanel";

const STATUS_TONE: Record<InvoiceStatus, PillarKey> = {
  draft: "blue", sent: "amber", partial: "purple", paid: "green", overdue: "red", cancelled: "red",
};
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft", sent: "Sent", partial: "Partial", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled",
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

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeature("invoices");
  const { id } = await params;
  const [data, role] = await Promise.all([getInvoiceLive(id), getUserRole()]);
  if (!data) notFound();
  const { invoice, lines, payments, account, contact, quote, workOrder, serviceCase, contract } = data;

  const balanceDue = Math.max(0, invoice.total - invoice.paid_amount);
  const isOverdue = invoice.due_date != null
    && new Date(invoice.due_date) < new Date()
    && ["sent", "partial"].includes(invoice.status);

  return (
    <>
      <TabTitle title={invoice.ref} />

      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.invoices} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>
          ← All invoices
        </Link>
      </div>

      <PageHeader
        title={invoice.ref}
        subtitle={`Finance & billing · ${account?.name ?? ""}`}
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <a
              href={`/api/invoices/${invoice.id}/pdf`}
              style={{ fontSize: 12.5, fontWeight: 600, color: c.accent, background: c.accentbg, borderRadius: 7, padding: "6px 12px", textDecoration: "none" }}
            >
              ⬇ PDF
            </a>
            <AdaptObjectDrawer objectType="invoice" objectLabel="Invoice" isAdmin={role === "admin"} />
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16, alignItems: "start", marginTop: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          <section style={{ ...cardStyle, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>Total</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: c.ink }}>{inr(invoice.total)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>Paid to date</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#1d9e75" }}>{inr(invoice.paid_amount)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 3 }}>Balance due</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: balanceDue > 0 ? "#a32d2d" : c.ink }}>{inr(balanceDue)}</div>
            </div>
            {isOverdue && (
              <div style={{ display: "flex", alignItems: "center" }}>
                <Pill label="Overdue" tone="red" />
              </div>
            )}
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
                    <td style={{ padding: "8px 14px", textAlign: "right", fontSize: 13, fontWeight: 500 }}>{inr(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <RecordPaymentPanel invoiceId={invoice.id} status={invoice.status} balanceDue={balanceDue} payments={payments} />

          {(invoice.notes || invoice.terms) && (
            <section style={cardStyle}>
              {invoice.notes && (
                <>
                  <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>Notes</div>
                  <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.7, color: c.ink }}>{invoice.notes}</p>
                </>
              )}
              {invoice.terms && (
                <>
                  <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>Terms</div>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: c.ink }}>{invoice.terms}</p>
                </>
              )}
            </section>
          )}

          <CustomFieldsSection
            objectType="invoice"
            recordId={invoice.id}
            customData={invoice.custom_data}
            patchUrl={`/api/invoices/${invoice.id}`}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <section style={{ ...cardStyle, padding: "14px" }}>
            <div style={{ marginBottom: 10 }}>
              <Pill label={STATUS_LABEL[invoice.status]} tone={STATUS_TONE[invoice.status]} />
            </div>
            {contact && (
              <>
                <CtxLabel>Contact</CtxLabel>
                <div style={{ fontSize: 13, color: c.ink }}>{contact.name}</div>
              </>
            )}
            {quote && (
              <>
                <CtxLabel>Linked quote</CtxLabel>
                <Link href={ROUTES.quotation(quote.id)} style={{ fontSize: 13, color: c.accent, textDecoration: "none", fontWeight: 600, fontFamily: "monospace" }}>
                  {quote.ref}
                </Link>
              </>
            )}
            {workOrder && (
              <>
                <CtxLabel>Linked work order</CtxLabel>
                <Link href={ROUTES.workOrder(workOrder.id)} style={{ fontSize: 13, color: c.accent, textDecoration: "none", fontWeight: 600, fontFamily: "monospace" }}>
                  {workOrder.ref}
                </Link>
              </>
            )}
            {serviceCase && (
              <>
                <CtxLabel>Linked case</CtxLabel>
                <Link href={ROUTES.case(serviceCase.id)} style={{ fontSize: 13, color: c.accent, textDecoration: "none", fontWeight: 600, fontFamily: "monospace" }}>
                  {serviceCase.ref}
                </Link>
              </>
            )}
            {contract && (
              <>
                <CtxLabel>Linked contract</CtxLabel>
                <div style={{ fontSize: 13, color: c.ink, fontFamily: "monospace" }}>{contract.ref}</div>
              </>
            )}

            <CtxLabel>Dates</CtxLabel>
            <CtxRow label="Issued" value={fmtDate(invoice.issued_at)} />
            <CtxRow label="Due" value={fmtDate(invoice.due_date)} />
          </section>

          <InvoiceEditPanel invoice={invoice} />
        </div>
      </div>
    </>
  );
}
