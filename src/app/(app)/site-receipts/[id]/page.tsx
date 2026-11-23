import { notFound } from "next/navigation";
import { requireSitePage } from "@/lib/site/pageGuard";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import StatusPill from "@/components/ui/StatusPill";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordActivity from "@/components/page/RecordActivity";
import ObjectSections from "@/components/fields/ObjectSections";
import { anyProject, loadActorNames, loadFiles, openSiteRequest } from "@/lib/site/server";
import { isDeciderOn, loadViewerScope } from "@/lib/site/expensesServer";
import { loadReceipt } from "@/lib/site/receiptsServer";
import { discrepancyLines, summarise } from "@/lib/site/receiptRules";
import { ERP_STATE_LABEL, RECEIPT_OUTCOME_LABEL, RECEIPT_STATUS_LABEL, type ReceiptOutcome } from "@/lib/site/types";
import EvidenceGrid from "@/components/site/EvidenceGrid";
import ReceiptLineBars from "@/components/site/ReceiptLineBars";
import ReceiptCancelButton from "@/components/site/ReceiptCancelButton";
import { Banner } from "@/components/site/siteUi";

const tone = (o: ReceiptOutcome) => (o === "complete" ? "green" : o === "partial" ? "amber" : "red") as "green" | "amber" | "red";

/** A site receipt: a bar per item (expected, accepted, rejected), the shortfall in words, the evidence and the history. Immutable once confirmed. */
export default async function SiteReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireSitePage("site_receipts");
  const gate = await openSiteRequest("site_receipts");
  if (!gate.ok) notFound();
  const req = gate.req;
  const { id } = await params;
  const { tab } = await searchParams;
  const found = await loadReceipt(req.admin, req.tenantId, id);
  if (found === "pending") return <div role="alert" style={{ fontSize: 13, color: "var(--amberink)" }}>Site receipts need a database update (migration 0259). Ask your administrator to apply it.</div>;
  if (!found) notFound();
  const { receipt: r, lines } = found;
  const [project, files, names, scope] = await Promise.all([
    anyProject(req.admin, req.tenantId, r.project_id), loadFiles(req.admin, req.tenantId, "site_receipt", id), loadActorNames(req.admin, req.tenantId, [r.received_by, r.cancelled_by]), loadViewerScope(req),
  ]);
  if (!project) notFound();
  const canCancel = r.status === "confirmed" && isDeciderOn(scope, r.project_id);
  const sum = summarise(lines.map((l) => ({ ...l, line_key: l.line_key, element_code: l.element_code, building: l.building, uom: l.uom, reason_code: l.reason_code, note: l.note })));
  const problems = discrepancyLines(lines.map((l) => ({ ...l })));

  const items = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {r.status === "cancelled" && <Banner tone="info">Cancelled{r.cancelled_by ? ` by ${names.get(r.cancelled_by) ?? "a manager"}` : ""}: {r.cancel_reason}</Banner>}
      {problems.length > 0 && <Banner tone="warn">{problems.slice(0, 6).join(" · ")}{problems.length > 6 ? ` · and ${problems.length - 6} more` : ""}</Banner>}
      <ReceiptLineBars lines={lines} />
      <ObjectSections objectType="site_receipt" record={{ ...r, project_name: `${project.ref ? `${project.ref} ` : ""}${project.name}`, received_by_name: names.get(r.received_by) ?? "" } as unknown as Record<string, unknown>} patchUrl={`/api/site-receipts/${id}`} />
    </div>
  );

  return (
    <ObjectRecordPage
      backHref={ROUTES.siteReceipts}
      backLabel="All site receipts"
      title={r.delivery_note_ref ?? "Delivery"}
      reference={r.ref}
      meta={`${project.ref ? `${project.ref} · ` : ""}${project.name}`}
      status={r.status === "cancelled" ? <StatusPill label={RECEIPT_STATUS_LABEL.cancelled} tone="blue" /> : <StatusPill label={RECEIPT_OUTCOME_LABEL[r.outcome]} tone={tone(r.outcome)} />}
      primaryAction={canCancel ? <ReceiptCancelButton id={id} /> : undefined}
      facts={[
        { label: "Received", value: new Date(r.received_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
        { label: "Received by", value: names.get(r.received_by) ?? "—" },
        { label: "Accepted", value: `${sum.accepted} of ${lines.length} item${lines.length === 1 ? "" : "s"}` },
        { label: "Driver", value: [r.handed_by, r.vehicle].filter(Boolean).join(" · ") || "—" },
      ]}
      externalLine={<span style={{ fontSize: 12, color: c.hint }}>ERP: {ERP_STATE_LABEL[r.erp_state]}{r.erp_ref ? ` (${r.erp_ref})` : ""}</span>}
      basePath={ROUTES.siteReceipt(id)}
      activeTab={tab}
      tabs={[
        { id: "items", label: "Items", count: lines.length, content: items },
        { id: "evidence", label: "Evidence", count: files.length, content: <EvidenceGrid files={files} empty="No photo or signature was added." /> },
        { id: "activity", label: "Activity", content: <RecordActivity objectType="site_receipts" objectId={id} isAdmin={req.role === "admin"} /> },
      ]}
    />
  );
}
