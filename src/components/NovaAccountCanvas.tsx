"use client";

import { useState } from "react";
import Link from "next/link";
import type { CanvasNode, QuoteCanvasNode } from "@/lib/nova/accountCanvas";

const ACCENT: Record<CanvasNode["accent"], { color: string; bg: string; border: string }> = {
  orange: { color: "var(--nova-orange-soft)", bg: "var(--nova-orange-bg)", border: "rgba(255,107,53,0.5)" },
  pink:   { color: "var(--nova-pink-soft)",   bg: "var(--nova-pink-bg)",   border: "rgba(232,67,147,0.5)" },
  purple: { color: "var(--nova-purple-softer)", bg: "var(--nova-purple-bg)", border: "rgba(155,89,245,0.5)" },
  teal:   { color: "var(--nova-teal-soft)",   bg: "var(--nova-teal-bg)",   border: "rgba(20,200,180,0.5)" },
};

// Evenly spreads `count` items across a 15..85 vertical band, centering a
// single item -- keeps the graph legible whether an account has 1 contact
// or 4.
function spreadY(count: number, index: number): number {
  if (count <= 1) return 50;
  const span = 70;
  return 15 + (span / (count - 1)) * index;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "•";
}

/**
 * Nova's Canvas (Constellation) view of an account -- the real contacts and
 * open quotes tied to it, laid out as a graph instead of a table. Contacts
 * on the left, open deals on the right, both wired to the account node at
 * center; nothing here is a mock relationship.
 */
export default function NovaAccountCanvas({
  accountName,
  accountMeta,
  contactNodes,
  dealNodes,
}: {
  accountName: string;
  accountMeta: string;
  contactNodes: CanvasNode[];
  dealNodes: QuoteCanvasNode[];
}) {
  const [openDeal, setOpenDeal] = useState<string | null>(null);

  if (contactNodes.length === 0 && dealNodes.length === 0) {
    return (
      <div style={{ border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", padding: "28px 20px", textAlign: "center", color: "var(--nova-ink-dim)", fontSize: 14, marginBottom: 20 }}>
        Nothing to graph yet — add a contact or send a quote to see {accountName}&apos;s constellation.
      </div>
    );
  }

  const lines: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
  contactNodes.forEach((n, i) => {
    lines.push({ x1: 50, y1: 50, x2: 15, y2: spreadY(contactNodes.length, i), color: ACCENT[n.accent].border });
  });
  dealNodes.forEach((n, i) => {
    lines.push({ x1: 50, y1: 50, x2: 85, y2: spreadY(dealNodes.length, i), color: ACCENT[n.accent].border });
  });

  return (
    <div style={{ marginBottom: 28 }}>
      <div className="nova-display" style={{ fontSize: 18, marginBottom: 16 }}>{accountName} — Constellation</div>

      <div style={{ position: "relative", height: 320, background: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)", backgroundSize: "36px 36px", borderRadius: "var(--nova-radius-card)", border: "1px solid var(--nova-line)" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 100 100" preserveAspectRatio="none">
          {lines.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} strokeWidth={0.2} />
          ))}
        </svg>

        {/* Account node, center */}
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: 3, background: "var(--nova-purple-bg)", backdropFilter: "blur(12px)", border: "1.5px solid rgba(155,89,245,0.5)", borderRadius: 16, padding: "14px 18px", textAlign: "center", whiteSpace: "nowrap", boxShadow: "0 0 40px rgba(123,47,190,0.2)" }}>
          <div style={{ fontSize: 11, color: "var(--nova-purple-softer)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Account</div>
          <div className="nova-display" style={{ fontSize: 16 }}>{accountName}</div>
          <div style={{ fontSize: 12, color: "var(--nova-ink-faint)", marginTop: 4 }}>{accountMeta}</div>
        </div>

        {contactNodes.map((n, i) => {
          const accent = ACCENT[n.accent];
          return (
            <Link
              key={n.id}
              href={n.href}
              style={{
                position: "absolute", left: "15%", top: `${spreadY(contactNodes.length, i)}%`,
                transform: "translate(-50%, -50%)", zIndex: 3, display: "flex", alignItems: "center", gap: 10,
                background: "var(--nova-glass-bg)", backdropFilter: "blur(12px)", border: "1px solid var(--nova-glass-border)",
                borderRadius: 100, padding: "8px 16px 8px 8px", textDecoration: "none", color: "inherit", whiteSpace: "nowrap",
              }}
            >
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: accent.bg, border: `1px solid ${accent.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: accent.color, flexShrink: 0 }}>
                {initials(n.label)}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{n.label}</div>
                <div style={{ fontSize: 11, color: "var(--nova-ink-faint)" }}>{n.meta}</div>
              </div>
            </Link>
          );
        })}

        {dealNodes.map((n, i) => {
          const accent = ACCENT[n.accent];
          const isOpen = openDeal === n.id;
          return (
            <div
              key={n.id}
              style={{ position: "absolute", left: "85%", top: `${spreadY(dealNodes.length, i)}%`, transform: "translate(-50%, -50%)", zIndex: isOpen ? 4 : 3, cursor: "pointer" }}
              onClick={() => setOpenDeal(isOpen ? null : n.id)}
            >
              {isOpen ? (
                <div style={{ width: 240, background: "rgba(10,15,30,0.94)", backdropFilter: "blur(16px)", border: `1.5px solid ${accent.border}`, borderRadius: 16, boxShadow: "0 12px 60px rgba(0,0,0,0.5)", overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--nova-line-soft)" }}>
                    <div style={{ fontSize: 11, color: accent.color, letterSpacing: "0.08em", textTransform: "uppercase" }}>Open quote</div>
                    <div className="nova-display" style={{ fontSize: 15, marginTop: 2 }}>{n.ref}</div>
                  </div>
                  <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12.5, color: "var(--nova-ink-dim)" }}>Status: <span style={{ color: "var(--nova-ink)" }}>{n.status}</span></div>
                    <div style={{ fontSize: 12.5, color: "var(--nova-ink-dim)" }}>Value: <span style={{ color: "var(--nova-ink)" }}>{n.meta.split(" · ")[1] ?? ""}</span></div>
                    <Link href={n.href} style={{ fontSize: 12, fontWeight: 500, color: "#fff", background: "var(--nova-gradient-cta)", borderRadius: 8, padding: "8px 14px", textAlign: "center", textDecoration: "none", marginTop: 4 }}>
                      Open quote →
                    </Link>
                  </div>
                </div>
              ) : (
                <div style={{ background: accent.bg, backdropFilter: "blur(12px)", border: `1.5px solid ${accent.border}`, borderRadius: 16, padding: "12px 16px", whiteSpace: "nowrap" }}>
                  <div style={{ fontSize: 11, color: accent.color, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>Open quote</div>
                  <div className="nova-display" style={{ fontSize: 14 }}>{n.label}</div>
                  <div style={{ fontSize: 11, color: "var(--nova-ink-faint)", marginTop: 2 }}>{n.meta}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
