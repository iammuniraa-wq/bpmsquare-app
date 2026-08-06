"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { c, pillar, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import Donut from "@/components/Donut";

const POLL_MS = 30_000;

// One bucket per employee, mutually exclusive so the donut's slices sum to
// headcount -- "late" and "outside geofence" are flags on top of a state,
// not states of their own, so they stay as separate stat cards.
type Bucket = "In" | "On break" | "On leave" | "Absent" | "Checked out" | "Not in yet";

function bucketOf(r: Row): Bucket {
  if (r.on_leave) return "On leave";
  if (r.state === "in") return "In";
  if (r.state === "break") return "On break";
  if (r.absent) return "Absent";
  if (r.punches > 0) return "Checked out";
  return "Not in yet";
}

const BUCKET_COLOR: Record<Bucket, string> = {
  "In": pillar.green.base,
  "On break": pillar.amber.base,
  "On leave": pillar.purple.base,
  "Absent": pillar.red.base,
  "Checked out": pillar.blue.base,
  "Not in yet": pillar.teal.base,
};

type Row = {
  employee_id: string;
  employee_code: string | null;
  full_name: string;
  employment_type: "full_time" | "contractor";
  home_site_id: string | null;
  home_site_name: string | null;
  shift_name: string | null;
  state: "out" | "in" | "break";
  first_in: string | null;
  last_out: string | null;
  late: boolean;
  absent: boolean;
  on_leave: boolean;
  outside_geofence: boolean;
  punches: number;
};

type Board = {
  date: string;
  timezone: string;
  is_week_off: boolean;
  is_holiday: boolean;
  rows: Row[];
};

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "middle",
};

const fmtTime = (s: string | null, tz: string) =>
  s ? new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz }) : "—";

function statusPill(r: Row) {
  if (r.on_leave) return <Pill label="On leave" tone="purple" />;
  if (r.state === "in") return <Pill label="In" tone="green" />;
  if (r.state === "break") return <Pill label="On break" tone="amber" />;
  if (r.absent) return <Pill label="Absent" tone="red" />;
  if (r.punches > 0) return <Pill label="Out" tone="blue" />;
  return <Pill label="Not in yet" tone="teal" />;
}

const inp: React.CSSProperties = {
  padding: "8px 11px", fontSize: 12.5, border: `1px solid ${c.line}`,
  borderRadius: 8, background: c.panel, color: c.ink, outline: "none",
};

