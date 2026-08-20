"use client";

import { c } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";
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
const RX = 48;   // cylinder radius (x)
const RY = 14;   // cap ellipse radius (y) — the "3D" flatten
const PAD = 10;

const WORK = { edge: "2A55B8", g1: "4A7CE4", hi: "A6C8FF", g2: "3E70DC", lid: "CBE0FF", dot: "3B82F6" };
const BREAK = { edge: "C0468A", g1: "E162A6", hi: "FCC8E4", g2: "D2559A", lid: "FBDAEE", dot: "EC4899" };

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
  const isMobile = useIsMobile();
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
  const svgH = bodyH + 2 * RY + 14; // +room for the ground shadow
  const baseCy = RY + bodyH;   // bottom ellipse centre (y from top)
  const yTopOf = (ms: number) => RY + (bodyH - upFromBase(ms)); // segment edge, svg-y

  const topSeg = segs[segs.length - 1];
  const topC = topSeg.mode === "work" ? WORK : BREAK;
  // internal boundaries (between adjacent segments) for the liquid-layer line
  const boundaries = segs.slice(1).map((s) => yTopOf(s.start));

  const worked = (
    <div style={{ textAlign: isMobile ? "left" : "right", flexShrink: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: c.hint }}>Worked</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{hm(workedMinutes)}</div>
      {breakMinutes > 0 && <div style={{ fontSize: 11, color: `#${BREAK.dot}`, marginTop: 2 }}>{hm(breakMinutes)} break</div>}
    </div>
  );

  return (
    <div>
    <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "nowrap" }}>
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ flexShrink: 0, overflow: "visible" }} aria-hidden="true">
        <defs>
          {[["work", WORK], ["break", BREAK]].map(([id, k]) => {
            const col = k as typeof WORK;
            return (
              <linearGradient key={id as string} id={`dc-${id}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={`#${col.edge}`} />
                <stop offset="0.16" stopColor={`#${col.g1}`} />
                <stop offset="0.34" stopColor={`#${col.hi}`} />
                <stop offset="0.52" stopColor={`#${col.g1}`} />
                <stop offset="0.80" stopColor={`#${col.g2}`} />
                <stop offset="1" stopColor={`#${col.edge}`} />
              </linearGradient>
            );
          })}
          {/* continuous glass gloss across the whole body */}
          <linearGradient id="dc-gloss" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.07" stopColor="#fff" stopOpacity="0.10" />
            <stop offset="0.17" stopColor="#fff" stopOpacity="0.62" />
            <stop offset="0.26" stopColor="#fff" stopOpacity="0.12" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.8" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.9" stopColor="#fff" stopOpacity="0.16" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          {/* top surface: bright toward the light, tinted by the current stretch */}
          <radialGradient id="dc-lid" cx="0.4" cy="0.32" r="0.85">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="0.45" stopColor={`#${topC.lid}`} stopOpacity="0.98" />
            <stop offset="1" stopColor={`#${topC.g1}`} stopOpacity="0.98" />
          </radialGradient>
          <clipPath id="dc-body">
            <rect x={cx - RX} y={RY} width={2 * RX} height={bodyH} />
            <ellipse cx={cx} cy={RY} rx={RX} ry={RY} />
            <ellipse cx={cx} cy={baseCy} rx={RX} ry={RY} />
          </clipPath>
          <filter id="dc-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        {/* ground shadow */}
        <ellipse cx={cx} cy={baseCy + 9} rx={RX * 0.82} ry={RY * 0.7} fill="#000" opacity="0.22" filter="url(#dc-soft)" />

        <g clipPath="url(#dc-body)">
          {/* segment fills */}
          {segs.map((s, i) => {
            const yTop = yTopOf(s.end), yBot = yTopOf(s.start);
            return (
              <rect key={i} x={cx - RX} y={yTop} width={2 * RX} height={Math.max(0.5, yBot - yTop)}
                fill={s.mode === "work" ? "url(#dc-work)" : "url(#dc-break)"} opacity="0.92" />
            );
          })}
          {/* liquid-layer separators */}
          {boundaries.map((y, i) => (
            <rect key={`b${i}`} x={cx - RX} y={y - 0.75} width={2 * RX} height="1.5" fill="#000" opacity="0.16" />
          ))}
          {/* the continuous gloss on top of everything */}
          <rect x={cx - RX} y={RY - RY} width={2 * RX} height={bodyH + 2 * RY} fill="url(#dc-gloss)" />
          {/* inner rim shading at the very edges for glass thickness */}
          <rect x={cx - RX} y={RY} width={3.5} height={bodyH} fill="#000" opacity="0.16" />
          <rect x={cx + RX - 3.5} y={RY} width={3.5} height={bodyH} fill="#000" opacity="0.22" />
        </g>

        {/* back rim of the base (see-through hint) */}
        <path d={`M ${cx - RX} ${baseCy} A ${RX} ${RY} 0 0 1 ${cx + RX} ${baseCy}`} stroke="#fff" strokeOpacity="0.18" strokeWidth="1" fill="none" />

        {/* the glossy top surface */}
        <ellipse cx={cx} cy={RY} rx={RX} ry={RY} fill="url(#dc-lid)" stroke="#fff" strokeOpacity="0.55" strokeWidth="1" />
        {/* specular glint on the lid */}
        <ellipse cx={cx - RX * 0.34} cy={RY - RY * 0.28} rx={RX * 0.30} ry={RY * 0.34} fill="#fff" opacity="0.5" filter="url(#dc-soft)" />

        {/* silhouette: edges + front-bottom curve */}
        <path d={`M ${cx - RX} ${RY} L ${cx - RX} ${baseCy}`} stroke="#fff" strokeOpacity="0.35" strokeWidth="1" fill="none" />
        <path d={`M ${cx + RX} ${RY} L ${cx + RX} ${baseCy}`} stroke="#000" strokeOpacity="0.30" strokeWidth="1" fill="none" />
        <path d={`M ${cx - RX} ${baseCy} A ${RX} ${RY} 0 0 0 ${cx + RX} ${baseCy}`} stroke="#000" strokeOpacity="0.30" strokeWidth="1.2" fill="none" />
      </svg>

      {/* Labels, aligned to the cylinder's own boundaries. */}
      <div style={{ position: "relative", height: svgH, minWidth: 0, flex: 1 }}>
        <Label bottom={RY} dot={WORK.dot} time={t(firstIn)} text="Checked in" mobile={isMobile} />
        {segs.map((s, i) => {
          if (s.mode !== "break") return null;
          const midBottom = RY + (upFromBase(s.start) + upFromBase(s.end)) / 2;
          const mins = Math.round((s.end - s.start) / 60000);
          // Full range on desktop; just the start + duration on a phone so it
          // never overruns the label column beside the cylinder.
          const time = isMobile ? t(s.start) : `${t(s.start)}–${t(s.end)}`;
          return <Label key={i} bottom={midBottom} dot={BREAK.dot} time={time} text={`Break · ${mins}m`} muted mobile={isMobile} />;
        })}
        {topSeg.open
          ? <Label bottom={RY + bodyH} dot={WORK.dot} time={t(lastEnd)} text="Now" mobile={isMobile} />
          : <Label bottom={RY + bodyH} dot="ef4444" time={t(lastEnd)} text="Checked out" mobile={isMobile} />}
      </div>

      {/* Worked total — beside the cylinder on desktop. */}
      {!isMobile && <div style={{ alignSelf: "flex-start" }}>{worked}</div>}
    </div>
    {/* On a phone the total drops below, full width, so the labels keep the room. */}
    {isMobile && <div style={{ marginTop: 12 }}>{worked}</div>}
    </div>
  );
}

function Label({ bottom, dot, time, text, muted, mobile }: { bottom: number; dot: string; time: string; text: string; muted?: boolean; mobile?: boolean }) {
  return (
    <div style={{ position: "absolute", left: 0, bottom, transform: "translateY(50%)", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", maxWidth: "100%" }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: `#${dot}`, flexShrink: 0 }} />
      <span style={{ fontSize: mobile ? 11.5 : 12, fontWeight: 700, color: muted ? c.muted : c.ink, fontVariantNumeric: "tabular-nums" }}>{time}</span>
      <span style={{ fontSize: mobile ? 11 : 11.5, color: c.hint, overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
    </div>
  );
}
