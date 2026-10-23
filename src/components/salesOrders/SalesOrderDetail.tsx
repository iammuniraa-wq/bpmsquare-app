"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import RecordActivity from "@/components/page/RecordActivity";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Input";
import MoreMenu from "@/components/ui/MoreMenu";
import type { MenuItem } from "@/components/ui/menuItems";
import SidePanel from "@/components/ui/SidePanel";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { useFeel } from "@/components/FeelProvider";
import { ROUTES } from "@/lib/constants";
import { buildWhatsAppLink, sanitizePhoneForWhatsApp } from "@/lib/whatsapp";
import { useUnsavedChangesGuard } from "@/lib/unsavedChanges";
import {
  cancelOrder, confirmOrder, deleteOrder, emailOrder, getOrder, listAttachments, listOrderTypes, refreshAvailability, reopenOrder,
  type ApiResult, type Attachment, type OrderDetail,
} from "@/lib/salesOrders/client";
import { orderAnnotatable } from "@/lib/salesOrders/types";
import { documentFlow, orderActions, orderWhatsAppMessage, pricingLine, type FlowRoutes } from "./logic";
import { fmtMoney } from "./money";
import { ORDER_TIPS } from "./tips";
import type { PickProduct } from "./lines";
import OrderChips from "./OrderChips";
import StatusPath from "./StatusPath";
import OverviewTab from "./OverviewTab";
import LinesTab from "./LinesTab";
import AvailabilityTab from "./AvailabilityTab";
import ErpTab from "./ErpTab";
import DocumentFlow from "./DocumentFlow";
import FilesAndLinks from "./FilesAndLinks";
import EditDetailsPanel from "./EditDetailsPanel";
import s from "./salesOrders.module.css";

const TAB_IDS = ["overview", "lines", "availability", "erp", "documents", "history"] as const;

export const FLOW_ROUTES: FlowRoutes = {
  standardQuote: ROUTES.standardQuote, quotation: ROUTES.quotation, deal: ROUTES.pipelineDetail, order: ROUTES.salesOrder,
};

type State =
  | { phase: "loading" }
  | { phase: "ready"; detail: OrderDetail; attachments: Attachment[] | null }
  | { phase: "failed"; status: number; error: string; missing: boolean };

/** What to say when the order cannot be shown: gone, no access, or the service not answering (never a crash). */
export function failureCopy(f: Extract<State, { phase: "failed" }>): { title: string; text: string; retry: boolean } {
  if (f.status === 404 && !f.error.toLowerCase().includes("network")) return { title: "Order not found", text: "It may have been deleted, or it belongs to another workspace.", retry: false };
  if (f.status === 401 || f.status === 403) return { title: "You cannot open this order", text: "Ask an admin for access to Sales Orders.", retry: false };
  return { title: "Sales orders are not available right now", text: "The order service did not answer. Try again in a moment.", retry: true };
}

