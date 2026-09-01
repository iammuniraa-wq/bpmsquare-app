"use client";

import { useState } from "react";

/**
 * Nova — the query bar. Originally built as QuoteQueryBar for the
 * Quotations redesign (owner discussion 2026-08-31); genericized when the
 * same "ask, don't filter" treatment was ported to Cases (2026-09-01) so
 * the second object reuses this component instead of forking a near-copy.
 * It only ever renders a token's `.label` and reports counts/placeholder
 * text via props -- no object-specific knowledge lives here. See
 * lib/quoteQuery.ts / lib/caseQuery.ts for what each object's parser can
 * and can't parse, and why each is a deterministic fast-path rather than
 * an LLM call.
 *
 * Lives above the view switcher in the object's *BoardSlot wrapper, not
 * inside any one view, per the design's core rule: "filtering is not a
 * property of a view; it belongs to the page."
 *
 * `onAskAI` (owner request 2026-09-01, Quotations only for now) is a
 * second, opt-in tier on top of the deterministic parser, not a
 * replacement for it: the token parser stays the instant path for a
 * recognised phrase, and this button/shortcut hands the FULL typed text
 * to a real AI analysis call for whatever the parser's small vocabulary
 * can't express. Omitted entirely (e.g. Cases today) means this bar
 * behaves exactly as it always has.
 */
export default function NovaQueryBar<Token extends { label: string }>({
  tokens, leftover, matchingCount, totalCount, onCommit, onRemoveToken, right, placeholder, noun, onAskAI, aiBusy,
}: {
  tokens: Token[];
  leftover: string;
  matchingCount: number;
  totalCount: number;
  onCommit: (text: string) => void;
  onRemoveToken: (index: number) => void;
  /** Rendered inline with the count strip -- the object's view switcher
   *  lives here instead of its own row, so the query bar's count line and
   *  the switcher share one row of vertical space, not two. */
  right?: React.ReactNode;
  placeholder: string;
  /** Plural noun for the count strip, e.g. "quotes" / "cases". */
  noun: string;
  /** Opt-in only -- omit to keep this bar exactly the deterministic
   *  filter-token parser (e.g. Cases today). When provided, a sparkle
   *  button (and Cmd/Ctrl+Enter) sends the CURRENT typed text to a real
   *  AI analysis call instead of/alongside the token parser -- see
   *  FlowBoardSlot.tsx, the only caller that currently passes this. */
  onAskAI?: (text: string) => void;
  aiBusy?: boolean;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        border: "1px solid var(--nova-line)", borderRadius: 12,
        background: "var(--nova-glass-bg)", padding: "9px 14px",
      }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !draft.trim()) return;
            if (onAskAI && (e.metaKey || e.ctrlKey)) { onAskAI(draft); return; }
            onCommit(draft);
            setDraft("");
          }}
          placeholder={placeholder}
          style={{
            flex: 1, border: "none", outline: "none", background: "transparent",
            fontSize: 15, color: "var(--nova-ink)", fontFamily: "var(--nova-font-body)",
          }}
        />
        {onAskAI && (
          <button
            type="button"
            disabled={!draft.trim() || aiBusy}
            onClick={() => onAskAI(draft)}
            title="Ask AI to actually analyse this against the real data (⌘/Ctrl + ⏎)"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              fontFamily: "var(--nova-font-body)", fontSize: 11.5, fontWeight: 600,
              color: draft.trim() && !aiBusy ? "#F6C87E" : "var(--nova-ink-faint)",
              background: "rgba(240,169,59,.10)", border: "1px solid rgba(240,169,59,.28)",
              borderRadius: 7, padding: "5px 10px", cursor: draft.trim() && !aiBusy ? "pointer" : "not-allowed",
              whiteSpace: "nowrap",
            }}
          >
            ✨ {aiBusy ? "Thinking…" : "Ask AI"}
          </button>
        )}
        <span style={{ fontFamily: "var(--nova-font-body)", fontSize: 10.5, color: "var(--nova-ink-faint)", border: "1px solid var(--nova-line)", borderRadius: 5, padding: "2px 7px" }}>
          ⏎
        </span>
      </div>

      {(tokens.length > 0 || leftover) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {tokens.map((t, i) => (
            <span
              key={i}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                background: "rgba(240,169,59,.12)", border: "1px solid rgba(240,169,59,.34)",
                color: "#F6C87E", borderRadius: 7, padding: "4px 9px",
                fontFamily: "var(--nova-font-body)", fontSize: 11.5,
              }}
            >
              {t.label}
              <button
                type="button"
                onClick={() => onRemoveToken(i)}
                aria-label={`Remove ${t.label}`}
                style={{ border: "none", background: "none", color: "rgba(240,169,59,.6)", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}
              >
                ✕
              </button>
            </span>
          ))}
          {leftover && (
            <span
              title="This part of the query wasn't recognised and has no effect on what's shown."
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                border: "1px dashed var(--nova-line)", color: "var(--nova-ink-faint)",
                borderRadius: 7, padding: "4px 9px", fontFamily: "var(--nova-font-body)", fontSize: 11.5,
              }}
            >
              Couldn&apos;t read: &ldquo;{leftover}&rdquo;
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, marginTop: 10, paddingBottom: 10, borderBottom: "1px solid var(--nova-line-soft)" }}>
        <div>
          <span style={{ fontFamily: "var(--nova-font-display)", fontSize: 18, fontWeight: 700, color: "var(--nova-ink)", letterSpacing: "-.01em" }}>
            {matchingCount}
          </span>
          <span style={{ fontFamily: "var(--nova-font-body)", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--nova-ink-faint)", marginLeft: 7 }}>
            {tokens.length > 0 ? `of ${totalCount} ${noun}` : noun}
          </span>
        </div>
        {right}
      </div>
    </div>
  );
}
