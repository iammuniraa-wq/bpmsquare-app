"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type { WfmSite, WfmShift } from "@/lib/wfm/types";

type Row = {
  id: string;
  employee_code: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  status: "active" | "inactive";
  employment_type: "full_time" | "contractor";
  wfm_role: "employee" | "supervisor";
  shift_id: string | null;
  site_id: string | null;
  supervisor_id: string | null;
  consent_recorded_at: string | null;
  has_login: boolean;
  wfm_shifts: { name: string } | null;
  wfm_sites: { name: string } | null;
};

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "middle",
};
const btn: React.CSSProperties = {
  padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8,
  border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff",
};

type Draft = {
  employee_code: string; first_name: string; last_name: string; phone: string;
  employment_type: "full_time" | "contractor"; wfm_role: "employee" | "supervisor";
  shift_id: string; site_id: string; supervisor_id: string; invite_email: string; invite_password: string;
};
const emptyDraft = (): Draft => ({
  employee_code: "", first_name: "", last_name: "", phone: "",
  employment_type: "full_time", wfm_role: "employee", shift_id: "", site_id: "", supervisor_id: "",
  invite_email: "", invite_password: "",
});

export default function WfmEmployeesClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [shifts, setShifts] = useState<WfmShift[]>([]);
  const [sites, setSites] = useState<WfmSite[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // "new" | employee id
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [roleFilter, setRoleFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");

  const load = useCallback(async () => {
    const [empRes, shiftRes, siteRes] = await Promise.all([
      fetch("/api/wfm/employees"), fetch("/api/wfm/shifts"), fetch("/api/wfm/sites"),
    ]);
    if (empRes.ok) setRows(await empRes.json());
    else setError((await empRes.json()).error ?? "Failed to load");
    if (shiftRes.ok) setShifts(await shiftRes.json());
    if (siteRes.ok) setSites(await siteRes.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (editing === "new" && (!draft.employee_code.trim() || !draft.first_name.trim())) {
      setError("Employee code and first name are required");
      return;
    }
    if (draft.invite_email.trim() && !draft.invite_password.trim()) {
      setError("An initial password is required to invite a login");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const isNew = editing === "new";
      const payload: Record<string, unknown> = {
        employee_code: draft.employee_code,
        first_name: draft.first_name,
        last_name: draft.last_name,
        phone: draft.phone,
        employment_type: draft.employment_type,
        wfm_role: draft.wfm_role,
        shift_id: draft.shift_id || null,
        site_id: draft.site_id || null,
      };
      if (!isNew) payload.supervisor_id = draft.supervisor_id || null;
      if (!isNew && draft.invite_email.trim()) {
        payload.invite_email = draft.invite_email.trim();
        payload.invite_password = draft.invite_password;
      }
      const res = await fetch(isNew ? "/api/wfm/employees" : `/api/wfm/employees/${editing}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Save failed"); return; }
      setEditing(null);
      setDraft(emptyDraft());
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(row: Row) {
    setBusy(true);
    try {
      await fetch(`/api/wfm/employees/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: row.status === "active" ? "inactive" : "active" }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const form = editing !== null && (
    <div style={{ display: "flex", gap: 10, padding: 12, flexWrap: "wrap", alignItems: "flex-end", borderTop: `1px solid ${c.line}` }}>
      <div style={{ flex: "0 1 110px" }}>
        <label style={lbl}>Code</label>
        <input style={inp} value={draft.employee_code} onChange={(e) => setDraft({ ...draft, employee_code: e.target.value })} placeholder="EMP-001" />
      </div>
      <div style={{ flex: "1 1 130px" }}>
        <label style={lbl}>First name</label>
        <input style={inp} value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} />
      </div>
      <div style={{ flex: "1 1 130px" }}>
        <label style={lbl}>Last name</label>
        <input style={inp} value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} />
      </div>
      <div style={{ flex: "0 1 130px" }}>
        <label style={lbl}>Phone</label>
        <input style={inp} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
      </div>
      <div style={{ flex: "0 1 130px" }}>
        <label style={lbl}>Type</label>
        <select style={inp} value={draft.employment_type} onChange={(e) => setDraft({ ...draft, employment_type: e.target.value as Draft["employment_type"] })}>
          <option value="full_time">Full-time</option>
          <option value="contractor">Contractor</option>
        </select>
      </div>
      <div style={{ flex: "0 1 130px" }}>
        <label style={lbl}>WFM role</label>
        <select style={inp} value={draft.wfm_role} onChange={(e) => setDraft({ ...draft, wfm_role: e.target.value as Draft["wfm_role"] })}>
          <option value="employee">Employee</option>
          <option value="supervisor">Supervisor</option>
        </select>
      </div>
      <div style={{ flex: "0 1 150px" }}>
        <label style={lbl}>Shift</label>
        <select style={inp} value={draft.shift_id} onChange={(e) => setDraft({ ...draft, shift_id: e.target.value })}>
          <option value="">— none —</option>
          {shifts.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div style={{ flex: "0 1 150px" }}>
        <label style={lbl}>Home site</label>
        <select style={inp} value={draft.site_id} onChange={(e) => setDraft({ ...draft, site_id: e.target.value })}>
          <option value="">— none —</option>
          {sites.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {editing !== "new" && (
        <div style={{ flex: "0 1 170px" }}>
          <label style={lbl}>Supervisor</label>
          <select style={inp} value={draft.supervisor_id} onChange={(e) => setDraft({ ...draft, supervisor_id: e.target.value })}>
            <option value="">— tenant-wide (any supervisor) —</option>
            {rows.filter((r) => r.wfm_role === "supervisor" && r.id !== editing).map((r) => (
              <option key={r.id} value={r.id}>{[r.first_name, r.last_name].filter(Boolean).join(" ")}</option>
            ))}
          </select>
        </div>
      )}
      {editing !== "new" && (
        <div style={{ flex: "1 1 180px" }}>
          <label style={lbl}>Set up login (email)</label>
          <input style={inp} value={draft.invite_email} onChange={(e) => setDraft({ ...draft, invite_email: e.target.value })} placeholder="worker@example.com" />
        </div>
      )}
      {editing !== "new" && draft.invite_email.trim() && (
        <div style={{ flex: "1 1 180px" }}>
          <label style={lbl}>Initial password</label>
          <input
            style={inp}
            type="password"
            value={draft.invite_password}
            onChange={(e) => setDraft({ ...draft, invite_password: e.target.value })}
            placeholder="Min. 8 characters"
          />
        </div>
      )}
      <button style={btnPrimary} disabled={busy} onClick={save}>{editing === "new" ? "Create" : "Save"}</button>
      <button style={btn} disabled={busy} onClick={() => { setEditing(null); setDraft(emptyDraft()); setError(""); }}>Cancel</button>
    </div>
  );

  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (roleFilter && r.wfm_role !== roleFilter) return false;
    if (siteFilter && r.site_id !== siteFilter) return false;
    if (!q) return true;
    return (
      [r.first_name, r.last_name].filter(Boolean).join(" ").toLowerCase().includes(q) ||
      (r.employee_code ?? "").toLowerCase().includes(q) ||
      (r.phone ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <>
      {error && <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.bad, fontSize: 12.5 }}>{error}</div>}

      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: `1px solid ${c.line}`, gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>
            {visible.length === rows.length
              ? `${rows.length} employee${rows.length === 1 ? "" : "s"}`
              : `${visible.length} of ${rows.length} employees`}
          </span>
          <button style={btnPrimary} onClick={() => { setEditing("new"); setDraft(emptyDraft()); setError(""); }}>
            + New employee
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${c.line}`, flexWrap: "wrap", alignItems: "center" }}>
          <input
            style={{ ...inp, flex: "1 1 200px", maxWidth: 280 }}
            placeholder="Search name, code or phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select style={{ ...inp, width: "auto" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
            <option value="">All statuses</option>
          </select>
          <select style={{ ...inp, width: "auto" }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            <option value="supervisor">Supervisors</option>
            <option value="employee">Employees</option>
          </select>
          <select style={{ ...inp, width: "auto" }} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
            <option value="">All sites</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Code</th>
              <th style={th}>Name</th>
              <th style={th}>Type</th>
              <th style={th}>WFM role</th>
              <th style={th}>Shift</th>
              <th style={th}>Home site</th>
              <th style={th}>Supervisor</th>
              <th style={th}>Login</th>
              <th style={th}>Consent</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, fontFamily: "monospace" }}>{r.employee_code ?? "—"}</td>
                <td style={{ ...td, fontWeight: 600 }}>
                  <Link href={ROUTES.wfmEmployee(r.id)} style={{ color: "var(--tenant-accent, #378ADD)", textDecoration: "none" }}>
                    {[r.first_name, r.last_name].filter(Boolean).join(" ")}
                  </Link>
                </td>
                <td style={td}>{r.employment_type === "contractor" ? "Contractor" : "Full-time"}</td>
                <td style={td}>{r.wfm_role === "supervisor" ? <Pill label="Supervisor" tone="purple" /> : "Employee"}</td>
                <td style={td}>{r.wfm_shifts?.name ?? "—"}</td>
                <td style={td}>{r.wfm_sites?.name ?? "—"}</td>
                <td style={{ ...td, color: c.muted }}>
                  {r.supervisor_id
                    ? [rows.find((s) => s.id === r.supervisor_id)?.first_name, rows.find((s) => s.id === r.supervisor_id)?.last_name].filter(Boolean).join(" ") || "—"
                    : "—"}
                </td>
                <td style={td}>{r.has_login ? <Pill label="Linked" tone="green" /> : <Pill label="No login" tone="amber" />}</td>
                <td style={td}>{r.consent_recorded_at ? <Pill label="Given" tone="green" /> : "—"}</td>
                <td style={td}><Pill label={r.status === "active" ? "Active" : "Inactive"} tone={r.status === "active" ? "green" : "red"} /></td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <button
                    style={btn}
                    disabled={busy}
                    onClick={() => {
                      setEditing(r.id);
                      setDraft({
                        employee_code: r.employee_code ?? "",
                        first_name: r.first_name,
                        last_name: r.last_name,
                        phone: r.phone ?? "",
                        employment_type: r.employment_type,
                        wfm_role: r.wfm_role,
                        shift_id: r.shift_id ?? "",
                        site_id: r.site_id ?? "",
                        supervisor_id: r.supervisor_id ?? "",
                        invite_email: "",
                        invite_password: "",
                      });
                      setError("");
                    }}
                  >
                    Edit
                  </button>{" "}
                  <button style={btn} disabled={busy} onClick={() => toggleStatus(r)}>
                    {r.status === "active" ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td style={{ ...td, color: c.hint }} colSpan={11}>
                {rows.length === 0
                  ? "No employees yet — create one below or bulk-load via Data Workbench."
                  : "No employees match these filters."}
              </td></tr>
            )}
          </tbody>
        </table>
        {form}
      </section>
    </>
  );
}
