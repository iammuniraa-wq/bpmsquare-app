import { notFound } from "next/navigation";
import Link from "next/link";
import { requireFeature, getUserRole, getTenantCurrency } from "@/lib/tenant";
import { moneyFormatter } from "@/lib/currency";
import { getInvoiceLive } from "@/lib/data/live";
import { c, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { ROUTES } from "@/lib/constants";
import type { InvoiceStatus } from "@/lib/types";
import ObjectSections from "@/components/fields/ObjectSections";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import ExternalRecordSlot from "@/components/ExternalRecordSlot";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActivity from "@/components/page/RecordActivity";
import RelatedList from "@/components/page/RelatedList";
import type { MenuItem } from "@/components/ui/menuItems";
import type { RecordAction } from "@/components/page/recordActions";
import RecordPaymentPanel from "./RecordPaymentPanel";
import EmailInvoicePanel from "./EmailInvoicePanel";

const STATUS_TONE: Record<InvoiceStatus, PillarKey> = {
  draft: "blue", sent: "amber", partial: "purple", paid: "green", overdue: "red", cancelled: "red",
};
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft", sent: "Sent", partial: "Partial", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled",
};

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function CtxRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, marginTop: 5 }}>
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

export default async function InvoiceDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireFeature("invoices");
  const inr = moneyFormatter(await getTenantCurrency(), { maximumFractionDigits: 0 });
  const { id } = await params;
  const { tab } = await searchParams;
  const [data, role] = await Promise.all([getInvoiceLive(id), getUserRole()]);
  if (!data) notFound();
  const { invoice, lines, payments, account, contact, quote, workOrder, serviceCase, contract } = data;
  const isAdmin = role === "admin";
  const basePath = ROUTES.invoice(invoice.id);

  const balanceDue = Math.max(0, invoice.total - invoice.paid_amount);
  const isOverdue = invoice.due_date != null
    && new Date(invoice.due_date) < new Date()
    && ["sent", "partial"].includes(invoice.status);

  const canEmail = invoice.status !== "cancelled";
  const isDraft = invoice.status === "draft";
  const canRecordPayment = !["draft", "cancelled"].includes(invoice.status) && balanceDue > 0;

  const primaryAction = isDraft
    ? <Button href={`${basePath}?tab=email`} variant="primary">Email invoice</Button>
    : canRecordPayment
      ? <Button href={`${basePath}?tab=payments`} variant="primary">Record payment</Button>
      : undefined;

  const extraItems: MenuItem[] = [
    { label: "Email invoice", href: `${basePath}?tab=email`, hidden: !canEmail || isDraft },
  ];
  const actions: RecordAction[] = [
    { label: "Mark as sent (without emailing)", endpoint: `/api/invoices/${invoice.id}`, body: { status: "sent" }, hidden: !isDraft, errorText: "Failed to update status" },
    {
      label: "Cancel invoice", endpoint: `/api/invoices/${invoice.id}`, body: { status: "cancelled" }, danger: true,
      hidden: ["draft", "cancelled", "paid"].includes(invoice.status),
      confirm: { title: "Cancel this invoice?", body: "It stays on record as cancelled — nothing is deleted.", confirmLabel: "Cancel invoice", cancelLabel: "Keep it", tone: "danger" },
      errorText: "Failed to update status",
    },
  ];

  return (
    <ObjectRecordPage
      backHref={ROUTES.invoices}
      backLabel="All invoices"
      title={invoice.ref}
      meta={`Finance & billing${account?.name ? ` · ${account.name}` : ""}`}
      status={
        <>
          <StatusPill label={STATUS_LABEL[invoice.status]} tone={STATUS_TONE[invoice.status]} />
          {isOverdue && <StatusPill label="Overdue" tone="red" />}
        </>
      }
      primaryAction={primaryAction}
      menu={
        <RecordMoreMenu
          inlineEdit={{ overviewHref: basePath }}
          printHref={`/api/invoices/${invoice.id}/pdf`}
          extraItems={extraItems}
          actions={actions}
          adapt={{ objectType: "invoice", objectLabel: "Invoice", isAdmin }}
          remove={isDraft ? { endpoint: `/api/invoices/${invoice.id}`, recordName: invoice.ref, entityLabel: "draft invoice", afterHref: ROUTES.invoices } : undefined}
        />
      }
      facts={[
        { label: "Total", value: inr(invoice.total) },
        { label: "Paid to date", value: <span style={{ color: "var(--teal)" }}>{inr(invoice.paid_amount)}</span> },
        { label: "Balance due", value: <span style={{ color: balanceDue > 0 ? "var(--red)" : undefined }}>{inr(balanceDue)}</span> },
        { label: "Due", value: fmtDate(invoice.due_date) },
      ]}
      externalLine={<ExternalRecordSlot objectType="invoices" objectId={id} />}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <ObjectSections
              objectType="invoice"
              record={invoice as unknown as Record<string, unknown>}
              patchUrl={`/api/invoices/${invoice.id}`}
              exclude={["ref"]}
            />
          ),
        },
        {
          id: "lines",
          label: "Lines",
          count: lines.length,
          content: (
            <RelatedList
              title="Line items"
              emptyText="No line items."
              rows={lines}
              rowKey={(l) => l.id}
              columns={[
                { label: "Description", render: (l) => l.description },
                { label: "UOM", align: "center", cellStyle: { color: c.muted, fontSize: 12.5 }, render: (l) => l.uom ?? "" },
                { label: "Qty", align: "right", render: (l) => l.qty },
                { label: "Rate", align: "right", cellStyle: { color: c.muted }, render: (l) => inr(l.rate) },
                { label: "Amount", align: "right", cellStyle: { fontWeight: 500 }, render: (l) => inr(l.amount) },
              ]}
              footer={<div style={{ fontSize: 14, fontWeight: 700 }}>Total: {inr(invoice.total)}</div>}
            />
          ),
        },
        {
          id: "payments",
          label: "Payments",
          count: payments.length,
          content: <RecordPaymentPanel invoiceId={invoice.id} status={invoice.status} balanceDue={balanceDue} payments={payments} />,
        },
        ...(canEmail ? [{
          id: "email",
          label: "Email",
          content: <EmailInvoicePanel invoiceId={invoice.id} invoiceRef={invoice.ref} closeHref={basePath} />,
        }] : []),
        { id: "activity", label: "Activity", content: <RecordActivity objectType="invoices" objectId={invoice.id} isAdmin={isAdmin} /> },
      ]}
      rail={
        <Card padding={14}>
          {account && (
            <>
              <CtxLabel>Account</CtxLabel>
              <Link href={ROUTES.account(account.id)} style={{ fontSize: 13, color: c.accent, textDecoration: "none", fontWeight: 600 }}>{account.name}</Link>
            </>
          )}
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
        </Card>
      }
    />
  );
}
