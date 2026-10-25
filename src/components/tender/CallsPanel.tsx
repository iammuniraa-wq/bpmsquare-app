"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import SettingsSection from "@/components/settings/SettingsSection";
import { CALL_KIND_LABEL, CALL_LIMITS, isOverdue, type CallsData, type CallView } from "@/lib/tender/calls";
import { LogCallButton } from "./LogCall";

// The calls, meetings and site visits logged on a tender deal, newest first, on the deal's Activity tab beside the change history.
// Text is shown as text (never HTML). A next step shows its due date and turns red once past; "Done" ticks it off.

const fmtStamp = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDay = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function CallsPanel({ opportunityId, data, todayKey, initialShowAll = false }: {
  opportunityId: string;
  data: CallsData;
  todayKey: string;
  initialShowAll?: boolean;
}) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(initialShowAll);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const shown = showAll ? data.calls : data.calls.slice(0, CALL_LIMITS.shown);

  async function call(id: string, init: RequestInit, failure: string) {
    setError(""); setBusy(id);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/tender/calls/${id}`, { ...init, headers: { "Content-Type": "application/json" } });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? failure); return; }
      setAsking(null);
      router.refresh();
    } finally { setBusy(null); }
  }

  const summary = data.pending ? "Needs a database update" : data.calls.length === 0 ? "Nothing logged yet" : `${data.calls.length} logged · latest ${fmtStamp(data.calls[0].occurred_at)}`;

  return (
    <SettingsSection id="tender.calls" title="Calls and visits" summary={summary} defaultOpen>
      <div data-guide="tender.calls" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.pending && <div role="alert" data-guide="tender.calls.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Logged calls need a database update (migration 0225). Ask your administrator to apply it.</div>}
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        {data.canEdit && !data.pending && <div><LogCallButton opportunityId={opportunityId} variant="primary" /></div>}
        {!data.pending && data.calls.length === 0 && <div style={{ fontSize: 13, color: c.hint }}>No calls logged yet. Log one after you speak to the client or consultant.</div>}
        {shown.map((k: CallView) => {
          const late = isOverdue(k, todayKey);
          const done = !!k.next_step_done_at;
          return (
            <div key={k.id} data-guide="tender.call.row" style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "9px 12px", fontSize: 13 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline", color: c.hint, fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: c.ink }}>{CALL_KIND_LABEL[k.kind]}</span>
                {k.with_whom && <span>with {k.with_whom}</span>}
                <span style={{ marginLeft: "auto" }}>{[k.logged_by_name, fmtStamp(k.occurred_at)].filter(Boolean).join(" · ")}</span>
              </div>
              <div style={{ marginTop: 4, color: c.ink, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{k.summary}</div>
              {k.outcome && <div style={{ marginTop: 3, color: c.muted, wordBreak: "break-word" }}>Outcome: {k.outcome}</div>}
              {k.next_step && (
                <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ color: c.ink, wordBreak: "break-word" }}>Next: {k.next_step}</span>
                  {k.next_step_due && (
                    <span style={{ fontSize: 11.5, fontWeight: 600, padding: "1px 8px", borderRadius: 999, color: done ? "var(--greenink)" : late ? "var(--redink)" : "var(--amberink)", background: done ? "var(--greenbg)" : late ? "var(--redbg)" : "var(--amberbg)" }}>
                      {done ? "Done" : late ? `Overdue since ${fmtDay(k.next_step_due)}` : `Due ${fmtDay(k.next_step_due)}`}
                    </span>
                  )}
                  {data.canEdit && (
                    <Button size="sm" variant="quiet" loading={busy === k.id} data-guide="tender.call.done" style={{ minHeight: 44 }}
                      onClick={() => call(k.id, { method: "PATCH", body: JSON.stringify({ next_step_done: !done }) }, "Could not update the next step")}>
                      {done ? "Reopen" : "Mark done"}
                    </Button>
                  )}
                </div>
              )}
              {data.canEdit && k.can_change && (
                <div style={{ marginTop: 4 }}>
                  {asking === k.id ? (
                    <span role="alertdialog" aria-label="Remove this entry" style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, color: "var(--amberink)" }}>
                      Remove this entry?
                      <Button size="sm" variant="danger" loading={busy === k.id} data-guide="tender.call.remove_yes" style={{ minHeight: 44 }} onClick={() => call(k.id, { method: "DELETE" }, "Could not remove")}>Remove</Button>
                      <Button size="sm" variant="secondary" style={{ minHeight: 44 }} onClick={() => setAsking(null)}>Keep</Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="quiet" data-guide="tender.call.remove" style={{ minHeight: 44 }} onClick={() => setAsking(k.id)}>Remove</Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!showAll && data.calls.length > CALL_LIMITS.shown && (
          <div><Button variant="quiet" size="sm" data-guide="tender.calls.show_all" style={{ minHeight: 44 }} onClick={() => setShowAll(true)}>Show all {data.calls.length}</Button></div>
        )}
      </div>
    </SettingsSection>
  );
}
