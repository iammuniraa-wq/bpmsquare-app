"use client";

import Link from "next/link";
import type { NovaStreamItem } from "@/lib/nova/stream";

const ACCENT: Record<NovaStreamItem["accent"], { color: string; bg: string }> = {
  orange: { color: "var(--nova-orange-soft)", bg: "var(--nova-orange-bg)" },
  pink:   { color: "var(--nova-pink-soft)",   bg: "var(--nova-pink-bg)" },
  purple: { color: "var(--nova-purple-softer)", bg: "var(--nova-purple-bg)" },
  teal:   { color: "var(--nova-teal-soft)",   bg: "var(--nova-teal-bg)" },
};

const CTA_LABEL: Record<NovaStreamItem["kind"], string> = {
  quote_pending: "Follow up",
  contract_lapsing: "Renew",
  product_unquoted: "Quote it",
  wfm_approval: "Review",
};

export default function NovaStream({
  items,
  userName,
  greeting,
  dateLabel,
}: {
  items: NovaStreamItem[];
  userName: string | null;
  greeting: string;
  dateLabel: string;
}) {
  const name = userName ? `, ${userName}` : "";

  return (
    <div style={{ flex: 1, padding: "48px 24px 80px", maxWidth: 860, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
      <div style={{ marginBottom: 8, fontSize: 13, color: "var(--nova-ink-faint)" }}>{dateLabel}</div>
      <h1 className="nova-display" style={{ fontSize: 34, margin: "0 0 6px" }}>
        {greeting}{name}.
      </h1>
      <p style={{ fontSize: 15, fontWeight: 300, color: "var(--nova-ink-dim)", margin: "0 0 36px", maxWidth: 560 }}>
        Your stream is ranked by what needs you most — overdue follow-ups, lapsing renewals, and approvals waiting on
        your call.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--nova-ink-faint)" }}>
          Predictive action stream
        </span>
        <span style={{ fontSize: 11, color: "var(--nova-teal-soft)", background: "var(--nova-teal-bg)", borderRadius: "var(--nova-radius-pill)", padding: "3px 10px", whiteSpace: "nowrap" }}>
          {items.length} pending
        </span>
      </div>

      {items.length === 0 ? (
        <div style={{ border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", padding: "28px 20px", textAlign: "center", color: "var(--nova-ink-dim)", fontSize: 14 }}>
          You&apos;re all caught up. Nothing is waiting on you right now.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((item) => {
            const accent = ACCENT[item.accent];
            return (
              <Link
                key={item.id}
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  background: "var(--nova-glass-bg)",
                  border: "1px solid var(--nova-glass-border)",
                  borderRadius: 12,
                  padding: "13px 16px",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: accent.color,
                    background: accent.bg,
                    borderRadius: 6,
                    padding: "3px 8px",
                    minWidth: 22,
                    textAlign: "center",
                    flexShrink: 0,
                  }}
                >
                  {item.score}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "var(--nova-ink)", opacity: 0.88, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--nova-ink-faint)", marginTop: 2 }}>{item.detail}</div>
                </div>
                <span style={{ fontSize: 12, color: accent.color, flexShrink: 0 }}>{CTA_LABEL[item.kind]} →</span>
              </Link>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 32, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("nova:open-palette"))}
          style={{
            fontSize: 12,
            color: "var(--nova-ink-dim)",
            background: "var(--nova-glass-bg)",
            border: "1px solid var(--nova-glass-border)",
            borderRadius: "var(--nova-radius-pill)",
            padding: "7px 16px",
            cursor: "pointer",
            fontFamily: "var(--nova-font-body)",
          }}
        >
          Ask Nova anything — ⌘K
        </button>
      </div>
    </div>
  );
}
