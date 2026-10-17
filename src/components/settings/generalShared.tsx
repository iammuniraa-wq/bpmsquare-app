"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";

// Pieces the former General settings page shared between its sections. That
// page is now a set of pages (company, navigation, appearance, developer, ...);
// these are the helpers they have in common, moved as they were.

export const PILLAR_DOT: Record<string, string> = {
  blue: "#378ADD", purple: "var(--purple)", teal: "var(--teal)",
  amber: "#f6b23c", red: "var(--err-ink)", green: "#639922",
};

export function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback(() => {
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 1800);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [saved, flash];
}

export function Toggle({ on, onChange, accent, label }: { on: boolean; onChange: (v: boolean) => void; accent: string; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} style={{ width: 40, height: 22, borderRadius: 11, background: on ? accent : "color-mix(in srgb, var(--muted) 40%, var(--panel))", border: "none", cursor: "pointer", position: "relative", transition: "background 0.15s", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left 0.15s", display: "block" }} />
    </button>
  );
}

/** A block on a settings page. Was a collapsible accordion section while all
 *  of General lived on one page; on a page of its own it is simply open. `id`
 *  and `summary` are kept so the markup moved over unchanged. An empty title
 *  draws no heading (the page title already says it). */
export function Section({
  title, description, children,
}: {
  id?: string;
  title: string;
  description?: string;
  summary?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Card title={title || undefined} padding={16}>
        {description && (
          <p className="bpm-t-help" style={{ margin: "0 0 14px" }}>{description}</p>
        )}
        {children}
      </Card>
    </div>
  );
}

export function StatusBadge({ status }: { status: "active" | "ready" | "coming-soon" }) {
  const map = {
    "active":       { label: "Live",          bg: "var(--tealbg)", color: "var(--tealink)", border: "var(--teal)" },
    "ready":        { label: "Config ready",  bg: "var(--bluebg)", color: "var(--blueink)", border: "var(--blueline)" },
    "coming-soon":  { label: "Coming Soon",   bg: "var(--amberbg)", color: "var(--amberink)", border: "var(--amberline)" },
  }[status];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: "2px 8px", borderRadius: 6, background: map.bg, color: map.color, border: `1px solid ${map.border}`, whiteSpace: "nowrap" }}>
      {map.label}
    </span>
  );
}

/** What a non-admin sees on a page whose controls only an admin can use. The
 *  server refuses their writes either way; this just says so up front. */
export function AdminOnlyNotice({ what }: { what: string }) {
  return (
    <Card>
      <EmptyState title="Admin only" text={`Ask a workspace admin to ${what}.`} />
    </Card>
  );
}
