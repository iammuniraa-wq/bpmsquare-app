"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";

const POLL_MS = 30_000;

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

export default function LiveBoardClient() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

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

  // Group by home site; employees without one land in a trailing group.
  const groups = new Map<string, Row[]>();
  for (const r of board.rows) {
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
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {stat("Checked in", counts.in, "#10b981")}
        {stat("On break", counts.onBreak, c.amber)}
        {stat("Late", counts.late, "#ef4444")}
        {stat("Absent", counts.absent, "#ef4444")}
        {stat("On leave", counts.leave)}
        {stat("Geofence flags", counts.flagged, counts.flagged ? c.amber : undefined)}
      </div>

      {(board.is_holiday || board.is_week_off) && (
        <div style={{ ...cardStyle, marginBottom: 14, fontSize: 12.5, color: c.muted }}>
          {board.is_holiday ? "Today is a holiday — " : "Today is a weekly off — "}
          no lateness or absence is being marked.
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
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
                    {r.late && <span style={{ color: "#ef4444", marginLeft: 6, fontSize: 11 }}>late</span>}
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
