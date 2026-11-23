"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { Banner } from "./siteUi";

type Line = { line_key: string; description: string };

/**
 * Approve, return or cancel an expense. Approve may set the cost line when the person was not sure, and asks for the amount in the project
 * currency when the expense was in another one. Return and cancel ask for a reason. Every button only asks the route: the route decides who may.
 * `compact` is the row version in a list: Approve and Return only.
 */
export default function ExpenseActions({ id, status, canDecide, canCancel, projectCurrency, currency, hasLine, lines, compact }: {
  id: string; status: string; canDecide: boolean; canCancel: boolean; projectCurrency: string | null; currency: string; hasLine: boolean; lines?: Line[]; compact?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "return" | "cancel">(null);
  const [reason, setReason] = useState("");
  const [line, setLine] = useState("");
  const [inProject, setInProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const foreign = !!projectCurrency && currency !== projectCurrency;

  async function call(path: string, body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/site-expenses/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "That did not work"); return; }
      setMode(null); setReason("");
      router.refresh();
    } finally { setBusy(false); }
  }

  const approvable = status === "submitted" && canDecide;
  const cancellable = !compact && canCancel && status !== "cancelled";
  if (!approvable && !cancellable) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }} className="bpm-tap">
      {approvable && mode === null && (
        <>
          {!compact && !hasLine && lines && lines.length > 0 && (
            <select className="bpm-input" value={line} onChange={(e) => setLine(e.target.value)} aria-label="Cost line">
              <option value="">Cost line: not chosen</option>
              {lines.map((l) => <option key={l.line_key} value={l.line_key}>{l.description}</option>)}
            </select>
          )}
          {foreign && !compact && (
            <input className="bpm-input" inputMode="decimal" value={inProject} onChange={(e) => setInProject(e.target.value)} placeholder={`Amount in ${projectCurrency}`} aria-label={`Amount in ${projectCurrency}`} />
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" disabled={busy} data-guide="site.expense.approve"
              onClick={() => call("approve", { ...(line ? { line_key: line } : {}), ...(inProject ? { amount_project_ccy: inProject } : {}) })}>Approve</button>
            <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" disabled={busy} onClick={() => setMode("return")}>Return</button>
          </div>
        </>
      )}
      {mode !== null && (
        <>
          <textarea className="bpm-input" rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} aria-label="Reason" placeholder={mode === "return" ? "Why are you returning it?" : "Why is it cancelled?"} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" disabled={busy || reason.trim().length < 3} onClick={() => call(mode === "return" ? "reject" : "cancel", { reason })}>{mode === "return" ? "Return it" : "Cancel the expense"}</button>
            <button type="button" className="bpm-btn bpm-btn-quiet bpm-btn-md" onClick={() => { setMode(null); setReason(""); setError(null); }}>Back</button>
          </div>
        </>
      )}
      {cancellable && mode === null && <button type="button" className="bpm-btn bpm-btn-quiet bpm-btn-md" style={{ alignSelf: "flex-start", color: c.muted }} onClick={() => setMode("cancel")}>Cancel this expense</button>}
      {error && <Banner tone="bad">{error}</Banner>}
    </div>
  );
}
