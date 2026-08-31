"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";

/**
 * Nova — Quote Field. See api/nova/quote-field/route.ts for exactly which
 * real fields drive the axes, the colour, and the exposure corner (and
 * why idle-days-since-touch was used instead of the original spec's
 * "days since created"). Shipped as a compact band above Lanes, not a
 * full-screen default -- see FlowBoardSlot.tsx.
 *
 * No box-select yet: that hands a selection to the List view's bulk-action
 * bar, and List hasn't been redrawn with one to receive it. Building the
 * drag interaction before there's anywhere for it to go would be a
 * mechanism with no destination -- deferred to when List gets its
 * selection UI (see the redesign's own build order).
 */

type Point = {
  id: string; ref: string; account: string; total: number;
  idleDays: number; lineCount: number; color: "draft" | "sent" | "accepted"; exposed: boolean;
};
type Payload = { points: Point[]; exposed: Point[]; exposure_value: number; exposure_days: number };

const COLOR: Record<Point["color"], string> = { draft: "#E4634A", sent: "#F0A93B", accepted: "#14C8B4" };
const LABEL: Record<Point["color"], string> = { draft: "Draft, unsent", sent: "Sent", accepted: "Accepted / negotiating" };

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const money = (n: number) =>
  n >= 10_000_000 ? `₹${(n / 10_000_000).toFixed(2)}Cr`
  : n >= 100_000 ? `₹${(n / 100_000).toFixed(2)}L`
  : inr(n);

const W = 900, H = 230, PAD_L = 50, PAD_R = 14, PAD_T = 12, PAD_B = 26;

