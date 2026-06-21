import Link from "next/link";
import { notFound } from "next/navigation";
import { getCase, CASE_STATUS_LABEL, CASE_TYPE_LABEL, QUOTE_STATUS_LABEL } from "@/lib/data";
import type { ServiceCase, CasePhoto, InspectionReport } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import type { PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import ComingSoon from "@/components/ComingSoon";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";

// ── Stage timeline config ─────────────────────────────────────────────────────

type Stage = {
  status: ServiceCase["status"];
  label: string;
  short: string;
};

const STAGES: Stage[] = [
  { status: "intake",          label: "Intake",          short: "Intake" },
  { status: "inspection",      label: "Inspection",      short: "Inspect" },
  { status: "report_sent",     label: "Report sent",     short: "Report" },
  { status: "report_approved", label: "Report approved", short: "Approved" },
  { status: "quote_sent",      label: "Quote sent",      short: "Quote" },
  { status: "quote_approved",  label: "Quote approved",  short: "Approved" },
  { status: "in_repair",       label: "In repair",       short: "Repair" },
  { status: "qa",              label: "QA",              short: "QA" },
  { status: "ready",           label: "Ready",           short: "Ready" },
  { status: "closed",          label: "Closed",          short: "Closed" },
];

const EXIT_STATUSES: ServiceCase["status"][] = ["buyback", "scrapped"];

function stageIndex(status: ServiceCase["status"]): number {
  return STAGES.findIndex((s) => s.status === status);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const fmtDateTime = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: true,
      })
    : "—";

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

