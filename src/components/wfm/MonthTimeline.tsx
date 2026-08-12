"use client";

import { useMemo, useState } from "react";
import { c, pillar } from "@/lib/theme";

// ── Types (structurally matching EmployeeDayRecord, kept local so this stays
// a pure presentational component usable from any WFM screen) ───────────────

export type TimelineBreak = { start: string; end: string | null; minutes: number };
export type TimelineSession = { in: string; out: string | null; breaks: TimelineBreak[] };
export type TimelineOtSegment = { start: string; end: string; minutes: number; status: string };

export type TimelineDay = {
  date: string;
  sessions: TimelineSession[];
  breaks: TimelineBreak[];
  net_minutes: number;
  gross_minutes: number;
  break_minutes: number;
  late: boolean;
  absent: boolean;
  incomplete: boolean;
  on_leave: { name: string; category: string; half_day?: boolean } | null;
  holiday: string | null;
  is_week_off: boolean;
  ot_minutes: number;
  ot_pending_minutes: number;
  ot_segments: TimelineOtSegment[];
};

// ── Palette ────────────────────────────────────────────────────────────────
// Three categorical segment types (work / break / overtime), validated for
// CVD separation and contrast in BOTH light and dark surfaces before use.
// Segment identity is never colour-alone: every bar carries a legend, a
// hover tooltip and a text summary per row.
const SEG = {
  work: pillar.teal.base,   // #1d9e75
  brk: pillar.amber.base,   // #ba7517
  ot: pillar.purple.base,   // #7f77dd
};

const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

const fmtHM = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const clockOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

/** Minutes from the day's local midnight, for positioning on the 24h axis.
 * A segment that started the previous day (an OT block that ran past
 * midnight belongs to its START day) clamps to 0 rather than going negative. */
function minutesFromMidnight(iso: string, dayKey: string): number {
  const d = new Date(iso);
  const localDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const mins = d.getHours() * 60 + d.getMinutes();
  if (localDay === dayKey) return mins;
  return localDay < dayKey ? 0 : 24 * 60 + mins; // before this day → clamp; after → past-midnight
}

type Band = {
  leftPct: number; widthPct: number; color: string;
  label: string; detail: string; pending: boolean;
};

/** Turn one day's sessions/breaks/OT into positioned bands on the 24h axis. */
function bandsFor(day: TimelineDay): Band[] {
  const DAY_MIN = 24 * 60;
  const bands: Band[] = [];
  const push = (fromMin: number, toMin: number, color: string, label: string, detail: string, pending: boolean) => {
    // Anything past midnight is drawn clipped at the axis end -- the row is
    // one calendar day; the tooltip still states the real end time.
    const from = Math.max(0, Math.min(DAY_MIN, fromMin));
    const to = Math.max(0, Math.min(DAY_MIN, toMin));
    if (to <= from) return;
    bands.push({
      leftPct: (from / DAY_MIN) * 100,
      widthPct: ((to - from) / DAY_MIN) * 100,
      color, label, detail, pending,
    });
  };

  for (const s of day.sessions) {
    const from = minutesFromMidnight(s.in, day.date);
    const to = s.out ? minutesFromMidnight(s.out, day.date) : DAY_MIN;
    push(from, to, SEG.work, "Work",
      `${clockOf(s.in)} – ${s.out ? clockOf(s.out) : "in progress"}`, false);
  }
  for (const b of day.breaks) {
    if (!b.end) continue;
    push(minutesFromMidnight(b.start, day.date), minutesFromMidnight(b.end, day.date),
      SEG.brk, "Break", `${clockOf(b.start)} – ${clockOf(b.end)} · ${fmtHM(b.minutes)}`, false);
  }
  for (const o of day.ot_segments) {
    if (o.status === "rejected") continue;
    push(minutesFromMidnight(o.start, day.date), minutesFromMidnight(o.end, day.date),
      SEG.ot, "Overtime",
      `${clockOf(o.start)} – ${clockOf(o.end)} · ${fmtHM(o.minutes)}${o.status === "pending" ? " · awaiting approval" : ""}`,
      o.status === "pending");
  }
  return bands;
}

/** The non-working reason for a day, if any -- rendered as a full-width
 * tinted band with its own label instead of segments. */
function dayState(day: TimelineDay): { label: string; tone: string } | null {
  if (day.holiday) return { label: day.holiday, tone: pillar.green.base };
  if (day.on_leave) return { label: `${day.on_leave.name}${day.on_leave.half_day ? " (half day)" : ""}`, tone: pillar.blue.base };
  if (day.is_week_off) return { label: "Week off", tone: c.hint };
  if (day.absent) return { label: "Absent", tone: pillar.red.base };
  return null;
}

/**
 * Adobe-Zeiterfassung-style month view: one calendar month per page, one
 * horizontal bar per day against a shared 24-hour axis, so an employee reads
 * a whole month's rhythm (late starts, long days, overtime) at a glance
 * instead of scanning a table of numbers.
 *
 * Anything awaiting supervisor approval renders faded with a dashed outline
 * -- one visual convention for "not final yet", covering both pending
 * overtime and a day with an open correction request. Clicking any row opens
 * the detail popup, where a correction can be raised for that date.
 */
