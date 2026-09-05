"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";

/**
 * One collapsible block on a settings page.
 *
 * Settings screens here gain a section per capability and never lose one, so
 * "everything expanded" is the wrong default: the page becomes a wall to
 * scroll past to reach the single switch someone came for. Collapsed is the
 * default; the header carries a one-line digest of what the section currently
 * holds, so the common case -- checking what is set -- needs no click at all.
 *
 * Which sections a person opens is remembered for them alone (localStorage).
 * It is a per-viewer convenience, never state anything else depends on, so
 * every access is wrapped: a private window or blocked site data must render
 * the page exactly as well.
 */
export default function SettingsSection({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  /** Stable key for remembering this section's open state. */
  id: string;
  title: string;
  /** One line describing what is configured, shown while collapsed. */
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const key = `bpm.settings.${id}`;
  const [open, setOpen] = useState(defaultOpen);

  // Read after mount rather than during render: the server has no way to know
  // this viewer's stored choice, and reading it inline would make the two
  // renders disagree.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) setOpen(stored === "1");
    } catch {
      /* private mode / site data blocked -- the default stands */
    }
  }, [key]);

  const toggle = () =>
    setOpen((v) => {
      try { localStorage.setItem(key, v ? "0" : "1"); } catch { /* see above */ }
      return !v;
    });

  return (
    <section
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--line)",
        borderRadius: "var(--card-radius)",
        boxShadow: "var(--card-shadow)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          minHeight: 52, padding: "12px 16px", textAlign: "left",
          background: "none", border: "none", cursor: "pointer", color: "inherit",
        }}
      >
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: c.ink }}>
            {title}
          </span>
          {summary && !open && (
            <span
              style={{
                display: "block", fontSize: 11.5, color: c.hint, marginTop: 3,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {summary}
            </span>
          )}
        </span>
        <span
          aria-hidden
          style={{
            flexShrink: 0, width: 26, height: 26, borderRadius: 7,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: open ? "var(--tenant-accent, #378ADD)" : c.panel2,
            color: open ? "#fff" : c.muted,
            border: open ? "none" : `1px solid ${c.line}`,
          }}
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {open && (
        <div style={{ padding: "16px", borderTop: `1px solid ${c.line}` }}>{children}</div>
      )}
    </section>
  );
}
