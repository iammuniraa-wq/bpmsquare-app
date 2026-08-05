"use client";

import { useCallback, useEffect, useState } from "react";
import type { CorrectionIssue, CorrectionStatus, WfmCorrectionRequest } from "@/lib/wfm/types";

const ISSUE_LABEL: Record<CorrectionIssue, string> = {
  missing_check_in: "Missing check-in",
  missing_check_out: "Missing check-out",
  wrong_time: "Wrong time",
  other: "Other",
};
const STATUS_COLOR: Record<CorrectionStatus, string> = {
  pending: "#f6b23c", approved: "#22c07a", rejected: "#ff6b6b",
};

type Draft = { target_date: string; issue: CorrectionIssue; proposed_ts: string; reason_text: string };
const emptyDraft = (): Draft => ({
  target_date: new Date().toISOString().slice(0, 10),
  issue: "missing_check_out",
  proposed_ts: "",
  reason_text: "",
});

export default function CorrectionsClient({ accentColor }: { accentColor: string }) {
  const [requests, setRequests] = useState<WfmCorrectionRequest[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/corrections");
      const json = await res.json();
      if (res.ok) setRequests(json);
      else setError(json.error ?? "Failed to load");
    } catch {
      setError("Network error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit() {
    if (!draft.reason_text.trim()) { setError("Please describe the issue"); return; }
    if (draft.issue !== "other" && !draft.proposed_ts) { setError("Please give the correct time"); return; }
    setBusy(true);
    setError("");
    try {
      const proposed_ts = draft.proposed_ts
        ? new Date(`${draft.target_date}T${draft.proposed_ts}:00`).toISOString()
        : undefined;
      const res = await fetch("/api/wfm/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_date: draft.target_date,
          issue: draft.issue,
          proposed_ts,
          reason_text: draft.reason_text.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Could not submit"); return; }
      setDraft(emptyDraft());
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  const S: Record<string, React.CSSProperties> = {
    page: { minHeight: "100dvh", background: "#0e1a28", color: "#e8eef4", fontFamily: "system-ui, -apple-system, sans-serif", padding: "18px 16px 24px", maxWidth: 440, margin: "0 auto" },
    card: { background: "#152233", borderRadius: 14, padding: 16, marginTop: 14 },
    label: { fontSize: 12, color: "#8fa1b3", marginBottom: 5, display: "block" },
    input: { width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 10, border: "1px solid #2a3b52", background: "#0e1a28", color: "#e8eef4", boxSizing: "border-box", marginBottom: 12 },
    button: { width: "100%", padding: "13px 0", fontSize: 15, fontWeight: 700, borderRadius: 12, border: "none", color: "#fff", cursor: "pointer" },
  };

  return (
    <div style={S.page}>
      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Corrections</div>
      <div style={{ fontSize: 12.5, color: "#8fa1b3", marginBottom: 4 }}>
        Request a fix to a missing or wrong punch — your supervisor reviews every request.
      </div>

      <div style={S.card}>
        <label style={S.label}>Date</label>
        <input
          type="date" style={S.input} value={draft.target_date}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDraft({ ...draft, target_date: e.target.value })}
        />

        <label style={S.label}>What happened</label>
        <select
          style={S.input}
          value={draft.issue}
          onChange={(e) => setDraft({ ...draft, issue: e.target.value as CorrectionIssue })}
        >
          {(Object.keys(ISSUE_LABEL) as CorrectionIssue[]).map((k) => (
            <option key={k} value={k}>{ISSUE_LABEL[k]}</option>
          ))}
        </select>

        {draft.issue !== "other" && (
          <>
            <label style={S.label}>Correct time</label>
            <input
              type="time" style={S.input} value={draft.proposed_ts}
              onChange={(e) => setDraft({ ...draft, proposed_ts: e.target.value })}
            />
          </>
        )}

        <label style={S.label}>Reason</label>
        <textarea
          style={{ ...S.input, minHeight: 70, resize: "vertical" }}
          value={draft.reason_text}
          onChange={(e) => setDraft({ ...draft, reason_text: e.target.value })}
          placeholder="e.g. Phone died before I could check out"
        />

        {error && <div style={{ color: "#ff6b6b", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}

        <button style={{ ...S.button, background: accentColor, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>
          {busy ? "Submitting…" : "Submit request"}
        </button>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, margin: "20px 0 8px", color: "#c6d2dd" }}>Your requests</div>
      {requests.length === 0 && <div style={{ fontSize: 12.5, color: "#5f7286" }}>No requests yet.</div>}
      {requests.map((r) => (
        <div key={r.id} style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>{new Date(r.target_date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: STATUS_COLOR[r.status], textTransform: "uppercase" }}>{r.status}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "#8fa1b3", marginTop: 4 }}>
            {ISSUE_LABEL[r.requested_change.issue]} — {r.reason_text}
          </div>
          {r.supervisor_remark && (
            <div style={{ fontSize: 12, color: "#c6d2dd", marginTop: 6, borderTop: "1px solid #1e2f44", paddingTop: 6 }}>
              Supervisor: {r.supervisor_remark}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