export default function LiveBoardClient() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [query, setQuery] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/live-board");
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load"); return; }
      setBoard(json);
      setError("");
      setUpdatedAt(new Date());
    } catch {
      setError("Network error");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (error) {
    return <div style={{ ...cardStyle, color: c.muted, fontSize: 13 }}>{error}</div>;
  }
  if (!board) {
    return <div style={{ ...cardStyle, color: c.hint, fontSize: 13 }}>Loading today&apos;s board…</div>;
  }

  const counts = {
    in: board.rows.filter((r) => r.state === "in").length,
    onBreak: board.rows.filter((r) => r.state === "break").length,
    late: board.rows.filter((r) => r.late).length,
    absent: board.rows.filter((r) => r.absent).length,
    leave: board.rows.filter((r) => r.on_leave).length,
    flagged: board.rows.filter((r) => r.outside_geofence).length,
  };

  // Donut always reflects the whole board, not the filtered subset -- it's
  // the overview the filters act on, so filtering it too would leave a
  // single 100% slice and nothing to click back to.
  const donutSlices = (Object.keys(BUCKET_COLOR) as Bucket[]).map((b) => ({
    label: b,
    value: board.rows.filter((r) => bucketOf(r) === b).length,
    color: BUCKET_COLOR[b],
  }));

  const sites = [...new Set(board.rows.map((r) => r.home_site_name ?? "No site assigned"))].sort();
  const q = query.trim().toLowerCase();
  const visible = board.rows.filter((r) => {
    if (statusFilter && bucketOf(r) !== statusFilter) return false;
    if (siteFilter && (r.home_site_name ?? "No site assigned") !== siteFilter) return false;
    if (flaggedOnly && !r.outside_geofence) return false;
    if (!q) return true;
    return (
      r.full_name.toLowerCase().includes(q) ||
      (r.employee_code ?? "").toLowerCase().includes(q) ||
      (r.shift_name ?? "").toLowerCase().includes(q)
    );
  });

  // Group by home site; employees without one land in a trailing group.
  const groups = new Map<string, Row[]>();
  for (const r of visible) {
    const key = r.home_site_name ?? "No site assigned";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) =>
    a === "No site assigned" ? 1 : b === "No site assigned" ? -1 : a.localeCompare(b)
  );

  const stat = (label: string, value: number, color?: string) => (
    <div key={label} style={{ ...cardStyle, padding: "10px 16px", minWidth: 100 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? c.ink }}>{value}</div>
      <div style={{ fontSize: 11.5, color: c.muted }}>{label}</div>
    </div>
  );

  return (
    <>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14, alignItems: "stretch" }}>
        <section style={{ ...cardStyle, flex: "1 1 320px" }}>
          <Donut
            slices={donutSlices}
            title="Right now"
            centerLabel="employees"
            selected={statusFilter}
            onSelect={setStatusFilter}
          />
        </section>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: "1 1 320px", alignContent: "flex-start" }}>
          {stat("Checked in", counts.in, statusInk.good)}
          {stat("On break", counts.onBreak, statusInk.warn)}
          {stat("Late", counts.late, statusInk.bad)}
          {stat("Absent", counts.absent, statusInk.bad)}
          {stat("On leave", counts.leave)}
          {stat("Geofence flags", counts.flagged, counts.flagged ? statusInk.warn : undefined)}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <input
          style={{ ...inp, flex: "1 1 220px", maxWidth: 320 }}
          placeholder="Search name, code or shift…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select style={inp} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
          <option value="">All sites</option>
          {sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={inp} value={statusFilter ?? ""} onChange={(e) => setStatusFilter(e.target.value || null)}>
          <option value="">All statuses</option>
          {(Object.keys(BUCKET_COLOR) as Bucket[]).map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: c.muted, cursor: "pointer" }}>
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
          Geofence flags only
        </label>
        <span style={{ fontSize: 11.5, color: c.hint }}>{visible.length} of {board.rows.length}</span>
      </div>

      {(board.is_holiday || board.is_week_off) && (
        <div style={{ ...cardStyle, marginBottom: 14, fontSize: 12.5, color: c.muted }}>
          {board.is_holiday ? "Today is a holiday — " : "Today is a weekly off — "}
          no lateness or absence is being marked.
        </div>
      )}

      {visible.length === 0 && (
        <div style={{ ...cardStyle, marginBottom: 14, fontSize: 12.5, color: c.hint }}>
          No employees match these filters.
        </div>
      )}

      {orderedGroups.map(([siteName, rows]) => (
        <section key={siteName} style={{ ...cardStyle, padding: 0, marginBottom: 14, overflowX: "auto" }}>
          <div style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: c.ink, borderBottom: `1px solid ${c.line}` }}>
            {siteName}
            <span style={{ color: c.hint, fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
              {rows.filter((r) => r.state !== "out").length} of {rows.length} present
            </span>
          </div>
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Employee</th>
                <th style={th}>Shift</th>
                <th style={th}>Status</th>
                <th style={th}>First in</th>
                <th style={th}>Last out</th>
                <th style={th}>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id}>
                  <td style={td}>
                    <span style={{ fontWeight: 600, color: c.ink }}>{r.full_name}</span>
                    {r.employee_code && (
                      <span style={{ color: c.hint, marginLeft: 6, fontSize: 11.5 }}>{r.employee_code}</span>
                    )}
                    {r.employment_type === "contractor" && (
                      <span style={{ marginLeft: 6 }}><Pill label="Contractor" tone="teal" /></span>
                    )}
                  </td>
                  <td style={td}>{r.shift_name ?? "—"}</td>
                  <td style={td}>{statusPill(r)}</td>
                  <td style={td}>
                    {fmtTime(r.first_in, board.timezone)}
                    {r.late && <span style={{ color: statusInk.bad, marginLeft: 6, fontSize: 11 }}>late</span>}
                  </td>
                  <td style={td}>{fmtTime(r.last_out, board.timezone)}</td>
                  <td style={td}>
                    {r.outside_geofence ? <Pill label="Outside geofence" tone="amber" /> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <div style={{ fontSize: 11.5, color: c.hint }}>
        {board.date} · {board.timezone}
        {updatedAt && <> · updated {updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</>}
        {" "}· refreshes every 30s
      </div>
    </>
  );
}
