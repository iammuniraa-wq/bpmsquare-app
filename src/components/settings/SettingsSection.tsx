"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";

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
  info,
  defaultOpen = false,
  defaultOpenNarrow,
  children,
}: {
  /** Stable key for remembering this section's open state. */
  id: string;
  title: string;
  /** One line describing what is configured, shown while collapsed. */
  summary?: string;
  /** What the section is for, behind an "i" after the title (docs/design/ux-simplification.md §2a). */
  info?: React.ReactNode;
  defaultOpen?: boolean;
  /** The default on a phone (under 900 px) when it differs from the desktop one; a remembered choice still wins. */
  defaultOpenNarrow?: boolean;
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
      if (stored !== null) { setOpen(stored === "1"); return; }
    } catch {
      /* private mode / site data blocked -- the default stands */
    }
    if (defaultOpenNarrow !== undefined && window.matchMedia("(max-width: 900px)").matches) setOpen(defaultOpenNarrow);
  }, [key, defaultOpenNarrow]);

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
      {info ? (
        // An "i" is a button, and a button cannot sit inside the header button: the header becomes a row whose click
        // toggles, the title is the real (focusable) button, and the "i" stops its own clicks from toggling.
        <div
          onClick={toggle}
          style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "12px 16px", cursor: "pointer" }}
        >
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "flex", alignItems: "center" }}>
              <button
                type="button"
                aria-expanded={open}
                style={{ padding: 0, textAlign: "left", background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit" }}
              >
                <span className="bpm-t-section">{title}</span>
              </button>
              <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}><InfoTip label={title}>{info}</InfoTip></span>
            </span>
            {summary && !open && (
              <span className="bpm-t-help" style={{ display: "block", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {summary}
              </span>
            )}
          </span>
          <Chevron open={open} />
        </div>
      ) : (
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
            <span className="bpm-t-section" style={{ display: "block" }}>
              {title}
            </span>
            {summary && !open && (
              <span
                className="bpm-t-help"
                style={{
                  display: "block", marginTop: 3,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                {summary}
              </span>
            )}
          </span>
          <Chevron open={open} />
        </button>
      )}

      {open && (
        <div style={{ padding: "16px", borderTop: `1px solid ${c.line}` }}>{children}</div>
      )}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
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
  );
}
