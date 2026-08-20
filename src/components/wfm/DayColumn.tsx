"use client";

import { c } from "@/lib/theme";
import { isSessionStart, isSessionEnd, type PresenceKind } from "@/lib/wfm/types";

/**
 * The "day column" — the ADP-style cylinder that grows through the shift.
 * Drawn as a real 3D cylinder (elliptical top cap, curved base): blue for
 * time on the clock, pink for breaks, stacked bottom to top. Check-in is at
 * the base, each break a pink band with its duration, the current open
 * stretch growing live, and check-out (or "now") at the top, with the day's
 * worked total beside it.
 *
 * Height maps to elapsed time (PX_PER_HOUR), floored so it always reads as a
 * cylinder and capped at MAX so a long day can't run off the card — past the
 * cap it compresses proportionally rather than clipping.
 *
 * Pure presentation: the parent owns the live clock (`now`) and the already-
 * computed worked/break minutes, so the bar and the number tick as one.
 */

type Ev = { kind: PresenceKind; ts: string };
type Seg = { mode: "work" | "break"; start: number; end: number; open: boolean };

const PX_PER_HOUR = 44;
const MIN_PX = 170;   // always tall enough to read as a real cylinder
const MAX_PX = 320;
const RX = 46;   // cylinder radius (x)
const RY = 13;   // cap ellipse radius (y) — the "3D" flatten
const PAD = 6;

const WORK = { edge: "1D4ED8", mid: "60A5FA", lid: "93C5FD" };
const BREAK = { edge: "9D174D", mid: "F472B6", lid: "F9A8D4" };

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;
const t = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

function buildSegments(events: Ev[], now: number): { segs: Seg[]; firstIn: number | null } {
  const sorted = [...events].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const segs: Seg[] = [];
  let mode: "out" | "work" | "break" = "out";
  let start = 0;
  let firstIn: number | null = null;

  for (const e of sorted) {
    const ms = new Date(e.ts).getTime();
    if (isSessionStart(e.kind) || e.kind === "ot_in") {
      if (mode === "out") { mode = "work"; start = ms; if (firstIn === null) firstIn = ms; }
    } else if (e.kind === "break_start") {
      if (mode === "work") { segs.push({ mode: "work", start, end: ms, open: false }); mode = "break"; start = ms; }
    } else if (e.kind === "break_end") {
      if (mode === "break") { segs.push({ mode: "break", start, end: ms, open: false }); mode = "work"; start = ms; }
    } else if (isSessionEnd(e.kind) || e.kind === "ot_out") {
      if (mode !== "out") { segs.push({ mode, start, end: ms, open: false }); mode = "out"; start = 0; }
    }
  }
  if (mode !== "out") segs.push({ mode, start, end: now, open: true });
  return { segs, firstIn };
}

function maxEnd(events: Ev[]): number {
  return events.reduce((m, e) => Math.max(m, new Date(e.ts).getTime()), 0) || Date.now();
}

