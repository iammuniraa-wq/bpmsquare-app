"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import PhotoUploader from "./PhotoUploader";
import type { CasePhoto } from "@/lib/types";

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
};

const btn: React.CSSProperties = {
  padding: "10px 16px", borderRadius: 8, border: "none",
  background: c.accent, color: "#fff", fontWeight: 700, fontSize: 13,
  cursor: "pointer", width: "100%",
};

const btnSecondary: React.CSSProperties = {
  padding: "10px 16px", borderRadius: 8,
  border: `1px solid ${c.line}`, background: c.panel,
  color: c.muted, fontWeight: 600, fontSize: 13,
  cursor: "pointer", width: "100%",
};

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};

const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};

const fw: React.CSSProperties = { marginBottom: 14 };


export default function CaseActions({
  caseId,
  currentStatus,
  notes,
  inspectionReport,
  intakePhotos,
  inspectionPhotos,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Notes state (used in intake + in_repair stages)
  const [localNotes, setLocalNotes] = useState(notes ?? "");

  // Inspection report state
  const [findings, setFindings] = useState(inspectionReport?.findings ?? "");
  const [recommendations, setRecommendations] = useState(inspectionReport?.recommendations ?? "");
  const [estimatedCost, setEstimatedCost] = useState<string>(
    inspectionReport?.estimated_cost != null ? String(inspectionReport.estimated_cost) : ""
  );

  function patchCase(patch: Record<string, unknown>, onSuccess?: () => void) {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        onSuccess?.();
        router.refresh();
      } else {
        const j = await res.json();
        setError(j.error ?? "Action failed");
      }
    });
  }

  function saveNotes() {
    patchCase({ notes: localNotes });
  }

  function postInspectionReport(action: "save" | "send") {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/cases/${caseId}/inspection-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findings,
          recommendations,
          estimated_cost: estimatedCost !== "" ? Number(estimatedCost) : null,
          action,
        }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const j = await res.json();
        setError(j.error ?? "Failed to save report");
      }
    });
  }

  function navigateToNewQuotation() {
    sessionStorage.setItem("vvcrm_case_id", caseId);
    router.push(ROUTES.quotationNew);
  }

  const panelStyle: React.CSSProperties = {
    background: c.panel,
    border: `1px solid ${c.line}`,
    borderLeft: `3px solid ${c.accent}`,
    borderRadius: 10,
    padding: "16px 18px",
    marginBottom: 12,
  };

  const panelTitle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: c.accent,
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12,
  };

  const errorBox = error ? (
    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#dc2626", marginTop: 10 }}>
      {error}
    </div>
  ) : null;

  // ── "intake" stage ────────────────────────────────────────────────────────

  if (currentStatus === "intake") {
    return (
      <div style={panelStyle}>
        <div style={panelTitle}>Intake actions</div>
        <div style={fw}>
          <label style={lbl}>Internal notes</label>
          <textarea
            style={{ ...inp, minHeight: 80, resize: "vertical" }}
            value={localNotes}
            onChange={(e) => setLocalNotes(e.target.value)}
            placeholder="Add intake notes, condition on arrival, accessories received…"
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <button style={btnSecondary} onClick={saveNotes} disabled={pending} type="button">
            {pending ? "Saving…" : "Save notes"}
          </button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ ...lbl, marginBottom: 8 }}>Intake photos</label>
          <PhotoUploader
            caseId={caseId}
            stage="intake"
            existingPhotos={intakePhotos}
            onUploaded={() => router.refresh()}
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            style={{ ...btn, fontSize: 14 }}
            onClick={() => patchCase({ status: "inspection" })}
            disabled={pending}
            type="button"
          >
            {pending ? "…" : "→ Start Inspection"}
          </button>
        </div>
        {errorBox}
      </div>
    );
  }

  // ── "inspection" stage ────────────────────────────────────────────────────

  if (currentStatus === "inspection") {
    return (
      <div style={panelStyle}>
        <div style={panelTitle}>Inspection report</div>
        <div style={fw}>
          <label style={lbl}>Findings *</label>
          <textarea
            style={{ ...inp, minHeight: 80, resize: "vertical" }}
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
            placeholder="Describe what was found during inspection…"
          />
        </div>
        <div style={fw}>
          <label style={lbl}>Recommendations *</label>
          <textarea
            style={{ ...inp, minHeight: 80, resize: "vertical" }}
            value={recommendations}
            onChange={(e) => setRecommendations(e.target.value)}
            placeholder="Recommended repair actions…"
          />
        </div>
        <div style={fw}>
          <label style={lbl}>Estimated cost (₹, optional)</label>
          <input
            style={inp}
            type="number"
            min={0}
            value={estimatedCost}
            onChange={(e) => setEstimatedCost(e.target.value)}
            placeholder="e.g. 15000"
          />
        </div>
        <div style={{ marginBottom: 4 }}>
          <label style={{ ...lbl, marginBottom: 8 }}>Inspection photos</label>
          <PhotoUploader
            caseId={caseId}
            stage="inspection"
            existingPhotos={inspectionPhotos}
            onUploaded={() => router.refresh()}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            style={{ ...btnSecondary, flex: 1 }}
            onClick={() => postInspectionReport("save")}
            disabled={pending}
            type="button"
          >
            {pending ? "Saving…" : "Save draft"}
          </button>
          <button
            style={{ ...btn, flex: 1 }}
            onClick={() => postInspectionReport("send")}
            disabled={pending}
            type="button"
          >
            {pending ? "…" : "Send to customer →"}
          </button>
        </div>
        {errorBox}
      </div>
    );
  }

  // ── "report_sent" stage ───────────────────────────────────────────────────

  if (currentStatus === "report_sent") {
    return (
      <div style={panelStyle}>
        <div style={panelTitle}>Awaiting customer approval</div>
        <div style={{
          background: c.accentbg, borderRadius: 8, padding: "12px 14px",
          fontSize: 13, color: "#0c447c", marginBottom: 14,
        }}>
          Waiting for customer to approve the inspection report
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            style={btn}
            onClick={() => patchCase({ status: "report_approved" })}
            disabled={pending}
            type="button"
          >
            {pending ? "…" : "Customer approved →"}
          </button>
          <button
            style={btnSecondary}
            onClick={navigateToNewQuotation}
            type="button"
          >
            Create Quotation →
          </button>
        </div>
        {errorBox}
      </div>
    );
  }

  // ── "report_approved" stage ───────────────────────────────────────────────

  if (currentStatus === "report_approved") {
    return (
      <div style={panelStyle}>
        <div style={panelTitle}>Report approved</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            style={btn}
            onClick={navigateToNewQuotation}
            type="button"
          >
            Create Quotation →
          </button>
          <button
            style={btnSecondary}
            onClick={() => patchCase({ status: "in_repair" })}
            disabled={pending}
            type="button"
          >
            {pending ? "…" : "Start Repair →"}
          </button>
        </div>
        {errorBox}
      </div>
    );
  }

  // ── "quote_sent" / "quote_approved" stages ────────────────────────────────

  if (currentStatus === "quote_sent" || currentStatus === "quote_approved") {
    return (
      <div style={panelStyle}>
        <div style={panelTitle}>{currentStatus === "quote_sent" ? "Quote sent" : "Quote approved"}</div>
        <button
          style={btn}
          onClick={() => patchCase({ status: "in_repair" })}
          disabled={pending}
          type="button"
        >
          {pending ? "…" : "Start Repair →"}
        </button>
        {errorBox}
      </div>
    );
  }

  // ── "in_repair" stage ─────────────────────────────────────────────────────

  if (currentStatus === "in_repair") {
    return (
      <div style={panelStyle}>
        <div style={panelTitle}>In repair</div>
        <div style={fw}>
          <label style={lbl}>Internal notes</label>
          <textarea
            style={{ ...inp, minHeight: 80, resize: "vertical" }}
            value={localNotes}
            onChange={(e) => setLocalNotes(e.target.value)}
            placeholder="Repair progress notes…"
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <button style={btnSecondary} onClick={saveNotes} disabled={pending} type="button">
            {pending ? "Saving…" : "Save notes"}
          </button>
        </div>
        <button
          style={btn}
          onClick={() => patchCase({ status: "qa" })}
          disabled={pending}
          type="button"
        >
          {pending ? "…" : "Move to QA →"}
        </button>
        {errorBox}
      </div>
    );
  }

  // ── "qa" stage ────────────────────────────────────────────────────────────

  if (currentStatus === "qa") {
    return (
      <div style={panelStyle}>
        <div style={panelTitle}>Quality assurance</div>
        <button
          style={btn}
          onClick={() => patchCase({ status: "ready" })}
          disabled={pending}
          type="button"
        >
          {pending ? "…" : "Mark Ready →"}
        </button>
        {errorBox}
      </div>
    );
  }

  // ── "ready" stage ─────────────────────────────────────────────────────────

  if (currentStatus === "ready") {
    return (
      <div style={panelStyle}>
        <div style={panelTitle}>Ready for pickup</div>
        <button
          style={{ ...btn, background: "#1d9e75" }}
          onClick={() => patchCase({ status: "closed" })}
          disabled={pending}
          type="button"
        >
          {pending ? "…" : "Close case ✓"}
        </button>
        {errorBox}
      </div>
    );
  }

  // ── "closed" + exit statuses ──────────────────────────────────────────────

  if (currentStatus === "closed") {
    return (
      <div style={{ ...panelStyle, borderLeftColor: "#1d9e75" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#04342c" }}>
          ✓ Case closed
        </div>
      </div>
    );
  }

  if (currentStatus === "buyback") {
    return (
      <div style={{ ...panelStyle, borderLeftColor: "#7f77dd" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#26215c" }}>
          Unit purchased (buyback)
        </div>
      </div>
    );
  }

  if (currentStatus === "scrapped") {
    return (
      <div style={{ ...panelStyle, borderLeftColor: "#a32d2d" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#791f1f" }}>
          Unit scrapped
        </div>
      </div>
    );
  }

  // Fallback for unrecognised statuses
  return null;
}