export default function QuoteField({ filterQuery }: { filterQuery?: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ p: Point; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    const url = filterQuery ? `/api/nova/quote-field?${filterQuery}` : "/api/nova/quote-field";
    fetch(url)
      .then((r) => r.json())
      .then((json) => { if (!cancelled) { if (json.error) setError(json.error); else setData(json); } })
      .catch(() => { if (!cancelled) setError("Couldn't load the field view"); });
    return () => { cancelled = true; };
  }, [filterQuery]);

  const geo = useMemo(() => {
    if (!data || data.points.length === 0) return null;
    const maxIdle = Math.max(30, ...data.points.map((p) => p.idleDays));
    const maxValue = Math.max(data.exposure_value * 1.5, ...data.points.map((p) => p.total));
    const x = (d: number) => PAD_L + (d / maxIdle) * (W - PAD_L - PAD_R);
    const y = (v: number) => H - PAD_B - Math.sqrt(v / maxValue) * (H - PAD_B - PAD_T);
    return { maxIdle, maxValue, x, y };
  }, [data]);

  if (error) return <div style={{ padding: 20, color: "var(--nova-ink-dim)", fontSize: 13 }}>{error}</div>;
  if (!data || !geo) return <div style={{ padding: 20, color: "var(--nova-ink-faint)", fontSize: 13 }}>Loading field…</div>;
  if (data.points.length === 0) {
    // Axes stay drawn even empty -- a plot that collapses to zero height
    // on no data reads as broken, not as "nothing to show".
    return (
      <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", color: "var(--nova-ink-faint)", fontSize: 13, marginBottom: 28 }}>
        No open quotes to plot.
      </div>
    );
  }

  const { x: X, y: Y, maxIdle, maxValue } = geo;
  const gridValues = [0, data.exposure_value, maxValue].filter((v, i, arr) => arr.indexOf(v) === i);
  const gridDays = [0, data.exposure_days, Math.round(maxIdle)];

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!data) return;
    const box = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    const sy = ((e.clientY - box.top) / box.height) * H;
    let best: Point | null = null, bestD = 14;
    for (const p of data.points) {
      const dx = X(p.idleDays) - sx, dy = Y(p.total) - sy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) { setHover(null); return; }
    setHover({ p: best, x: (X(best.idleDays) / W) * box.width, y: (Y(best.total) / H) * box.height });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 240px", gap: 18, alignItems: "start", marginBottom: 30 }}>
      <div style={{ position: "relative", border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", background: "var(--nova-glass-bg)", overflow: "hidden" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${data.points.length} quotations plotted by idle days and value`}
          style={{ display: "block", width: "100%", height: "auto", cursor: "pointer" }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={() => { if (hover) router.push(`${ROUTES.quotations}/${hover.p.id}`); }}
        >
          {/* exposure corner */}
          <rect
            x={X(data.exposure_days)} y={PAD_T}
            width={X(maxIdle) - X(data.exposure_days)} height={Y(data.exposure_value) - PAD_T}
            fill="rgba(228,99,74,.08)" stroke="rgba(228,99,74,.32)" strokeDasharray="3 4"
          />
          <text x={W - PAD_R - 8} y={Y(data.exposure_value) - 8} textAnchor="end" fill="#E4634A" fontFamily="var(--nova-font-body)" fontSize="10" letterSpacing="0.5">
            EXPOSURE · {data.exposed.length} quote{data.exposed.length === 1 ? "" : "s"} · {money(data.exposed.reduce((s, p) => s + p.total, 0))}
          </text>
          {gridValues.map((v) => (
            <g key={v}>
              <line x1={PAD_L} x2={W - PAD_R} y1={Y(v)} y2={Y(v)} stroke="var(--nova-line-soft)" />
              <text x={PAD_L - 8} y={Y(v) + 3} textAnchor="end" fill="var(--nova-ink-faint)" fontFamily="var(--nova-font-body)" fontSize="9.5">
                {v === 0 ? "₹0" : money(v)}
              </text>
            </g>
          ))}
          {gridDays.map((d) => (
            <text key={d} x={X(d)} y={H - 9} textAnchor="middle" fill="var(--nova-ink-faint)" fontFamily="var(--nova-font-body)" fontSize="9.5">{d}d</text>
          ))}
          {data.points.map((p) => (
            <circle
              key={p.id}
              cx={X(p.idleDays)} cy={Y(p.total)} r={2.4 + Math.sqrt(p.lineCount) * 1.3}
              fill={COLOR[p.color]} fillOpacity={p.exposed ? 0.95 : 0.5}
              stroke={p.exposed ? COLOR[p.color] : "none"} strokeWidth={p.exposed ? 1.3 : 0}
            />
          ))}
        </svg>
        {hover && (
          <div style={{
            position: "absolute", pointerEvents: "none",
            left: Math.min(Math.max(hover.x - 80, 6), W - 200), top: Math.max(hover.y - 58, 6),
            background: "var(--nova-bg)", border: "1px solid var(--nova-line)", borderRadius: 8,
            padding: "8px 11px", fontSize: 12, minWidth: 160, boxShadow: "0 14px 34px -14px rgba(0,0,0,.9)", zIndex: 5,
          }}>
            <div style={{ fontWeight: 500, color: "var(--nova-ink)", marginBottom: 2 }}>{hover.p.account}</div>
            <div style={{ fontFamily: "var(--nova-font-body)", fontSize: 11, color: "var(--nova-ink-dim)" }}>
              {inr(hover.p.total)} · {hover.p.lineCount} line{hover.p.lineCount === 1 ? "" : "s"} · {hover.p.idleDays}d idle
            </div>
          </div>
        )}
      </div>
      <aside>
        <div style={{ fontFamily: "var(--nova-font-body)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#E4634A", marginBottom: 4 }}>
          Exposure corner
        </div>
        <p style={{ fontSize: 12, color: "var(--nova-ink-faint)", margin: "0 0 12px", lineHeight: 1.5 }}>
          {money(data.exposure_value)}+, idle {data.exposure_days} days or more.
        </p>
        <div style={{ maxHeight: 150, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {data.exposed.length === 0 && <div style={{ fontSize: 12, color: "var(--nova-ink-faint)" }}>Nothing exposed right now.</div>}
          {data.exposed.map((p) => (
            <button
              key={p.id}
              onClick={() => router.push(`${ROUTES.quotations}/${p.id}`)}
              style={{
                display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline",
                padding: "9px 0", borderTop: "none", borderLeft: "none", borderRight: "none",
                borderBottom: "1px solid var(--nova-line-soft)",
                background: "none", cursor: "pointer", textAlign: "left", width: "100%",
              }}
            >
              <span style={{ fontSize: 12.5, color: "var(--nova-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.account}</span>
              <span style={{ fontFamily: "var(--nova-font-body)", fontSize: 11, color: "var(--nova-ink-dim)", whiteSpace: "nowrap" }}>{inr(p.total)} · {p.idleDays}d</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
          {(Object.keys(COLOR) as Point["color"][]).map((k) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--nova-font-body)", fontSize: 10.5, color: "var(--nova-ink-faint)" }}>
              <i style={{ width: 7, height: 7, borderRadius: "50%", background: COLOR[k], display: "block" }} />
              {LABEL[k]}
            </span>
          ))}
        </div>
      </aside>
    </div>
  );
}
