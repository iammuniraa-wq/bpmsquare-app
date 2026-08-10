"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { WfmShift } from "@/lib/wfm/types";

type EmployeeOpt = { id: string; first_name: string; last_name: string; employee_code: string | null; shift_id: string | null; wfm_shifts: { name: string } | null };
type RosterRow = {
  id: string; employee_id: string; date: string; shift_id: string | null; is_day_off: boolean; note: string | null;
  wfm_shifts: { name: string; start_time: string; end_time: string; is_night_shift: boolean } | null;
};

const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" };
const btn: React.CSSProperties = { padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer" };
const btnPrimary: React.CSSProperties = { ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff" };

function mondayOf(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}
function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
}

export default function RosterClient() {
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [shifts, setShifts] = useState<WfmShift[]>([]);
  const [rosterRows, setRosterRows] = useState<RosterRow[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [bulkShiftId, setBulkShiftId] = useState("");
  const [bulkDayOff, setBulkDayOff] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  }), [weekStart]);
  const from = toDateKey(weekDays[0]);
  const to = toDateKey(weekDays[6]);

  const loadBase = useCallback(async () => {
    const [empRes, shiftRes] = await Promise.all([fetch("/api/wfm/employees"), fetch("/api/wfm/shifts")]);
    if (empRes.ok) {
      const rows = (await empRes.json()) as EmployeeOpt[];
      setEmployees(rows);
      if (rows.length > 0) setEmployeeId((cur) => cur || rows[0].id);
    } else setError((await empRes.json()).error ?? "Failed to load");
    if (shiftRes.ok) setShifts(await shiftRes.json());
  }, []);

  useEffect(() => { loadBase(); }, [loadBase]);

  const loadRoster = useCallback(async () => {
    if (!employeeId) return;
    const res = await fetch(`/api/wfm/roster?from=${from}&to=${to}&employee_id=${employeeId}`);
    if (res.ok) setRosterRows(await res.json());
  }, [employeeId, from, to]);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  const rowByDate = useMemo(() => new Map(rosterRows.map((r) => [r.date, r])), [rosterRows]);
  const standing = employees.find((e) => e.id === employeeId);

  function toggleDate(dateKey: string) {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
      return next;
    });
  }

  async function applyBulk() {
    if (selectedDates.size === 0) { setError("Select at least one day first"); return; }
    if (!bulkDayOff && !bulkShiftId) { setError("Choose a shift, or mark as day off"); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/wfm/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          dates: [...selectedDates],
          shift_id: bulkDayOff ? null : bulkShiftId,
          is_day_off: bulkDayOff,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Save failed"); return; }
      setSelectedDates(new Set());
      await loadRoster();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function clearOne(rosterId: string) {
    setBusy(true);
    try {
      await fetch(`/api/wfm/roster/${rosterId}`, { method: "DELETE" });
      await loadRoster();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.bad, fontSize: 12.5 }}>{error}</div>}

      <section style={{ ...cardStyle, marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 220px" }}>
            <label style={lbl}>Employee</label>
            <select style={inp} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {[e.first_name, e.last_name].filter(Boolean).join(" ")} {e.employee_code ? `(${e.employee_code})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={btn} onClick={() => setWeekStart((w) => { const n = new Date(w); n.setDate(w.getDate() - 7); return n; })}>← Prev week</button>
            <button style={btn} onClick={() => setWeekStart(mondayOf(new Date()))}>This week</button>
            <button style={btn} onClick={() => setWeekStart((w) => { const n = new Date(w); n.setDate(w.getDate() + 7); return n; })}>Next week →</button>
          </div>
        </div>
        {standing && (
          <div style={{ fontSize: 12, color: c.hint, marginTop: 10 }}>
            Standing shift (used for any day below with no explicit assignment): {standing.wfm_shifts?.name ?? "— none set —"}
          </div>
        )}
      </section>

      <section style={{ ...cardStyle, padding: 0, marginBottom: 18, overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(130px, 1fr))" }}>
          {weekDays.map((d) => {
            const dateKey = toDateKey(d);
            const row = rowByDate.get(dateKey);
            const selected = selectedDates.has(dateKey);
            return (
              <div
                key={dateKey}
                onClick={() => toggleDate(dateKey)}
                style={{
                  padding: 12, borderRight: `1px solid ${c.line}`, borderBottom: `1px solid ${c.line}`,
                  cursor: "pointer", background: selected ? "var(--tenant-accent, #378ADD)15" : "transparent",
                  minHeight: 96,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", marginBottom: 6 }}>{fmtShort(d)}</div>
                {row ? (
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: row.is_day_off ? "var(--red)" : c.ink }}>
                      {row.is_day_off ? "Day off" : row.wfm_shifts?.name ?? "—"}
                    </div>
                    {!row.is_day_off && row.wfm_shifts && (
                      <div style={{ fontSize: 11, color: c.hint, marginTop: 2 }}>
                        {row.wfm_shifts.start_time.slice(0, 5)}–{row.wfm_shifts.end_time.slice(0, 5)}
                      </div>
                    )}
                    <button
                      style={{ ...btn, fontSize: 10.5, padding: "3px 7px", marginTop: 8 }}
                      onClick={(e) => { e.stopPropagation(); clearOne(row.id); }}
                      disabled={busy}
                    >
                      Revert to standing
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: c.hint }}>
                    Standing{standing?.wfm_shifts?.name ? `: ${standing.wfm_shifts.name}` : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ ...cardStyle }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: c.ink, marginBottom: 10 }}>
          Assign selected days ({selectedDates.size} selected — click days above to select/deselect)
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "0 1 200px" }}>
            <label style={lbl}>Shift</label>
            <select style={inp} value={bulkShiftId} onChange={(e) => { setBulkShiftId(e.target.value); setBulkDayOff(false); }} disabled={bulkDayOff}>
              <option value="">— select —</option>
              {shifts.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: c.ink, paddingBottom: 8 }}>
            <input type="checkbox" checked={bulkDayOff} onChange={(e) => setBulkDayOff(e.target.checked)} />
            Mark as day off instead
          </label>
          <button style={btnPrimary} disabled={busy || selectedDates.size === 0} onClick={applyBulk}>Apply to selected days</button>
        </div>
      </section>
    </>
  );
}
