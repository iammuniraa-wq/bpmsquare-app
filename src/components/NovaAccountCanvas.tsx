"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CanvasNode, QuoteCanvasNode } from "@/lib/nova/accountCanvas";
import { MOBILE_BREAKPOINT } from "@/lib/constants";

const ACCENT: Record<CanvasNode["accent"], { color: string; bg: string; border: string; glow: string }> = {
  orange: { color: "var(--nova-orange-soft)", bg: "var(--nova-orange-bg)", border: "rgba(255,107,53,0.55)", glow: "rgba(255,107,53,0.35)" },
  pink:   { color: "var(--nova-pink-soft)",   bg: "var(--nova-pink-bg)",   border: "rgba(232,67,147,0.55)", glow: "rgba(232,67,147,0.35)" },
  purple: { color: "var(--nova-purple-softer)", bg: "var(--nova-purple-bg)", border: "rgba(155,89,245,0.55)", glow: "rgba(155,89,245,0.35)" },
  teal:   { color: "var(--nova-teal-soft)",   bg: "var(--nova-teal-bg)",   border: "rgba(20,200,180,0.55)", glow: "rgba(20,200,180,0.35)" },
};

// Cheap deterministic "jitter" -- same input always gives the same output,
// so server and client render identically (no hydration mismatch, unlike
// Math.random()). Only used to keep the constellation from looking like a
// rigid, perfectly-spaced grid.
const jitter = (i: number, amplitude: number) => (((i * 37 + 11) % 7) - 3) * (amplitude / 3);

const CENTER = { x: 50, y: 50 };

// Desktop: a wide container, so contacts/deals arc left/right (centerAngle
// 180/0) into a wide ellipse. Mobile: the container is narrow but tall
// (portrait), so this same graph would collapse into a cramped horizontal
// band with cards overlapping and clipping past the edges -- instead it
// arcs contacts up and deals down (centerAngle 90/270) into a TALL ellipse,
// using the space the phone actually has. Node cards keep a fixed pixel
// width regardless of layout, so the clamp bounds differ too: desktop
// leaves generous horizontal room per node (10-90), mobile leans on the
// full height (6-94) but keeps nodes closer to the vertical centerline
// (22-78) so a card's fixed width doesn't hang off the container.
type CanvasLayout = { radiusX: number; radiusY: number; clampX: [number, number]; clampY: [number, number] };
const DESKTOP_LAYOUT: CanvasLayout = { radiusX: 33, radiusY: 32, clampX: [10, 90], clampY: [14, 86] };
const MOBILE_LAYOUT: CanvasLayout = { radiusX: 27, radiusY: 40, clampX: [22, 78], clampY: [6, 94] };

function arcPosition(index: number, count: number, centerAngleDeg: number, spreadDeg: number, layout: CanvasLayout) {
  const angleDeg = count <= 1 ? centerAngleDeg : centerAngleDeg - spreadDeg / 2 + (spreadDeg / (count - 1)) * index;
  const rad = (angleDeg * Math.PI) / 180;
  const rx = layout.radiusX + jitter(index, 6);
  const ry = layout.radiusY + jitter(index + 3, 6);
  return {
    x: Math.min(layout.clampX[1], Math.max(layout.clampX[0], CENTER.x + rx * Math.cos(rad))),
    y: Math.min(layout.clampY[1], Math.max(layout.clampY[0], CENTER.y - ry * Math.sin(rad))),
  };
}