export default function DayColumn({
  events, now, workedMinutes, breakMinutes,
}: {
  events: Ev[];
  /** Live clock (ms) owned by the parent; 0 = not mounted yet. */
  now: number;
  workedMinutes: number;
  breakMinutes: number;
}) {
  const liveEnd = now || maxEnd(events);
  const { segs, firstIn } = buildSegments(events, liveEnd);
  if (firstIn === null || segs.length === 0) {
    return <div style={{ fontSize: 12, color: c.hint, padding: "8px 2px" }}>The day starts when you check in.</div>;
  }

  const lastEnd = segs[segs.length - 1].end;
  const elapsedMs = lastEnd - firstIn;
  const rawPx = (elapsedMs / 3_600_000) * PX_PER_HOUR;
  const bodyH = Math.max(MIN_PX, Math.min(MAX_PX, rawPx));
  const scale = rawPx > 0 ? bodyH / rawPx : 1;
  // distance from the base (check-in, bottom) upward, 0..bodyH
  const upFromBase = (ms: number) => ((ms - firstIn) / 3_600_000) * PX_PER_HOUR * scale;

  const svgW = 2 * RX + 2 * PAD, cx = PAD + RX;
  const svgH = bodyH + 2 * RY;
  const baseCy = RY + bodyH;   // bottom ellipse centre (y from top)
  const yTopOf = (ms: number) => RY + (bodyH - upFromBase(ms)); // segment edge, svg-y

  const topSeg = segs[segs.length - 1];
  const topLid = topSeg.mode === "work" ? WORK.lid : BREAK.lid;

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ flexShrink: 0, overflow: "visible" }} aria-hidden="true">
        <defs>
          <linearGradient id="dc-work" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={`#${WORK.edge}`} /><stop offset="0.5" stopColor={`#${WORK.mid}`} /><stop offset="1" stopColor={`#${WORK.edge}`} />
          </linearGradient>
          <linearGradient id="dc-break" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={`#${BREAK.edge}`} /><stop offset="0.5" stopColor={`#${BREAK.mid}`} /><stop offset="1" stopColor={`#${BREAK.edge}`} />
          </linearGradient>
          <clipPath id="dc-body">
            <rect x={cx - RX} y={RY} width={2 * RX} height={bodyH} />
            <ellipse cx={cx} cy={RY} rx={RX} ry={RY} />
            <ellipse cx={cx} cy={baseCy} rx={RX} ry={RY} />
          </clipPath>
        </defs>

        {/* Filled segments, clipped to the cylinder silhouette. */}
        <g clipPath="url(#dc-body)">
          {segs.map((s, i) => {
            const yTop = yTopOf(s.end);
            const yBot = yTopOf(s.start);
            return (
              <rect key={i} x={cx - RX} y={yTop} width={2 * RX} height={Math.max(0.5, yBot - yTop)}
                fill={s.mode === "work" ? "url(#dc-work)" : "url(#dc-break)"} />
            );
          })}
        </g>

        {/* The visible top face (the 3D lid), coloured by the current stretch. */}
        <ellipse cx={cx} cy={RY} rx={RX} ry={RY} fill={`#${topLid}`} stroke="rgba(0,0,0,0.28)" strokeWidth="1" />

        {/* Outline: sides, front-bottom curve. */}
        <path d={`M ${cx - RX} ${RY} L ${cx - RX} ${baseCy}`} stroke="rgba(0,0,0,0.28)" strokeWidth="1" fill="none" />
        <path d={`M ${cx + RX} ${RY} L ${cx + RX} ${baseCy}`} stroke="rgba(0,0,0,0.28)" strokeWidth="1" fill="none" />
        <path d={`M ${cx - RX} ${baseCy} A ${RX} ${RY} 0 0 0 ${cx + RX} ${baseCy}`} stroke="rgba(0,0,0,0.28)" strokeWidth="1" fill="none" />
      </svg>

      {/* Labels, aligned to the cylinder's own boundaries. */}
      <div style={{ position: "relative", height: svgH, minWidth: 150, flex: 1 }}>
        <Label bottom={RY} dot={WORK.edge} time={t(firstIn)} text="Checked in" />
        {segs.map((s, i) => {
          if (s.mode !== "break") return null;
          const midBottom = RY + (upFromBase(s.start) + upFromBase(s.end)) / 2;
          const mins = Math.round((s.end - s.start) / 60000);
          return <Label key={i} bottom={midBottom} dot={BREAK.edge} time={`${t(s.start)}–${t(s.end)}`} text={`Break · ${mins}m`} muted />;
        })}
        {topSeg.open
          ? <Label bottom={RY + bodyH} dot={WORK.edge} time={t(lastEnd)} text="Now" />
          : <Label bottom={RY + bodyH} dot="ef4444" time={t(lastEnd)} text="Checked out" />}
      </div>

      {/* The running total. */}
      <div style={{ textAlign: "right", flexShrink: 0, alignSelf: "flex-start" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: c.hint }}>Worked</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{hm(workedMinutes)}</div>
        {breakMinutes > 0 && <div style={{ fontSize: 11, color: `#${BREAK.edge}`, marginTop: 2 }}>{hm(breakMinutes)} break</div>}
      </div>
    </div>
  );
}

function Label({ bottom, dot, time, text, muted }: { bottom: number; dot: string; time: string; text: string; muted?: boolean }) {
  return (
    <div style={{ position: "absolute", left: 0, bottom, transform: "translateY(50%)", display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: `#${dot}`, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: muted ? c.muted : c.ink, fontVariantNumeric: "tabular-nums" }}>{time}</span>
      <span style={{ fontSize: 11.5, color: c.hint }}>{text}</span>
    </div>
  );
}
