import Link from "next/link";
import { notFound } from "next/navigation";
import { getCase, CASE_STATUS_LABEL, CASE_TYPE_LABEL, QUOTE_STATUS_LABEL } from "@/lib/data";
import type { ServiceCase, CasePhoto, InspectionReport } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import type { PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import ComingSoon from "@/components/ComingSoon";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import CustomFieldsSection from "@/components/CustomFieldsSection";
import CaseActions from "@/components/CaseActions";
import CaseCoreEditPanel from "./CaseCoreEditPanel";
import { MessageSquare } from "@/components/Icons";

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

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

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

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getCase(id);
  if (!data) notFound();

  const { serviceCase: sc, account, contact, asset, technician, contract, quote, photos, inspectionReport, loanerAsset, subCases } = data;

  const currentGroupIdx = stageIndex(sc.status);
  const isExit = EXIT_STATUSES.includes(sc.status);

  const photosByStage = {
    intake:     photos.filter((p) => p.stage === "intake"),
    inspection: photos.filter((p) => p.stage === "inspection"),
    final:      photos.filter((p) => p.stage === "final"),
  };

  return (
    <>
      <TabTitle title={sc.ref} />

      {/* Compact header */}
      <div style={{ marginBottom: 18 }}>
        <Link href={ROUTES.cases} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none", display: "inline-block", marginBottom: 8 }}>
          ← All cases
        </Link>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: c.ink, fontFamily: "monospace", lineHeight: 1 }}>{sc.ref}</h1>
              <Pill label={CASE_STATUS_LABEL[sc.status]} tone={statusTone[sc.status]} />
              <Pill label={CASE_TYPE_LABEL[sc.type]} tone={typeTone[sc.type]} />
              {sc.has_loaner && <Pill label="Loaner out" tone="amber" />}
              {sc.parent_case_id && (
                <Link href={ROUTES.case(sc.parent_case_id)} style={{ fontSize: 11.5, color: c.accent, textDecoration: "none", background: c.accentbg, borderRadius: 5, padding: "2px 7px" }}>
                  Sub-case →
                </Link>
              )}
            </div>
            <div style={{ fontSize: 13.5, color: c.muted, fontWeight: 500 }}>
              {account?.name ?? "—"}{sc.equipment_label ? <span style={{ color: c.hint }}> · {sc.equipment_label}</span> : ""}
            </div>
          </div>
        </div>
      </div>

      {/* Stage stepper */}
      {!isExit ? (
        <div style={{ ...cardStyle, marginBottom: 16, padding: "14px 18px", overflowX: "auto" }}>
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
        <div style={{ ...cardStyle, marginBottom: 16, padding: "13px 16px", background: sc.status === "scrapped" ? "#fcebeb" : "#eeedfe", borderLeft: `3px solid ${sc.status === "scrapped" ? "#a32d2d" : "#7f77dd"}` }}>
          <span style={{ fontWeight: 600, fontSize: 13.5, color: sc.status === "scrapped" ? "#791f1f" : "#26215c" }}>
            {sc.status === "scrapped" ? "Unit scrapped" : "Buyback — unit purchased by Vikas Pioneers"}
          </span>
          {sc.closed_at && (
            <span style={{ marginLeft: 10, fontSize: 12, color: c.muted }}>{fmtDate(sc.closed_at)}</span>
          )}
        </div>
      )}

      {/* Two-column body */}
      <div className="case-body" style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 14, alignItems: "start" }}>

        {/* LEFT — stage action + history */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
            intakePhotos={photosByStage.intake}
            inspectionPhotos={photosByStage.inspection}
            intakeNotes={sc.notes ?? null}
          />

          {/* Inspection report (read-only after inspection stage) */}
          {inspectionReport && sc.status !== "inspection" && (
            <section style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <SectionHeading>Inspection report</SectionHeading>
                <Pill label={irStatusLabel[inspectionReport.status]} tone={irStatusTone[inspectionReport.status]} />
              </div>
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
            </section>
          )}

          {/* Linked quote */}
          {quote && (
            <section style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <SectionHeading>Quotation</SectionHeading>
                <Pill label={QUOTE_STATUS_LABEL[quote.status]} tone={quote.status === "approved" ? "teal" : quote.status === "sent" ? "amber" : "blue"} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontFamily: "monospace", color: c.accent, fontSize: 14 }}>{quote.ref}</div>
                  <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>Rev. {quote.revision} · Valid until {quote.valid_until ? fmtDate(quote.valid_until) : "—"}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: c.ink }}>{"₹" + quote.total.toLocaleString("en-IN")}</div>
                  <div style={{ marginTop: 4, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Link href={ROUTES.quotation(quote.id)} style={{ fontSize: 12, color: c.accent }}>View →</Link>
                    <Link href={ROUTES.quotationPrint(quote.id)} target="_blank" rel="noopener" style={{ fontSize: 12, color: c.muted }}>PDF ↗</Link>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Photos */}
          {photosByStage.intake.length > 0 && sc.status !== "intake" && sc.status !== "inspection" && (
            <PhotoSection title="Intake photos" photos={photosByStage.intake} />
          )}
          {photosByStage.inspection.length > 0 && sc.status !== "inspection" && (
            <PhotoSection title="Inspection photos" photos={photosByStage.inspection} />
          )}
          {photosByStage.final.length > 0 && (
            <PhotoSection title="Final / delivery photos" photos={photosByStage.final} />
          )}

          {/* Sub-cases */}
          {subCases.length > 0 && (
            <section style={cardStyle}>
              <SectionHeading>Sub-cases ({subCases.length})</SectionHeading>
              {subCases.map((sub, i) => (
                <div key={sub.id} style={{ padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${c.line}`, display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 12.5, color: c.ink }}>{sub.ref}</span>
                      <Pill label={CASE_STATUS_LABEL[sub.status]} tone={statusTone[sub.status]} />
                    </div>
                    <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.45 }}>
                      {sub.complaint.length > 100 ? sub.complaint.slice(0, 100) + "…" : sub.complaint}
                    </div>
                  </div>
                  <Link href={ROUTES.case(sub.id)} style={{ fontSize: 11, fontWeight: 600, color: c.accent, textDecoration: "none", background: c.accentbg, borderRadius: 6, padding: "3px 8px", flexShrink: 0 }}>
                    Open →
                  </Link>
                </div>
              ))}
            </section>
          )}

          <CustomFieldsSection
            objectType="case"
            recordId={sc.id}
            customData={(sc as Record<string, unknown>).custom_data as Record<string, unknown> | null}
            patchUrl={`/api/cases/${sc.id}`}
          />
        </div>

        {/* RIGHT — context card */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <section style={{ ...cardStyle, padding: "14px 14px 12px" }}>

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
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#ba7517" }}>{loanerAsset.name}</div>
                <div style={{ fontSize: 11, color: "#ba7517", marginTop: 2 }}>Return on delivery</div>
              </>
            )}

            {/* Asset link */}
            {asset && (
              <>
                <div style={{ borderTop: `1px solid ${c.line}`, margin: "10px 0" }} />
                <CtxLabel>Asset</CtxLabel>
                <Link href={ROUTES.asset(asset.id)} style={{ fontSize: 12.5, fontWeight: 600, color: c.accent, textDecoration: "none" }}>
                  {asset.name} →
                </Link>
              </>
            )}
          </section>

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {quote && (
              <Link href={ROUTES.quotation(quote.id)} style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                background: c.accent, color: "#fff", borderRadius: 8, padding: "8px 14px",
                fontSize: 12.5, fontWeight: 600, textDecoration: "none",
              }}>
                ₹ View quotation
              </Link>
            )}
            {quote && (
              <Link href={ROUTES.quotationPrint(quote.id)} target="_blank" style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                background: c.accentbg, color: "#0c447c", borderRadius: 8, padding: "8px 14px",
                fontSize: 12.5, fontWeight: 600, textDecoration: "none",
              }}>
                ↓ Download PDF
              </Link>
            )}
            <span style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              background: "#f0faf5", color: "#3d7a5a", borderRadius: 8, padding: "7px 14px",
              fontSize: 12, fontWeight: 500, cursor: "not-allowed",
            }}>
              <MessageSquare size={12} color="#3d7a5a" /> WhatsApp <ComingSoon size="xs" />
            </span>

            <CaseCoreEditPanel
              caseId={sc.id}
              equipmentLabel={sc.equipment_label}
              complaint={sc.complaint}
              notes={sc.notes ?? null}
            />
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .case-body { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: c.accent, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>
      {children}
    </div>
  );
}

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
    <section style={cardStyle}>
      <SectionHeading>{title}</SectionHeading>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
        {photos.map((photo) => (
          <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer"
            style={{ borderRadius: 6, overflow: "hidden", border: `1px solid ${c.line}`, display: "block", textDecoration: "none" }}>
            <img src={photo.url} alt={photo.caption || title}
              style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }} />
            {photo.caption && (
              <div style={{ padding: "5px 8px", fontSize: 11, color: c.muted, lineHeight: 1.4 }}>{photo.caption}</div>
            )}
          </a>
        ))}
      </div>
    </section>
  );
}
