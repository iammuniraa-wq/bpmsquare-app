"use client";

import { useCallback, useEffect, useState } from "react";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import ChartRenderer from "@/components/charts/ChartRenderer";
import { normalizeReport, type ReportPayload } from "@/lib/reportView";

type Phase = "idle" | "asking" | "clarify" | "ready" | "insights" | "declined" | "error";

type SavedReport = { id: string; question: string; title: string; chart_type: string; created_at: string };

const EXAMPLES = [
  "How many open quotes do we have?",
  "Quotes by status this year",
  "Top 5 accounts by open quote value",
  "Cases by disposition",
];

const EXAMPLES_FULL = [
  "Accounts with quote value over 50k",
  "Quote value by quarter this year",
  "Top 10 accounts by total quote value",
  "Won quotes that haven't been invoiced yet",
  "Average quote value by status",
  "Open cases by status",
  "Total outstanding invoice value",
  "Assets by make",
  "Hours by project this month",
  "Billable amount by account last month",
  "Unassigned hours by month",
  "Give me insights about quotes",
  "How is my business doing?",
];

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data?.status) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export default function AskPanel({ canSave, fullPage = false }: { canSave: boolean; fullPage?: boolean }) {
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  // "Insights about X" -- broad questions can't answer as one chart, so the
  // server returns several independently-compiled facets instead. Rendered
  // as a vertical stream of cards, each with its own Save.
  const [insightsReports, setInsightsReports] = useState<ReportPayload[]>([]);
  const [insightsTitle, setInsightsTitle] = useState("");
  // A short prose synthesis of the facets below -- generated from the
  // already-computed numbers, never a fresh data call. Optional: a failure
  // writing it never blocks the charts themselves.
  const [insightsSummary, setInsightsSummary] = useState<string | null>(null);
  const [clarifyingQuestion, setClarifyingQuestion] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReport[] | null>(null);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/reports");
      const data = await res.json();
      setSaved(Array.isArray(data?.reports) ? data.reports : []);
    } catch {
      setSaved([]);
    }
  }, []);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  async function ask(q: string) {
    setPhase("asking");
    setError(null);
    try {
      // The previous single-chart report travels as refinement context, so
      // "now only this year" or "top 5 instead" continues it -- the server
      // decides whether the new question refines or stands alone.
      const context = phase === "ready" && payload
        ? { question: payload.question, object: payload.object, compiled_query: payload.compiled_query }
        : undefined;
      const data = await postJson("/api/reports/ask", { question: q, context });
      if (data.status === "needs_clarification") {
        setClarifyingQuestion(data.clarifying_question);
        setPhase("clarify");
        return;
      }
      if (data.status === "declined") {
        setDeclineReason(data.reason);
        setPhase("declined");
        return;
      }
      if (data.status === "insights") {
        setInsightsReports(Array.isArray(data.reports) ? data.reports : []);
        setInsightsTitle(data.question ?? q);
        setInsightsSummary(typeof data.summary === "string" ? data.summary : null);
        setPhase("insights");
        return;
      }
      setPayload(data as ReportPayload);
      setPhase("ready");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  function submit() {
    const q = question.trim();
    if (!q) return;
    ask(q);
  }

  function submitClarification(answer: string) {
    const combined = `${question.trim()}. ${answer.trim()}`;
    setQuestion(combined);
    ask(combined);
  }

  // Back to a blank slate. Distinct from just typing a new question into
  // the same box: while a report/insights stream is showing, that box's
  // placeholder invites REFINING it and the request carries the current
  // report as context -- fine for "only this year", wrong for someone who
  // wants to start over on something unrelated. This clears everything,
  // including that context, rather than relying on the model to notice the
  // new question "stands alone."
  function newQuestion() {
    setQuestion("");
    setPayload(null);
    setInsightsReports([]);
    setInsightsTitle("");
    setInsightsSummary(null);
    setClarifyingQuestion(null);
    setDeclineReason(null);
    setError(null);
    setPhase("idle");
  }

  async function openSaved(id: string) {
    setPhase("asking");
    setError(null);
    try {
      const res = await fetch(`/api/reports/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't open this report.");
      setQuestion(data.question ?? "");
      setPayload(data as ReportPayload);
      setPhase("ready");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  async function deleteSaved(id: string) {
    await fetch(`/api/reports/${id}`, { method: "DELETE" }).catch(() => {});
    loadSaved();
  }

  const busy = phase === "asking";
  const examples = fullPage ? EXAMPLES_FULL : EXAMPLES;

  return (
    <div style={{ ...cardStyle, padding: fullPage ? 24 : 20, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4, gap: 10 }}>
        <div style={{ fontSize: fullPage ? 17 : 15, fontWeight: 700, color: c.ink }}>Talk to data</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          {phase !== "idle" && phase !== "asking" && (
            <button
              onClick={newQuestion}
              style={{ fontSize: 11.5, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              + New question
            </button>
          )}
          <div style={{ fontSize: 11.5, color: c.muted }}>Ask a question in plain English</div>
        </div>
      </div>
      {fullPage && (
        <div style={{ fontSize: 12.5, color: c.muted, marginTop: 2, maxWidth: 620, lineHeight: 1.5 }}>
          Ask about anything you can see in BPMSquare — quotes, accounts, cases, invoices, products and more.
          Every answer is computed live from your data, and the line under each chart states exactly what was measured.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: fullPage ? 16 : 12 }}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) submit(); }}
          placeholder={phase === "ready" ? "Refine it ('only this year', 'top 5 instead') or ask something new…" : "e.g. Top 5 accounts by open quote value"}
          disabled={busy}
          style={{ flex: 1, padding: fullPage ? "13px 14px" : "10px 12px", fontSize: fullPage ? 14.5 : 13.5, borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel2, color: c.ink }}
        />
        <button
          onClick={submit}
          disabled={busy || !question.trim()}
          style={{
            padding: fullPage ? "13px 22px" : "10px 18px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none",
            background: c.accent, color: "#fff", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>

      {phase === "idle" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {examples.map((ex) => (
            <button
              key={ex}
              onClick={() => { setQuestion(ex); ask(ex); }}
              style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 999, border: `1px solid ${c.line}`, background: c.panel2, color: c.muted, cursor: "pointer" }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {phase === "clarify" && clarifyingQuestion && (
        <ClarifyBox question={clarifyingQuestion} onAnswer={submitClarification} busy={busy} />
      )}

      {phase === "declined" && declineReason && (
        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8, background: pillar.amber.bg, color: pillar.amber.fg, fontSize: 12.5 }}>
          {declineReason}
        </div>
      )}

      {phase === "error" && error && (
        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8, background: pillar.red.bg, color: pillar.red.fg, fontSize: 12.5 }}>
          {error}
        </div>
      )}

      {phase === "ready" && payload && (
        <ReportCard payload={payload} canSave={canSave} onSaved={loadSaved} style={{ marginTop: 16 }} />
      )}

      {phase === "insights" && insightsReports.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {insightsSummary && (
            <div style={{
              padding: "14px 16px", borderRadius: 10, marginBottom: 16,
              background: "color-mix(in srgb, " + pillar.blue.base + " 8%, " + c.panel2 + ")",
              border: `1px solid color-mix(in srgb, ${pillar.blue.base} 25%, transparent)`,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: pillar.blue.fg, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                ✦ Summary
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: c.ink }}>{insightsSummary}</div>
            </div>
          )}
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            The data behind it — {insightsReports.length} angle{insightsReports.length === 1 ? "" : "s"} on &ldquo;{insightsTitle}&rdquo;
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {insightsReports.map((r, i) => (
              <ReportCard key={i} payload={r} canSave={canSave} onSaved={loadSaved} />
            ))}
          </div>
        </div>
      )}

      {saved && saved.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            Saved reports
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {saved.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`, background: c.panel }}>
                <button onClick={() => openSaved(r.id)} style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", fontSize: 12.5, color: c.ink, flex: 1 }}>
                  {r.title}
                </button>
                {canSave && (
                  <button onClick={() => deleteSaved(r.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11.5, color: c.muted }}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// One chart + its own Save state -- reused for a single "ready" answer AND
// for each card in an "insights" stream, so saving one facet never touches
// the others.
function ReportCard({ payload, canSave, onSaved, style }: { payload: ReportPayload; canSave: boolean; onSaved: () => void; style?: React.CSSProperties }) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save() {
    setSaveState("saving");
    setSaveError(null);
    try {
      await postJson("/api/reports", {
        object: payload.object, question: payload.question, chart_type: payload.chart_type,
        compiled_query: payload.compiled_query, title: payload.title, interpretation: payload.interpretation,
      });
      setSaveState("saved");
      onSaved();
    } catch (e) {
      setSaveError((e as Error).message);
      setSaveState("idle");
    }
  }

  return (
    <div style={{ padding: 16, borderRadius: 10, border: `1px solid ${c.line}`, background: c.panel2, ...style }}>
      <ChartRenderer report={normalizeReport(payload)} />
      {canSave && (
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={save}
            disabled={saveState !== "idle"}
            style={{
              padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: `1px solid ${c.line}`, background: c.panel, color: c.muted,
              cursor: saveState === "idle" ? "pointer" : "default",
            }}
          >
            {saveState === "saved" ? "✓ Saved" : saveState === "saving" ? "Saving…" : "Save this report"}
          </button>
          {saveError && <span style={{ fontSize: 11.5, color: pillar.red.fg }}>{saveError}</span>}
        </div>
      )}
    </div>
  );
}

function ClarifyBox({ question, onAnswer, busy }: { question: string; onAnswer: (a: string) => void; busy: boolean }) {
  const [answer, setAnswer] = useState("");
  return (
    <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 8, background: pillar.blue.bg }}>
      <div style={{ fontSize: 12.5, color: pillar.blue.fg, fontWeight: 600, marginBottom: 8 }}>{question}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && answer.trim() && !busy) onAnswer(answer); }}
          placeholder="Your answer…"
          disabled={busy}
          style={{ flex: 1, padding: "8px 10px", fontSize: 13, borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel, color: c.ink }}
        />
        <button
          onClick={() => onAnswer(answer)}
          disabled={busy || !answer.trim()}
          style={{ padding: "8px 14px", fontSize: 12.5, fontWeight: 700, borderRadius: 6, border: "none", background: c.accent, color: "#fff", cursor: busy ? "default" : "pointer" }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