const STAGE_GROUPS: { label: string; statuses: ServiceCase["status"][] }[] = [
  { label: "Intake",     statuses: ["intake"] },
  { label: "Inspection", statuses: ["inspection"] },
  { label: "Report",     statuses: ["report_sent", "report_approved"] },
  { label: "Quote",      statuses: ["quote_sent", "quote_approved"] },
  { label: "Repair",     statuses: ["in_repair", "qa"] },
  { label: "Close",      statuses: ["ready", "closed"] },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getCase(id);
  if (!data) notFound();

  const { serviceCase: sc, account, contact, asset, technician, contract, quote, photos, inspectionReport, loanerAsset, subCases } = data;

  const currentIdx = stageIndex(sc.status);
  const isExit = EXIT_STATUSES.includes(sc.status);

  const photosByStage = {
    intake:     photos.filter((p) => p.stage === "intake"),
    inspection: photos.filter((p) => p.stage === "inspection"),
    final:      photos.filter((p) => p.stage === "final"),
  };

  return (
    <>
      <TabTitle title={sc.ref} />
      <PageHeader
        title={sc.ref}
        subtitle={`Service · Case · ${account?.name ?? ""}`}
      />

      {/* Back + badges row */}
      <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Link href={ROUTES.cases} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All cases
        </Link>
        {sc.parent_case_id && (
          <>
            <span style={{ fontSize: 12, color: c.hint }}>/</span>
            <Link href={ROUTES.case(sc.parent_case_id)} style={{ fontSize: 12, color: c.accent, textDecoration: "none", fontFamily: "monospace" }}>
              Sub-case of {sc.parent_case_id.replace("case_", "CS-2026-00")}
            </Link>
          </>
        )}
        <Pill label={CASE_STATUS_LABEL[sc.status]} tone={statusTone[sc.status]} />
        <Pill label={CASE_TYPE_LABEL[sc.type]} tone={typeTone[sc.type]} />
        {sc.has_loaner && <Pill label="Loaner out" tone="amber" />}
        {sc.disposition === "buyback" && <Pill label="Buyback" tone="purple" />}
        {sc.disposition === "scrap"   && <Pill label="Scrapped" tone="red" />}
      </div>

      {/* Action bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {quote && (
          <Link
            href={ROUTES.quotation(quote.id)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c.accent, color: "#fff", borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 500, textDecoration: "none" }}
          >
            ₹ View quotation
          </Link>
        )}
        {quote && (
          <Link
            href={ROUTES.quotationPrint(quote.id)}
            target="_blank"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#e6f1fb", color: "#0c447c", borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 500, textDecoration: "none" }}
          >
            ↓ Download PDF
          </Link>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f4f6f9", color: c.hint, borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 500, cursor: "not-allowed" }}>
          📧 Email report <ComingSoon size="xs" />
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f0faf5", color: "#3d7a5a", borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 500, cursor: "not-allowed" }}>
          💬 WhatsApp contact <ComingSoon size="xs" />
        </span>
      </div>

      {/* Stage timeline */}
      {!isExit && (
        <div style={{ ...cardStyle, marginBottom: 12, padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto" }}>
            {STAGE_GROUPS.map((group, gi) => {
              const groupIdxes = group.statuses.map((s) => stageIndex(s));
              const minIdx = Math.min(...groupIdxes);
              const maxIdx = Math.max(...groupIdxes);
              const isDone    = currentIdx > maxIdx;
              const isCurrent = currentIdx >= minIdx && currentIdx <= maxIdx;

              const dotColor = isDone ? "#1d9e75" : isCurrent ? "#378ADD" : c.line;
              const dotBg    = isDone ? "#e1f5ee" : isCurrent ? "#e6f1fb" : "#f4f6f9";
              const labelColor = isDone ? "#04342c" : isCurrent ? "#0c447c" : c.hint;

              return (
                <div key={group.label} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                  {/* connector line before each group (except first) */}
                  {gi > 0 && (
                    <div style={{
                      width: 32, height: 2,
                      background: currentIdx > STAGE_GROUPS[gi - 1].statuses.map(s => stageIndex(s)).reduce((a,b)=>Math.max(a,b))
                        ? "#1d9e75" : c.line,
                      flexShrink: 0,
                    }} />
                  )}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%",
                      background: dotBg,
                      border: `2px solid ${dotColor}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: isDone ? 14 : 11, color: dotColor, fontWeight: 700,
                    }}>
                      {isDone ? "✓" : gi + 1}
                    </div>
                    <div style={{ fontSize: 10, color: labelColor, fontWeight: isCurrent ? 700 : 500, whiteSpace: "nowrap" }}>
                      {group.label}
                    </div>
                    {isCurrent && (
                      <div style={{ fontSize: 9, color: "#378ADD", fontWeight: 600, background: "#e6f1fb", borderRadius: 3, padding: "1px 5px" }}>
                        Now
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isExit && (
        <div style={{ ...cardStyle, marginBottom: 12, padding: "12px 16px", background: sc.status === "scrapped" ? "#fcebeb" : "#eeedfe", borderLeft: `3px solid ${sc.status === "scrapped" ? "#a32d2d" : "#7f77dd"}` }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: sc.status === "scrapped" ? "#791f1f" : "#26215c" }}>
            {sc.status === "scrapped" ? "Unit scrapped" : "Buyback — unit purchased by Vikas Pioneers"}
          </span>
          {sc.closed_at && (
            <span style={{ marginLeft: 10, fontSize: 12, color: c.muted }}>{fmtDate(sc.closed_at)}</span>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 12 }}>

        {/* ── Left column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Complaint */}
          <section style={cardStyle}>
            <SectionHeading>Complaint</SectionHeading>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: c.ink }}>{sc.complaint}</p>
            {sc.notes && (
              <p style={{ margin: "10px 0 0", fontSize: 12, color: c.muted, lineHeight: 1.6, borderTop: `1px solid ${c.line}`, paddingTop: 10 }}>
                <strong style={{ color: c.ink }}>Note: </strong>{sc.notes}
              </p>
            )}
          </section>

          {/* Photos — intake */}
          {photosByStage.intake.length > 0 && (
            <PhotoSection title="Intake photos" photos={photosByStage.intake} />
          )}

          {/* Inspection report */}
          {inspectionReport && (
            <section style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <SectionHeading>Inspection report</SectionHeading>
                <Pill label={irStatusLabel[inspectionReport.status]} tone={irStatusTone[inspectionReport.status]} />
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: c.accent, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5 }}>
                  Findings
                </div>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: c.ink }}>{inspectionReport.findings}</p>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: c.accent, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5 }}>
                  Recommendations
                </div>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: c.ink }}>{inspectionReport.recommendations}</p>
              </div>

              <div style={{ display: "flex", gap: 20, paddingTop: 10, borderTop: `1px solid ${c.line}`, flexWrap: "wrap" }}>
                {inspectionReport.estimated_cost != null && (
                  <MiniDetail label="Estimated cost" value={inr(inspectionReport.estimated_cost)} />
                )}
                {inspectionReport.sent_at && (
                  <MiniDetail label="Sent" value={fmtDateTime(inspectionReport.sent_at)} />
                )}
                {inspectionReport.approved_at && (
                  <MiniDetail label="Approved" value={fmtDateTime(inspectionReport.approved_at)} />
                )}
              </div>
            </section>
          )}

          {/* Inspection photos */}
          {photosByStage.inspection.length > 0 && (
            <PhotoSection title="Inspection photos" photos={photosByStage.inspection} />
          )}

          {/* Sub-cases */}
          {subCases.length > 0 && (
            <section style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <SectionHeading>Sub-cases ({subCases.length})</SectionHeading>
              </div>
              {subCases.map((sub, i) => (
                <div key={sub.id} style={{
                  padding: "10px 0",
                  borderTop: i === 0 ? "none" : `1px solid ${c.line}`,
                  display: "flex", alignItems: "flex-start", gap: 10,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 12.5, color: c.ink }}>{sub.ref}</span>
                      <Pill label={CASE_STATUS_LABEL[sub.status]} tone={statusTone[sub.status]} />
                    </div>
                    <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.45 }}>
                      {sub.complaint.length > 100 ? sub.complaint.slice(0, 100) + "…" : sub.complaint}
                    </div>
                  </div>
                  <Link
                    href={ROUTES.case(sub.id)}
                    style={{
                      fontSize: 11, fontWeight: 600, color: c.accent, textDecoration: "none",
                      background: c.accentbg, borderRadius: 6, padding: "3px 8px", flexShrink: 0,
                    }}
                  >
                    Open →
                  </Link>
                </div>
              ))}
            </section>
          )}

          {/* Linked quote */}
          {quote && (
            <section style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <SectionHeading>Quotation</SectionHeading>
                <Pill
                  label={QUOTE_STATUS_LABEL[quote.status]}
                  tone={quote.status === "approved" ? "teal" : quote.status === "sent" ? "amber" : "blue"}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontFamily: "monospace", color: c.accent, fontSize: 14 }}>{quote.ref}</div>
                  <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
                    Rev. {quote.revision} · Valid until {quote.valid_until ? fmtDate(quote.valid_until) : "—"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: c.ink }}>
                    {"₹" + quote.total.toLocaleString("en-IN")}
                  </div>
                  <div style={{ marginTop: 4, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Link href={ROUTES.quotation(quote.id)} style={{ fontSize: 12, color: c.accent }}>
                      View quote →
                    </Link>
                    <Link href={ROUTES.quotationPrint(quote.id)} target="_blank" rel="noopener" style={{ fontSize: 12, color: c.muted }}>
                      PDF ↗
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Final photos */}
          {photosByStage.final.length > 0 && (
            <PhotoSection title="Final / delivery photos" photos={photosByStage.final} />
          )}
        </div>

        {/* ── Right sidebar ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Account */}
          <section style={cardStyle}>
            <SectionHeading>Account</SectionHeading>
            {account && (
              <>
                <Link
                  href={ROUTES.account(account.id)}
                  style={{ fontSize: 14, fontWeight: 600, color: c.accent, display: "block", marginBottom: 6 }}
                >
                  {account.name}
                </Link>
                {account.city  && <SideDetail label="City"  value={account.city} />}
                {account.phone && <SideDetail label="Phone" value={account.phone} />}
                {account.email && <SideDetail label="Email" value={account.email} />}
              </>
            )}
            {contact && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.line}` }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: c.hint, marginBottom: 4 }}>CONTACT</div>
                <div style={{ fontWeight: 600, fontSize: 12.5 }}>{contact.name}</div>
                {contact.role  && <div style={{ fontSize: 12, color: c.muted }}>{contact.role}</div>}
                {contact.phone && <SideDetail label="Phone" value={contact.phone} />}
                {contact.email && <SideDetail label="Email" value={contact.email} />}
              </div>
            )}
          </section>

          {/* Equipment */}
          <section style={cardStyle}>
            <SectionHeading>Equipment</SectionHeading>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{sc.equipment_label}</div>
            {asset && (
              <>
                <SideDetail label="Kind"   value={asset.kind.charAt(0).toUpperCase() + asset.kind.slice(1)} />
                {asset.rating && <SideDetail label="Rating" value={asset.rating} />}
                {asset.serial && <SideDetail label="Serial" value={asset.serial} />}
              </>
            )}
          </section>

          {/* Loaner */}
          {loanerAsset && (
            <section style={{ ...cardStyle, borderLeft: `3px solid ${pillar.amber.base}`, background: pillar.amber.bg }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <SectionHeading>Loaner dispatched</SectionHeading>
                <Pill label="On Loan" tone="amber" />
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, color: c.ink }}>{loanerAsset.name}</div>
              {loanerAsset.rating && (
                <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{loanerAsset.rating}</div>
              )}
              {loanerAsset.serial && (
                <div style={{ fontSize: 11, color: c.hint, marginTop: 2, fontFamily: "monospace" }}>S/N {loanerAsset.serial}</div>
              )}
              <div style={{ fontSize: 11.5, color: pillar.amber.base, marginTop: 8, fontWeight: 500 }}>
                Return on delivery of repaired unit
              </div>
            </section>
          )}

          {/* Technician */}
          <section style={cardStyle}>
            <SectionHeading>Assigned to</SectionHeading>
            {technician ? (
              <>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{technician.name}</div>
                {technician.skills && (
                  <div style={{ fontSize: 12, color: c.muted, marginTop: 3 }}>{technician.skills}</div>
                )}
              </>
            ) : (
              <div style={{ color: c.hint, fontSize: 12 }}>Not yet assigned</div>
            )}
          </section>

          {/* AMC contract */}
          {contract && (
            <section style={cardStyle}>
              <SectionHeading>AMC contract</SectionHeading>
              <div style={{ fontWeight: 600, fontFamily: "monospace", fontSize: 13, color: c.accent }}>{contract.ref}</div>
              <Pill label={contract.status.charAt(0).toUpperCase() + contract.status.slice(1)} tone={contract.status === "active" ? "teal" : "red"} />
              {contract.end_date && (
                <div style={{ marginTop: 6 }}>
                  <SideDetail label="Valid until" value={fmtDate(contract.end_date)} />
                </div>
              )}
              {contract.value != null && (
                <SideDetail label="AMC value" value={inr(contract.value)} />
              )}
            </section>
          )}

          {/* Case timeline */}
          <section style={cardStyle}>
            <SectionHeading>Timeline</SectionHeading>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <TimelineRow label="Intake"  value={fmtDateTime(sc.intake_at)} />
              {sc.closed_at && <TimelineRow label="Closed" value={fmtDateTime(sc.closed_at)} />}
            </div>
          </section>
        </div>
      </div>
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

function SideDetail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginTop: 5 }}>
      <span style={{ color: c.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", wordBreak: "break-all" }}>{value}</span>
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

function TimelineRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
      <span style={{ color: c.muted }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function PhotoSection({ title, photos }: { title: string; photos: CasePhoto[] }) {
  return (
    <section style={cardStyle}>
      <SectionHeading>{title}</SectionHeading>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
        {photos.map((photo) => (
          <div key={photo.id} style={{ borderRadius: 6, overflow: "hidden", border: `1px solid ${c.line}` }}>
            {/* Placeholder — in prod this is an <img src={photo.url} /> */}
            <div style={{
              height: 100,
              background: "linear-gradient(135deg, #e6f1fb 0%, #d0e4f5 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28,
            }}>
              📷
            </div>
            <div style={{ padding: "6px 8px", fontSize: 11, color: c.muted, lineHeight: 1.4 }}>
              {photo.caption}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
