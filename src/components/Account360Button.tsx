"use client";

import { useIsNextgen3Layer } from "@/lib/tenant-context";

/**
 * The way into Account 360. Self-gates on Nova (like NovaTimelineSlot), so a
 * server page mounts it unconditionally and a non-Nova tenant renders
 * nothing. Raising the event rather than importing the drawer keeps the
 * drawer a single instance mounted once in Shell.
 */
export function openAccount360(id: string) {
  window.dispatchEvent(new CustomEvent("nova:open-account-360", { detail: { id } }));
}

export default function Account360Button({ accountId, variant = "button" }: { accountId: string; variant?: "button" | "link" }) {
  const nova = useIsNextgen3Layer();
  if (!nova) return null;

  if (variant === "link") {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); openAccount360(accountId); }}
        title="Account 360"
        aria-label="Open Account 360"
        style={{
          border: "none", background: "transparent", cursor: "pointer", padding: 2, lineHeight: 0,
          color: "var(--modern-accent, var(--accent))",
        }}
      >
        <Glyph />
      </button>
    );
  }

  return (
    <button
      onClick={() => openAccount360(accountId)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", font: "inherit",
        padding: "6px 11px", borderRadius: 8, fontSize: 12.5, fontWeight: 650,
        border: "1px solid var(--line, #e5e7eb)", background: "transparent", color: "var(--ink, #111827)",
      }}
    >
      <Glyph />
      Account 360
    </button>
  );
}

/**
 * List-table variant. Head and body cells gate on the SAME hook, so a
 * non-Nova tenant renders neither -- the table keeps exactly the columns it
 * has today rather than growing an empty one.
 */
export function Account360HeadCell({ style }: { style?: React.CSSProperties }) {
  const nova = useIsNextgen3Layer();
  if (!nova) return null;
  return <th style={{ ...style, width: 30 }} aria-label="Account 360" />;
}

export function Account360Cell({ accountId, style }: { accountId: string; style?: React.CSSProperties }) {
  const nova = useIsNextgen3Layer();
  if (!nova) return null;
  return (
    <td style={{ ...style, width: 30, paddingLeft: 0, paddingRight: 0 }}>
      <Account360Button accountId={accountId} variant="link" />
    </td>
  );
}

function Glyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".45" />
      <path d="M8 2.4a5.6 5.6 0 0 1 5.35 3.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="8" r="1.7" fill="currentColor" />
    </svg>
  );
}
