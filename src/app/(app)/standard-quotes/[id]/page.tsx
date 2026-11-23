import { notFound } from "next/navigation";
import Link from "next/link";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature, getTenant, getTenantCurrency } from "@/lib/tenant";
import { getUserRole } from "@/lib/tenant";
import { moneyFormatter } from "@/lib/currency";
import { createAdminSupabase } from "@/lib/supabase-server";
import StandardQuoteDealCard from "./StandardQuoteDealCard";
import StandardQuoteDatesCard from "./StandardQuoteDatesCard";
import { getStandardQuoteLive } from "@/lib/data/live";
import { c, type PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { ROUTES } from "@/lib/constants";
import type { StandardQuoteStatus } from "@/lib/types";
import StandardQuoteAttachments from "./StandardQuoteAttachments";
import RecordRfqsCard from "@/components/rfq/RecordRfqsCard";
import RfqLineChip from "@/components/rfq/RfqLineChip";
import { rfqPrefill } from "@/components/rfq/prefill";
import { rfqLineStatuses } from "@/lib/rfq/server";
import { selectedLines } from "@/lib/sales/lineTotals";
import { hasClientItemNumbers } from "@/lib/sales/lineItemNumbers";
import { findInvoiceForStandardQuote } from "@/lib/sales/standardQuoteInvoice";
import { pricingOnStandardQuotes } from "../formData";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import ExternalRecordSlot from "@/components/ExternalRecordSlot";
import CreateSalesOrderButton from "@/components/salesOrders/CreateSalesOrderButton";
import { findOrderForSource } from "@/components/salesOrders/serverData";
import QuoteProjectAction, { findQuoteProject } from "@/components/contractProjects/QuoteProjectAction";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActivity from "@/components/page/RecordActivity";
import RelatedList from "@/components/page/RelatedList";
import RecordActionButton, { type RecordAction } from "@/components/page/recordActions";
import ObjectSections from "@/components/fields/ObjectSections";
import SourceEmailSlot from "@/components/inbox/SourceEmailSlot";
import { FIELD_REGISTRY } from "@/lib/fieldRegistry";
import StandardQuoteDocumentTab, { type DocSectionDef } from "./StandardQuoteDocumentTab";
import { madeFromChips } from "@/lib/sales/quoteSource";
import { editableSections } from "@/lib/pdf/framedQuote";
import { quoteBlocks } from "@/lib/pdf/standardQuoteFrame";
import { docColumnsReady } from "../formData";
import { canEditContent, isLockedByIssue, printedRevisionNo, revisionsActive, workingRevisionNo } from "@/lib/revisions/state";
import { listRevisions } from "@/lib/revisions/server";
import RevisionActions from "./RevisionActions";
import RevisionsPanel from "./RevisionsPanel";
import { REVISION_TIPS } from "@/lib/revisions/tips";
import type { ClauseSectionData, ScopeMatrixData } from "@/lib/types";

// The page hand-renders every standard field; only the tenant's own (cf_) fields come from ObjectSections.
const STANDARD_FIELD_KEYS = FIELD_REGISTRY.standard_quote.fields.map((f) => f.key);

const STATUS_TONE: Record<StandardQuoteStatus, PillarKey> = {
  draft: "blue", sent: "amber", accepted: "green", rejected: "red", expired: "red",
};
const STATUS_LABEL: Record<StandardQuoteStatus, string> = {
  draft: "Draft", sent: "Sent", accepted: "Accepted", rejected: "Rejected", expired: "Expired",
};

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function CtxRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, marginTop: 6 }}>
      <span style={{ color: c.hint, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", color: c.muted, wordBreak: "break-word" }}>{value}</span>
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

export default async function StandardQuoteDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireWorkcenterView("standard_quotes");
  await requireFeature("standard_quotes");
  const inr = moneyFormatter(await getTenantCurrency(), { maximumFractionDigits: 0 });
  const { id } = await params;
  const { tab } = await searchParams;
  const data = await getStandardQuoteLive(id);
  if (!data) notFound();
  const { quote, lines, account, contact, template } = data;
  const role = await getUserRole();
  const isAdmin = role === "admin";
  const basePath = ROUTES.standardQuote(quote.id);
  // The deal this quote belongs to (0120), when Pipeline is on.
  const tenant = await getTenant();
  const pipelineOn = tenant?.features?.pipeline === true;
  const deal = pipelineOn && quote.opportunity_id
    ? (await createAdminSupabase().from("opportunities").select("id, ref, title, stage, outcome").eq("id", quote.opportunity_id).eq("tenant_id", quote.tenant_id).maybeSingle()).data as { id: string; ref: string | null; title: string; stage: string; outcome: string } | null
    : null;
  // Which alternative options are chosen (0118: a break family inside an
  // option labels the option and the quantity separately).
  // RFQ (0128): where each line's supplier request stands, for the chip on
  // the line and for prefilling "Request quotation" with this quote's lines.
  const rfqOn = tenant?.features?.rfq === true;
  const rfqStatus = rfqOn
    ? await rfqLineStatuses(createAdminSupabase(), quote.tenant_id, lines.map((l) => (l as { rfq_line_id?: string | null }).rfq_line_id ?? "").filter(Boolean))
    : {};
  // A quote made from a tender bid keeps the client's item numbers; an ordinary quote has none to show (1..n adds nothing).
  const clientNumbers = hasClientItemNumbers(lines);
  const chosenGroupIds = new Set(selectedLines(lines).filter((l) => l.group_type === "alternative" && l.group_id).map((l) => l.group_id as string));

  // Revision history (0252, off unless the workspace turned it on): an issued quote is locked, so "can it be edited" is not only "is it a draft".
  const revActive = revisionsActive(tenant?.config, quote);
  const isDraft = quote.status === "draft";
  const isSent = quote.status === "sent";
  const contentEditable = canEditContent(quote, revActive);
  const locked = isLockedByIssue(quote, revActive);
  const revisions = revActive ? await listRevisions(createAdminSupabase(), quote.tenant_id, quote.id) : [];
  const workingRev = workingRevisionNo(quote);
  const revLabel = (n: number) => `Rev. ${String(n).padStart(2, "0")}`;
  // "Made from" (0251) and the per-quotation sections of a framed layout (the "Document" tab).
  const madeFrom = await madeFromChips(createAdminSupabase(), quote.tenant_id, quote);
  const framed = Boolean(tenant?.config?.pdf_design) && docColumnsReady(quote);
  const docSections: DocSectionDef[] = framed
    ? editableSections(quoteBlocks(template)).map(({ block, kind }) => (kind === "clause"
        ? { id: block.id, kind: "clause" as const, data: block.data as ClauseSectionData }
        : { id: block.id, kind: "matrix" as const, data: block.data as ScopeMatrixData }))
    : [];
  // An accepted quote can be billed once (Invoices on): the invoice it already has, or the button to raise it.
  const invoicesOn = tenant?.features?.invoices === true;
  const isAccepted = quote.status === "accepted";
  const invoice = invoicesOn && isAccepted ? await findInvoiceForStandardQuote(createAdminSupabase(), quote.tenant_id, quote.id) : null;
  // Sales Orders (flag-gated): the order made from this quote, or the button to make it once the quote is accepted.
  const salesOrdersOn = tenant?.features?.sales_orders === true;
  const salesOrder = salesOrdersOn ? await findOrderForSource(createAdminSupabase(), quote.tenant_id, "standard_quote", quote.id) : null;
  const createSalesOrder = salesOrdersOn && isAccepted && !salesOrder ? <CreateSalesOrderButton sourceType="standard_quote" sourceId={quote.id} /> : null;
  // Contract Projects (flag-gated): the project made from this quote, or the button to make it once the quote is accepted.
  const projectsOn = tenant?.features?.contract_projects === true;
  const project = projectsOn ? await findQuoteProject("standard_quote", quote.id) : null;
  const projectAction = projectsOn ? <QuoteProjectAction sourceType="standard_quote" sourceId={quote.id} ready={isAccepted} /> : null;
  const createInvoice: RecordAction = {
    label: "Create invoice", endpoint: `/api/standard-quotes/${quote.id}/convert-to-invoice`, method: "POST",
    redirectTo: ROUTES.invoice("{id}"), errorText: "Failed to create the invoice",
  };
  const base = `/api/standard-quotes/${quote.id}`;
  const emailAction: RecordAction = { label: isDraft ? "Email to customer" : "Resend email", endpoint: `${base}/email`, method: "POST", successText: "Sent to {sentTo}", errorText: "Failed to send email" };
  const accept: RecordAction = { label: "Mark accepted", endpoint: base, body: { status: "accepted" }, errorText: "Failed to update status" };
  const actions: RecordAction[] = [
    { label: "Mark as sent", endpoint: base, body: { status: "sent" }, hidden: !isDraft || (revActive && !locked), errorText: "Failed to update status" },
    { label: "Copy to a new quotation", endpoint: `${base}/copy`, method: "POST", redirectTo: ROUTES.standardQuote("{id}"), successText: "Copied as {ref}", errorText: "Failed to copy the quotation" },
    { ...emailAction, hidden: !isSent },
    { label: "Mark rejected", endpoint: base, body: { status: "rejected" }, danger: true, hidden: !isSent, errorText: "Failed to update status" },
  ];

  return (
    <ObjectRecordPage
      backHref={ROUTES.standardQuotes}
      backLabel="All standard quotes"
      title={quote.ref}
      meta={`Standard Quote${account?.name ? ` · ${account.name}` : ""}${revActive ? ` · ${locked ? `${revLabel(printedRevisionNo(quote))} issued` : `${revLabel(workingRev)} in preparation`}` : ""}`}
      status={<StatusPill label={STATUS_LABEL[quote.status]} tone={STATUS_TONE[quote.status]} />}
      primaryAction={(() => {
        // With revisions on, a working copy is issued before it is sent: Issue replaces the send step until then.
        if (revActive && !locked) return <RevisionActions quoteId={quote.id} mode="issue" workingRevision={workingRev} pendingReason={quote.pending_revision_reason ?? null} />;
        const main = isDraft ? <RecordActionButton action={emailAction} /> : isSent ? <RecordActionButton action={accept} /> : invoicesOn && isAccepted && !invoice ? <RecordActionButton action={createInvoice} /> : undefined;
        const extras = createSalesOrder || projectAction ? <>{createSalesOrder}{projectAction}</> : null;
        return main && extras ? <>{main}{extras}</> : main ?? extras ?? undefined;
      })()}
      menu={
        <RecordMoreMenu
          editHref={contentEditable ? ROUTES.standardQuoteEdit(quote.id) : undefined}
          printHref={`${base}/pdf`}
          actions={actions}
          remove={isDraft ? { endpoint: base, recordName: quote.ref, entityLabel: "draft quote", afterHref: ROUTES.standardQuotes } : undefined}
        />
      }
      facts={[
        { label: "Account", value: account ? <Link href={ROUTES.account(account.id)} style={{ color: c.accent, textDecoration: "none" }}>{account.name}</Link> : "—" },
        { label: "Total", value: inr(quote.total) },
        { label: "Valid until", value: fmtDate(quote.valid_until) },
        ...(salesOrder ? [{ label: "Sales order", value: <Link href={ROUTES.salesOrder(salesOrder.id)} style={{ color: c.accent, textDecoration: "none" }}>{salesOrder.ref}</Link> }] : []),
        ...(project ? [{ label: "Project", value: <Link href={ROUTES.contractProject(project.id)} style={{ color: c.accent, textDecoration: "none" }}>{project.ref ?? "Open"}</Link> }] : []),
        ...(contact ? [{ label: "Contact", value: contact.name }] : []),
        ...(invoice ? [{ label: "Invoice", value: <Link href={ROUTES.invoice(invoice.id)} style={{ color: c.accent, textDecoration: "none" }}>{invoice.ref}</Link> }] : []),
      ]}
      externalLine={<ExternalRecordSlot objectType="standard_quotes" objectId={quote.id} />}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <>
            {madeFrom.length > 1 && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 10 }} data-guide="sq-made-from" aria-label="Made from">
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: c.hint }}>Made from</span>
                {madeFrom.map((chip, i) => (
                  <span key={chip.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {i > 0 && <span aria-hidden="true" style={{ color: c.hint }}>›</span>}
                    {chip.href
                      ? <Link href={chip.href} style={{ color: c.accent, textDecoration: "none", fontSize: 12.5, minHeight: 44, display: "inline-flex", alignItems: "center" }}>{chip.label}: {chip.text}</Link>
                      : <span style={{ fontSize: 12.5, color: c.muted }}>{chip.label}: {chip.text}</span>}
                  </span>
                ))}
              </div>
            )}
            <Card title="Quote details">
              {framed && quote.project_title && <CtxRow label="Project title" value={quote.project_title} />}
              {framed && quote.subject && <CtxRow label="Subject" value={quote.subject} />}
              <CtxRow label="Account" value={account ? <Link href={ROUTES.account(account.id)} style={{ color: c.accent, textDecoration: "none" }}>{account.name}</Link> : "—"} />
              <CtxRow label="Contact" value={contact?.name ?? "—"} />
              <CtxRow label="Total" value={inr(quote.total)} />
              <CtxRow label="Valid until" value={fmtDate(quote.valid_until)} />
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
            </Card>
            <ObjectSections objectType="standard_quote" record={quote as unknown as Record<string, unknown>} patchUrl={`/api/standard-quotes/${quote.id}`} exclude={STANDARD_FIELD_KEYS} />
            </>
          ),
        },
        {
          id: "lines",
          label: "Lines",
          count: lines.length,
          content: (
            <RelatedList
              title="Line items"
              summary={pricingOnStandardQuotes(tenant) && isDraft ? (
                <span style={{ fontSize: 11.5 }}>
                  Engine pricing, the price trace and supplier RFQs are on the edit screen —{" "}
                  <Link href={ROUTES.standardQuoteEdit(quote.id)} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>click Edit to price the lines</Link>.
                </span>
              ) : undefined}
              emptyText="No line items."
              rows={lines}
              rowKey={(l) => l.id}
              columns={[
                ...(clientNumbers ? [{ label: "Item", cellStyle: { color: c.muted, fontSize: 12.5, whiteSpace: "nowrap" as const }, render: (l: (typeof lines)[number]) => l.sl_no ?? "" }] : []),
                {
                  label: "Description",
                  render: (l) => {
                    // Not selected: either an alternative option the customer
                    // wasn't offered, or a quantity break that isn't the
                    // chosen quantity (0116, §3.3/§3.4) -- either way the row
                    // still prints, greyed out, so nothing looks silently
                    // dropped, but it does not count toward the total.
                    const notSelected = l.is_selected === false;
                    const isBreak = !!l.break_of;
                    const hiddenOnPdf = l.show_on_pdf === false;
                    // A break family inside an option (0118): the option's own
                    // "not chosen" is about the GROUP, the quantity's about the
                    // row -- never both on one row for the same reason.
                    const groupNotChosen = l.group_type === "alternative" && !!l.group_id && !chosenGroupIds.has(l.group_id);
                    // A break is an offer (2026-09-06): ticked = printed, never
                    // charged; the base line always is.
                    const dim = isBreak ? (notSelected || groupNotChosen) : groupNotChosen;
                    const rl = (l as { rfq_line_id?: string | null }).rfq_line_id;
                    const st = rl ? rfqStatus[rl] : undefined;
                    return (
                      <div style={{ opacity: dim ? 0.55 : 1 }}>
                        {hiddenOnPdf && (
                          <span title="The rep hid this line from the PDF; it still counts if it is selected" style={{ display: "inline-block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: c.hint, marginRight: 6, border: `1px solid ${c.line}`, borderRadius: 4, padding: "0 4px" }}>
                            not on PDF
                          </span>
                        )}
                        {l.group_type === "alternative" && (
                          <span style={{ display: "inline-block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: groupNotChosen ? c.hint : c.accent, marginRight: 6 }}>
                            {l.group_label || "Option"}{groupNotChosen ? " · not chosen" : ""}
                          </span>
                        )}
                        {isBreak && (
                          <span style={{ display: "inline-block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: notSelected ? c.hint : c.accent, marginRight: 6 }}>
                            Qty {l.qty} · {notSelected ? "not offered" : "offered"}
                          </span>
                        )}
                        {l.description}
                        {st ? <div><RfqLineChip s={st} /></div> : null}
                        {(l.pricing_flags ?? []).map((f, i) => (
                          <div key={i} style={{ fontSize: 11, fontWeight: 600, marginTop: 2, color: f.policy === "block" ? "var(--err-ink)" : "var(--amberink)" }}>
                            {f.code === "MARGIN_FLOOR" ? `Margin ${f.actual_pct}% is below the ${f.floor_pct}% floor` : f.code}
                            {f.policy === "block" ? " — can't be sent until re-priced or approved" : ""}
                          </div>
                        ))}
                      </div>
                    );
                  },
                },
                { label: "UOM", align: "center", cellStyle: { color: c.muted, fontSize: 12.5 }, render: (l) => l.uom ?? "" },
                { label: "Qty", align: "right", render: (l) => l.qty },
                { label: "Rate", align: "right", cellStyle: { color: c.muted }, render: (l) => inr(l.rate) },
                { label: "Disc %", align: "right", cellStyle: { color: c.muted }, render: (l) => (l.discount_pct > 0 ? `${l.discount_pct}%` : "—") },
                { label: "Amount", align: "right", cellStyle: { fontWeight: 500 }, render: (l) => inr(l.amount) },
              ]}
              footer={<div style={{ fontSize: 14, fontWeight: 700 }}>Total: {inr(quote.total)}</div>}
            />
          ),
        },
        ...(docSections.length > 0 ? [{
          id: "document",
          label: "Document",
          content: <StandardQuoteDocumentTab quoteId={quote.id} sections={docSections} initial={quote.doc_sections ?? {}} canEdit={contentEditable} />,
        }] : []),
        ...(revActive ? [{
          id: "revisions",
          label: "Revisions",
          count: revisions.length,
          content: (
            <>
              <RevisionsPanel quoteId={quote.id} rows={revisions} money={inr} workingRevision={workingRev} inPreparation={!locked} />
              {locked && quote.status !== "accepted" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                  <RevisionActions quoteId={quote.id} mode="revise" workingRevision={workingRev + 1} pendingReason={null} />
                  <span className="bpm-label-row"><InfoTip label="Revise">{REVISION_TIPS.copy}</InfoTip></span>
                </div>
              )}
            </>
          ),
        }] : []),
        {
          id: "related",
          label: "Related",
          content: (
            <>
              {rfqOn && (
                <RecordRfqsCard
                  origin={{ type: "standard_quote", id }}
                  originLabel={`Quote ${quote.ref}${account?.name ? ` for ${account.name}` : ""}`}
                  title={account?.name ? `Prices for ${quote.ref} (${account.name})` : `Prices for ${quote.ref}`}
                  lines={rfqPrefill(lines as Parameters<typeof rfqPrefill>[0], (rl) => rfqStatus[rl]?.ref ?? null)}
                  compactTop
                />
              )}
              <Card padding={16}>
                <StandardQuoteAttachments quoteId={quote.id} canCreateLines={isDraft} />
              </Card>
            </>
          ),
        },
        { id: "activity", label: "Activity", content: <RecordActivity objectType="standard_quotes" objectId={quote.id} isAdmin={isAdmin} /> },
      ]}
      rail={
        <>
          <StandardQuoteDatesCard quote={quote} />
          {pipelineOn && <StandardQuoteDealCard quoteId={quote.id} accountId={quote.account_id} deal={deal} />}
          <SourceEmailSlot objectType="standard_quotes" objectId={quote.id} />
        </>
      }
    />
  );
}
