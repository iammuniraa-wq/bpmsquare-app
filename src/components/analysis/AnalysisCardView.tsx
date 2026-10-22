"use client";

import { useState } from "react";
import { c, statusInk } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import InfoTip from "@/components/ui/InfoTip";
import { STAGE_LABEL } from "@/lib/signals/types";
import { FIT_TEXT, FOLLOW_UP_TEXT, type FollowUp } from "@/lib/analysis/types";
import { ANALYSIS_EMPTY, ANALYSIS_TIPS } from "@/lib/analysis/tips";
import type { DockAnalysis } from "@/lib/assistant/analysisTool";

// The company analysis card as the dock draws it (docs/design/account-analysis.md, owner corrections 2026-10-22 evening):
// a verdict, what they are doing, what we have in our system, next steps. Nothing else; no sources, no profile. Every
// string below arrives as a field and is drawn as a React text node, so a word from the web can never become markup, and
// the only links are internal paths handed to onOpen (the dock checks them again). Pure view: it decides nothing.

const DAY = 86_400_000;

export function refreshedText(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / 3_600_000)} h ago`;
  const days = Math.floor(ms / DAY);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

const TONE: Record<FollowUp, string> = { yes: statusInk.good, not_now: statusInk.warn, unclear: c.muted };

const chip: React.CSSProperties = {
  background: "var(--accentbg)", border: "1px solid var(--line)", borderRadius: 999, padding: "6px 12px",
  fontSize: 11.5, fontWeight: 650, color: c.accent, cursor: "pointer", fontFamily: "inherit",
};
const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 };
const section: React.CSSProperties = { padding: "10px 12px", borderTop: `1px solid ${c.line}`, display: "flex", flexDirection: "column", gap: 6 };
const plainBtn: React.CSSProperties = { background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: "inherit" };

type Row = { text: string; href?: string; gap?: boolean };
const ROWS_SHOWN = 6;

function systemRows(s: DockAnalysis["card"]["inSystem"]): Row[] {
  const rows: Row[] = [];
  if (s.account.length) rows.push({ text: s.account.map((l) => l.text).join(" · ") });
  for (const k of s.contacts) rows.push({ text: `${k.name}${k.title ? ` · ${k.title}` : k.role ? ` · ${k.role}` : ""}`, href: k.href });
  for (const l of [...s.openQuotes, ...s.openCases, ...s.invoicesDue]) rows.push({ text: l.text, href: l.href });
  if (s.lastActivity) rows.push({ text: `Last: ${s.lastActivity.text}${s.lastActivity.date ? ` · ${s.lastActivity.date.slice(0, 10)}` : ""}`, href: s.lastActivity.href });
  for (const m of s.missing) rows.push({ text: m, gap: true });
  return rows;
}

export default function AnalysisCardView({ data, busy = false, now = new Date(), onOpen, onRefresh, onAsk }: {
  data: DockAnalysis;
  busy?: boolean;
  now?: Date;
  onOpen: (href: string) => void;
  onRefresh: () => void;
  onAsk: (question: string) => void;
}) {
  const [why, setWhy] = useState(false);
  const [all, setAll] = useState(false);
  const card = data.card;
  const v = card.verdict;
  const s = card.inSystem;
  const timing = v.timing.from === "web_only"
    ? "from public news only"
    : `${STAGE_LABEL[v.timing.stage]}${v.timing.score !== null ? ` (${v.timing.score})` : ""}`;
  const rows = systemRows(s);
  // What is missing is the point of the block: it is never folded away behind "Show all".
  const facts = rows.filter((r) => !r.gap);
  const shown = [...(all ? facts : facts.slice(0, ROWS_SHOWN)), ...rows.filter((r) => r.gap)];
  const empty = card.notes.find((n) => n === ANALYSIS_EMPTY.needsWeb || n === ANALYSIS_EMPTY.littleInfo) ?? ANALYSIS_EMPTY.littleInfo;
  const extra = card.notes.filter((n) => n !== ANALYSIS_EMPTY.needsWeb && n !== ANALYSIS_EMPTY.littleInfo);
  const factors = v.factors.filter((f) => f.points !== 0);
  const steps: { id: string; label: string; run: () => void }[] = [];
  if (s.inCrm && card.accountId) steps.push({ id: "open", label: "Open account", run: () => onOpen(ROUTES.account(card.accountId!)) });
  if (!s.inCrm) steps.push({ id: "create", label: "Create account", run: () => onOpen(ROUTES.accountNew) });
  if (s.inCrm) steps.push({ id: "who", label: "Who should I talk to?", run: () => onAsk(`Who should I talk to at ${card.name}? Answer only from the analysis.`) });
  for (const n of card.nextSteps) steps.push({ id: n.id, label: n.label, run: () => onAsk(n.label) });

  return (
    <section aria-label={`Company analysis: ${card.name}`} style={{ border: `1px solid ${c.line}`, borderRadius: "var(--card-radius, 10px)", background: "var(--card-bg, #fff)", overflow: "hidden", fontSize: 12.5, lineHeight: 1.4 }}>
      <div style={{ padding: "10px 12px", display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 180px", minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: c.ink, overflowWrap: "anywhere" }}>{card.name}</div>
          {card.identity && <div style={{ fontSize: 11.5, color: c.muted, overflowWrap: "anywhere" }}>{card.identity}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: c.hint }}>{data.cached ? "Saved" : "Refreshed"} {refreshedText(card.refreshedAt, now)}</span>
          <button type="button" className="bms-dock-chip" style={chip} disabled={busy} onClick={onRefresh}>Refresh</button>
        </div>
      </div>

      {data.notice && <div role="status" style={{ padding: "0 12px 8px", fontSize: 12, color: statusInk.warn }}>{data.notice}</div>}

      <div style={section}>
        <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ color: c.ink }}>Worth following up:</span>
          <strong style={{ color: TONE[v.followUp], fontSize: 14 }}>{FOLLOW_UP_TEXT[v.followUp]}</strong>
        </div>
        <div style={{ color: c.ink, overflowWrap: "anywhere" }}>{v.sentence.text}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button type="button" className="bms-dock-row" aria-expanded={why} onClick={() => setWhy((x) => !x)} style={{ ...plainBtn, fontSize: 12, color: c.muted }}>
            Fit: {FIT_TEXT[v.fit]} · Timing: {timing} {why ? "▴" : "▾"}
          </button>
          <InfoTip label="fit and timing">{ANALYSIS_TIPS.verdict}</InfoTip>
        </div>
        {why && (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
            {factors.length === 0 && <li style={{ fontSize: 12, color: c.hint }}>Nothing counts for or against yet.</li>}
            {factors.slice(0, 8).map((f, i) => (
              <li key={i} style={{ fontSize: 12, color: c.ink, overflowWrap: "anywhere" }}>
                <span style={{ color: f.points > 0 ? statusInk.good : statusInk.bad, fontWeight: 700 }}>{f.points > 0 ? `+${f.points}` : f.points}</span>{" "}
                <span style={{ fontWeight: 650 }}>{f.label}</span>
                {f.detail && f.group !== "moving" ? <span style={{ color: c.muted }}>{` · ${f.detail}`}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={section}>
        <div style={label}>What they are doing</div>
        {card.doing.length === 0 ? (
          <div style={{ color: c.muted }}>{empty}</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
            {card.doing.map((h, i) => (
              <li key={i} style={{ overflowWrap: "anywhere", color: h.stale ? c.muted : c.ink }}>
                {h.text}
                {h.when ? <span style={{ color: c.hint }}>{` · ${h.when}${h.stale ? ", older" : ""}`}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={section}>
        <div style={label}>What we have in our system</div>
        {!s.inCrm ? (
          <>
            <div style={{ fontWeight: 650, color: c.ink }}>{ANALYSIS_EMPTY.notInSystem}</div>
            {s.similar.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: c.muted }}>Similar accounts</div>
                {s.similar.map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                    <span style={{ overflowWrap: "anywhere", color: c.ink }}>{a.name}</span>
                    <button type="button" className="bms-dock-chip" style={{ ...chip, flexShrink: 0 }} onClick={() => onOpen(a.href)}>Open</button>
                  </div>
                ))}
              </>
            )}
          </>
        ) : rows.length === 0 ? (
          <div style={{ color: c.muted }}>An account, with nothing else recorded yet.</div>
        ) : (
          <>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
              {shown.map((r, i) => (
                <li key={i} style={{ overflowWrap: "anywhere", color: r.gap ? statusInk.warn : c.ink }}>
                  {r.href ? (
                    <button type="button" className="bms-dock-row" onClick={() => onOpen(r.href!)} style={{ ...plainBtn, color: c.accent, fontWeight: 600 }}>{r.text} →</button>
                  ) : r.text}
                </li>
              ))}
            </ul>
            {facts.length > ROWS_SHOWN && (
              <button type="button" className="bms-dock-chip" style={{ ...chip, alignSelf: "flex-start" }} onClick={() => setAll((x) => !x)}>
                {all ? "Show fewer" : `Show all ${facts.length}`}
              </button>
            )}
          </>
        )}
      </div>

      {steps.length > 0 && (
        <div style={section}>
          <div style={label}>Next steps</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {steps.map((st) => (
              <button key={st.id} type="button" className="bms-dock-chip" style={chip} disabled={busy} onClick={st.run}>{st.label}</button>
            ))}
          </div>
        </div>
      )}

      {extra.length > 0 && <div style={{ padding: "0 12px 10px", fontSize: 11.5, color: c.hint }}>{extra.join(" · ")}</div>}
    </section>
  );
}
