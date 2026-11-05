"use client";

import { c } from "@/lib/theme";
import PunchAudit from "@/components/wfm/PunchAudit";

/** The control that opens one day's punches (selfie, kiosk or GPS location) beneath its row. */
export function DayPunchesToggle({ date, open, onToggle }: { date: string; open: boolean; onToggle: (date: string) => void }) {
  return (
    <button
      type="button"
      className="wfm-punch-toggle"
      aria-expanded={open}
      aria-controls={`day-punches-${date}`}
      onClick={() => onToggle(date)}
      style={{
        padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: "pointer",
        border: `1px solid ${c.line}`, background: open ? c.panel2 : c.panel, color: c.ink,
      }}
    >
      Punches {open ? "▴" : "▾"}
    </button>
  );
}

/** The full-width row that holds the day's punches while its toggle is open. */
export function DayPunchesRow({ employeeId, date, colSpan }: { employeeId: string; date: string; colSpan: number }) {
  return (
    <tr id={`day-punches-${date}`}>
      <td colSpan={colSpan} style={{ padding: "4px 14px 10px", borderBottom: `1px solid ${c.line}`, background: c.panel2 }}>
        <PunchAudit employeeId={employeeId} date={date} />
      </td>
    </tr>
  );
}
