"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import PhotoUploader from "./PhotoUploader";
import type { CasePhoto } from "@/lib/types";
import { Clipboard, Pencil, CheckIcon } from "@/components/Icons";

type InspectionReportProps = {
  id: string;
  findings: string;
  recommendations: string;
  estimated_cost: number | null;
  status: string;
} | null;

type Props = {
  caseId: string;
  caseRef: string;
  currentStatus: string;
  notes: string | null;
  assignedTo: string | null;
  inspectionReport: InspectionReportProps;
  accountId: string;
  intakePhotos: CasePhoto[];
  inspectionPhotos: CasePhoto[];
  intakeNotes: string | null;
};

// ── Button styles — compact, not full-width ───────────────────────────────────

const btnPrimary: React.CSSProperties = {
  padding: "8px 18px", borderRadius: 7, border: "none",
  background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13,
  cursor: "pointer",
};
const btnSuccess: React.CSSProperties = {
  ...btnPrimary, background: "#1d9e75",
};
const btnSecondary: React.CSSProperties = {
  padding: "7px 14px", borderRadius: 7,
  border: `1px solid ${c.line}`, background: c.panel,
  color: c.muted, fontWeight: 600, fontSize: 12.5,
  cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "5px 10px", borderRadius: 6,
  border: `1px solid ${c.line}`, background: "none",
  color: c.muted, fontWeight: 600, fontSize: 12,
  cursor: "pointer",
};

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700,
  color: c.accent, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const fw: React.CSSProperties = { marginBottom: 14 };

const card: React.CSSProperties = {
  background: c.panel,
  border: `1px solid ${c.line}`,
  borderLeft: `3px solid ${c.accent}`,
  borderRadius: 10,
  padding: "16px 18px",
  marginBottom: 12,
};

const actionRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
  marginTop: 16, paddingTop: 14, borderTop: `1px solid ${c.line}`,
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

// ── Intake reference (collapsible reference during inspection) ─────────────────

