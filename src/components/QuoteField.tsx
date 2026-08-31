"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";

/**
 * Nova — Quote Field. Own full-screen tab in the Quotations view switcher
 * (owner feedback 2026-08-31: the original "band above Lanes" treatment
 * read as cluttered next to the concept mockup's clean, focused page --
 * split back out to its own tab, matching the mockup, and made the
 * default view). See api/nova/quote-field/route.ts for exactly which real
 * fields drive the axes, the colour, and the exposure corner (and why
 * idle-days-since-touch was used instead of the original spec's "days
 * since created").
 *
 * The value axis is deliberately NOT a plain linear/sqrt scale of the
 * true max -- a single very large quote (₹1Cr+) would otherwise crush
 * every other dot into the bottom few pixels, which is exactly the bug
 * this had. The domain instead caps at a value derived from the 90th
 * percentile of what's actually plotted; anything above that domain is
 * drawn clamped at the top with a dashed "off-scale" ring, and its real
 * value is still shown on hover -- nothing is hidden, the axis just isn't
 * held hostage by one outlier.
 *
 * Drag-to-select (owner request 2026-08-31): dragging a rectangle over
 * the plot selects every bubble inside it; the right rail swaps from the
 * Exposure corner list to the selected quotes (count, total value, and
 * the same open-on-click rows) until cleared. A plain click (no drag)
 * still opens the hovered quote directly, same as before -- distinguished
 * by movement distance between mousedown and mouseup, not by a modifier
 * key, since a modifier-free drag is what "draw a rectangle" means.
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

const W = 980, H = 300, PAD_L = 54, PAD_R = 14, PAD_T = 16, PAD_B = 28;
const DRAG_THRESHOLD = 8; // svg-space px below which a mousedown->mouseup counts as a click, not a drag

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--nova-font-body)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--nova-ink-faint)", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--nova-font-display)", fontSize: 24, fontWeight: 700, letterSpacing: "-.01em", color: "var(--nova-ink)" }}>
        {value}
      </div>
    </div>
  );
}

export default function QuoteField({ filterQuery }: { filterQuery?: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ p: Point; clamped: boolean; x: number; y: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragNow, setDragNow] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    const url = filterQuery ? `/api/nova/quote-field?${filterQuery}` : "/api/nova/quote-field";
    setSelected(new Set());
    fetch(url)
      .then((r) => r.json())
      .then((json) => { if (!cancelled) { if (json.error) setError(json.error); else setData(json); } })
      .catch(() => { if (!cancelled) setError("Couldn't load the field view"); });
    return () => { cancelled = true; };
  }, [filterQuery]);

  const geo = useMemo(() => {
    if (!data || data.points.length === 0) return null;
    const maxIdle = Math.max(30, ...data.points.map((p) => p.idleDays));
    const totals = data.points.map((p) => p.total);
    // Cap the domain at the 90th percentile (padded) rather than the true
    // max, so one outlier can't crush the rest of the field -- see the
    // file-level comment.
    const maxValue = Math.max(data.exposure_value * 1.3, percentile(totals, 0.9) * 1.2, 1);
    const domainMax = maxValue * 1.15;
    const x = (d: number) => PAD_L + (d / maxIdle) * (W - PAD_L - PAD_R);
    const y = (v: number) => H - PAD_B - Math.sqrt(Math.min(v, maxValue) / domainMax) * (H - PAD_B - PAD_T);
    const atStake = totals.reduce((s, v) => s + v, 0);
    const medianAge = median(data.points.map((p) => p.idleDays));
    return { maxIdle, maxValue, x, y, atStake, medianAge };
  }, [data]);

  if (error) return <div style={{ padding: 20, color: "var(--nova-ink-dim)", fontSize: 13 }}>{error}</div>;
  if (!data || !geo) return <div style={{ padding: 20, color: "var(--nova-ink-faint)", fontSize: 13 }}>Loading field…</div>;

  const { x: X, y: Y, maxIdle, maxValue, atStake, medianAge } = geo;

  const statBar = (
    <div style={{ display: "flex", gap: 40, marginBottom: 22, paddingBottom: 18, borderBottom: "1px solid var(--nova-line-soft)" }}>
      <Stat label="Matching" value={<>{data.points.length} <span style={{ fontSize: 13, fontWeight: 500, color: "var(--nova-ink-faint)" }}>quotes</span></>} />
      <Stat label="At stake" value={money(atStake)} />
      <Stat label="Median age" value={<>{medianAge} <span style={{ fontSize: 13, fontWeight: 500, color: "var(--nova-ink-faint)" }}>days</span></>} />
      <Stat label="Exposure corner" value={<span style={{ color: data.exposed.length > 0 ? "#E4634A" : "var(--nova-ink)" }}>{data.exposed.length} · {money(data.exposed.reduce((s, p) => s + p.total, 0))}</span>} />
    </div>
  );

  if (data.points.length === 0) {
    return (
      <div>
        {statBar}
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", color: "var(--nova-ink-faint)", fontSize: 13 }}>
          No open quotes to plot.
        </div>
      </div>
    );
  }

  const gridValues = [0, data.exposure_value, maxValue].filter((v, i, arr) => arr.indexOf(v) === i);
  const gridDays = [0, data.exposure_days, Math.round(maxIdle)];

  const toSvgCoords = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * W,
      y: ((e.clientY - box.top) / box.height) * H,
    };
  };

  const nearest = (pt: { x: number; y: number }): Point | null => {
    let best: Point | null = null, bestD = 14;
    for (const p of data.points) {
      const dx = X(p.idleDays) - pt.x, dy = Y(p.total) - pt.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  };

  function onDown(e: React.MouseEvent<SVGSVGElement>) {
    const pt = toSvgCoords(e);
    setDragStart(pt);
    setDragNow(pt);
  }

  function onMoveSvg(e: React.MouseEvent<SVGSVGElement>) {
    const pt = toSvgCoords(e);
    if (dragStart) { setDragNow(pt); return; }
    const best = nearest(pt);
    if (!best) { setHover(null); return; }
    setHover({ p: best, clamped: best.total > maxValue, x: (X(best.idleDays) / W) * (svgRef.current?.getBoundingClientRect().width ?? W), y: (Y(best.total) / H) * (svgRef.current?.getBoundingClientRect().height ?? H) });
  }

  function onUp() {
    if (!data || !dragStart || !dragNow) { setDragStart(null); setDragNow(null); return; }
    const moved = Math.hypot(dragNow.x - dragStart.x, dragNow.y - dragStart.y);
    if (moved < DRAG_THRESHOLD) {
      const best = nearest(dragNow);
      if (best) router.push(`${ROUTES.quotations}/${best.id}`);
    } else {
      const x0 = Math.min(dragStart.x, dragNow.x), x1 = Math.max(dragStart.x, dragNow.x);
      const y0 = Math.min(dragStart.y, dragNow.y), y1 = Math.max(dragStart.y, dragNow.y);
      const ids = data.points
        .filter((p) => { const px = X(p.idleDays), py = Y(p.total); return px >= x0 && px <= x1 && py >= y0 && py <= y1; })
        .map((p) => p.id);
      setSelected(new Set(ids));
    }
    setDragStart(null);
    setDragNow(null);
  }

  const selecting = dragStart != null && dragNow != null && Math.hypot(dragNow.x - dragStart.x, dragNow.y - dragStart.y) >= DRAG_THRESHOLD;
  const selectedPoints = data.points.filter((p) => selected.has(p.id));
  const selectedTotal = selectedPoints.reduce((s, p) => s + p.total, 0);

  return (
    <div>
      {statBar}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 240px", gap: 18, alignItems: "start" }}>
        <div style={{ position: "relative", border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", background: "var(--nova-glass-bg)", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 10, right: 14, fontFamily: "var(--nova-font-body)", fontSize: 10.5, color: "var(--nova-ink-faint)", zIndex: 2, pointerEvents: "none" }}>
            Drag to select
          </div>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${data.points.length} quotations plotted by idle days and value`}
            style={{ display: "block", width: "100%", height: "auto", cursor: selecting ? "crosshair" : "pointer", userSelect: "none" }}
            onMouseDown={onDown}
            onMouseMove={onMoveSvg}
            onMouseUp={onUp}
            onMouseLeave={() => { setHover(null); setDragStart(null); setDragNow(null); }}
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
                  {v === 0 ? "₹0" : v >= maxValue ? `${money(v)}+` : money(v)}
                </text>
              </g>
            ))}
            {gridDays.map((d) => (
              <text key={d} x={X(d)} y={H - 9} textAnchor="middle" fill="var(--nova-ink-faint)" fontFamily="var(--nova-font-body)" fontSize="9.5">{d}d</text>
            ))}
            {data.points.map((p) => {
              const clamped = p.total > maxValue;
              const isSelected = selected.has(p.id);
              const dimmed = selected.size > 0 && !isSelected;
              return (
                <circle
                  key={p.id}
                  cx={X(p.idleDays)} cy={Y(p.total)} r={(2.4 + Math.sqrt(p.lineCount) * 1.3) * (isSelected ? 1.25 : 1)}
                  fill={COLOR[p.color]} fillOpacity={dimmed ? 0.14 : p.exposed || isSelected ? 0.95 : 0.5}
                  stroke={isSelected ? "#fff" : clamped ? COLOR[p.color] : p.exposed ? COLOR[p.color] : "none"}
                  strokeWidth={isSelected ? 1.6 : clamped ? 1.3 : p.exposed ? 1.3 : 0}
                  strokeDasharray={!isSelected && clamped ? "2 2" : undefined}
                />
              );
            })}
            {dragStart && dragNow && (
              <rect
                x={Math.min(dragStart.x, dragNow.x)} y={Math.min(dragStart.y, dragNow.y)}
                width={Math.abs(dragNow.x - dragStart.x)} height={Math.abs(dragNow.y - dragStart.y)}
                fill="rgba(240,169,59,.10)" stroke="var(--nova-orange)" strokeDasharray="4 3"
              />
            )}
          </svg>
          {hover && !dragStart && (
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
              {hover.clamped && (
                <div style={{ fontFamily: "var(--nova-font-body)", fontSize: 10.5, color: "#E4634A", marginTop: 3 }}>
                  Off scale — shown clamped to fit the chart
                </div>
              )}
            </div>
          )}
        </div>
        <aside>
          {selected.size > 0 ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ fontFamily: "var(--nova-font-body)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--nova-orange)" }}>
                  Selected
                </div>
                <button
                  type="button" onClick={() => setSelected(new Set())}
                  style={{ border: "none", background: "none", color: "var(--nova-ink-faint)", fontSize: 11, cursor: "pointer", padding: 0 }}
                >
                  Clear
                </button>
              </div>
              <p style={{ fontSize: 12, color: "var(--nova-ink-faint)", margin: "0 0 12px", lineHeight: 1.5 }}>
                {selectedPoints.length} quote{selectedPoints.length === 1 ? "" : "s"} · {money(selectedTotal)}
              </p>
              <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                {selectedPoints.map((p) => (
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
            </>
          ) : (
            <>
              <div style={{ fontFamily: "var(--nova-font-body)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#E4634A", marginBottom: 4 }}>
                Exposure corner
              </div>
              <p style={{ fontSize: 12, color: "var(--nova-ink-faint)", margin: "0 0 12px", lineHeight: 1.5 }}>
                {money(data.exposure_value)}+, idle {data.exposure_days} days or more.
              </p>
              <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column" }}>
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
            </>
          )}
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
    </div>
  );
}