// A gentle quadratic curve from the center to a node, bowed left/right on
// alternating nodes so the graph reads as organic wiring rather than
// straight spokes.
function curvedPath(x1: number, y1: number, x2: number, y2: number, bend: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return `M ${x1} ${y1} Q ${mx + nx * bend} ${my + ny * bend} ${x2} ${y2}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "•";
}

/**
 * Nova's Canvas (Constellation) view of an account -- the real contacts and
 * open quotes tied to it, laid out as a graph instead of a table. Contacts
 * arc to the left of the account node, open deals arc to the right; nothing
 * here is a mock relationship. Curved connectors, node glow, a slow ambient
 * float, and zoom controls carry the "living graph" feel from the shared
 * design proposal -- all motion is skipped under prefers-reduced-motion.
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
  const [zoom, setZoom] = useState(1);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (contactNodes.length === 0 && dealNodes.length === 0) {
    return (
      <div style={{ border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", padding: "28px 20px", textAlign: "center", color: "var(--nova-ink-dim)", fontSize: 14, marginBottom: 20 }}>
        Nothing to graph yet — add a contact or send a quote to see {accountName}&apos;s constellation.
      </div>
    );
  }

  const layout = isMobile ? MOBILE_LAYOUT : DESKTOP_LAYOUT;
  const contactCenterAngle = isMobile ? 90 : 180;
  const dealCenterAngle = isMobile ? 270 : 0;
  const contactPositions = contactNodes.map((_, i) => arcPosition(i, contactNodes.length, contactCenterAngle, 130, layout));
  const dealPositions = dealNodes.map((_, i) => arcPosition(i, dealNodes.length, dealCenterAngle, 130, layout));

  return (
    <div style={{ marginBottom: 28 }}>
      <style>{`
        @keyframes nova-canvas-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        @keyframes nova-canvas-pulse {
          0%, 100% { box-shadow: 0 0 32px var(--nova-pulse-color, rgba(155,89,245,0.28)); }
          50% { box-shadow: 0 0 52px var(--nova-pulse-color, rgba(155,89,245,0.28)); }
        }
        @keyframes nova-canvas-flow {
          to { stroke-dashoffset: -24; }
        }
        .nova-canvas-node {
          animation: nova-canvas-float 7s ease-in-out infinite;
          transition: filter 0.2s ease;
        }
        .nova-canvas-node:hover { filter: brightness(1.18); z-index: 5; }
        .nova-canvas-center { animation: nova-canvas-pulse 4.5s ease-in-out infinite; }
        .nova-canvas-line { animation: nova-canvas-flow 2.4s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .nova-canvas-node, .nova-canvas-center, .nova-canvas-line { animation: none !important; }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div className="nova-display" style={{ fontSize: 18 }}>{accountName} — Constellation</div>
        <span style={{ fontSize: 11.5, color: "var(--nova-ink-faint)" }}>Click a node to open it</span>
      </div>

      <div style={{ position: "relative", height: isMobile ? 480 : 360, background: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)", backgroundSize: "36px 36px", borderRadius: "var(--nova-radius-card)", border: "1px solid var(--nova-line)", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})`, transformOrigin: "50% 50%", transition: "transform 0.25s ease" }}>
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 100 100" preserveAspectRatio="none">
            {contactNodes.map((n, i) => {
              const p = contactPositions[i];
              const bend = (i % 2 === 0 ? 1 : -1) * (6 + jitter(i, 4));
              return (
                <path
                  key={n.id}
                  className="nova-canvas-line"
                  d={curvedPath(CENTER.x, CENTER.y, p.x, p.y, bend)}
                  stroke={ACCENT[n.accent].border}
                  strokeWidth={0.22}
                  strokeDasharray="3 3"
                  fill="none"
                />
              );
            })}
            {dealNodes.map((n, i) => {
              const p = dealPositions[i];
              const bend = (i % 2 === 0 ? -1 : 1) * (6 + jitter(i, 4));
              return (
                <path
                  key={n.id}
                  className="nova-canvas-line"
                  d={curvedPath(CENTER.x, CENTER.y, p.x, p.y, bend)}
                  stroke={ACCENT[n.accent].border}
                  strokeWidth={0.22}
                  strokeDasharray="3 3"
                  fill="none"
                />
              );
            })}
          </svg>

          {/* Account node, center */}
          <div
            className="nova-canvas-center"
            style={{
              position: "absolute", left: `${CENTER.x}%`, top: `${CENTER.y}%`, transform: "translate(-50%, -50%)",
              zIndex: 3, background: "rgba(155,89,245,0.14)", backdropFilter: "blur(12px)",
              border: "1.5px solid rgba(155,89,245,0.5)", borderRadius: "var(--nova-radius-card)", padding: "14px 20px",
              textAlign: "center", maxWidth: isMobile ? 190 : 280,
              ["--nova-pulse-color" as string]: "rgba(155,89,245,0.3)",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--nova-purple-softer)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Account</div>
            <div className="nova-display" style={{ fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{accountName}</div>
            <div style={{ fontSize: 12, color: "var(--nova-ink-faint)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{accountMeta}</div>
          </div>

          {contactNodes.map((n, i) => {
            const accent = ACCENT[n.accent];
            const p = contactPositions[i];
            return (
              <div key={n.id} style={{ position: "absolute", left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%, -50%)", zIndex: 3 }}>
                <Link
                  href={n.href}
                  className="nova-canvas-node"
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: "var(--nova-glass-bg)", backdropFilter: "blur(12px)", border: `1px solid ${accent.border}`,
                    borderRadius: 100, padding: "8px 16px 8px 8px", textDecoration: "none", color: "inherit",
                    // Capped rather than nowrap-and-grow: a card with no
                    // width ceiling on a narrow phone container overlaps its
                    // neighbours and clips past the canvas edge (the
                    // "distorted" mobile report) -- each line truncates
                    // instead of the card ballooning to fit it.
                    maxWidth: isMobile ? 132 : 190,
                    boxShadow: `0 0 22px ${accent.glow}`,
                    animationDelay: `${i * 0.4}s`,
                  }}
                >
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: accent.bg, border: `1px solid ${accent.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: accent.color, flexShrink: 0 }}>
                    {initials(n.label)}
                  </div>
                  <div style={{ minWidth: 0, overflow: "hidden" }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</div>
                    <div style={{ fontSize: 11, color: "var(--nova-ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.meta}</div>
                  </div>
                </Link>
              </div>
            );
          })}

          {dealNodes.map((n, i) => {
            const accent = ACCENT[n.accent];
            const isOpen = openDeal === n.id;
            const p = dealPositions[i];
            return (
              <div
                key={n.id}
                style={{ position: "absolute", left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%, -50%)", zIndex: isOpen ? 6 : 3 }}
              >
                <div
                  className={isOpen ? undefined : "nova-canvas-node"}
                  style={{ cursor: "pointer", animationDelay: `${i * 0.4 + 0.2}s` }}
                  onClick={() => setOpenDeal(isOpen ? null : n.id)}
                >
                {isOpen ? (
                  <div style={{ width: isMobile ? 200 : 240, background: "rgba(10,15,30,0.96)", backdropFilter: "blur(16px)", border: `1.5px solid ${accent.border}`, borderRadius: "var(--nova-radius-card)", boxShadow: `0 12px 60px rgba(0,0,0,0.5), 0 0 40px ${accent.glow}`, overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--nova-line-soft)" }}>
                      <div style={{ fontSize: 11, color: accent.color, letterSpacing: "0.08em", textTransform: "uppercase" }}>Open quote</div>
                      <div className="nova-display" style={{ fontSize: 15, marginTop: 2 }}>{n.ref}</div>
                    </div>
                    <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontSize: 12.5, color: "var(--nova-ink-dim)" }}>Status: <span style={{ color: "var(--nova-ink)" }}>{n.status}</span></div>
                      <div style={{ fontSize: 12.5, color: "var(--nova-ink-dim)" }}>Value: <span style={{ color: "var(--nova-ink)" }}>{n.meta.split(" · ")[1] ?? ""}</span></div>
                      <Link href={n.href} style={{ fontSize: 12, fontWeight: 500, color: "var(--nova-ink)", background: "var(--nova-gradient-cta)", borderRadius: 8, padding: "8px 14px", textAlign: "center", textDecoration: "none", marginTop: 4 }}>
                        Open quote →
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div style={{ background: accent.bg, backdropFilter: "blur(12px)", border: `1.5px solid ${accent.border}`, borderRadius: "var(--nova-radius-card)", padding: "12px 16px", maxWidth: isMobile ? 150 : 210, boxShadow: `0 0 24px ${accent.glow}` }}>
                    <div style={{ fontSize: 11, color: accent.color, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>Open quote</div>
                    <div className="nova-display" style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</div>
                    <div style={{ fontSize: 11, color: "var(--nova-ink-faint)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.meta}</div>
                  </div>
                )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Zoom controls ── */}
        <div style={{ position: "absolute", left: 14, bottom: 14, zIndex: 7, display: "flex", alignItems: "center", gap: 2, background: "rgba(6,8,15,0.85)", border: "1px solid var(--nova-glass-border)", borderRadius: 10, padding: 4 }}>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.7, Math.round((z - 0.15) * 100) / 100))}
            style={{ fontSize: 16, color: "var(--nova-ink-dim)", padding: "4px 12px", background: "none", border: "none", cursor: "pointer" }}
          >
            −
          </button>
          <span style={{ fontSize: 12, color: "var(--nova-ink)", padding: "4px 6px", minWidth: 42, textAlign: "center" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.6, Math.round((z + 0.15) * 100) / 100))}
            style={{ fontSize: 16, color: "var(--nova-ink-dim)", padding: "4px 12px", background: "none", border: "none", cursor: "pointer" }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
