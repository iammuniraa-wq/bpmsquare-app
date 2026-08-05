"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";

type EmployeeSummary = {
  employee_id: string;
  employee_code: string | null;
  full_name: string;
  employment_type: "full_time" | "contractor";
  site_id: string | null;
  site_name: string | null;
  totals: {
    days_present: number;
    working_minutes: number;
    late_marks: number;
    half_day_deductions: number;
    paid_leave_days: number;
    unpaid_leave_days: number;
    holiday_days: number;
    night_shifts: number;
    night_allowance_total: number;
    incomplete_days: number;
  };
};

const th: React.CSSProperties = { textAlign: "left", color: c.hint, fontWeight: 500, padding: "9px 10px", borderBottom: `1px solid ${c.line}`, fontSize: 11, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "9px 10px", borderBottom: `1px solid ${c.line}`, fontSize: 12, verticalAlign: "middle", whiteSpace: "nowrap" };
const inp: React.CSSProperties = { padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none" };
const btnPrimary: React.CSSProperties = { padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: "none", background: "var(--tenant-accent, #378ADD)", color: "#fff", cursor: "pointer", textDecoration: "none", display: "inline-block" };

const fmtHM = (mins: number) => `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;

function Section({ title, rows }: { title: string; rows: EmployeeSummary[] }) {
  return (
    <section style={{ ...cardStyle, padding: 0, marginBottom: 18, overflowX: "auto" }}>
      <div style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: c.ink, borderBottom: `1px solid ${c.line}` }}>
        {title} <span style={{ color: c.hint, fontWeight: 400 }}>({rows.length})</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Code</th><th style={th}>Name</th><th style={th}>Site</th>
            <th style={th}>Days present</th><th style={th}>Hours</th><th style={th}>Late marks</th>
            <th style={th}>Half-day ded.</th><th style={th}>Paid leave</th><th style={th}>Unpaid leave</th>
            <th style={th}>Holidays</th><th style={th}>Night shifts</th><th style={th}>Night allowance</th>
            <th style={th}>Incomplete</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employee_id}>
              <td style={{ ...td, fontFamily: "monospace" }}>{r.employee_code ?? "—"}</td>
              <td style={{ ...td, fontWeight: 600, color: c.ink }}>{r.full_name}</td>
              <td style={td}>{r.site_name ?? "—"}</td>
              <td style={td}>{r.totals.days_present}</td>
              <td style={td}>{fmtHM(r.totals.working_minutes)}</td>
              <td style={{ ...td, color: r.totals.late_marks > 0 ? "#f6b23c" : undefined }}>{r.totals.late_marks}</td>
              <td style={td}>{r.totals.half_day_deductions}</td>
              <td style={td}>{r.totals.paid_leave_days}</td>
              <td style={td}>{r.totals.unpaid_leave_days}</td>
              <td style={td}>{r.totals.holiday_days}</td>
              <td style={td}>{r.totals.night_shifts}</td>
              <td style={td}>{r.totals.night_allowance_total ? `₹${r.totals.night_allowance_total.toLocaleString("en-IN")}` : "—"}</td>
              <td style={{ ...td, color: r.totals.incomplete_days > 0 ? "#ef4444" : undefined }}>{r.totals.incomplete_days || "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={{ ...td, color: c.hint }} colSpan={13}>No employees in this section.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

export default function SummaryClient() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<EmployeeSummary[]>([]);
  const [siteFilter, setSiteFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/wfm/summary?month=${m}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load"); return; }
      setRows(json.employees);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  const sites = useMemo(() => [...new Set(rows.map((r) => r.site_name).filter(Boolean))] as string[], [rows]);
  const filtered = siteFilter ? rows.filter((r) => r.site_name === siteFilter) : rows;

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input style={inp} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <select style={inp} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
          <option value="">All sites</option>
          {sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <a style={btnPrimary} href={`/api/wfm/summary/export?month=${month}`}>Export to Excel</a>
        {loading && <span style={{ fontSize: 12, color: c.hint }}>Loading…</span>}
      </div>

      {error && <div style={{ ...cardStyle, marginBottom: 14, color: "#ef4444", fontSize: 12.5 }}>{error}</div>}

      <Section title="Full-Time" rows={filtered.filter((r) => r.employment_type === "full_time")} />
      <Section title="Contractors" rows={filtered.filter((r) => r.employment_type === "contractor")} />
    </>
  );
}
