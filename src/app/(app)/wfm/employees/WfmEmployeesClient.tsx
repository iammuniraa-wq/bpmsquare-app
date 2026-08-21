"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type { WfmSite, WfmShift } from "@/lib/wfm/types";
import Pager from "@/components/Pager";
import { paginate, clampPage, DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import FaceEnrollModal from "@/components/wfm/FaceEnrollModal";

type Row = {
  id: string;
  employee_code: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  status: "active" | "inactive";
  employment_type: string;
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
  /** Read-only in the form: system-generated at create, immutable after. */
  employee_code: string;
  first_name: string; last_name: string; phone: string;
  employment_type: string; wfm_role: "employee" | "supervisor";
  shift_id: string; site_id: string; supervisor_id: string; invite_email: string; invite_password: string;
};
const emptyDraft = (): Draft => ({
  employee_code: "", first_name: "", last_name: "", phone: "",
  employment_type: "full_time", wfm_role: "employee", shift_id: "", site_id: "", supervisor_id: "",
  invite_email: "", invite_password: "",
});

export default function WfmEmployeesClient({ initial = null, employmentTypes = [], loginMode = "email" }: {
  initial?: { rows: Row[]; shifts: WfmShift[]; sites: WfmSite[] } | null;
  /** The tenant's configured employment types (Settings -> Workforce). */
  employmentTypes?: { code: string; label: string }[];
  /** How employees sign in (Settings -> Workforce). In "code" mode the screen
   *  offers a Create/Reset login action that sets a code+password login. */
  loginMode?: "email" | "code";
}) {
  const typeLabel = (code: string) => employmentTypes.find((t) => t.code === code)?.label ?? code;
  const [rows, setRows] = useState<Row[]>(initial?.rows ?? []);
  const [shifts, setShifts] = useState<WfmShift[]>(initial?.shifts ?? []);
  const [sites, setSites] = useState<WfmSite[]>(initial?.sites ?? []);
  const serverSeeded = useRef(initial != null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // "new" | employee id
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [roleFilter, setRoleFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [page, setPage] = useState(1);
  // Face-punch enrollment status (self-gating: the route says enabled:false
  // when the tenant hasn't switched face_punch on, and the column hides).
  const [faceEnabled, setFaceEnabled] = useState(false);
  const [faceMap, setFaceMap] = useState<Record<string, string>>({});
  const [enrolling, setEnrolling] = useState<Row | null>(null);
  // Code-login create/reset (loginMode === "code"): a small password prompt.
  const [loginRow, setLoginRow] = useState<Row | null>(null);
  const [loginPw, setLoginPw] = useState("");
  const [loginMsg, setLoginMsg] = useState("");

  const loadFace = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/face/enrollments");
      if (!res.ok) return;
      const json = await res.json();
      setFaceEnabled(json.enabled === true);
      const map: Record<string, string> = {};
      for (const e of json.enrollments ?? []) map[e.employee_id] = e.status;
      setFaceMap(map);
    } catch { /* leave hidden */ }
  }, []);
  useEffect(() => { void loadFace(); }, [loadFace]);

  async function revokeFace(r: Row) {
    if (!confirm(`Remove ${r.first_name}'s face enrollment? Their photos and face template are deleted.`)) return;
    await fetch(`/api/wfm/face/enrollments?employee_id=${r.id}`, { method: "DELETE" });
    void loadFace();
  }

  function openLogin(r: Row) {
    setLoginRow(r);
    setLoginPw("");
    setLoginMsg("");
  }

  async function submitLogin() {
    if (!loginRow || loginPw.length < 8) return;
    setBusy(true);
    setLoginMsg("");
    try {
      const res = await fetch(`/api/wfm/employees/${loginRow.id}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPw }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setLoginMsg(json.error ?? "Could not set the login."); return; }
      setLoginRow(null);
      setLoginPw("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(async () => {
    const [empRes, shiftRes, siteRes] = await Promise.all([
      fetch("/api/wfm/employees"), fetch("/api/wfm/shifts"), fetch("/api/wfm/sites"),
    ]);
    if (empRes.ok) setRows(await empRes.json());
    else setError((await empRes.json()).error ?? "Failed to load");
    if (shiftRes.ok) setShifts(await shiftRes.json());
    if (siteRes.ok) setSites(await siteRes.json());
  }, []);

  useEffect(() => {
    if (serverSeeded.current) { serverSeeded.current = false; return; } // server-rendered bootstrap
    load();
  }, [load]);

  async function save() {
    if (editing === "new" && !draft.first_name.trim()) {
      setError("First name is required");
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

  const formFields = (
    <div style={{ display: "flex", gap: 10, padding: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div style={{ flex: "0 1 150px" }}>
        <label style={lbl}>Code</label>
        <div style={{ fontSize: 12.5, color: draft.employee_code ? c.ink : c.hint, paddingTop: 9, fontFamily: draft.employee_code ? "monospace" : undefined }}>
          {draft.employee_code || "Assigned automatically (EMP-####)"}
        </div>
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
          {employmentTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
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

  // Create/edit takes over the view instead of appearing as an extra row under
  // the table -- appended to the bottom of a long list it was off-screen, so
  // pressing "New employee" looked like nothing had happened.
  if (editing !== null) {
    return (
      <>
        {error && <div style={{ ...cardStyle, marginBottom: 14, color: statusInk.bad, fontSize: 12.5 }}>{error}</div>}
        <section style={{ ...cardStyle, padding: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
            padding: "12px 12px 10px", borderBottom: `1px solid ${c.line}`, flexWrap: "wrap",
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>
                {editing === "new" ? "New employee" : "Edit employee"}
              </div>
              <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
                {editing === "new"
                  ? "Leave the code blank and the next one is generated for you."
                  : "Shift and site decide whose queue this person's requests land in."}
              </div>
            </div>
            <button
              style={btn}
              onClick={() => { setEditing(null); setDraft(emptyDraft()); setError(""); }}
            >← Back to employees</button>
          </div>
          {formFields}
        </section>
      </>
    );
  }

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
              {faceEnabled && <th style={th}>Face</th>}
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {paginate(visible, clampPage(page, visible.length, DEFAULT_PAGE_SIZE), DEFAULT_PAGE_SIZE).map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, fontFamily: "monospace" }}>{r.employee_code ?? "—"}</td>
                <td style={{ ...td, fontWeight: 600 }}>
                  <Link href={ROUTES.wfmEmployee(r.id)} style={{ color: "var(--tenant-accent, #378ADD)", textDecoration: "none" }}>
                    {[r.first_name, r.last_name].filter(Boolean).join(" ")}
                  </Link>
                </td>
                <td style={td}>{typeLabel(r.employment_type)}</td>
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
                {faceEnabled && (
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {faceMap[r.id] === "active" ? (
                      <>
                        <Pill label="Enrolled" tone="green" />{" "}
                        <button style={{ ...btn, padding: "3px 8px", fontSize: 11 }} disabled={busy} onClick={() => revokeFace(r)}>Remove</button>
                      </>
                    ) : r.status === "active" ? (
                      <button style={{ ...btn, padding: "3px 8px", fontSize: 11 }} disabled={busy} onClick={() => setEnrolling(r)}>Enroll</button>
                    ) : "—"}
                  </td>
                )}
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
                  {loginMode === "code" && r.status === "active" && (
                    <>
                      {" "}
                      <button style={btn} disabled={busy} onClick={() => openLogin(r)}>
                        {r.has_login ? "Reset password" : "Create login"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td style={{ ...td, color: c.hint }} colSpan={faceEnabled ? 12 : 11}>
                {rows.length === 0
                  ? "No employees yet — use + New employee above, or bulk-load via Data Workbench."
                  : "No employees match these filters."}
              </td></tr>
            )}
          </tbody>
        </table>
        <div style={{ padding: "0 12px 10px" }}>
          <Pager page={clampPage(page, visible.length, DEFAULT_PAGE_SIZE)} total={visible.length} pageSize={DEFAULT_PAGE_SIZE} onPage={setPage} />
        </div>
      </section>

      {enrolling && (
        <FaceEnrollModal
          employeeId={enrolling.id}
          employeeName={[enrolling.first_name, enrolling.last_name].filter(Boolean).join(" ")}
          onClose={() => setEnrolling(null)}
          onDone={() => void loadFace()}
        />
      )}

      {loginRow && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 1000 }}
          onClick={() => !busy && setLoginRow(null)}
        >
          <div style={{ ...cardStyle, width: 400, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.ink, marginBottom: 4 }}>
              {loginRow.has_login ? "Reset password" : "Create portal login"}
            </div>
            <div style={{ fontSize: 12.5, color: c.muted, marginBottom: 14, lineHeight: 1.5 }}>
              {[loginRow.first_name, loginRow.last_name].filter(Boolean).join(" ")} signs in with employee ID{" "}
              <strong style={{ color: c.ink }}>{loginRow.employee_code ?? "—"}</strong> and this password. They&apos;ll be asked to change it on first sign-in.
            </div>
            <label style={lbl}>Initial password</label>
            <input
              type="text"
              value={loginPw}
              onChange={(e) => setLoginPw(e.target.value)}
              placeholder="At least 8 characters"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={inp}
            />
            {loginMsg && <div style={{ fontSize: 12.5, color: statusInk.bad, marginTop: 8 }}>{loginMsg}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button style={btn} disabled={busy} onClick={() => setLoginRow(null)}>Cancel</button>
              <button style={btnPrimary} disabled={busy || loginPw.length < 8} onClick={submitLogin}>
                {busy ? "Saving…" : loginRow.has_login ? "Reset password" : "Create login"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
