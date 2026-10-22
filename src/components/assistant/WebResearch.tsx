"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import { ASSISTANT_TIPS } from "@/lib/assistant/tips";
import type { ConsentState, WebChoice } from "@/lib/assistant/webConsent";

// The dock's three web-research states, built from the two shapes the dock already has: the chip (a pill button) and the
// bordered card. Nothing here searches or decides anything; the dock sends the person's choice and the server acts on it.

const chip: React.CSSProperties = {
  background: "var(--accentbg)", border: "1px solid var(--line)", borderRadius: 999, padding: "6px 12px",
  fontSize: 11.5, fontWeight: 650, color: c.accent, cursor: "pointer", fontFamily: "inherit",
};
const card: React.CSSProperties = {
  border: `1px solid ${c.line}`, borderRadius: "var(--card-radius, 10px)", background: "var(--card-bg, #fff)", padding: "10px 12px",
  display: "flex", flexDirection: "column", gap: 8,
};
const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 4 };

const SETTLED: Record<Exclude<ConsentState, "pending">, string> = {
  yes: "Searched the web for this",
  no: "Not searched",
  skipped: "Not searched",
};

/** "Search the web?" with Yes / No. Once answered it shrinks to one muted line. */
export function WebConsentRow({ query, state, disabled, onChoice }: {
  query: string;
  state: ConsentState;
  disabled?: boolean;
  onChoice: (choice: WebChoice) => void;
}) {
  if (state !== "pending") {
    return <div style={{ fontSize: 11.5, color: c.hint }}>{SETTLED[state]}</div>;
  }
  return (
    <div style={card} role="group" aria-label="Search the web?">
      <div style={label}>Search the web? <InfoTip label="web search">{ASSISTANT_TIPS.webConsent}</InfoTip></div>
      <div style={{ fontSize: 12.5, color: c.ink, lineHeight: 1.4, overflowWrap: "anywhere" }}>&ldquo;{query}&rdquo;</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <button className="bms-dock-chip" style={chip} disabled={disabled} onClick={() => onChoice("yes")}>Yes</button>
        <button className="bms-dock-chip" style={chip} disabled={disabled} onClick={() => onChoice("no")}>No</button>
      </div>
    </div>
  );
}

const ANALYSIS_SETTLED: Record<Exclude<ConsentState, "pending">, string> = {
  yes: "Analysed with web research",
  no: "Not analysed",
  skipped: "Not analysed",
};

/**
 * The same question for a company analysis: Yes / No only. It carries no "i" (the dock keeps at most three) because the
 * line says what happens. Once answered it shrinks to one muted line.
 */
export function AnalysisConsentRow({ subject, state, disabled, onChoice }: {
  subject: string;
  state: ConsentState;
  disabled?: boolean;
  onChoice: (choice: WebChoice) => void;
}) {
  if (state !== "pending") return <div style={{ fontSize: 11.5, color: c.hint }}>{ANALYSIS_SETTLED[state]}</div>;
  return (
    <div style={card} role="group" aria-label="Analyse with web research?">
      <div style={label}>Analyse with web research?</div>
      <div style={{ fontSize: 12.5, color: c.ink, lineHeight: 1.4, overflowWrap: "anywhere" }}>{subject}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <button className="bms-dock-chip" style={chip} disabled={disabled} onClick={() => onChoice("yes")}>Yes</button>
        <button className="bms-dock-chip" style={chip} disabled={disabled} onClick={() => onChoice("no")}>No</button>
      </div>
    </div>
  );
}

export type CreateDetailsState = "pending" | "manual" | "web" | "skipped";
export type CreateDetailsMode = "manual" | "web";

const DETAILS_SETTLED: Record<Exclude<CreateDetailsState, "pending">, string> = {
  manual: "You will give the details",
  web: "Looking it up on the web",
  skipped: "Not answered",
};

/**
 * The one question under "Create an account <name>": two chips, no free text. Both are requests of their own that the
 * server answers without a model. It carries no "i" (the dock keeps at most three): the two labels say what happens.
 * Once answered it shrinks to one muted line.
 */
export function CreateDetailsRow({ state, disabled, onChoice }: {
  state: CreateDetailsState;
  disabled?: boolean;
  onChoice: (mode: CreateDetailsMode) => void;
}) {
  if (state !== "pending") return <div style={{ fontSize: 11.5, color: c.hint }}>{DETAILS_SETTLED[state]}</div>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} role="group" aria-label="How to fill in the details">
      <button className="bms-dock-chip" style={chip} disabled={disabled} onClick={() => onChoice("manual")}>I&apos;ll give the details</button>
      <button className="bms-dock-chip" style={chip} disabled={disabled} onClick={() => onChoice("web")}>Look it up on the web</button>
    </div>
  );
}

const SHOWN = 3;

/** The "From the web" label and the sources an answer used, numbered to match the [n] markers in its text. */
export function WebSources({ sources }: { sources: { title: string; url: string }[] }) {
  const [all, setAll] = useState(false);
  if (sources.length === 0) return null;
  const rows = all ? sources : sources.slice(0, SHOWN);
  return (
    <div style={card}>
      <div style={label}>From the web</div>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((s, i) => (
          <li key={s.url} style={{ fontSize: 12, lineHeight: 1.4, overflowWrap: "anywhere" }}>
            <span style={{ color: c.hint }}>{`[${i + 1}] `}</span>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="bms-dock-row" style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
              {s.title} &#8599;
            </a>
          </li>
        ))}
      </ol>
      {sources.length > SHOWN && (
        <button className="bms-dock-chip" style={{ ...chip, alignSelf: "flex-start" }} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${sources.length}`}
        </button>
      )}
    </div>
  );
}
