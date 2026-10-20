"use client";

import { useState } from "react";
import { c, pillar } from "@/lib/theme";
import Button from "@/components/ui/Button";
import { PROGRESS_LABEL, PROGRESS_TONE, type AbmProgress } from "@/lib/abm/types";
import Modal from "./Modal";

type Why = {
  label: string; source: "rule" | "manual"; sentence: string; changed_on: string; changed_by: string | null;
  means: string; next: string; evidence: { text: string; on: string }[]; held: string | null; would_change_to: string | null;
};

/**
 * Progress as a pill that explains itself. Wherever Progress is shown it is
 * this button: a click opens a small dialog saying, in plain words, why the
 * system chose this status -- the rule and the events behind it with dates --
 * or, for a manual override, who set it and the reason they gave.
 */
export default function ProgressWhy({ targetId, progress }: { targetId: string; progress: AbmProgress }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState<Why | null>(null);
  const [error, setError] = useState("");
  const tone = pillar[PROGRESS_TONE[progress]];

  async function show() {
    setOpen(true);
    if (why) return;
    setError("");
    const res = await fetch(`/api/abm/targets/${targetId}/why`).catch(() => null);
    if (!res || !res.ok) { setError("Could not load the explanation."); return; }
    setWhy((await res.json()) as Why);
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        title="Why this status?"
        aria-label={`${PROGRESS_LABEL[progress]}. Why this status?`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 7, whiteSpace: "nowrap",
          background: tone.bg, color: tone.fg, border: 0, cursor: "pointer", font: "inherit", fontSize: 11,
        }}
      >
        {PROGRESS_LABEL[progress]}
        <svg width="11" height="11" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10 9v5M10 6.2v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <Modal title={`Why ${PROGRESS_LABEL[progress]}?`} onClose={() => setOpen(false)}>
          {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 13 }}>{error}</div>}
          {!why && !error && <div style={{ color: c.muted, fontSize: 13 }}>Loading…</div>}
          {why && (
            <div style={{ fontSize: 13.5, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: c.hint, fontWeight: 700 }}>{why.source === "manual" ? "Set by a person" : "Set by rule"}</div>
                <div style={{ marginTop: 3 }}>{why.sentence}</div>
                {why.source === "manual" && why.changed_by && <div style={{ color: c.muted, fontSize: 12.5, marginTop: 2 }}>By {why.changed_by}, {why.changed_on}</div>}
              </div>
              <div style={{ color: c.muted }}>{why.means}</div>
              {why.evidence.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: c.hint, fontWeight: 700 }}>What happened</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {why.evidence.map((e, i) => <li key={i}>{e.text}</li>)}
                  </ul>
                </div>
              )}
              {why.held && <div style={{ background: pillar.amber.bg, color: pillar.amber.fg, borderRadius: 8, padding: "8px 10px" }}>{why.held}.</div>}
              {why.would_change_to && <div style={{ color: c.muted }}>Checking progress now would move this to {why.would_change_to}.</div>}
              <div>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: c.hint, fontWeight: 700 }}>What moves it next</div>
                <div style={{ marginTop: 3, color: c.muted }}>{why.next}</div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><Button onClick={() => setOpen(false)} autoFocus>Close</Button></div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
