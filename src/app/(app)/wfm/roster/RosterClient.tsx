"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import type { WfmShift } from "@/lib/wfm/types";

type EmployeeRow = {
  id: string;
  first_name: string;
  last_name: string;
  employee_code: string | null;
  shift_id: string | null;
  status: string;
};

type OverrideRow = {
  id: string;
  employee_id: string;
  date: string;
  is_day_off: boolean;
  note: string | null;
  wfm_shifts: { name: string; start_time: string; end_time: string } | { name: string; start_time: string; end_time: string }[] | null;
  employees: { first_name: string; last_name: string; employee_code: string | null } | { first_name: string; last_name: string; employee_code: string | null }[] | null;
};

// Supabase's untyped client sometimes infers a *-to-one relation as an
// array -- normalize either shape to a single object or null.
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

const UPCOMING_DAYS = 30;

const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 };
const inp: React.CSSProperties = { padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" };
const th: React.CSSProperties = { textAlign: "left", color: c.hint, fontWeight: 500, padding: "9px 10px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap" };
const thCenter: React.CSSProperties = { ...th, textAlign: "center" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "middle" };
const tdCenter: React.CSSProperties = { ...td, textAlign: "center" };
const btn: React.CSSProperties = { padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer" };
const btnPrimary: React.CSSProperties = { ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff" };
const btnTiny: React.CSSProperties = { ...btn, padding: "3px 8px", fontSize: 10.5, fontWeight: 600 };
const hhmm = (t: string) => t.slice(0, 5);
const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
const todayKey = () => new Date().toISOString().slice(0, 10);

function empName(e: { first_name: string; last_name: string } | null): string {
  return e ? [e.first_name, e.last_name].filter(Boolean).join(" ") : "—";
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default function RosterClient() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [shifts, setShifts] = useState<WfmShift[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Section A: standing shifts (bulk matrix) ─────────────────────────
  const [searchA, setSearchA] = useState("");
  const [pending, setPending] = useState<Map<string, string | null>>(new Map());
  const [savingA, setSavingA] = useState(false);
  const [okA, setOkA] = useState("");

  // ── Section B: temporary overrides ───────────────────────────────────
  const [searchB, setSearchB] = useState("");
  const [selectedB, setSelectedB] = useState<Set<string>>(new Set());
  const [fromDate, setFromDate] = useState(todayKey());
  const [toDate, setToDate] = useState(todayKey());
  const [overrideShiftId, setOverrideShiftId] = useState("");
  const [overrideDayOff, setOverrideDayOff] = useState(false);
  const [busyB, setBusyB] = useState(false);
  const [errorB, setErrorB] = useState("");
  const [okB, setOkB] = useState("");

  const load = useCallback(async () => {
    const from = todayKey();
    const rangeEnd = new Date();
    rangeEnd.setDate(rangeEnd.getDate() + UPCOMING_DAYS);
    const rangeEndKey = rangeEnd.toISOString().slice(0, 10);

    const [empRes, shiftRes, ovRes] = await Promise.all([
      fetch("/api/wfm/employees"),
      fetch("/api/wfm/shifts"),
      fetch(`/api/wfm/roster?from=${from}&to=${rangeEndKey}`),
    ]);
    if (empRes.ok) setEmployees(await empRes.json()); else setError((await empRes.json()).error ?? "Failed to load employees");
    if (shiftRes.ok) setShifts(await shiftRes.json());
    if (ovRes.ok) setOverrides(await ovRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Section A logic ───────────────────────────────────────────────────
  const activeShifts = useMemo(() => shifts.filter((s) => s.active), [shifts]);
  const qA = searchA.trim().toLowerCase();
  const visibleEmployeesA = useMemo(
    () => employees.filter((e) =>
      e.status === "active" &&
      (!qA || empName(e).toLowerCase().includes(qA) || (e.employee_code ?? "").toLowerCase().includes(qA))
    ),
    [employees, qA]
  );

  function effectiveShift(e: EmployeeRow): string | null {
    return pending.has(e.id) ? pending.get(e.id)! : e.shift_id;
  }

  function setCell(employeeId: string, shiftId: string | null) {
    setOkA("");
    setPending((prev) => {
      const next = new Map(prev);
      const emp = employees.find((e) => e.id === employeeId);
      if (emp && emp.shift_id === shiftId) next.delete(employeeId);
      else next.set(employeeId, shiftId);
      return next;
    });
  }

  function assignAllVisible(shiftId: string | null) {
    setOkA("");
    setPending((prev) => {
      const next = new Map(prev);
      for (const e of visibleEmployeesA) {
        if (e.shift_id === shiftId) next.delete(e.id);
        else next.set(e.id, shiftId);
      }
      return next;
    });
  }

  async function saveShiftChanges() {
    if (pending.size === 0) return;
    setSavingA(true);
    setError("");
    setOkA("");
    try {
      // Group by target shift so this is a handful of bulk calls, not one per employee.
      const groups = new Map<string, string[]>(); // shiftId ("" = unassigned) -> employee ids
      for (const [employeeId, shiftId] of pending) {
        const key = shiftId ?? "";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(employeeId);
      }
      const results = await Promise.all(
        [...groups.entries()].map(([shiftKey, ids]) =>
          fetch("/api/wfm/employees/bulk-shift", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee_ids: ids, shift_id: shiftKey || null }),
          })
        )
      );
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const json = await failed.json().catch(() => ({}));
        setError(json.error ?? "Some changes failed to save");
      } else {
        setOkA(`Saved shift assignment for ${pending.size} employee(s).`);
        setPending(new Map());
      }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSavingA(false);
    }
  }

  // ── Section B logic ───────────────────────────────────────────────────
  const qB = searchB.trim().toLowerCase();
  const visibleEmployeesB = useMemo(
    () => employees.filter((e) =>
      e.status === "active" &&
      (!qB || empName(e).toLowerCase().includes(qB) || (e.employee_code ?? "").toLowerCase().includes(qB))
    ),
    [employees, qB]
  );

  function toggleB(id: string) {
    setSelectedB((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAllVisibleB() {
    setSelectedB((prev) => {
      const next = new Set(prev);
      for (const e of visibleEmployeesB) next.add(e.id);
      return next;
    });
  }
  function clearSelectionB() {
    setSelectedB(new Set());
  }

  async function applyOverride() {
    setErrorB("");
    setOkB("");
    if (selectedB.size === 0) { setErrorB("Select at least one employee"); return; }
    if (!overrideDayOff && !overrideShiftId) { setErrorB("Choose a shift, or mark as day off"); return; }
    if (toDate < fromDate) { setErrorB("End date can't be before start date"); return; }
    const dates = dateRange(fromDate, toDate);
    if (dates.length > 62) { setErrorB("That date range is too long (max 62 days) — split it up"); return; }
    setBusyB(true);
    try {
      const res = await fetch("/api/wfm/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_ids: [...selectedB],
          dates,
          shift_id: overrideDayOff ? null : overrideShiftId,
          is_day_off: overrideDayOff,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setErrorB(json.error ?? "Failed to apply"); return; }
      setOkB(`Applied to ${selectedB.size} employee(s) across ${dates.length} date(s).`);
      setSelectedB(new Set());
      await load();
    } catch {
      setErrorB("Network error");
    } finally {
      setBusyB(false);
    }
  }

  async function removeOverride(id: string) {
    setBusyB(true);
    try {
      await fetch(`/api/wfm/roster/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyB(false);
    }
  }

  if (loading) return <div style={{ ...cardStyle, color: c.hint, fontSize: 13 }}>Loading roster…</div>;

  return (
    <>
      {error && <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.bad, fontSize: 12.5 }}>{error}</div>}

      {/* ── Section A: standing shifts ────────────────────────────────── */}
      <section style={{ ...cardStyle, padding: 0, marginBottom: 22, overflowX: "auto" }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${c.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Standing shifts</div>
          <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>
            Everyone&apos;s default shift. Tick a cell to change someone&apos;s shift — this applies every day until
            changed again, or overridden for specific dates below. Use a column&apos;s &quot;Assign all&quot; to set a
            whole filtered group at once instead of one employee at a time.
          </div>
          <div style={{ marginTop: 10 }}>
            <input
              style={{ ...inp, width: 260 }}
              placeholder="Search employee name or code…"
              value={searchA}
              onChange={(e) => setSearchA(e.target.value)}
            />
          </div>
        </div>

        {activeShifts.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12.5, color: c.hint }}>
            No active shifts yet — add one in Settings → Workforce → Shifts first.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Employee</th>
                {activeShifts.map((s) => (
                  <th key={s.id} style={thCenter}>
                    <div>{s.name}</div>
                    <div style={{ fontWeight: 400, color: c.hint, fontSize: 10.5 }}>{hhmm(s.start_time)}–{hhmm(s.end_time)}</div>
                    <button style={{ ...btnTiny, marginTop: 5 }} onClick={() => assignAllVisible(s.id)}>
                      Assign all{qA ? " filtered" : ""}
                    </button>
                  </th>
                ))}
                <th style={thCenter}>
                  <div>Unassigned</div>
                  <button style={{ ...btnTiny, marginTop: 5 }} onClick={() => assignAllVisible(null)}>
                    Clear all{qA ? " filtered" : ""}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployeesA.map((e) => {
                const eff = effectiveShift(e);
                const changed = pending.has(e.id);
                return (
                  <tr key={e.id} style={changed ? { background: "rgba(55, 138, 221, 0.08)" } : undefined}>
                    <td style={{ ...td, fontWeight: 600, color: c.ink, whiteSpace: "nowrap" }}>
                      {empName(e)}
                      {e.employee_code && <span style={{ color: c.hint, fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{e.employee_code}</span>}
                    </td>
                    {activeShifts.map((s) => (
                      <td key={s.id} style={tdCenter}>
                        <input type="checkbox" checked={eff === s.id} onChange={() => setCell(e.id, s.id)} style={{ cursor: "pointer" }} />
                      </td>
                    ))}
                    <td style={tdCenter}>
                      <input type="checkbox" checked={eff === null} onChange={() => setCell(e.id, null)} style={{ cursor: "pointer" }} />
                    </td>
                  </tr>
                );
              })}
              {visibleEmployeesA.length === 0 && (
                <tr><td style={{ ...td, color: c.hint }} colSpan={activeShifts.length + 2}>No employees match.</td></tr>
              )}
            </tbody>
          </table>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderTop: `1px solid ${c.line}` }}>
          <button style={{ ...btnPrimary, opacity: pending.size === 0 ? 0.5 : 1 }} disabled={pending.size === 0 || savingA} onClick={saveShiftChanges}>
            {savingA ? "Saving…" : `Save changes${pending.size > 0 ? ` (${pending.size})` : ""}`}
          </button>
          {okA && <span style={{ fontSize: 12, color: statusInk.good }}>{okA}</span>}
        </div>
      </section>

      {/* ── Section B: temporary overrides ────────────────────────────── */}
      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${c.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Temporary overrides</div>
          <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>
            A different shift (or a day off) for selected employees on specific dates only — doesn&apos;t change
            anyone&apos;s standing shift above. For a holiday that applies to everyone, use Settings → Workforce →
            Holidays instead — this is for individual/group exceptions.
          </div>
        </div>

        <div style={{ padding: 14, borderBottom: `1px solid ${c.line}` }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
            <div>
              <label style={lbl}>From</label>
              <input style={inp} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>To</label>
              <input style={inp} type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div style={{ minWidth: 200 }}>
              <label style={lbl}>Shift</label>
              <select
                style={{ ...inp, width: "100%" }}
                value={overrideShiftId}
                disabled={overrideDayOff}
                onChange={(e) => setOverrideShiftId(e.target.value)}
              >
                <option value="">— select —</option>
                {activeShifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({hhmm(s.start_time)}–{hhmm(s.end_time)})</option>)}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: c.ink, paddingBottom: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={overrideDayOff} onChange={(e) => setOverrideDayOff(e.target.checked)} />
              Mark as day off instead
            </label>
          </div>

          <label style={lbl}>Employees ({selectedB.size} selected)</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              style={{ ...inp, width: 220 }}
              placeholder="Search employee name or code…"
              value={searchB}
              onChange={(e) => setSearchB(e.target.value)}
            />
            <button style={btnTiny} onClick={selectAllVisibleB}>Select all{qB ? " filtered" : ""}</button>
            <button style={btnTiny} onClick={clearSelectionB}>Clear selection</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 180, overflowY: "auto", padding: 8, border: `1px solid ${c.line}`, borderRadius: 8, marginBottom: 12 }}>
            {visibleEmployeesB.map((e) => (
              <label
                key={e.id}
                style={{
                  display: "flex", alignItems: "center", gap: 5, fontSize: 12, padding: "4px 8px",
                  borderRadius: 6, cursor: "pointer",
                  background: selectedB.has(e.id) ? "var(--tenant-accent, #378ADD)" : c.panel,
                  color: selectedB.has(e.id) ? "#fff" : c.ink,
                  border: `1px solid ${selectedB.has(e.id) ? "transparent" : c.line}`,
                }}
              >
                <input type="checkbox" checked={selectedB.has(e.id)} onChange={() => toggleB(e.id)} style={{ cursor: "pointer" }} />
                {empName(e)}{e.employee_code ? ` (${e.employee_code})` : ""}
              </label>
            ))}
            {visibleEmployeesB.length === 0 && <span style={{ fontSize: 12, color: c.hint }}>No employees match.</span>}
          </div>

          {errorB && <div style={{ fontSize: 12, color: statusInk.bad, marginBottom: 8 }}>{errorB}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button style={btnPrimary} disabled={busyB} onClick={applyOverride}>
              {busyB ? "Applying…" : `Apply to ${selectedB.size || "…"} selected`}
            </button>
            {okB && <span style={{ fontSize: 12, color: statusInk.good }}>{okB}</span>}
          </div>
        </div>

        <div style={{ padding: "10px 14px", fontSize: 12.5, fontWeight: 600, color: c.ink }}>
          Upcoming overrides — next {UPCOMING_DAYS} days
        </div>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Date</th><th style={th}>Employee</th><th style={th}>Shift</th><th style={th}>Note</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((r) => {
              const shift = one(r.wfm_shifts);
              const emp = one(r.employees);
              return (
                <tr key={r.id}>
                  <td style={td}>{fmtDate(r.date)}</td>
                  <td style={{ ...td, fontWeight: 600, color: c.ink }}>
                    {empName(emp)}
                    {emp?.employee_code && <span style={{ color: c.hint, fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{emp.employee_code}</span>}
                  </td>
                  <td style={td}>
                    {r.is_day_off
                      ? <Pill label="Day off" tone="red" />
                      : shift ? `${shift.name} (${hhmm(shift.start_time)}–${hhmm(shift.end_time)})` : "—"}
                  </td>
                  <td style={{ ...td, color: c.muted }}>{r.note ?? "—"}</td>
                  <td style={td}><button style={btnTiny} disabled={busyB} onClick={() => removeOverride(r.id)}>Remove</button></td>
                </tr>
              );
            })}
            {overrides.length === 0 && (
              <tr><td style={{ ...td, color: c.hint }} colSpan={5}>No overrides in this window — everyone follows their standing shift.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
