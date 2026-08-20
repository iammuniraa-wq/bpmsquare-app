"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { isSessionStart, isSessionEnd, type PresenceKind } from "@/lib/wfm/types";

/**
 * The "day column" — the ADP-style vertical bar that grows through the
 * shift. Blue = time on the clock, pink = break. It reads the day's punch
 * events (kind + ts) and draws, bottom to top: check-in at the base, each
 * break as a pink band with its duration, the current open stretch growing
 * live, and check-out (or "now") at the top, with the day's worked total.
 *
 * Height maps to elapsed time (PX_PER_HOUR), capped at MAX_PX so a long day
 * can't run off the card — past the cap the whole column compresses
 * proportionally rather than clipping, so the segments stay to scale. While
 * the employee is still in or on break, `now` ticks so the top segment
 * grows on its own.
 *
 * Pure presentation: no fetch, no mutation. It shows exactly what the punch
 * events already say, which is why a forgotten check-out simply leaves the
 * last stretch open to the end of the shown day rather than inventing time.
 */

type Ev = { kind: PresenceKind; ts: string };
type Seg = { mode: "work" | "break"; start: number; end: number; open: boolean };

const PX_PER_HOUR = 34;
const MAX_PX = 300;
const MIN_SEG_PX = 3;
const WORK = { a: "#60a5fa", b: "#2563eb" }; // light -> deep blue
const BREAK = { a: "#f9a8d4", b: "#ec4899" }; // light -> deep pink

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

export default function DayColumn({
  events, active, workedMinutes, breakMinutes,
}: {
  events: Ev[];
  /** Still in / on break — drives the live tick. */
  active: boolean;
  /** Net worked minutes for the day (from the server's own computation). */
  workedMinutes: number;
  breakMinutes: number;
}) {
  // Starts at 0 so the server render and the first client render agree (no
  // hydration mismatch on a time-derived height); the effect sets the real
  // clock immediately on mount, then ticks it while the day is open.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [active]);

  const liveEnd = active ? (now || maxEnd(events)) : maxEnd(events);
  const { segs, firstIn } = buildSegments(events, liveEnd);
  if (firstIn === null || segs.length === 0) {
    return (
      <div style={{ fontSize: 12, color: c.hint, padding: "8px 2px" }}>
        The day starts when you check in.
      </div>
    );
  }

  const lastEnd = segs[segs.length - 1].end;
  const elapsedMs = lastEnd - firstIn;
  const rawPx = (elapsedMs / 3_600_000) * PX_PER_HOUR;
  const drawPx = Math.max(40, Math.min(MAX_PX, rawPx));
  const scale = rawPx > 0 ? drawPx / rawPx : 1;
  const yOf = (ms: number) => ((ms - firstIn) / 3_600_000) * PX_PER_HOUR * scale;

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-end" }}>
      {/* The bar. Bottom = check-in, top = now / check-out. */}
      <div
        style={{
          position: "relative", width: 40, height: drawPx, borderRadius: 20,
          background: c.panel, border: `1px solid ${c.line}`, overflow: "hidden", flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {segs.map((s, i) => {
          const bottom = yOf(s.start);
          const height = Math.max(MIN_SEG_PX, yOf(s.end) - yOf(s.start));
          const col = s.mode === "work" ? WORK : BREAK;
          return (
            <div
              key={i}
              style={{
                position: "absolute", left: 0, right: 0, bottom, height,
                background: `linear-gradient(0deg, ${col.b}, ${col.a})`,
                boxShadow: s.open ? `0 0 0 1px ${col.b} inset` : undefined,
                transition: "height .5s ease, bottom .5s ease",
              }}
            />
          );
        })}
      </div>

      {/* Labels, aligned to the bar's own boundaries. */}
      <div style={{ position: "relative", height: drawPx, minWidth: 128, flex: 1 }}>
        {/* check-in (base) */}
        <Label y={0} align="bottom" dot={WORK.b} time={t(firstIn)} text="Checked in" />
        {segs.map((s, i) => {
          if (s.mode !== "break") return null;
          const midY = (yOf(s.start) + yOf(s.end)) / 2;
          const mins = Math.round((s.end - s.start) / 60000);
          return <Label key={i} y={midY} align="mid" dot={BREAK.b} time={`${t(s.start)}–${t(s.end)}`} text={`Break · ${mins}m`} muted />;
        })}
        {/* top: now (open) or check-out */}
        {segs[segs.length - 1].open ? (
          <Label y={drawPx} align="top" dot={WORK.b} time={t(lastEnd)} text="Now" />
        ) : (
          <Label y={drawPx} align="top" dot="#ef4444" time={t(lastEnd)} text="Checked out" />
        )}
      </div>

      {/* The running total, like ADP's figure at the end. */}
      <div style={{ textAlign: "right", flexShrink: 0, alignSelf: "flex-start" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: c.hint }}>Worked</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{hm(workedMinutes)}</div>
        {breakMinutes > 0 && <div style={{ fontSize: 11, color: BREAK.b, marginTop: 2 }}>{hm(breakMinutes)} break</div>}
      </div>
    </div>
  );
}

function maxEnd(events: Ev[]): number {
  return events.reduce((m, e) => Math.max(m, new Date(e.ts).getTime()), 0) || Date.now();
}

function Label({
  y, align, dot, time, text, muted,
}: {
  y: number; align: "bottom" | "mid" | "top"; dot: string; time: string; text: string; muted?: boolean;
}) {
  // y is measured from the BAR's base (bottom). Convert to a `bottom` offset
  // and nudge so the row centers on its boundary.
  const style: React.CSSProperties = {
    position: "absolute", left: 0, bottom: y, transform: "translateY(50%)",
    display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
  };
  if (align === "bottom") { style.transform = "translateY(50%)"; }
  if (align === "top") { style.transform = "translateY(50%)"; }
  return (
    <div style={style}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: dot, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: muted ? c.muted : c.ink, fontVariantNumeric: "tabular-nums" }}>{time}</span>
      <span style={{ fontSize: 11.5, color: c.hint }}>{text}</span>
    </div>
  );
}
