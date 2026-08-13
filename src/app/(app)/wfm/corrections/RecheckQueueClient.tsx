"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type { RecheckStatus, RecheckType, WfmRecheckRequest } from "@/lib/wfm/types";

type Row = WfmRecheckRequest & {
  employees: { first_name: string; last_name: string; employee_code: string | null } | null;
};

const TYPE_LABEL: Record<RecheckType, string> = { time: "Time", selfie: "Selfie", both: "Time and selfie" };
const STATUS_TONE: Record<RecheckStatus, "amber" | "blue" | "green" | "red"> = {
  pending: "amber", responded: "blue", resolved: "green", dismissed: "red",
};

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "top",
};
const btn: React.CSSProperties = {
  padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8,
  border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer",
};
const btnGreen: React.CSSProperties = { ...btn, background: "#10b981", borderColor: "transparent", color: "#fff" };
const btnRed: React.CSSProperties = { ...btn, background: "#ef4444", borderColor: "transparent", color: "#fff" };

const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function RecheckQueueClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"pending" | "responded" | "all">("pending");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const qs = filter === "all" ? "" : `?status=${filter}`;
    const res = await fetch(`/api/wfm/recheck-requests${qs}`);
    const json = await res.json();
    if (res.ok) setRows(json);
    else setError(json.error ?? "Failed to load");
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function resolve(id: string, action: "resolve" | "dismiss") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/wfm/recheck-requests/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Request failed"); return; }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button style={filter === "pending" ? { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" } : btn} onClick={() => setFilter("pending")}>Awaiting employee</button>
        <button style={filter === "responded" ? { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" } : btn} onClick={() => setFilter("responded")}>Employee replied</button>
        <button style={filter === "all" ? { ...btn, background: "var(--tenant-accent, #378ADD)", color: "#fff", borderColor: "transparent" } : btn} onClick={() => setFilter("all")}>All</button>
        <span style={{ fontSize: 11.5, color: c.hint }}>{rows.length}</span>
      </div>

      {error && <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.bad, fontSize: 12.5 }}>{error}</div>}

      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Employee</th>
              <th style={th}>Date</th>
              <th style={th}>Type</th>
              <th style={th}>Your message</th>
              <th style={th}>Their reply</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, fontWeight: 600 }}>
                  <Link href={ROUTES.wfmEmployee(r.employee_id)} style={{ color: "var(--tenant-accent, #378ADD)", textDecoration: "none" }}>
                    {r.employees ? [r.employees.first_name, r.employees.last_name].filter(Boolean).join(" ") : "—"}
                  </Link>
                  {r.employees?.employee_code && <span style={{ color: c.hint, marginLeft: 6, fontSize: 11 }}>{r.employees.employee_code}</span>}
                </td>
                <td style={td}>{fmtDate(r.target_date)}</td>
                <td style={td}>{TYPE_LABEL[r.recheck_type]}</td>
                <td style={{ ...td, maxWidth: 220, color: c.muted }}>{r.message}</td>
                <td style={{ ...td, maxWidth: 220 }}>
                  {r.employee_response_text ?? <span style={{ color: c.hint }}>— no reply yet —</span>}
                  {r.linked_correction_id && (
                    <div style={{ marginTop: 4 }}><Pill label="Filed a correction" tone="blue" /></div>
                  )}
                </td>
                <td style={td}><Pill label={r.status} tone={STATUS_TONE[r.status]} /></td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {(r.status === "pending" || r.status === "responded") && (
                    <>
                      <button style={btnGreen} disabled={busy} onClick={() => resolve(r.id, "resolve")}>Resolve</button>{" "}
                      <button style={btnRed} disabled={busy} onClick={() => resolve(r.id, "dismiss")}>Dismiss</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td style={{ ...td, color: c.hint }} colSpan={7}>Nothing flagged for review{filter !== "all" ? " in this view" : ""}.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
