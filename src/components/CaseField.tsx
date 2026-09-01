"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";

/**
 * Nova — Case Field. Cases redesign (owner request 2026-09-01), ported
 * from Quotations' QuoteField. See api/nova/case-field/route.ts for
 * exactly which real fields drive each axis and why (age since intake
 * across, pipeline progress % up -- Cases have neither a money value nor
 * an updated_at to reuse quote-field's axes as-is).
 *
 * The progress axis is naturally bounded 0-100%, so unlike quote-field
 * there's no outlier to clamp -- one thing genuinely simpler here.
 *
 * Overlap is a bigger problem here than it was for quotes, though: with
 * only 9 real stage values, many cases share the exact same y, and any
 * bulk-seeded/imported batch shares the exact same intake date (x) too --
 * whole clusters can land on the identical pixel. Quote-field's 1D
 * same-day jitter isn't enough for that; points sharing an exact (x,y)
 * pixel here fan out in a small 2D spiral (Fermat/golden-angle spacing)
 * instead -- cosmetic only, the same jittered position is used
 * consistently for hover, drag-select, and the rendered dot.
 *
 * Drag-to-select and the mobile stacked-rail layout are the same
 * mechanisms as QuoteField.tsx -- see that file's comments for why.
 */

type Point = {
  id: string; ref: string; account: string; status: string;
  ageDays: number; progress: number; assetCount: number; unassigned: boolean; stuck: boolean;
};
type Payload = { points: Point[]; stuck: Point[]; stuck_age: number; stuck_progress_max: number };

const ASSIGNED_COLOR = "#14C8B4";
const UNASSIGNED_COLOR = "#E4634A";

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const W = 980, H = 300, PAD_L = 44, PAD_R = 14, PAD_T = 16, PAD_B = 28;
const DRAG_THRESHOLD = 8;
const GOLDEN_ANGLE = 137.508 * (Math.PI / 180);

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

