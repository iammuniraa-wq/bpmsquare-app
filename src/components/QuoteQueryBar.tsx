"use client";

import { useState } from "react";
import type { QuoteToken } from "@/lib/quoteQuery";

/**
 * Nova — the query bar (fourth slice of the Quotations redesign, owner
 * discussion 2026-08-31). See lib/quoteQuery.ts for what it can and can't
 * parse, and why it's a deterministic fast-path rather than an LLM call.
 *
 * Shared across List, Lanes, Field and (eventually) Flow board -- lives
 * above the view switcher in FlowBoardSlot, not inside any one view, per
 * the design's core rule: "filtering is not a property of a view; it
 * belongs to the page."
 */
export default function QuoteQueryBar({
  tokens, leftover, matchingCount, totalCount, onCommit, onRemoveToken, right,
}: {
  tokens: QuoteToken[];
  leftover: string;
  matchingCount: number;
  totalCount: number;
  onCommit: (text: string) => void;
  onRemoveToken: (index: number) => void;
  /** Rendered inline with the count strip -- FlowBoardSlot's view switcher
   *  lives here instead of its own row, so the query bar's count line and
   *  the switcher share one row of vertical space, not two. */
  right?: React.ReactNode;
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
            onCommit(draft);
            setDraft("");
          }}
          placeholder="Ask for what you want — e.g. drafts over ₹75,000 that haven't moved in a fortnight"
          style={{
            flex: 1, border: "none", outline: "none", background: "transparent",
            fontSize: 15, color: "var(--nova-ink)", fontFamily: "var(--nova-font-body)",
          }}
        />
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
            {tokens.length > 0 ? `of ${totalCount} quotes` : "quotes"}
          </span>
        </div>
        {right}
      </div>
    </div>
  );
}
