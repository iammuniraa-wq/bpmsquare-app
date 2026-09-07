"use client";

import { useState } from "react";
import { c, sh } from "@/lib/theme";
import type { FenceGateInput } from "@/lib/fence/geometry";
import type { FenceDraftValues } from "./FenceConfigurator";

const GATE_TYPE_LABEL: Record<FenceGateInput["type"], string> = {
  single_swing: "Single swing",
  double_swing: "Double swing",
  sliding: "Sliding",
};

interface DraftResult {
  name: string | null;
  layout: "open_run" | "closed_perimeter" | null;
  totalLength: number | null;
  securityProfileId: string | null;
  securityProfileLabel: string | null;
  gates: { type: FenceGateInput["type"]; width_m: number }[];
  documentNotes: string[];
  unmatchedProfileText: string | null;
}

// AI-drafted intake (concept differentiator #1,
// docs/fence-configurator-architecture.md §0/§14b): paste the client's
// email, Nova proposes a starting configuration instead of a rep typing
// four lengths by hand. Review-before-use, same as NovaDraft.tsx's
// pattern elsewhere in the app -- nothing is created until "Open
// configurator" is pressed, and the rep can always start blank instead.
export default function FenceIntake({
  profileLabels,
  onDrafted,
  onSkip,
}: {
  profileLabels: Record<string, string>;
  onDrafted: (draft: FenceDraftValues) => void;
  onSkip: () => void;
}) {
  const [text, setText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [error, setError] = useState("");

  async function handleDraft() {
    if (!text.trim()) return;
    setError("");
    setDrafting(true);
    setResult(null);
    const res = await fetch("/api/fence-projects/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const json = await res.json();
    setDrafting(false);
    if (!res.ok) { setError(json.error ?? "Could not draft a configuration from this text"); return; }
    setResult({ ...json, securityProfileLabel: json.securityProfileId ? profileLabels[json.securityProfileId] ?? null : null });
  }

  function handleUseDraft() {
    if (!result) return;
    onDrafted({
      name: result.name,
      layout: result.layout,
      totalLength: result.totalLength,
      securityProfileId: result.securityProfileId,
      gates: result.gates,
    });
  }

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: c.panel2, color: c.ink, fontFamily: "inherit" }}>
      <div style={{ flex: "none", height: 48, display: "flex", alignItems: "center", gap: 14, padding: "0 16px", background: c.panel, borderBottom: `1px solid ${c.line}` }}>
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>New fence project</span>
        <button onClick={onSkip} style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", color: c.muted, fontSize: 12.5, fontWeight: 600 }}>
          Skip — start blank →
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "32px 24px", display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 880 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px" }}>Configure a fence without typing a single length</h1>
          <p style={{ fontSize: 13, color: c.muted, margin: "0 0 24px", maxWidth: "62ch" }}>
            Paste the client's email or message as-is. Nova reads it the same way it reads any pasted intake across BPMSquare — no separate tool, no re-typing into a spec sheet.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
            <div style={{ background: c.panel, border: `1px solid ${c.line}`, borderRadius: 12, boxShadow: sh.card, padding: 4 }}>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'Paste the email here, e.g.:\n\n"We need to fence the full perimeter of our new yard in Al Rayyan — roughly 500 metres around, it\'s a bonded warehouse so it needs high security. Two vehicle gates: a 6m double-swing at the main entrance and a 4m double-swing at the loading side."'}
                rows={14}
                style={{ width: "100%", border: "none", background: "none", color: c.ink, fontSize: 13, padding: 14, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ background: c.panel, border: `1px solid ${c.line}`, borderRadius: 12, boxShadow: sh.card, padding: 18, minHeight: 340, display: "flex", flexDirection: "column" }}>
              {!result && !drafting && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 14, color: c.muted }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: c.accentbg, display: "flex", alignItems: "center", justifyContent: "center", color: c.accent, fontSize: 19 }}>✦</div>
                  <div style={{ fontSize: 13 }}>Nothing drafted yet. Paste a message, then let Nova propose a starting configuration.</div>
                  <button
                    onClick={handleDraft}
                    disabled={!text.trim()}
                    style={{ border: "none", borderRadius: 8, padding: "10px 18px", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: text.trim() ? "pointer" : "default", opacity: text.trim() ? 1 : 0.5 }}
                  >
                    ✦ Draft with Nova
                  </button>
                  {error && <div style={{ color: "#c2402f", fontSize: 12 }}>{error}</div>}
                </div>
              )}

              {drafting && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: c.accent, fontFamily: "monospace", fontSize: 12.5 }}>
                  Reading the message…
                </div>
              )}

              {result && !drafting && (
                <>
                  <div style={{ fontSize: 12, color: c.muted, marginBottom: 6 }}>Drafted configuration</div>
                  <DraftField label="Layout" value={result.layout === "closed_perimeter" ? "Closed perimeter" : result.layout === "open_run" ? "Open run" : "—"} tag={result.layout ? "from message" : undefined} />
                  <DraftField label="Total length" value={result.totalLength ? `≈ ${result.totalLength} m` : "—"} tag={result.totalLength ? "estimated" : undefined} />
                  <DraftField
                    label="Protecting"
                    value={result.securityProfileLabel ?? (result.unmatchedProfileText ? `"${result.unmatchedProfileText}" (no match — pick manually)` : "—")}
                    tag={result.securityProfileLabel ? "from message" : undefined}
                  />
                  {result.gates.map((g, i) => (
                    <DraftField key={i} label={`Gate ${i + 1}`} value={`${GATE_TYPE_LABEL[g.type]}, ${g.width_m} m`} tag="from message" />
                  ))}
                  {result.documentNotes.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 11, color: c.amber }}>
                      {result.documentNotes.map((n, i) => <div key={i}>⚠ {n}</div>)}
                    </div>
                  )}
                  <div style={{ flex: 1 }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                    <button onClick={() => setResult(null)} style={{ border: `1px solid ${c.line}`, background: "none", borderRadius: 8, padding: "9px 14px", fontSize: 12.5, fontWeight: 600, color: c.muted, cursor: "pointer" }}>
                      Try again
                    </button>
                    <button onClick={handleUseDraft} style={{ flex: 1, border: "none", borderRadius: 8, padding: "9px 14px", background: c.accent, color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                      Looks right — open configurator →
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DraftField({ label, value, tag }: { label: string; value: string; tag?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderTop: `1px solid ${c.line}` }}>
      <span style={{ fontSize: 12, color: c.muted }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right" }}>
        {value}
        {tag && (
          <span style={{ display: "inline-flex", marginLeft: 7, fontFamily: "monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.3, color: c.accent, background: c.accentbg, padding: "2px 5px", borderRadius: 4 }}>
            ✦ {tag}
          </span>
        )}
      </span>
    </div>
  );
}