function IntakeReference({ notes, photos }: { notes: string | null; photos: CasePhoto[] }) {
  const [open, setOpen] = useState(false);
  if (!notes && photos.length === 0) return null;
  return (
    <div style={{ background: "#f8fafc", border: `1px solid ${c.line}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
      <button type="button" onClick={() => setOpen(v => !v)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", background: "none", border: "none", cursor: "pointer" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: 0.7 }}>
          <Clipboard size={12} color={c.muted} style={{ marginRight: 5 }} /> Intake reference{photos.length > 0 ? ` · ${photos.length} photo${photos.length > 1 ? "s" : ""}` : ""}
        </span>
        <span style={{ color: c.hint, fontSize: 13, display: "inline-block", transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>▾</span>
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${c.line}`, padding: "12px 14px" }}>
          {notes && (
            <div style={{ marginBottom: photos.length > 0 ? 12 : 0 }}>
              <div style={{ ...lbl, color: c.muted }}>Notes from intake</div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: c.ink }}>{notes}</p>
            </div>
          )}
          {photos.length > 0 && (
            <div>
              <div style={{ ...lbl, color: c.muted }}>Intake photos</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
                {photos.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" style={{ borderRadius: 6, overflow: "hidden", border: `1px solid ${c.line}`, display: "block" }}>
                    <img src={p.url} alt={p.caption || ""} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Read-only inspection report ───────────────────────────────────────────────

function InspectionReportView({ report, onEdit }: { report: NonNullable<InspectionReportProps>; onEdit: () => void }) {
  return (
    <div style={{ ...card, borderLeftColor: "#6c6bd4" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#6c6bd4", textTransform: "uppercase", letterSpacing: 0.6 }}>Inspection report · Draft saved</span>
        <button type="button" onClick={onEdit} style={btnGhost}><Pencil size={12} style={{ marginRight: 4 }} /> Edit</button>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={lbl}>Findings</div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: c.ink }}>{report.findings}</p>
      </div>
      <div style={{ marginBottom: report.estimated_cost != null ? 10 : 0 }}>
        <div style={lbl}>Recommendations</div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: c.ink }}>{report.recommendations}</p>
      </div>
      {report.estimated_cost != null && (
        <div style={{ paddingTop: 10, borderTop: `1px solid ${c.line}` }}>
          <span style={{ fontSize: 12, color: c.muted }}>Estimated cost: </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>{inr(report.estimated_cost)}</span>
        </div>
      )}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function CaseActions({
  caseId, caseRef, currentStatus, notes, inspectionReport,
  accountId, intakePhotos, inspectionPhotos, intakeNotes,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [localNotes, setLocalNotes] = useState(notes ?? "");
  const [notesSaved, setNotesSaved] = useState(false);

  const [editing, setEditing] = useState(!inspectionReport);
  const [findings, setFindings] = useState(inspectionReport?.findings ?? "");
  const [recommendations, setRecommendations] = useState(inspectionReport?.recommendations ?? "");
  const [estimatedCost, setEstimatedCost] = useState(
    inspectionReport?.estimated_cost != null ? String(inspectionReport.estimated_cost) : ""
  );

  function patchCase(patch: Record<string, unknown>, onSuccess?: () => void) {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) { onSuccess?.(); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Action failed"); }
    });
  }

  function saveNotes() {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: localNotes }),
      });
      if (res.ok) { setNotesSaved(true); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    });
  }

  function postInspectionReport(action: "save" | "send") {
    setError("");
    if (!findings.trim() || !recommendations.trim()) {
      setError("Findings and recommendations are required.");
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/cases/${caseId}/inspection-report`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findings, recommendations, estimated_cost: estimatedCost !== "" ? Number(estimatedCost) : null, action }),
      });
      if (res.ok) { setEditing(false); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save report"); }
    });
  }

  function goToNewQuotation() {
    try {
      sessionStorage.setItem("vvcrm_quote_source", JSON.stringify({
        caseId, caseRef,
        accountId,
        findings: inspectionReport?.findings ?? intakeNotes ?? "",
        recommendations: inspectionReport?.recommendations ?? "",
        estimatedCost: inspectionReport?.estimated_cost ?? null,
      }));
    } catch { /* ignore */ }
    router.push(ROUTES.quotationNew);
  }

  const errorBox = error ? (
    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "9px 14px", fontSize: 12.5, color: "#dc2626", marginTop: 10 }}>
      {error}
    </div>
  ) : null;

  // ── INTAKE ──────────────────────────────────────────────────────────────────

  if (currentStatus === "intake") {
    return (
      <div style={card}>
        <div style={fw}>
          <label style={lbl}>Internal notes</label>
          <textarea style={{ ...inp, minHeight: 80, resize: "vertical" }} value={localNotes}
            onChange={(e) => { setLocalNotes(e.target.value); setNotesSaved(false); }}
            placeholder="Condition on arrival, accessories received, customer remarks…" />
        </div>
        <div style={fw}>
          <label style={lbl}>Intake photos</label>
          <PhotoUploader caseId={caseId} stage="intake" existingPhotos={intakePhotos} onUploaded={() => router.refresh()} />
        </div>
        <div style={actionRow}>
          <button style={{ ...btnSuccess }} onClick={() => patchCase({ status: "inspection" })} disabled={pending} type="button">
            {pending ? "…" : "Start Inspection →"}
          </button>
          <button style={btnSecondary} onClick={saveNotes} disabled={pending} type="button">
            {pending ? "Saving…" : notesSaved ? "Saved" : "Save notes"}
          </button>
        </div>
        {errorBox}
      </div>
    );
  }

  // ── INSPECTION ──────────────────────────────────────────────────────────────

  if (currentStatus === "inspection") {
    const hasDraft = !!inspectionReport && !editing;
    const canSend  = !!inspectionReport;
    return (
      <div>
        <IntakeReference notes={intakeNotes} photos={intakePhotos} />

        {hasDraft ? (
          <InspectionReportView report={inspectionReport!} onEdit={() => setEditing(true)} />
        ) : (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: c.accent, textTransform: "uppercase", letterSpacing: 0.6 }}>
                {inspectionReport ? "Edit inspection report" : "Inspection report"}
              </span>
              {inspectionReport && <button type="button" onClick={() => setEditing(false)} style={btnGhost}>Cancel</button>}
            </div>
            <div style={fw}>
              <label style={lbl}>Findings *</label>
              <textarea style={{ ...inp, minHeight: 90, resize: "vertical" }} value={findings}
                onChange={(e) => setFindings(e.target.value)} placeholder="What was found during inspection…" />
            </div>
            <div style={fw}>
              <label style={lbl}>Recommendations *</label>
              <textarea style={{ ...inp, minHeight: 90, resize: "vertical" }} value={recommendations}
                onChange={(e) => setRecommendations(e.target.value)} placeholder="Recommended repair actions…" />
            </div>
            <div style={fw}>
              <label style={lbl}>Estimated cost (₹, optional)</label>
              <input style={inp} type="number" min={0} value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)} placeholder="e.g. 14999" />
            </div>
            <div style={{ marginBottom: 4 }}>
              <label style={lbl}>Inspection photos</label>
              <PhotoUploader caseId={caseId} stage="inspection" existingPhotos={inspectionPhotos} onUploaded={() => router.refresh()} />
            </div>
            <div style={actionRow}>
              <button style={btnSecondary} onClick={() => postInspectionReport("save")} disabled={pending} type="button">
                {pending ? "Saving…" : "Save draft"}
              </button>
            </div>
            {errorBox}
          </div>
        )}

        {canSend && (
          <div style={{ ...actionRow, borderTop: "none", paddingTop: 0, marginTop: 4 }}>
            <button style={btnPrimary} onClick={() => postInspectionReport("send")} disabled={pending} type="button">
              {pending ? "…" : "Send report to customer →"}
            </button>
            <button style={btnSecondary} onClick={goToNewQuotation} type="button">
              Skip report — Create Quotation
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── REPORT SENT ─────────────────────────────────────────────────────────────

  if (currentStatus === "report_sent") {
    return (
      <div style={card}>
        <div style={{ background: c.accentbg, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#0c447c", marginBottom: 14 }}>
          Report sent to customer — waiting for approval.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btnSuccess} onClick={() => patchCase({ status: "report_approved" })} disabled={pending} type="button">
            {pending ? "…" : "Customer approved →"}
          </button>
          <button style={btnSecondary} onClick={goToNewQuotation} type="button">
            Create Quotation
          </button>
        </div>
        {errorBox}
      </div>
    );
  }

  // ── REPORT APPROVED ─────────────────────────────────────────────────────────

  if (currentStatus === "report_approved") {
    return (
      <div style={card}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btnPrimary} onClick={goToNewQuotation} type="button">
            Create Quotation →
          </button>
          <button style={btnSecondary} onClick={() => patchCase({ status: "in_repair" })} disabled={pending} type="button">
            {pending ? "…" : "Skip quote — Start Repair"}
          </button>
        </div>
        {errorBox}
      </div>
    );
  }

  // ── QUOTE SENT / APPROVED ───────────────────────────────────────────────────

  if (currentStatus === "quote_sent" || currentStatus === "quote_approved") {
    return (
      <div style={card}>
        <div style={{ fontSize: 12.5, color: c.muted, marginBottom: 12 }}>
          {currentStatus === "quote_sent" ? "Quote sent — awaiting customer approval." : "Quote approved."}
        </div>
        <button style={btnPrimary} onClick={() => patchCase({ status: "in_repair" })} disabled={pending} type="button">
          {pending ? "…" : "Start Repair →"}
        </button>
        {errorBox}
      </div>
    );
  }

  // ── IN REPAIR ───────────────────────────────────────────────────────────────

  if (currentStatus === "in_repair") {
    return (
      <div style={card}>
        <div style={fw}>
          <label style={lbl}>Repair notes</label>
          <textarea style={{ ...inp, minHeight: 80, resize: "vertical" }} value={localNotes}
            onChange={(e) => { setLocalNotes(e.target.value); setNotesSaved(false); }}
            placeholder="Repair progress, parts replaced…" />
        </div>
        <div style={actionRow}>
          <button style={{ ...btnPrimary, background: "#6c6bd4" }} onClick={() => patchCase({ status: "qa" })} disabled={pending} type="button">
            {pending ? "…" : "Move to QA →"}
          </button>
          <button style={btnSecondary} onClick={saveNotes} disabled={pending} type="button">
            {pending ? "Saving…" : notesSaved ? "Saved" : "Save notes"}
          </button>
        </div>
        {errorBox}
      </div>
    );
  }

  // ── QA ──────────────────────────────────────────────────────────────────────

  if (currentStatus === "qa") {
    return (
      <div style={card}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btnSuccess} onClick={() => patchCase({ status: "ready" })} disabled={pending} type="button">
            {pending ? "…" : "QA passed — Mark Ready →"}
          </button>
          <button style={btnSecondary} onClick={() => patchCase({ status: "in_repair" })} disabled={pending} type="button">
            {pending ? "…" : "Failed — Back to Repair"}
          </button>
        </div>
        {errorBox}
      </div>
    );
  }

  // ── READY ────────────────────────────────────────────────────────────────────

  if (currentStatus === "ready") {
    return (
      <div style={{ ...card, borderLeftColor: "#1d9e75" }}>
        <div style={{ fontSize: 12.5, color: "#1d6b4a", marginBottom: 12 }}>Equipment is ready for pickup.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btnSuccess} onClick={() => patchCase({ status: "closed" })} disabled={pending} type="button">
            {pending ? "…" : "Close — handed to customer ✓"}
          </button>
          <button style={{ ...btnSecondary, color: "#7f77dd", borderColor: "#c4c2f0" }} onClick={() => patchCase({ status: "buyback" })} disabled={pending} type="button">
            {pending ? "…" : "Buyback — customer sold unit"}
          </button>
          <button style={{ ...btnSecondary, color: "#a32d2d", borderColor: "#f5c0c0" }} onClick={() => patchCase({ status: "scrapped" })} disabled={pending} type="button">
            {pending ? "…" : "Scrap unit"}
          </button>
        </div>
        {errorBox}
      </div>
    );
  }

  // ── CLOSED / EXIT ────────────────────────────────────────────────────────────

  if (currentStatus === "closed") {
    return (
      <div style={{ ...card, borderLeftColor: "#1d9e75", background: "#f0faf5" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#04342c" }}>Case closed</div>
      </div>
    );
  }
  if (currentStatus === "buyback") {
    return (
      <div style={{ ...card, borderLeftColor: "#7f77dd", background: "#eeedfe" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#26215c" }}>Unit purchased (buyback)</div>
      </div>
    );
  }
  if (currentStatus === "scrapped") {
    return (
      <div style={{ ...card, borderLeftColor: "#a32d2d", background: "#fcebeb" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#791f1f" }}>Unit scrapped</div>
      </div>
    );
  }

  return null;
}