export default function CaseField({ filterQuery }: { filterQuery?: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ p: Point; x: number; y: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragNow, setDragNow] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    const url = filterQuery ? `/api/nova/case-field?${filterQuery}` : "/api/nova/case-field";
    setSelected(new Set());
    fetch(url)
      .then((r) => r.json())
      .then((json) => { if (!cancelled) { if (json.error) setError(json.error); else setData(json); } })
      .catch(() => { if (!cancelled) setError("Couldn't load the field view"); });
    return () => { cancelled = true; };
  }, [filterQuery]);

  const geo = useMemo(() => {
    if (!data || data.points.length === 0) return null;
    const maxAge = Math.max(30, ...data.points.map((p) => p.ageDays));
    const x = (d: number) => PAD_L + (d / maxAge) * (W - PAD_L - PAD_R);
    const y = (v: number) => H - PAD_B - (v / 100) * (H - PAD_B - PAD_T);
    const medianAge = median(data.points.map((p) => p.ageDays));

    // Fan out points sharing the exact same pixel -- see file-level comment.
    const jitter = new Map<string, { dx: number; dy: number }>();
    const groups = new Map<string, Point[]>();
    for (const p of data.points) {
      const key = `${p.ageDays}|${p.progress}`;
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }
    for (const arr of groups.values()) {
      if (arr.length <= 1) continue;
      const sorted = [...arr].sort((a, b) => a.id.localeCompare(b.id));
      sorted.forEach((p, i) => {
        if (i === 0) { jitter.set(p.id, { dx: 0, dy: 0 }); return; }
        const r = 3 * Math.sqrt(i);
        const theta = i * GOLDEN_ANGLE;
        jitter.set(p.id, { dx: r * Math.cos(theta), dy: r * Math.sin(theta) });
      });
    }

    return { maxAge, x, y, medianAge, jitter };
  }, [data]);

  if (error) return <div style={{ padding: 20, color: "var(--nova-ink-dim)", fontSize: 13 }}>{error}</div>;
  if (!data || !geo) return <div style={{ padding: 20, color: "var(--nova-ink-faint)", fontSize: 13 }}>Loading field…</div>;

  const { x: X, y: Y, maxAge, medianAge, jitter } = geo;
  const jxy = (p: Point) => {
    const j = jitter.get(p.id) ?? { dx: 0, dy: 0 };
    return { cx: X(p.ageDays) + j.dx, cy: Y(p.progress) + j.dy };
  };

  const unassignedCount = data.points.filter((p) => p.unassigned).length;

  const statBar = (
    <div className="cf-stats" style={{ display: "flex", gap: 28, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid var(--nova-line-soft)" }}>
      <Stat label="Median age" value={<>{medianAge} <span style={{ fontSize: 13, fontWeight: 500, color: "var(--nova-ink-faint)" }}>days</span></>} />
      <Stat label="Unassigned" value={<span style={{ color: unassignedCount > 0 ? "#E4634A" : "var(--nova-ink)" }}>{unassignedCount}</span>} />
      <Stat label="Stuck corner" value={<span style={{ color: data.stuck.length > 0 ? "#E4634A" : "var(--nova-ink)" }}>{data.stuck.length}</span>} />
    </div>
  );

  if (data.points.length === 0) {
    return (
      <div>
        {statBar}
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", color: "var(--nova-ink-faint)", fontSize: 13 }}>
          No open cases to plot.
        </div>
      </div>
    );
  }

  const gridValues = [0, data.stuck_progress_max, 100].filter((v, i, arr) => arr.indexOf(v) === i);
  const gridDays = [0, data.stuck_age, Math.round(maxAge)];

  const toSvgCoords = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * W, y: ((e.clientY - box.top) / box.height) * H };
  };

  const nearest = (pt: { x: number; y: number }): Point | null => {
    let best: Point | null = null, bestD = 14;
    for (const p of data.points) {
      const { cx, cy } = jxy(p);
      const d = Math.hypot(cx - pt.x, cy - pt.y);
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
    const { cx, cy } = jxy(best);
    const box = svgRef.current?.getBoundingClientRect();
    setHover({ p: best, x: (cx / W) * (box?.width ?? W), y: (cy / H) * (box?.height ?? H) });
  }

  function onUp() {
    if (!data || !dragStart || !dragNow) { setDragStart(null); setDragNow(null); return; }
    const moved = Math.hypot(dragNow.x - dragStart.x, dragNow.y - dragStart.y);
    if (moved < DRAG_THRESHOLD) {
      const best = nearest(dragNow);
      if (best) router.push(`${ROUTES.case(best.id)}`);
    } else {
      const x0 = Math.min(dragStart.x, dragNow.x), x1 = Math.max(dragStart.x, dragNow.x);
      const y0 = Math.min(dragStart.y, dragNow.y), y1 = Math.max(dragStart.y, dragNow.y);
      const ids = data.points
        .filter((p) => { const { cx, cy } = jxy(p); return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1; })
        .map((p) => p.id);
      setSelected(new Set(ids));
    }
    setDragStart(null);
    setDragNow(null);
  }

  const selecting = dragStart != null && dragNow != null && Math.hypot(dragNow.x - dragStart.x, dragNow.y - dragStart.y) >= DRAG_THRESHOLD;
  const selectedPoints = data.points.filter((p) => selected.has(p.id));

  return (
    <div>
      <style>{`
        @media (max-width: 760px) {
          .cf-stats { flex-wrap: wrap !important; row-gap: 14px !important; }
          .cf-grid { grid-template-columns: 1fr !important; }
          .cf-aside { margin-top: 16px; }
        }
      `}</style>
      {statBar}
      <div className="cf-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 240px", gap: 18, alignItems: "start" }}>
        <div style={{ position: "relative", border: "1px solid var(--nova-line)", borderRadius: "var(--nova-radius-card)", background: "var(--nova-glass-bg)", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 10, right: 14, fontFamily: "var(--nova-font-body)", fontSize: 10.5, color: "var(--nova-ink-faint)", zIndex: 2, pointerEvents: "none" }}>
            Drag to select
          </div>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${data.points.length} cases plotted by age and progress`}
            style={{ display: "block", width: "100%", height: "auto", cursor: selecting ? "crosshair" : "pointer", userSelect: "none" }}
            onMouseDown={onDown}
            onMouseMove={onMoveSvg}
            onMouseUp={onUp}
            onMouseLeave={() => { setHover(null); setDragStart(null); setDragNow(null); }}
          >
            {/* stuck corner: old + behind-typical progress, bottom-right */}
            <rect
              x={X(data.stuck_age)} y={Y(data.stuck_progress_max)}
              width={X(maxAge) - X(data.stuck_age)} height={Y(0) - Y(data.stuck_progress_max)}
              fill="rgba(228,99,74,.08)" stroke="rgba(228,99,74,.32)" strokeDasharray="3 4"
            />
            <text x={W - PAD_R - 8} y={Y(0) - 8} textAnchor="end" fill="#E4634A" fontFamily="var(--nova-font-body)" fontSize="10" letterSpacing="0.5">
              STUCK · {data.stuck.length} case{data.stuck.length === 1 ? "" : "s"}
            </text>
            {gridValues.map((v) => (
              <g key={v}>
                <line x1={PAD_L} x2={W - PAD_R} y1={Y(v)} y2={Y(v)} stroke="var(--nova-line-soft)" />
                <text x={PAD_L - 8} y={Y(v) + 3} textAnchor="end" fill="var(--nova-ink-faint)" fontFamily="var(--nova-font-body)" fontSize="9.5">{v}%</text>
              </g>
            ))}
            {gridDays.map((d) => (
              <text key={d} x={X(d)} y={H - 9} textAnchor="middle" fill="var(--nova-ink-faint)" fontFamily="var(--nova-font-body)" fontSize="9.5">{d}d</text>
            ))}
            {data.points.map((p) => {
              const isSelected = selected.has(p.id);
              const dimmed = selected.size > 0 && !isSelected;
              const { cx, cy } = jxy(p);
              const color = p.unassigned ? UNASSIGNED_COLOR : ASSIGNED_COLOR;
              return (
                <circle
                  key={p.id}
                  cx={cx} cy={cy} r={(3 + Math.sqrt(p.assetCount) * 1.2) * (isSelected ? 1.25 : 1)}
                  fill={color} fillOpacity={dimmed ? 0.14 : p.stuck || isSelected ? 0.95 : 0.5}
                  stroke={isSelected ? "#fff" : p.stuck ? color : "none"}
                  strokeWidth={isSelected ? 1.6 : p.stuck ? 1.3 : 0}
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
              left: Math.min(Math.max(hover.x - 80, 6), W - 200), top: Math.max(hover.y - 50, 6),
              background: "var(--nova-bg)", border: "1px solid var(--nova-line)", borderRadius: 8,
              padding: "8px 11px", fontSize: 12, minWidth: 160, boxShadow: "0 14px 34px -14px rgba(0,0,0,.9)", zIndex: 5,
            }}>
              <div style={{ fontWeight: 500, color: "var(--nova-ink)", marginBottom: 2 }}>{hover.p.account}</div>
              <div style={{ fontFamily: "var(--nova-font-body)", fontSize: 11, color: "var(--nova-ink-dim)" }}>
                {hover.p.progress}% along · {hover.p.ageDays}d since intake · {hover.p.unassigned ? "unassigned" : "assigned"}
              </div>
            </div>
          )}
        </div>
        <aside className="cf-aside">
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
                {selectedPoints.length} case{selectedPoints.length === 1 ? "" : "s"}
              </p>
              <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                {selectedPoints.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => router.push(ROUTES.case(p.id))}
                    style={{
                      display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline",
                      padding: "9px 0", borderTop: "none", borderLeft: "none", borderRight: "none",
                      borderBottom: "1px solid var(--nova-line-soft)",
                      background: "none", cursor: "pointer", textAlign: "left", width: "100%",
                    }}
                  >
                    <span style={{ fontSize: 12.5, color: "var(--nova-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.account}</span>
                    <span style={{ fontFamily: "var(--nova-font-body)", fontSize: 11, color: "var(--nova-ink-dim)", whiteSpace: "nowrap" }}>{p.progress}% · {p.ageDays}d</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontFamily: "var(--nova-font-body)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#E4634A", marginBottom: 4 }}>
                Stuck corner
              </div>
              <p style={{ fontSize: 12, color: "var(--nova-ink-faint)", margin: "0 0 12px", lineHeight: 1.5 }}>
                Open {data.stuck_age}+ days, {data.stuck_progress_max}% along or less.
              </p>
              <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                {data.stuck.length === 0 && <div style={{ fontSize: 12, color: "var(--nova-ink-faint)" }}>Nothing stuck right now.</div>}
                {data.stuck.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => router.push(ROUTES.case(p.id))}
                    style={{
                      display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline",
                      padding: "9px 0", borderTop: "none", borderLeft: "none", borderRight: "none",
                      borderBottom: "1px solid var(--nova-line-soft)",
                      background: "none", cursor: "pointer", textAlign: "left", width: "100%",
                    }}
                  >
                    <span style={{ fontSize: 12.5, color: "var(--nova-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.account}</span>
                    <span style={{ fontFamily: "var(--nova-font-body)", fontSize: 11, color: "var(--nova-ink-dim)", whiteSpace: "nowrap" }}>{p.progress}% · {p.ageDays}d</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--nova-font-body)", fontSize: 10.5, color: "var(--nova-ink-faint)" }}>
              <i style={{ width: 7, height: 7, borderRadius: "50%", background: ASSIGNED_COLOR, display: "block" }} /> Assigned
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--nova-font-body)", fontSize: 10.5, color: "var(--nova-ink-faint)" }}>
              <i style={{ width: 7, height: 7, borderRadius: "50%", background: UNASSIGNED_COLOR, display: "block" }} /> Unassigned
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
