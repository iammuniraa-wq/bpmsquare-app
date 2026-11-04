"use client";

import { useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";

export type AudiencePreview = {
  total: number;
  will_receive: number;
  left_out: number;
  reasons: { code: string; label: string; count: number }[];
  people: { name: string; email: string | null; code: string; label: string; why: string; fix: { label: string; href: string } | null }[];
};

const SHOWN = 5;

/**
 * "N will receive, M left out" with the reason for each person and the link that fixes it. The numbers
 * come from the send's own decisions (api/marketing/recipients-preview), so the count a person sees here
 * is the count the send will use. Reasons are real content, not decoration (6b: a blocker stays visible).
 */
export default function AudienceCount({ preview, checking }: { preview: AudiencePreview | null; checking?: boolean }) {
  const [all, setAll] = useState(false);
  if (!preview) return <div style={{ fontSize: 13, color: c.hint }}>{checking ? "Counting who will receive this…" : ""}</div>;
  const list = all ? preview.people : preview.people.slice(0, SHOWN);
  const more = preview.people.length - SHOWN;
  return (
    <div aria-live="polite">
      <div style={{ fontSize: 13 }}>
        <strong style={{ color: c.ink }}>{preview.will_receive} will receive</strong>
        {preview.left_out > 0 && <span style={{ color: c.hint, marginLeft: 8, fontSize: 12.5 }}>{preview.left_out} left out</span>}
        {checking && <span style={{ color: c.hint, marginLeft: 8, fontSize: 12 }}>updating…</span>}
      </div>
      {preview.left_out > 0 && (
        <div style={{ marginTop: 6 }}>
          {preview.reasons.length > 0 && (
            <div style={{ fontSize: 12, color: c.muted, marginBottom: 4 }}>
              {preview.reasons.map((r) => `${r.count} ${r.label.toLowerCase()}`).join(" · ")}
            </div>
          )}
          {list.map((p, i) => (
            <div key={`${p.name}-${p.email ?? ""}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", padding: "7px 0", borderTop: `1px solid ${c.line}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>{p.email && p.email !== p.name ? `${p.name} · ${p.email}` : p.name}</div>
                <div style={{ fontSize: 12, color: c.hint }}>{p.why}</div>
              </div>
              {p.fix && <Link href={p.fix.href} target="_blank" style={{ fontSize: 12.5, color: c.accent, fontWeight: 600, whiteSpace: "nowrap", minHeight: 44, display: "inline-flex", alignItems: "center" }}>{p.fix.label}</Link>}
            </div>
          ))}
          {!all && more > 0 && (
            <button type="button" onClick={() => setAll(true)} style={{ fontSize: 12.5, color: c.accent, background: "none", border: "none", cursor: "pointer", minHeight: 44, padding: 0 }}>Show all ({preview.people.length})</button>
          )}
        </div>
      )}
    </div>
  );
}
