"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { isMembershipActive } from "@/lib/constants";
import Pager from "@/components/Pager";
import { paginate, clampPage, DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import type { Employee } from "@/lib/types";

type BusinessUser = {
  user_id: string;
  role: "admin" | "member";
  created_at: string;
  employee_id: string | null;
  display_name: string | null;
  is_locked: boolean;
  valid_from: string | null;
  valid_to: string | null;
  counted: boolean;
  email: string | null;
  business_role_ids: string[];
};
type BusinessRole = { id: string; name: string };

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
};
const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7,
  border: `1px solid ${c.line}`, fontSize: 13, background: c.panel, color: c.ink, outline: "none",
};
const btnPrimary: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 7, border: "none", background: c.accent,
  color: "#fff", fontWeight: 600, fontSize: 12.5, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "7px 14px", borderRadius: 7, border: `1px solid ${c.line}`,
  background: "none", color: c.muted, fontSize: 12, cursor: "pointer",
};
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function BusinessUsersClient() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [users, setUsers] = useState<BusinessUser[]>([]);
  const [roles, setRoles] = useState<BusinessRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [showNewEmployee, setShowNewEmployee] = useState(false);
  const [empDraft, setEmpDraft] = useState({ first_name: "", last_name: "", employee_code: "", email: "", department: "", designation: "", valid_from: "", valid_to: "" });
  const [savingEmp, setSavingEmp] = useState(false);

  const [creatingUserFor, setCreatingUserFor] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState({ email: "", password: "", counted: true, roleIds: [] as string[] });
  const [savingUser, setSavingUser] = useState(false);
  const [justCreated, setJustCreated] = useState<{ name: string; email: string; password: string } | null>(null);

  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ display_name: "", valid_from: "", valid_to: "", counted: true, new_password: "" });
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const [linkingUser, setLinkingUser] = useState<string | null>(null);
  const [linkEmployeeId, setLinkEmployeeId] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/employees").then((r) => r.json()),
      fetch("/api/business-users").then((r) => r.json()),
      fetch("/api/business-roles").then((r) => r.json()),
    ])
      .then(([emps, bu, br]) => {
        setEmployees(Array.isArray(emps) ? emps : []);
        setUsers(Array.isArray(bu?.users) ? bu.users : []);
        setRoles(Array.isArray(br?.roles) ? br.roles.map((r: BusinessRole) => ({ id: r.id, name: r.name })) : []);
      })
      .catch(() => setError("Could not load — check your connection and refresh"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setPage((p) => clampPage(p, employees.length, DEFAULT_PAGE_SIZE));
  }, [employees.length]);
  const pageEmployees = paginate(employees, page, DEFAULT_PAGE_SIZE);

  const userByEmployee = new Map(users.filter((u) => u.employee_id).map((u) => [u.employee_id!, u]));
  const unlinkedUsers = users.filter((u) => !u.employee_id);

  function flash(msg: string) { setNotice(msg); setTimeout(() => setNotice(""), 4000); }

  async function createEmployee() {
    if (!empDraft.first_name.trim()) { setError("First name is required"); return; }
    setError("");
    setSavingEmp(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(empDraft),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create employee"); return; }
      setEmpDraft({ first_name: "", last_name: "", employee_code: "", email: "", department: "", designation: "", valid_from: "", valid_to: "" });
      setShowNewEmployee(false);
      flash("Employee created");
      load();
    } finally {
      setSavingEmp(false);
    }
  }

  async function createBusinessUser(employeeId: string, employeeName: string) {
    setError("");
    if (!userDraft.password.trim()) { setError("An initial password is required"); return; }
    setSavingUser(true);
    try {
      const res = await fetch("/api/business-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          email: userDraft.email || undefined,
          password: userDraft.password || undefined,
          counted: userDraft.counted,
          role_ids: userDraft.roleIds,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create business user"); return; }
      setCreatingUserFor(null);
      if (json.linkedExisting) {
        flash("Linked the existing login to this employee — its password is unchanged");
      } else {
        setJustCreated({ name: employeeName, email: userDraft.email, password: userDraft.password });
        if (json.rolesSkipped) {
          flash("Linked an existing login — assign its Business Roles from this list once it's confirmed");
        }
      }
      setUserDraft({ email: "", password: "", counted: true, roleIds: [] });
      load();
    } finally {
      setSavingUser(false);
    }
  }

  async function linkToEmployee(u: BusinessUser) {
    if (!linkEmployeeId) return;
    setError("");
    setSavingLink(true);
    try {
      const res = await fetch(`/api/business-users/${u.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: linkEmployeeId }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to link"); return; }
      setLinkingUser(null);
      setLinkEmployeeId("");
      flash("Login linked to employee");
      load();
    } finally {
      setSavingLink(false);
    }
  }

  function startEdit(u: BusinessUser) {
    setEditingUser(u.user_id);
    setEditDraft({
      display_name: u.display_name ?? "",
      valid_from: u.valid_from ?? "",
      valid_to: u.valid_to ?? "",
      counted: u.counted,
      new_password: "",
    });
    setEditRoleIds(u.business_role_ids);
  }

  async function saveEdit(u: BusinessUser) {
    setError("");
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/business-users/${u.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: editDraft.display_name,
          valid_from: editDraft.valid_from || null,
          valid_to: editDraft.valid_to || null,
          counted: editDraft.counted,
          ...(editDraft.new_password ? { new_password: editDraft.new_password } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to save"); return; }

      if (u.role === "member") {
        const rolesRes = await fetch(`/api/settings/team/${u.user_id}/roles`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role_ids: editRoleIds }),
        });
        if (!rolesRes.ok) { const j = await rolesRes.json(); setError(j.error ?? "Saved, but role assignment failed"); return; }
      }

      setEditingUser(null);
      flash("Saved");
      load();
    } finally {
      setSavingEdit(false);
    }
  }

  async function toggleLock(u: BusinessUser) {
    setError("");
    const res = await fetch(`/api/business-users/${u.user_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_locked: !u.is_locked }),
    });
    if (res.ok) { flash(u.is_locked ? "Unlocked" : "Locked — takes effect on their next request"); load(); }
    else { const j = await res.json(); setError(j.error ?? "Failed to update lock"); }
  }

  if (loading) return <div style={{ fontSize: 13, color: c.hint, padding: 24 }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 980 }}>
      {error && (
        <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--err-ink)" }}>
          {error}
        </div>
      )}
      {notice && (
        <div style={{ background: "var(--greenbg)", border: "1px solid var(--green)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--greenink)" }}>
          ✓ {notice}
        </div>
      )}

      {justCreated && <ShareCredentialsCard info={justCreated} onDismiss={() => setJustCreated(null)} />}

      <section style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 700, color: c.ink, margin: 0 }}>Employees</h3>
          <button style={btnPrimary} onClick={() => setShowNewEmployee((v) => !v)}>
            {showNewEmployee ? "Cancel" : "+ New Employee"}
          </button>
        </div>
        <p style={{ fontSize: 12, color: c.muted, margin: "0 0 14px" }}>
          Master data — an employee without a business user has no login. Also importable in bulk via Data Workbench → Employees.
        </p>

        {showNewEmployee && (
          <div style={{ border: `1px solid ${c.line}`, borderRadius: 9, padding: 14, marginBottom: 14, background: "var(--panel2)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div><label style={lbl}>First name *</label><input style={inp} value={empDraft.first_name} onChange={(e) => setEmpDraft((d) => ({ ...d, first_name: e.target.value }))} /></div>
              <div><label style={lbl}>Last name</label><input style={inp} value={empDraft.last_name} onChange={(e) => setEmpDraft((d) => ({ ...d, last_name: e.target.value }))} /></div>
              <div><label style={lbl}>Employee code</label><input style={inp} value={empDraft.employee_code} onChange={(e) => setEmpDraft((d) => ({ ...d, employee_code: e.target.value }))} placeholder="e.g. EMP-0042" /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div><label style={lbl}>Email</label><input style={inp} type="email" value={empDraft.email} onChange={(e) => setEmpDraft((d) => ({ ...d, email: e.target.value }))} placeholder="Becomes their login" /></div>
              <div><label style={lbl}>Department</label><input style={inp} value={empDraft.department} onChange={(e) => setEmpDraft((d) => ({ ...d, department: e.target.value }))} /></div>
              <div><label style={lbl}>Designation</label><input style={inp} value={empDraft.designation} onChange={(e) => setEmpDraft((d) => ({ ...d, designation: e.target.value }))} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div><label style={lbl}>Valid from</label><input style={inp} type="date" value={empDraft.valid_from} onChange={(e) => setEmpDraft((d) => ({ ...d, valid_from: e.target.value }))} /></div>
              <div><label style={lbl}>Valid to</label><input style={inp} type="date" value={empDraft.valid_to} onChange={(e) => setEmpDraft((d) => ({ ...d, valid_to: e.target.value }))} /></div>
            </div>
            <button style={btnPrimary} disabled={savingEmp} onClick={createEmployee}>{savingEmp ? "Saving…" : "Create Employee"}</button>
          </div>
        )}

        {employees.length === 0 ? (
          <div style={{ fontSize: 12.5, color: c.hint, padding: "14px 0" }}>No employees yet — create one above, or import via Data Workbench.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pageEmployees.map((emp) => {
              const bu = userByEmployee.get(emp.id);
              const name = `${emp.first_name} ${emp.last_name}`.trim();
              return (
                <div key={emp.id} style={{ border: `1px solid ${c.line}`, borderRadius: 9, padding: "10px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{name}</span>
                      {emp.employee_code && <span style={{ fontSize: 11, color: c.hint, marginLeft: 8, fontFamily: "monospace" }}>{emp.employee_code}</span>}
                      <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>
                        {[emp.designation, emp.department, emp.email].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    {bu ? (
                      <BusinessUserBadge user={bu} />
                    ) : creatingUserFor === emp.id ? null : (
                      <button style={btnGhost} onClick={() => { setCreatingUserFor(emp.id); setUserDraft({ email: emp.email ?? "", password: "", counted: true, roleIds: [] }); setJustCreated(null); }}>
                        + Create Business User
                      </button>
                    )}
                  </div>

                  {creatingUserFor === emp.id && !bu && (() => {
                    // Same email already a login here? Creating will LINK that
                    // login, not make a second one -- say so up front, and
                    // don't show a password field that would be silently
                    // ignored (an existing account's password is never
                    // overwritten from here).
                    const emailKey = userDraft.email.trim().toLowerCase();
                    const existing = emailKey ? users.find((u) => u.email?.toLowerCase() === emailKey) : undefined;
                    const conflicting = existing?.employee_id ? employees.find((e2) => e2.id === existing.employee_id) : undefined;
                    return (
                      <div style={{ marginTop: 10, background: "var(--panel2)", borderRadius: 8, padding: 12 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                          <div><label style={lbl}>Login email</label><input style={inp} type="email" value={userDraft.email} onChange={(e) => setUserDraft((d) => ({ ...d, email: e.target.value }))} /></div>
                          {!existing && (
                            <div>
                              <label style={lbl}>Initial password *</label>
                              <input style={inp} type="password" value={userDraft.password} onChange={(e) => setUserDraft((d) => ({ ...d, password: e.target.value }))} placeholder="min 8 characters" />
                            </div>
                          )}
                        </div>
                        {existing && !conflicting && (
                          <div style={{ background: "var(--bluebg, var(--panel))", border: `1px solid ${c.line}`, borderRadius: 7, padding: "9px 12px", fontSize: 12.5, color: c.ink, marginBottom: 10 }}>
                            This email is already a login in this workspace ({existing.role}). Saving will <strong>link that existing login</strong> to {name} — no new account, and its password stays unchanged.
                          </div>
                        )}
                        {conflicting && (
                          <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 7, padding: "9px 12px", fontSize: 12.5, color: "var(--err-ink)", marginBottom: 10 }}>
                            This email&apos;s login is already linked to {conflicting.first_name} {conflicting.last_name} — one login can only belong to one employee. Use a different email.
                          </div>
                        )}
                        {!existing && (
                          <div style={{ marginBottom: 10 }}>
                            <label style={lbl}>Business Roles</label>
                            {roles.length === 0 ? (
                              <div style={{ fontSize: 12, color: c.muted }}>No Business Roles exist yet — create one in Administrator → Business Roles first.</div>
                            ) : (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {roles.map((r) => (
                                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: c.ink, border: `1px solid ${c.line}`, borderRadius: 6, padding: "4px 9px", cursor: "pointer", background: c.panel }}>
                                    <input
                                      type="checkbox"
                                      checked={userDraft.roleIds.includes(r.id)}
                                      onChange={() => setUserDraft((d) => ({
                                        ...d,
                                        roleIds: d.roleIds.includes(r.id) ? d.roleIds.filter((x) => x !== r.id) : [...d.roleIds, r.id],
                                      }))}
                                    />
                                    {r.name}
                                  </label>
                                ))}
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: c.hint, marginTop: 5 }}>No role selected = full access (unrestricted).</div>
                          </div>
                        )}
                        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: c.ink, marginBottom: 10, cursor: "pointer" }}>
                          <input type="checkbox" checked={userDraft.counted} onChange={(e) => setUserDraft((d) => ({ ...d, counted: e.target.checked }))} />
                          Counted user (occupies a license seat)
                        </label>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            style={{ ...btnPrimary, opacity: conflicting || (!existing && !userDraft.password.trim()) ? 0.5 : 1 }}
                            disabled={savingUser || !!conflicting || (!existing && !userDraft.password.trim())}
                            onClick={() => createBusinessUser(emp.id, name)}
                          >
                            {savingUser ? "Saving…" : existing ? "Link existing login" : "Create"}
                          </button>
                          <button style={btnGhost} onClick={() => setCreatingUserFor(null)}>Cancel</button>
                        </div>
                      </div>
                    );
                  })()}

                  {bu && editingUser === bu.user_id && (
                    <EditPanel
                      user={bu} roles={roles} draft={editDraft} setDraft={setEditDraft}
                      roleIds={editRoleIds} setRoleIds={setEditRoleIds}
                      saving={savingEdit} onSave={() => saveEdit(bu)} onCancel={() => setEditingUser(null)}
                    />
                  )}

                  {bu && editingUser !== bu.user_id && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button style={btnGhost} onClick={() => startEdit(bu)}>Edit user</button>
                      <button
                        style={{ ...btnGhost, color: bu.is_locked ? "var(--greenink)" : "var(--red)", borderColor: bu.is_locked ? "var(--green)" : "#f5c0c0" }}
                        onClick={() => toggleLock(bu)}
                      >
                        {bu.is_locked ? "Unlock" : "Lock"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {employees.length > 0 && (
          <Pager page={page} total={employees.length} pageSize={DEFAULT_PAGE_SIZE} onPage={setPage} />
        )}
      </section>

      {unlinkedUsers.length > 0 && (
        <section style={cardStyle}>
          <h3 style={{ fontSize: 13.5, fontWeight: 700, color: c.ink, margin: "0 0 6px" }}>Other logins (no employee record)</h3>
          <p style={{ fontSize: 12, color: c.muted, margin: "0 0 12px" }}>
            Memberships created before this screen existed, or via Settings → Team. They work exactly the same — lock, validity, and roles all apply — they just aren&apos;t tied to an employee.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {unlinkedUsers.map((u) => (
              <div key={u.user_id} style={{ border: `1px solid ${c.line}`, borderRadius: 9, padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{u.display_name || u.email || u.user_id.slice(0, 8)}</span>
                    <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{u.email ?? "—"} · {u.role}</div>
                  </div>
                  <BusinessUserBadge user={u} />
                </div>
                {editingUser === u.user_id ? (
                  <EditPanel
                    user={u} roles={roles} draft={editDraft} setDraft={setEditDraft}
                    roleIds={editRoleIds} setRoleIds={setEditRoleIds}
                    saving={savingEdit} onSave={() => saveEdit(u)} onCancel={() => setEditingUser(null)}
                  />
                ) : linkingUser === u.user_id ? (
                  <div style={{ marginTop: 10, background: "var(--panel2)", borderRadius: 8, padding: 12 }}>
                    <label style={lbl}>Link this login to an employee</label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <select style={{ ...inp, maxWidth: 320 }} value={linkEmployeeId} onChange={(e) => setLinkEmployeeId(e.target.value)}>
                        <option value="">— Select employee —</option>
                        {employees.filter((e2) => !userByEmployee.has(e2.id)).map((e2) => (
                          <option key={e2.id} value={e2.id}>
                            {e2.first_name} {e2.last_name}{e2.employee_code ? ` (${e2.employee_code})` : ""}
                          </option>
                        ))}
                      </select>
                      <button style={btnPrimary} disabled={savingLink || !linkEmployeeId} onClick={() => linkToEmployee(u)}>
                        {savingLink ? "Linking…" : "Link"}
                      </button>
                      <button style={btnGhost} onClick={() => { setLinkingUser(null); setLinkEmployeeId(""); }}>Cancel</button>
                    </div>
                    <p style={{ fontSize: 11.5, color: c.hint, margin: "8px 0 0" }}>
                      The login and its password are untouched — this only ties it to the employee record, moving it up into the Employees list above.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button style={btnGhost} onClick={() => startEdit(u)}>Edit user</button>
                    <button style={btnGhost} onClick={() => { setLinkingUser(u.user_id); setLinkEmployeeId(""); setError(""); }}>
                      Link to employee
                    </button>
                    <button
                      style={{ ...btnGhost, color: u.is_locked ? "var(--greenink)" : "var(--red)", borderColor: u.is_locked ? "var(--green)" : "#f5c0c0" }}
                      onClick={() => toggleLock(u)}
                    >
                      {u.is_locked ? "Unlock" : "Lock"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ShareCredentialsCard({
  info, onDismiss,
}: {
  info: { name: string; email: string; password: string };
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? window.location.origin : "";
  const summary = `Sign-in: ${url}\nEmail: ${info.email}\nInitial password: ${info.password}`;

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard API can be unavailable (permissions, insecure context) --
      // the values are still shown on screen to copy by hand.
    }
  }

  const rowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${c.line}` };

  return (
    <div style={{ background: "var(--greenbg)", border: "1px solid var(--green)", borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--greenink)" }}>
          Business user created for {info.name} — share these details with them
        </div>
        <button style={{ ...btnGhost, flexShrink: 0 }} onClick={onDismiss}>Dismiss</button>
      </div>
      <div style={{ background: "#fff", borderRadius: 7, padding: "4px 12px" }}>
        <div style={rowStyle}><span style={{ fontSize: 12, color: c.hint }}>Sign-in URL</span><code style={{ fontSize: 12.5, color: c.ink }}>{url}</code></div>
        <div style={rowStyle}><span style={{ fontSize: 12, color: c.hint }}>Email</span><code style={{ fontSize: 12.5, color: c.ink }}>{info.email}</code></div>
        <div style={{ ...rowStyle, borderBottom: "none" }}><span style={{ fontSize: 12, color: c.hint }}>Initial password</span><code style={{ fontSize: 12.5, color: c.ink }}>{info.password}</code></div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <button style={btnPrimary} onClick={copyAll}>{copied ? "Copied!" : "Copy all"}</button>
        <span style={{ fontSize: 11.5, color: "var(--greenink)" }}>They&apos;ll be prompted to set their own password the first time they sign in.</span>
      </div>
    </div>
  );
}

function BusinessUserBadge({ user }: { user: BusinessUser }) {
  const active = isMembershipActive(user);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{
        fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "3px 9px",
        background: active ? "var(--greenbg)" : "var(--err-bg)",
        color: active ? "var(--greenink)" : "var(--err-ink)",
      }}>
        {user.is_locked ? "Locked" : active ? "Active" : "Out of validity"}
      </span>
      {!user.counted && <span style={{ fontSize: 11, color: c.hint, border: `1px solid ${c.line}`, borderRadius: 6, padding: "2px 8px" }}>Not counted</span>}
      {(user.valid_from || user.valid_to) && (
        <span style={{ fontSize: 11, color: c.hint }}>{fmtDate(user.valid_from)} → {fmtDate(user.valid_to)}</span>
      )}
    </div>
  );
}

function EditPanel({
  user, roles, draft, setDraft, roleIds, setRoleIds, saving, onSave, onCancel,
}: {
  user: BusinessUser;
  roles: BusinessRole[];
  draft: { display_name: string; valid_from: string; valid_to: string; counted: boolean; new_password: string };
  setDraft: React.Dispatch<React.SetStateAction<{ display_name: string; valid_from: string; valid_to: string; counted: boolean; new_password: string }>>;
  roleIds: string[];
  setRoleIds: React.Dispatch<React.SetStateAction<string[]>>;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ marginTop: 10, background: "var(--panel2)", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div><label style={lbl}>Display name</label><input style={inp} value={draft.display_name} onChange={(e) => setDraft((d) => ({ ...d, display_name: e.target.value }))} /></div>
        <div>
          <label style={lbl}>Set new password (optional)</label>
          <input style={inp} type="password" value={draft.new_password} onChange={(e) => setDraft((d) => ({ ...d, new_password: e.target.value }))} placeholder="min 8 characters" />
          {draft.new_password && <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>They&apos;ll be prompted to set their own on next login.</div>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div><label style={lbl}>Valid from</label><input style={inp} type="date" value={draft.valid_from} onChange={(e) => setDraft((d) => ({ ...d, valid_from: e.target.value }))} /></div>
        <div><label style={lbl}>Valid to</label><input style={inp} type="date" value={draft.valid_to} onChange={(e) => setDraft((d) => ({ ...d, valid_to: e.target.value }))} /></div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: c.ink, marginBottom: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={draft.counted} onChange={(e) => setDraft((d) => ({ ...d, counted: e.target.checked }))} />
        Counted user (occupies a license seat)
      </label>

      {user.role === "member" && (
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Business Roles</label>
          {roles.length === 0 ? (
            <div style={{ fontSize: 12, color: c.muted }}>No Business Roles exist yet — create one in Administrator → Business Roles first.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {roles.map((r) => (
                <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: c.ink, border: `1px solid ${c.line}`, borderRadius: 6, padding: "4px 9px", cursor: "pointer", background: c.panel }}>
                  <input
                    type="checkbox"
                    checked={roleIds.includes(r.id)}
                    onChange={() => setRoleIds((ids) => (ids.includes(r.id) ? ids.filter((x) => x !== r.id) : [...ids, r.id]))}
                  />
                  {r.name}
                </label>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: c.hint, marginTop: 5 }}>No role selected = full access (unrestricted).</div>
        </div>
      )}
      {user.role === "admin" && (
        <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 12 }}>Workspace admins bypass Business Roles entirely.</div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button style={btnPrimary} disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save"}</button>
        <button style={btnGhost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