export default function MonthTimeline({
  days, month, pendingCorrectionDates = [], onRequestCorrection,
}: {
  days: TimelineDay[];
  month: string; // YYYY-MM
  /** Dates with an open correction request -- rendered faded, like pending OT. */
  pendingCorrectionDates?: string[];
  onRequestCorrection?: (date: string) => void;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);
  const pendingSet = useMemo(() => new Set(pendingCorrectionDates), [pendingCorrectionDates]);

  const totals = useMemo(() => ({
    worked: days.reduce((s, d) => s + d.net_minutes, 0),
    ot: days.reduce((s, d) => s + d.ot_minutes, 0),
    otPending: days.reduce((s, d) => s + d.ot_pending_minutes, 0),
  }), [days]);

  const openDay = openDate ? days.find((d) => d.date === openDate) ?? null : null;
  const hasOt = days.some((d) => d.ot_segments.length > 0);

  return (
    <div>
      {/* Legend — identity is never colour-alone; every band is also named in
          its tooltip and in the row's own text summary. */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        {[
          { color: SEG.work, label: "Work" },
          { color: SEG.brk, label: "Break" },
          ...(hasOt ? [{ color: SEG.ot, label: "Overtime" }] : []),
        ].map((l) => (
          <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: c.muted }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
            {l.label}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: c.muted }}>
          <span style={{
            width: 10, height: 10, borderRadius: 3, background: SEG.ot,
            opacity: 0.35, outline: `1px dashed ${SEG.ot}`, outlineOffset: 1,
          }} />
          Awaiting approval
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: c.hint }}>
          Worked <strong style={{ color: c.ink }}>{fmtHM(totals.worked)}</strong>
          {totals.ot > 0 && <> · OT <strong style={{ color: c.ink }}>{fmtHM(totals.ot)}</strong></>}
          {totals.otPending > 0 && <> · <span style={{ color: pillar.amber.fg }}>{fmtHM(totals.otPending)} pending</span></>}
        </span>
      </div>

      {/* Hour axis */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ width: 74, flexShrink: 0 }} />
        <div style={{ position: "relative", flex: 1, height: 14 }}>
          {HOUR_TICKS.map((h) => (
            <span
              key={h}
              style={{
                position: "absolute", left: `${(h / 24) * 100}%`,
                transform: h === 0 ? "none" : h === 24 ? "translateX(-100%)" : "translateX(-50%)",
                fontSize: 10, color: c.hint, fontVariantNumeric: "tabular-nums",
              }}
            >{String(h).padStart(2, "0")}</span>
          ))}
        </div>
        <div style={{ width: 92, flexShrink: 0 }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {days.map((day) => {
          const bands = bandsFor(day);
          const state = dayState(day);
          const dayNum = Number(day.date.slice(8, 10));
          const weekday = new Date(`${day.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short" });
          const isPending = pendingSet.has(day.date) || day.ot_pending_minutes > 0;
          const isFuture = day.date > new Date().toISOString().slice(0, 10);

          return (
            <button
              key={day.date}
              type="button"
              onClick={() => setOpenDate(day.date)}
              title={`${day.date} — click for detail`}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                background: openDate === day.date ? c.panel2 : "transparent",
                border: "none", borderRadius: 6, padding: "3px 4px", cursor: "pointer", textAlign: "left",
              }}
            >
              {/* Date */}
              <span style={{ width: 74, flexShrink: 0, fontSize: 11.5, color: c.muted, fontVariantNumeric: "tabular-nums" }}>
                <strong style={{ color: day.late ? pillar.amber.fg : c.ink, fontWeight: 700 }}>{String(dayNum).padStart(2, "0")}</strong>
                <span style={{ marginLeft: 5, opacity: 0.75 }}>{weekday}</span>
              </span>

              {/* Track */}
              <span style={{
                position: "relative", flex: 1, height: 18, borderRadius: 5,
                background: c.panel2, overflow: "hidden", display: "block",
              }}>
                {/* recessive hour gridlines */}
                {HOUR_TICKS.slice(1, -1).map((h) => (
                  <span key={h} style={{
                    position: "absolute", left: `${(h / 24) * 100}%`, top: 0, bottom: 0,
                    width: 1, background: c.line, opacity: 0.6,
                  }} />
                ))}

                {state && !bands.length ? (
                  <span style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    paddingLeft: 8, fontSize: 10.5, color: state.tone,
                    background: `${state.tone}14`,
                  }}>{state.label}</span>
                ) : null}

                {bands.map((b, i) => (
                  <span
                    key={i}
                    title={`${b.label} · ${b.detail}`}
                    style={{
                      position: "absolute", left: `${b.leftPct}%`, width: `${b.widthPct}%`,
                      top: 3, bottom: 3, borderRadius: 4,
                      background: b.color,
                      // 2px surface gap between adjacent fills so touching
                      // segments stay individually readable.
                      boxShadow: `0 0 0 2px ${c.panel2}`,
                      opacity: b.pending ? 0.35 : 1,
                      outline: b.pending ? `1px dashed ${b.color}` : "none",
                      outlineOffset: -1,
                    }}
                  />
                ))}
              </span>

              {/* Row summary — the numeric read, so the bar is never the only
                  channel carrying the value. */}
              <span style={{ width: 92, flexShrink: 0, textAlign: "right", fontSize: 11, color: c.hint, fontVariantNumeric: "tabular-nums" }}>
                {isFuture ? "" : day.net_minutes > 0 ? fmtHM(day.net_minutes) : state ? "" : "—"}
                {day.ot_minutes > 0 && <span style={{ color: SEG.ot, marginLeft: 4 }}>+{fmtHM(day.ot_minutes)}</span>}
                {isPending && <span title="Awaiting approval" style={{ color: pillar.amber.fg, marginLeft: 4 }}>●</span>}
              </span>
            </button>
          );
        })}
      </div>

      {openDay && (
        <DayDetail
          day={openDay}
          hasPendingCorrection={pendingSet.has(openDay.date)}
          onClose={() => setOpenDate(null)}
          onRequestCorrection={onRequestCorrection}
        />
      )}
      {days.length === 0 && (
        <div style={{ fontSize: 12.5, color: c.hint, padding: "24px 0", textAlign: "center" }}>
          No attendance recorded for {month}.
        </div>
      )}
    </div>
  );
}

function DayDetail({ day, hasPendingCorrection, onClose, onRequestCorrection }: {
  day: TimelineDay;
  hasPendingCorrection: boolean;
  onClose: () => void;
  onRequestCorrection?: (date: string) => void;
}) {
  const state = dayState(day);
  const pretty = new Date(`${day.date}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 600 }} />
      <div
        role="dialog"
        aria-label={`Attendance detail for ${pretty}`}
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          zIndex: 601, width: "min(520px, calc(100vw - 32px))", maxHeight: "80vh", overflowY: "auto",
          background: c.panel, border: `1px solid ${c.line}`, borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,.35)", padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.ink }}>{pretty}</div>
            {state && <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{state.label}</div>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: c.hint, fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 16 }}>
          <Stat label="Worked" value={fmtHM(day.net_minutes)} />
          {day.break_minutes > 0 && <Stat label="Breaks" value={fmtHM(day.break_minutes)} />}
          {day.ot_minutes > 0 && <Stat label="Overtime" value={fmtHM(day.ot_minutes)} tone={SEG.ot} />}
          {day.ot_pending_minutes > 0 && <Stat label="OT pending" value={fmtHM(day.ot_pending_minutes)} tone={pillar.amber.fg} />}
        </div>

        {(day.late || day.incomplete) && (
          <div style={{ fontSize: 12, color: pillar.amber.fg, marginBottom: 12 }}>
            {day.late && "Marked late. "}
            {day.incomplete && "No check-out recorded for this day."}
          </div>
        )}

        <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
          Punches
        </div>
        {day.sessions.length === 0 && day.ot_segments.length === 0 ? (
          <div style={{ fontSize: 12.5, color: c.hint, marginBottom: 14 }}>No punches recorded.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
            {day.sessions.map((s, i) => (
              <Line key={`s${i}`} color={SEG.work} label="Work"
                detail={`${clockOf(s.in)} – ${s.out ? clockOf(s.out) : "in progress"}`} />
            ))}
            {day.breaks.filter((b) => b.end).map((b, i) => (
              <Line key={`b${i}`} color={SEG.brk} label="Break"
                detail={`${clockOf(b.start)} – ${clockOf(b.end!)} · ${fmtHM(b.minutes)}`} />
            ))}
            {day.ot_segments.map((o, i) => (
              <Line key={`o${i}`} color={SEG.ot} label="Overtime"
                detail={`${clockOf(o.start)} – ${clockOf(o.end)} · ${fmtHM(o.minutes)}`}
                badge={o.status === "approved" ? undefined : o.status === "pending" ? "awaiting approval" : "rejected"}
                faded={o.status !== "approved"} />
            ))}
          </div>
        )}

        {hasPendingCorrection && (
          <div style={{ fontSize: 12, color: pillar.amber.fg, marginBottom: 10 }}>
            A correction request for this day is awaiting approval.
          </div>
        )}

        {onRequestCorrection && (
          <button
            onClick={() => { onRequestCorrection(day.date); onClose(); }}
            style={{
              padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: "none", background: "var(--tenant-accent, #378ADD)", color: "#fff",
            }}
          >Request a correction for this day</button>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: tone ?? c.ink, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Line({ color, label, detail, badge, faded }: {
  color: string; label: string; detail: string; badge?: string; faded?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: faded ? 0.7 : 1 }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color, flexShrink: 0, opacity: faded ? 0.45 : 1 }} />
      <span style={{ fontSize: 12.5, color: c.ink, fontWeight: 600, minWidth: 68 }}>{label}</span>
      <span style={{ fontSize: 12.5, color: c.muted, fontVariantNumeric: "tabular-nums" }}>{detail}</span>
      {badge && (
        <span style={{ fontSize: 10.5, color: pillar.amber.fg, marginLeft: "auto" }}>{badge}</span>
      )}
    </div>
  );
}
