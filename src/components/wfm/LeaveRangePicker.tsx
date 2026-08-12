"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { c, pillar } from "@/lib/theme";

export type LeaveDayContext = {
  /** Holiday name, if this date is a company holiday. */
  holiday?: string;
  /** Existing approved/pending leave on this date, so the same day isn't
   * requested twice by accident. */
  existingLeave?: string;
  /** Weekly off (from the tenant's week_off_days config). */
  weekOff?: boolean;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function dayKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function addMonths(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}
/** Monday-first weekday index (0 = Mon … 6 = Sun). */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * ADP-style range picker for leave: click a day to start, drag across to
 * take a consecutive range, click a selected day to drop it. The selection
 * is a contiguous from→to range (which is what wfm_leave_requests stores),
 * so dragging is the primary gesture rather than ticking individual days.
 *
 * Days that already carry something -- a company holiday, an existing leave
 * request, a weekly off -- are marked so an employee can see BEFORE
 * submitting that a day wouldn't count, instead of finding out after a
 * supervisor rejects it. They stay selectable (a range often spans a
 * weekend); the count of working days is shown separately.
 */
export default function LeaveRangePicker({
  from, to, onChange, context = {}, minDate,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
  /** date (YYYY-MM-DD) -> what's already on that day. */
  context?: Record<string, LeaveDayContext>;
  /** Dates before this can't be selected (defaults to no limit). */
  minDate?: string;
}) {
  const [visibleMonth, setVisibleMonth] = useState<string>(() => (from ? from.slice(0, 7) : monthKey(new Date())));
  const [dragging, setDragging] = useState(false);
  const anchorRef = useRef<string | null>(null);

  // A drag that ends outside the grid (or outside the window) must still
  // stop -- otherwise the next hover keeps extending the range.
  useEffect(() => {
    if (!dragging) return;
    const stop = () => { setDragging(false); anchorRef.current = null; };
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchend", stop);
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchend", stop);
    };
  }, [dragging]);

  const cells = useMemo(() => {
    const [y, m] = visibleMonth.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const lead = mondayIndex(first);
    const out: ({ key: string; day: number } | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push({ key: dayKey(y, m - 1, d), day: d });
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [visibleMonth]);

  const inRange = (key: string) => !!from && !!to && key >= from && key <= to;
  const selectable = (key: string) => !minDate || key >= minDate;

  function startAt(key: string) {
    if (!selectable(key)) return;
    // Clicking inside the current selection clears it (ADP's "click a
    // selected day to remove it", applied to the whole range).
    if (inRange(key) && from === to) {
      onChange(null, null);
      return;
    }
    anchorRef.current = key;
    setDragging(true);
    onChange(key, key);
  }

  function extendTo(key: string) {
    if (!dragging || !anchorRef.current || !selectable(key)) return;
    const a = anchorRef.current;
    onChange(a <= key ? a : key, a <= key ? key : a);
  }

  const selectedCount = useMemo(() => {
    if (!from || !to) return 0;
    let n = 0;
    for (let d = new Date(`${from}T00:00:00`); d <= new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1)) n++;
    return n;
  }, [from, to]);

  // Days in the selection that already carry a holiday / week-off / existing
  // leave -- the "this probably won't all count" hint.
  const noteworthy = useMemo(() => {
    if (!from || !to) return [] as { key: string; note: string }[];
    const out: { key: string; note: string }[] = [];
    for (let d = new Date(`${from}T00:00:00`); d <= new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1)) {
      const key = dayKey(d.getFullYear(), d.getMonth(), d.getDate());
      const ctx = context[key];
      if (ctx?.holiday) out.push({ key, note: ctx.holiday });
      else if (ctx?.existingLeave) out.push({ key, note: ctx.existingLeave });
      else if (ctx?.weekOff) out.push({ key, note: "Week off" });
    }
    return out;
  }, [from, to, context]);

  const navBtn: React.CSSProperties = {
    border: `1px solid ${c.line}`, background: c.panel, color: c.muted,
    borderRadius: 7, width: 28, height: 28, cursor: "pointer", fontSize: 13, lineHeight: 1,
  };

  return (
    <div style={{ userSelect: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button type="button" style={navBtn} onClick={() => setVisibleMonth((m) => addMonths(m, -1))} aria-label="Previous month">‹</button>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink, minWidth: 132, textAlign: "center" }}>
          {new Date(`${visibleMonth}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
        </div>
        <button type="button" style={navBtn} onClick={() => setVisibleMonth((m) => addMonths(m, 1))} aria-label="Next month">›</button>
        {(from || to) && (
          <button
            type="button"
            onClick={() => onChange(null, null)}
            style={{ marginLeft: "auto", border: "none", background: "none", color: c.hint, fontSize: 12, cursor: "pointer" }}
          >Clear</button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} style={{ fontSize: 10, color: c.hint, textAlign: "center", fontWeight: 700, paddingBottom: 4 }}>{w}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`e${i}`} />;
          const ctx = context[cell.key] ?? {};
          const picked = inRange(cell.key);
          const isEdge = cell.key === from || cell.key === to;
          const disabled = !selectable(cell.key);
          const marker = ctx.holiday ? pillar.green.base : ctx.existingLeave ? pillar.blue.base : ctx.weekOff ? c.hint : null;

          return (
            <button
              key={cell.key}
              type="button"
              disabled={disabled}
              title={ctx.holiday ?? ctx.existingLeave ?? (ctx.weekOff ? "Week off" : undefined)}
              onMouseDown={(e) => { e.preventDefault(); startAt(cell.key); }}
              onMouseEnter={() => extendTo(cell.key)}
              onFocus={() => extendTo(cell.key)}
              style={{
                position: "relative", height: 38, borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer",
                border: isEdge ? `1px solid var(--tenant-accent, ${c.accent})` : `1px solid ${picked ? "transparent" : c.line}`,
                background: picked ? `var(--tenant-accent, ${c.accent})${isEdge ? "" : "22"}` : c.panel,
                color: picked && isEdge ? "#fff" : disabled ? c.hint : c.ink,
                opacity: disabled ? 0.45 : 1,
                fontSize: 12.5, fontWeight: picked ? 700 : 500,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {cell.day}
              {marker && (
                <span style={{
                  position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)",
                  width: 4, height: 4, borderRadius: "50%", background: marker,
                }} />
              )}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: c.hint }}>
        <span>Click a day, or drag across several.</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: pillar.green.base }} /> Holiday
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: pillar.blue.base }} /> Already on leave
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.hint }} /> Week off
        </span>
      </div>

      {selectedCount > 0 && (
        <div style={{ marginTop: 10, padding: "9px 11px", borderRadius: 8, background: c.panel2, fontSize: 12.5, color: c.ink }}>
          <strong>{selectedCount}</strong> day{selectedCount === 1 ? "" : "s"} selected
          <span style={{ color: c.muted }}>
            {" · "}{new Date(`${from}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
            {from !== to && ` – ${new Date(`${to}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`}
          </span>
          {noteworthy.length > 0 && (
            <div style={{ fontSize: 11.5, color: pillar.amber.fg, marginTop: 4 }}>
              {noteworthy.length} day{noteworthy.length === 1 ? "" : "s"} in this range already {noteworthy.length === 1 ? "has" : "have"} something on{" "}
              ({[...new Set(noteworthy.map((n) => n.note))].slice(0, 3).join(", ")}) — those usually aren&apos;t deducted from your balance.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