export default function SalesOrderDetail({ orderId, isAdmin, products, tenantCurrency, companyName, middlewareHref, externalLine, whatsappPhone }: {
  orderId: string;
  isAdmin: boolean;
  products: PickProduct[];
  tenantCurrency: string;
  companyName: string;
  middlewareHref: string | null;
  /** The customer's phone for the WhatsApp message, read on the server (it is stored encrypted); null = none on file. */
  whatsappPhone: string | null;
  /** The ERP id line, rendered on the server (ExternalRecordSlot). */
  externalLine: React.ReactNode;
}) {
  const router = useRouter();
  const { confirm, toast } = useFeel();
  const [tab, setTab] = useUrlTab(TAB_IDS);
  const [state, setState] = useState<State>({ phase: "loading" });
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<"" | "email" | "confirm" | "availability" | "reopen">("");
  const [panel, setPanel] = useState<"" | "details" | "cancel">("");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [linesDirty, setLinesDirty] = useState(false);

  const load = useCallback(async () => {
    const [o, a] = await Promise.all([getOrder(orderId), listAttachments(orderId)]);
    if (!o.ok) { setState({ phase: "failed", status: o.status, error: o.error, missing: o.missing }); return; }
    let type = o.data.type;
    if (!type && o.data.order.type_id) {
      const t = await listOrderTypes();
      if (t.ok) type = t.data.find((x) => x.id === o.data.order.type_id) ?? null;
    }
    setState({ phase: "ready", detail: { ...o.data, type }, attachments: a.ok ? a.data : null });
    setVersion((v) => v + 1);
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);
  useUnsavedChangesGuard(linesDirty, { body: "The lines of this order have unsaved changes. If you leave now they will be lost." });

  if (state.phase === "loading") {
    return <div className={s.screen} role="status" aria-busy="true"><Card padding={0}><EmptyState title="Loading the order…" /></Card></div>;
  }
  if (state.phase === "failed") {
    const copy = failureCopy(state);
    return (
      <div className={s.screen}>
        <Card padding={0}>
          <EmptyState
            title={copy.title}
            text={copy.text}
            action={copy.retry ? <Button variant="primary" onClick={() => { setState({ phase: "loading" }); void load(); }} data-guide="sales_order.retry">Try again</Button> : <Button href={ROUTES.salesOrders}>All sales orders</Button>}
          />
        </Card>
      </div>
    );
  }

  const { detail, attachments } = state;
  const { order, lines } = detail;
  const currency = order.currency || tenantCurrency;
  const can = orderActions(order, detail.erpLinked, { erpAvailable: detail.erpAvailable });
  // The server's own answers win when it sent them; the shared rule (types.ts) is the same one, so they agree.
  const editable = detail.permissions?.editable ?? can.editLines;
  const annotatable = detail.permissions?.annotatable ?? orderAnnotatable(order);
  const deletable = detail.permissions?.deletable ?? can.remove;
  const customerName = detail.account?.name ?? "";

  const phone = sanitizePhoneForWhatsApp(whatsappPhone ?? detail.contact?.phone ?? detail.account?.phone);
  const waLink = phone
    ? buildWhatsAppLink(phone, orderWhatsAppMessage({ customer: detail.contact?.name ?? customerName, company: companyName, ref: order.ref, total: fmtMoney(order.total, currency), link: detail.publicPdfLink }))
    : null;

  async function run<T>(key: typeof busy, work: () => Promise<ApiResult<T>>, ok: string) {
    setBusy(key);
    const res = await work();
    setBusy("");
    if (!res.ok) { toast({ text: res.error, tone: "error" }); return; }
    toast({ text: ok, tone: "success" });
    await load();
  }

  async function sendEmail() {
    setBusy("email");
    const res = await emailOrder(order.id);
    setBusy("");
    if (!res.ok) { toast({ text: res.error, tone: "error" }); return; }
    toast({ text: res.data.sentTo ? `Sent to ${res.data.sentTo}` : "Email sent", tone: "success" });
    await load();
  }

  async function reopen() {
    if (!(await confirm({ title: `Reopen ${order.ref}?`, body: "It becomes a draft again and its lines can be changed." }))) return;
    await run("reopen", () => reopenOrder(order.id), "Order reopened");
  }

  async function remove() {
    if (!(await confirm({ title: `Delete ${order.ref}?`, body: "A draft can be deleted. This cannot be undone.", tone: "danger" }))) return;
    const res = await deleteOrder(order.id);
    if (!res.ok) { toast({ text: res.error, tone: "error" }); return; }
    setLinesDirty(false);
    router.push(ROUTES.salesOrders);
  }

  async function submitCancel() {
    if (reason.trim() === "") { setReasonError("Give a reason"); return; }
    setCancelling(true); setReasonError("");
    const res = await cancelOrder(order.id, reason.trim());
    setCancelling(false);
    if (!res.ok) { setReasonError(res.error); return; }
    setPanel(""); setReason("");
    toast({ text: "Order cancelled", tone: "success" });
    await load();
  }

  const menu: MenuItem[] = [
    { label: "Edit details", onSelect: () => setPanel("details"), hidden: !editable && !annotatable },
    { label: "Reopen", onSelect: () => void reopen(), hidden: !can.reopen },
    { label: "Cancel order", onSelect: () => { setReason(""); setReasonError(""); setPanel("cancel"); }, danger: true, hidden: !can.cancel },
    { label: "Delete", onSelect: () => void remove(), danger: true, hidden: !deletable },
  ];

  const confirmDisabled = lines.length === 0;
  const primary = can.confirm && editable ? (
    <span className={s.primarySlot}>
      <Button
        variant="primary" loading={busy === "confirm"} disabled={confirmDisabled} data-guide="sales_order.confirm"
        title={confirmDisabled ? "Add at least one line first" : undefined}
        onClick={() => void run("confirm", () => confirmOrder(order.id), "Order confirmed")}
      >Confirm order</Button>
    </span>
  ) : null;

  const subtitle = customerName;
  const linesSig = JSON.stringify(lines.map((l) => [l.id, l.description, l.printed_text, l.qty, l.unit_price, l.discount_pct, l.tax_pct, l.requested_date]));

  const onTab = (id: string) => setTab(id);
  const linesVisible = tab === "lines";

  return (
    <div className={`${s.screen} ${primary ? s.hasPrimary : ""}`}>
      <TabTitle title={order.ref} />
      <StatusPath order={order} docs={detail.erpDocuments} />

      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.salesOrders} className="bpm-backlink" data-guide="sales_order.back">← All sales orders</Link>
      </div>

      <PageHeader
        title={order.ref}
        subtitle={subtitle || undefined}
        badge={<OrderChips order={order} type={detail.type} erpLinked={detail.erpLinked} reason={detail.lockReason} />}
        action={
          <div className={s.actions}>
            <Button href={`/api/sales-orders/${order.id}/pdf`} target="_blank" data-guide="sales_order.pdf">PDF</Button>
            {can.email && <Button loading={busy === "email"} onClick={() => void sendEmail()} data-guide="sales_order.email">Email</Button>}
            {can.whatsapp && (waLink
              ? <Button href={waLink} target="_blank" data-guide="sales_order.whatsapp">WhatsApp</Button>
              : <Button disabled title="This customer has no phone number" data-guide="sales_order.whatsapp">WhatsApp</Button>)}
            {can.checkWithErp && <Button disabled title="Checking with the ERP arrives with the ERP connection" data-guide="sales_order.check_erp">Check with ERP</Button>}
            {primary}
            <MoreMenu items={menu} />
          </div>
        }
      />
      <p className={s.quiet} data-guide="sales_order.pricing">{detail.pricingLabel ?? pricingLine(order.pricing_mode, detail.source ? { type: detail.source.type, ref: detail.source.ref } : null)}</p>

      <div style={{ marginBottom: 14 }}>
        <Tabs
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "lines", label: "Lines", count: lines.length },
            { id: "availability", label: "Availability" },
            { id: "erp", label: "ERP" },
            { id: "documents", label: "Documents and files" },
            { id: "history", label: "History" },
          ]}
          value={tab}
          onChange={onTab}
          label="Order sections"
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {tab === "overview" && (
          <OverviewTab detail={detail} attachments={attachments} currency={currency} onSeeAvailability={() => setTab("availability")} />
        )}

        {(linesVisible || linesDirty) && (
          <div hidden={!linesVisible}>
            <LinesTab key={linesSig} detail={detail} currency={currency} editable={editable} products={products} onSaved={() => void load()} onDirty={setLinesDirty} />
          </div>
        )}

        {tab === "availability" && (
          <AvailabilityTab
            lines={lines}
            canRefresh={order.status !== "cancelled" && order.origin === "bpmsquare"}
            refreshing={busy === "availability"}
            onRefresh={() => void run("availability", () => refreshAvailability(order.id), "Availability updated")}
          />
        )}

        {tab === "erp" && <ErpTab detail={detail} currency={currency} externalLine={externalLine} middlewareHref={middlewareHref} />}

        {tab === "documents" && (
          <>
            <Card title="Document flow" info={ORDER_TIPS.flow} padding={16}>
              <DocumentFlow model={documentFlow(detail, FLOW_ROUTES)} currency={currency} />
            </Card>
            <FilesAndLinks orderId={order.id} items={attachments} canAdd={annotatable} onChanged={() => void load()} />
          </>
        )}

        {tab === "history" && <RecordActivity objectType="sales_orders" objectId={order.id} isAdmin={isAdmin} />}
      </div>

      {panel === "details" && (
        <EditDetailsPanel
          key={version}
          detail={detail}
          editable={editable}
          onClose={() => setPanel("")}
          onSaved={() => { setPanel(""); toast({ text: "Details saved", tone: "success" }); void load(); }}
        />
      )}

      {panel === "cancel" && (
        <SidePanel
          title={`Cancel ${order.ref}`}
          onClose={() => setPanel("")}
          footer={<><Button onClick={() => setPanel("")} disabled={cancelling}>Keep order</Button><Button variant="danger" loading={cancelling} onClick={() => void submitCancel()} data-guide="sales_order.cancel_confirm">Cancel order</Button></>}
        >
          <Field label="Reason" required htmlFor="so-cancel-reason">
            <Textarea id="so-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Why is this order cancelled?" />
          </Field>
          {reasonError && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{reasonError}</div>}
        </SidePanel>
      )}
    </div>
  );
}
