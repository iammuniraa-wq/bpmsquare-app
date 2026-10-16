import Link from "next/link";
import { notFound } from "next/navigation";
import { getCase, CASE_STATUS_LABEL, CASE_TYPE_LABEL } from "@/lib/data";
import { getUserRole, getTenant } from "@/lib/tenant";
import { moneyFormatter, formatMoney, resolveCurrency } from "@/lib/currency";
import type { ServiceCase, CasePhoto, InspectionReport } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import type { PillarKey } from "@/lib/theme";
import StatusPill from "@/components/ui/StatusPill";
import Card, { CARD_SURFACE } from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import QuoteStatusPill from "@/components/QuoteStatusPill";
import ComingSoon from "@/components/ComingSoon";
import { ROUTES, DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import ObjectSections from "@/components/fields/ObjectSections";
import CaseActions from "@/components/CaseActions";
import CaseAssetsPanel from "./CaseAssetsPanel";
import { sanitizePhoneForWhatsApp, buildWhatsAppLink, buildCaseWhatsAppMessage } from "@/lib/whatsapp";
import RecordRfqsCard from "@/components/rfq/RecordRfqsCard";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordMoreMenu from "@/components/page/RecordMoreMenu";
import RecordActivity from "@/components/page/RecordActivity";
import RelatedList from "@/components/page/RelatedList";
import type { MenuItem } from "@/components/ui/menuItems";

// ── Stage groups ──────────────────────────────────────────────────────────────

const STAGE_GROUPS: { label: string; statuses: ServiceCase["status"][] }[] = [
  { label: "Intake",     statuses: ["intake"] },
  { label: "Inspection", statuses: ["inspection"] },
  { label: "Report",     statuses: ["report_sent", "report_approved"] },
  { label: "Quote",      statuses: ["quote_sent", "quote_approved"] },
  { label: "Repair",     statuses: ["in_repair", "qa"] },
  { label: "Close",      statuses: ["ready", "closed"] },
];

const EXIT_STATUSES: ServiceCase["status"][] = ["buyback", "scrapped"];

function stageIndex(status: ServiceCase["status"]): number {
  for (let i = 0; i < STAGE_GROUPS.length; i++) {
    if (STAGE_GROUPS[i].statuses.includes(status)) return i;
  }
  return -1;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const fmtDateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }) : "—";

const statusTone: Record<ServiceCase["status"], PillarKey> = {
  intake: "blue", inspection: "blue",
  report_sent: "purple", report_approved: "purple",
  quote_sent: "amber", quote_approved: "amber",
  in_repair: "teal", qa: "teal",
  ready: "green", closed: "green",
  buyback: "purple", scrapped: "red",
};

const typeTone: Record<ServiceCase["type"], PillarKey> = {
  amc: "teal", adhoc: "amber", direct: "blue",
};

const irStatusTone: Record<InspectionReport["status"], PillarKey> = {
  draft: "blue", sent: "purple", approved: "teal", rejected: "red",
};

const irStatusLabel: Record<InspectionReport["status"], string> = {
  draft: "Draft", sent: "Sent to customer", approved: "Customer approved", rejected: "Customer rejected",
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function CaseDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const [data, role, tenant] = await Promise.all([getCase(id), getUserRole(), getTenant()]);
  if (!data) notFound();
  const cur = resolveCurrency(tenant?.config);
  const inr = moneyFormatter(cur, { maximumFractionDigits: 0 });
  const isAdmin = role === "admin";

  const { serviceCase: sc, account, contact, assets, technician, contract, quote, photos, inspectionReport, loanerAsset, subCases } = data;
  const quoteStatuses: QuoteStatusDef[] =
    (tenant?.config as { quote_statuses?: QuoteStatusDef[] })?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;

  const waPhone = sanitizePhoneForWhatsApp(contact?.phone || account?.phone || account?.phone2);
  const waLink = waPhone
    ? buildWhatsAppLink(waPhone, buildCaseWhatsAppMessage({
        customer_name: contact?.name ?? "Sir/Madam",
        company_name: tenant?.company_info?.name ?? tenant?.name ?? "our team",
        case_ref: sc.ref,
      }))
    : null;

  const currentGroupIdx = stageIndex(sc.status);
  const isExit = EXIT_STATUSES.includes(sc.status);
  const basePath = ROUTES.case(sc.id);

  const photosByStage = {
    intake:     photos.filter((p) => p.stage === "intake"),
    inspection: photos.filter((p) => p.stage === "inspection"),
    final:      photos.filter((p) => p.stage === "final"),
  };
  const showIntakePhotos = photosByStage.intake.length > 0 && sc.status !== "intake" && sc.status !== "inspection";
  const showInspectionPhotos = photosByStage.inspection.length > 0 && sc.status !== "inspection";
  const showFinalPhotos = photosByStage.final.length > 0;
  const photoCount =
    (showIntakePhotos ? photosByStage.intake.length : 0) +
    (showInspectionPhotos ? photosByStage.inspection.length : 0) +
    (showFinalPhotos ? photosByStage.final.length : 0);
  const showReport = !!inspectionReport && sc.status !== "inspection";

  const extraItems: MenuItem[] = [
    ...(quote ? [{ label: "Quotation PDF", href: ROUTES.quotationPrint(quote.id), newTab: true }] : []),
    ...(waLink ? [{ label: "WhatsApp the customer", href: waLink, newTab: true }] : []),
  ];

  const stepper = !isExit ? (
    <div style={{ ...CARD_SURFACE, padding: "14px 18px", overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", minWidth: "fit-content" }}>
        {STAGE_GROUPS.map((group, gi) => {
          const isDone    = currentGroupIdx > gi;
          const isCurrent = currentGroupIdx === gi;
          const lineColor = currentGroupIdx > gi ? pillar.green.base : c.line;

          return (
            <div key={group.label} style={{ display: "flex", alignItems: "flex-start", flexShrink: 0 }}>
              {gi > 0 && (
                <div style={{ width: 40, height: 2, background: lineColor, flexShrink: 0, marginTop: 14 }} />
              )}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 68 }}>
                {/* Step circle */}
                <div style={{
                  width: isDone ? 28 : isCurrent ? 32 : 28,
                  height: isDone ? 28 : isCurrent ? 32 : 28,
                  borderRadius: "50%",
                  background: isDone ? pillar.green.base : isCurrent ? c.accent : c.panel2,
                  border: `2px solid ${isDone ? pillar.green.base : isCurrent ? c.accent : c.line}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                  boxShadow: isCurrent ? `0 0 0 4px ${c.accentbg}` : "none",
                  transition: "all 0.15s",
                }}>
                  {isDone ? (
                    <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>✓</span>
                  ) : (
                    <span style={{ color: isCurrent ? "#fff" : c.hint, fontSize: 11.5, fontWeight: 700 }}>{gi + 1}</span>
                  )}
                </div>
                {/* Label */}
                <div style={{
                  fontSize: 11, fontWeight: isCurrent ? 700 : 500, textAlign: "center", whiteSpace: "nowrap",
                  color: isDone ? pillar.green.base : isCurrent ? c.accent : c.hint,
                }}>
                  {group.label}
                </div>
                {/* Sub-status label (only on current) */}
                {isCurrent && (
                  <div style={{
                    fontSize: 9.5, color: c.accent, background: c.accentbg, borderRadius: 4,
                    padding: "1px 6px", fontWeight: 600, whiteSpace: "nowrap",
                  }}>
                    {CASE_STATUS_LABEL[sc.status]}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : (
    <div style={{ ...CARD_SURFACE, padding: "13px 16px", background: sc.status === "scrapped" ? "var(--redbg)" : "var(--purplebg)", borderLeft: `3px solid ${sc.status === "scrapped" ? "var(--red)" : "var(--purple)"}` }}>
      <span style={{ fontWeight: 600, fontSize: 13.5, color: sc.status === "scrapped" ? "var(--redink)" : "var(--purple)" }}>
        {sc.status === "scrapped" ? "Unit scrapped" : `Buyback — unit purchased by ${tenant?.company_info?.name ?? tenant?.name ?? "us"}`}
      </span>
      {sc.closed_at && (
        <span style={{ marginLeft: 10, fontSize: 12, color: c.muted }}>{fmtDate(sc.closed_at)}</span>
      )}
    </div>
  );

  const overview = (
    <>
      {/* The stage stepper and the current stage's action card stay at the top of Overview. */}
      {stepper}
      <CaseActions
        caseId={sc.id}
        caseRef={sc.ref}
        currentStatus={sc.status}
        notes={sc.notes ?? null}
        assignedTo={sc.assigned_to ?? null}
        inspectionReport={inspectionReport ? {
          id: inspectionReport.id,
          findings: inspectionReport.findings,
          recommendations: inspectionReport.recommendations,
          estimated_cost: inspectionReport.estimated_cost ?? null,
          status: inspectionReport.status,
        } : null}
        accountId={sc.account_id}
        assetIds={sc.asset_ids ?? []}
        intakePhotos={photosByStage.intake}
        inspectionPhotos={photosByStage.inspection}
        intakeNotes={sc.notes ?? null}
      />
      <ObjectSections
        objectType="case"
        record={sc as unknown as Record<string, unknown>}
        patchUrl={`/api/cases/${sc.id}`}
        exclude={["ref", "type", "equipment_label"]}
      />
    </>
  );

  const related = (
    <>
      {quote && (
        <Card
          title="Quotation"
          action={<QuoteStatusPill status={quote.status} statuses={quoteStatuses} />}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600, fontFamily: "monospace", color: c.accent, fontSize: 14 }}>{quote.ref}</div>
              <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>Rev. {quote.revision} · Valid until {quote.valid_until ? fmtDate(quote.valid_until) : "—"}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: c.ink }}>{formatMoney(quote.total, cur, {})}</div>
              <div style={{ marginTop: 6, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button href={ROUTES.quotation(quote.id)} variant="secondary" size="sm">View →</Button>
                <Button href={ROUTES.quotationPrint(quote.id)} target="_blank" variant="quiet" size="sm">PDF ↗</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {subCases.length > 0 && (
        <RelatedList
          title={`Sub-cases (${subCases.length})`}
          emptyText=""
          rows={subCases}
          rowKey={(sub) => sub.id}
          rowHref={(sub) => ROUTES.case(sub.id)}
          columns={[
            { label: "Ref", render: (sub) => <span style={{ fontFamily: "monospace", fontWeight: 600, color: c.ink }}>{sub.ref}</span> },
            { label: "Stage", render: (sub) => <StatusPill label={CASE_STATUS_LABEL[sub.status]} tone={statusTone[sub.status]} /> },
            { label: "Complaint", cellStyle: { color: c.muted, fontSize: 12.5 }, render: (sub) => (sub.complaint.length > 100 ? sub.complaint.slice(0, 100) + "…" : sub.complaint) },
          ]}
        />
      )}

      {/* Pre-filled from what the record knows; the buyer edits the item
          wording before sending -- a complaint is not a part number. */}
      <RecordRfqsCard origin={{ type: "case", id }} originLabel={`Case ${sc.ref}`} title={`Parts for ${sc.equipment_label}`} compactTop
        lines={[{ description: `Parts / repair for ${sc.equipment_label}`, spec: sc.complaint ? sc.complaint.slice(0, 300) : null, qty: 1, uom: "Nos" }]} />
      {inspectionReport && <RecordRfqsCard origin={{ type: "inspection_report", id: inspectionReport.id }} originLabel={`Inspection · ${sc.ref}`} heading="Supplier quotations for the inspection findings" title={`Repair parts — ${sc.equipment_label}`} compactTop
        lines={(inspectionReport.recommendations ?? "").split(/\r?\n|;/).map((t: string) => t.replace(/^[\s\-*•\d.)]+/, "").trim()).filter(Boolean).slice(0, 20).map((t: string) => ({ description: t.slice(0, 300), qty: 1, uom: "Nos" }))} />}
    </>
  );

  return (
    <ObjectRecordPage
      backHref={ROUTES.cases}
      backLabel="All cases"
      title={sc.ref}
      tabTitle={sc.ref}
      meta={`${account?.name ?? "—"}${sc.equipment_label ? ` · ${sc.equipment_label}` : ""}`}
      status={
        <>
          <StatusPill label={CASE_STATUS_LABEL[sc.status]} tone={statusTone[sc.status]} />
          <StatusPill label={CASE_TYPE_LABEL[sc.type]} tone={typeTone[sc.type]} />
          {sc.has_loaner && <StatusPill label="Loaner out" tone="amber" />}
          {sc.parent_case_id && (
            <Link href={ROUTES.case(sc.parent_case_id)} style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", background: c.accentbg, borderRadius: 5, padding: "2px 7px" }}>
              Sub-case →
            </Link>
          )}
        </>
      }
      primaryAction={quote ? <Button href={ROUTES.quotation(quote.id)} variant="primary">View quotation</Button> : undefined}
      menu={
        <RecordMoreMenu
          inlineEdit={{ overviewHref: basePath }}
          extraItems={extraItems}
          adapt={{ objectType: "case", objectLabel: "Case", isAdmin }}
        />
      }
      facts={[
        { label: "Customer", value: <Link href={ROUTES.account(sc.account_id)} style={{ color: c.accent, textDecoration: "none" }}>{account?.name ?? "—"}</Link> },
        { label: "Technician", value: technician?.name ?? "Not assigned" },
        { label: "Intake", value: fmtDate(sc.intake_at) },
        ...(sc.closed_at ? [{ label: "Closed", value: fmtDate(sc.closed_at) }] : []),
      ]}
      basePath={basePath}
      activeTab={tab}
      tabs={[
        { id: "overview", label: "Overview", content: overview },
        ...(showReport && inspectionReport ? [{
          id: "inspection",
          label: "Inspection",
          content: (
            <Card title="Inspection report" action={<StatusPill label={irStatusLabel[inspectionReport.status]} tone={irStatusTone[inspectionReport.status]} />}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: c.accent, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5 }}>Findings</div>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: c.ink }}>{inspectionReport.findings}</p>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: c.accent, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5 }}>Recommendations</div>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: c.ink }}>{inspectionReport.recommendations}</p>
              </div>
              {(inspectionReport.estimated_cost != null || inspectionReport.sent_at || inspectionReport.approved_at) && (
                <div style={{ display: "flex", gap: 20, paddingTop: 10, borderTop: `1px solid ${c.line}`, flexWrap: "wrap" }}>
                  {inspectionReport.estimated_cost != null && <MiniDetail label="Estimated cost" value={inr(inspectionReport.estimated_cost)} />}
                  {inspectionReport.sent_at     && <MiniDetail label="Sent"     value={fmtDateTime(inspectionReport.sent_at)} />}
                  {inspectionReport.approved_at && <MiniDetail label="Approved" value={fmtDateTime(inspectionReport.approved_at)} />}
                </div>
              )}
            </Card>
          ),
        }] : []),
        ...(photoCount > 0 ? [{
          id: "photos",
          label: "Photos",
          count: photoCount,
          content: (
            <>
              {showIntakePhotos && <PhotoSection title="Intake photos" photos={photosByStage.intake} />}
              {showInspectionPhotos && <PhotoSection title="Inspection photos" photos={photosByStage.inspection} />}
              {showFinalPhotos && <PhotoSection title="Final / delivery photos" photos={photosByStage.final} />}
            </>
          ),
        }] : []),
        { id: "related", label: "Related", count: subCases.length || undefined, content: related },
        { id: "activity", label: "Activity", content: <RecordActivity objectType="cases" objectId={sc.id} isAdmin={isAdmin} /> },
      ]}
      rail={
        <>
          <Card padding={14}>
            {/* Account */}
            <CtxLabel>Customer</CtxLabel>
            <Link href={ROUTES.account(sc.account_id)} style={{ fontSize: 13.5, fontWeight: 600, color: c.accent, display: "block", textDecoration: "none", marginBottom: 4 }}>
              {account?.name ?? "—"}
            </Link>
            {account?.city  && <CtxRow label="City"  value={account.city} />}
            {account?.phone && <CtxRow label="Phone" value={account.phone} />}

            {/* Contact */}
            {(contact?.name || contact?.phone) && (
              <>
                <div style={{ borderTop: `1px solid ${c.line}`, margin: "10px 0" }} />
                <CtxLabel>Contact</CtxLabel>
                {contact.name  && <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 2 }}>{contact.name}{contact.role ? <span style={{ fontWeight: 400, color: c.hint }}> · {contact.role}</span> : ""}</div>}
                {contact.phone && <CtxRow label="Phone" value={contact.phone} />}
              </>
            )}

            {/* Complaint */}
            <div style={{ borderTop: `1px solid ${c.line}`, margin: "10px 0" }} />
            <CtxLabel>Complaint</CtxLabel>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: c.ink }}>{sc.complaint}</p>

            {/* Technician */}
            <div style={{ borderTop: `1px solid ${c.line}`, margin: "10px 0" }} />
            <CtxLabel>Technician</CtxLabel>
            <div style={{ fontSize: 12.5, color: technician ? c.ink : c.hint, fontWeight: technician ? 600 : 400 }}>
              {technician?.name ?? "Not assigned"}
            </div>

            {/* Timeline */}
            <div style={{ borderTop: `1px solid ${c.line}`, margin: "10px 0" }} />
            <CtxLabel>Timeline</CtxLabel>
            <CtxRow label="Intake"  value={fmtDate(sc.intake_at)} />
            {sc.closed_at && <CtxRow label="Closed" value={fmtDate(sc.closed_at)} />}

            {/* Contract */}
            {contract && (
              <>
                <div style={{ borderTop: `1px solid ${c.line}`, margin: "10px 0" }} />
                <CtxLabel>AMC contract</CtxLabel>
                <div style={{ fontSize: 12.5, fontFamily: "monospace", fontWeight: 600, color: c.accent }}>{contract.ref}</div>
              </>
            )}

            {/* Loaner */}
            {loanerAsset && (
              <>
                <div style={{ borderTop: `1px solid ${c.line}`, margin: "10px 0" }} />
                <CtxLabel>Loaner dispatched</CtxLabel>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--amberink)" }}>{loanerAsset.name}</div>
                <div style={{ fontSize: 11, color: "var(--amberink)", marginTop: 2 }}>Return on delivery</div>
              </>
            )}

            {/* Assets */}
            {assets.length > 0 && (
              <>
                <div style={{ borderTop: `1px solid ${c.line}`, margin: "10px 0" }} />
                <CtxLabel>{assets.length > 1 ? `Assets (${assets.length})` : "Asset"}</CtxLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {assets.map((a) => (
                    <div key={a.id}>
                      <Link href={ROUTES.asset(a.id)} style={{ fontSize: 12.5, fontWeight: 600, color: c.accent, textDecoration: "none" }}>
                        {a.name} →
                      </Link>
                      <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>
                        {[[a.make, a.model].filter(Boolean).join(" "), a.rating, a.serial].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          <CaseAssetsPanel caseId={sc.id} accountId={sc.account_id} assets={assets} />

          {!waLink && (
            <div style={{ fontSize: 11.5, color: c.hint }} title="No phone number on file for this contact/account">
              WhatsApp unavailable: no phone number on file.
            </div>
          )}
          <div style={{ fontSize: 12, color: c.hint, display: "flex", alignItems: "center", gap: 6 }}>
            WhatsApp (embedded) <ComingSoon size="xs" />
          </div>
        </>
      }
    />
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CtxLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>
      {children}
    </div>
  );
}

function CtxRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, marginTop: 3 }}>
      <span style={{ color: c.hint, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", color: c.muted, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

function MiniDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 500, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function PhotoSection({ title, photos }: { title: string; photos: CasePhoto[] }) {
  return (
    <Card title={title}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
        {photos.map((photo) => (
          <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer"
            style={{ borderRadius: 6, overflow: "hidden", border: `1px solid ${c.line}`, display: "block", textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={photo.caption || title}
              style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }} />
            {photo.caption && (
              <div style={{ padding: "5px 8px", fontSize: 11, color: c.muted, lineHeight: 1.4 }}>{photo.caption}</div>
            )}
          </a>
        ))}
      </div>
    </Card>
  );
}
