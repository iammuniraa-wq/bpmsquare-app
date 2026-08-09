"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import type { Employee } from "@/lib/types";
import { sortRows, type SortExtractor } from "@/lib/listSort";

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

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SORT_EXTRACTORS: Record<string, SortExtractor<Employee>> = {
  name: (e) => `${e.first_name} ${e.last_name}`,
  code: (e) => e.employee_code,
  email: (e) => e.email,
  phone: (e) => e.phone,
  department: (e) => e.department,
  designation: (e) => e.designation,
  validity: (e) => e.valid_from,
  status: (e) => e.status,
};

type Draft = {
  first_name: string; last_name: string; employee_code: string; email: string;
  phone: string; department: string; designation: string;
  valid_from: string; valid_to: string; status: "active" | "inactive";
};
const emptyDraft = (): Draft => ({
  first_name: "", last_name: "", employee_code: "", email: "",
  phone: "", department: "", designation: "", valid_from: "", valid_to: "", status: "active",
});
const draftFrom = (e: Employee): Draft => ({
  first_name: e.first_name, last_name: e.last_name, employee_code: e.employee_code ?? "",
  email: e.email ?? "", phone: e.phone ?? "", department: e.department ?? "",
  designation: e.designation ?? "", valid_from: e.valid_from ?? "", valid_to: e.valid_to ?? "",
  status: e.status,
});

export default function EmployeesClient({ employees, canEdit }: { employees: Employee[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  // null = closed, "new" = create form, otherwise the employee id being edited
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [sortKey, setSortKey] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function sortIndicator(key: string) {
    const active = sortKey === key;
    return (
      <span style={{ fontSize: 9, opacity: active ? 1 : 0.35, color: active ? c.accent : "inherit", marginLeft: 4 }}>
        {active ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
      </span>
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? employees.filter((e) =>
        [e.first_name, e.last_name, e.employee_code, e.email, e.department, e.designation]
          .some((v) => v?.toLowerCase().includes(q)))
    : employees;
  const sorted = sortRows(filtered, sortKey, sortDir, SORT_EXTRACTORS);

  function open(id: string | "new", initial: Draft) {
    setEditing(id);
    setDraft(initial);
    setError("");
  }

  function save() {
    if (!draft.first_name.trim()) { setError("First name is required"); return; }
    setError("");
    startTransition(async () => {
      const payload = {
        ...draft,
        employee_code: draft.employee_code || null,
        email: draft.email || null,
        phone: draft.phone || null,
        department: draft.department || null,
        designation: draft.designation || null,
        valid_from: draft.valid_from || null,
        valid_to: draft.valid_to || null,
      };
      const res = editing === "new"
        ? await fetch("/api/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch(`/api/employees/${editing}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok) { setEditing(null); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save employee"); }
    });
  }

  function remove(e: Employee) {
    if (!confirm(`Delete ${e.first_name} ${e.last_name}? A business user linked to this employee keeps their login but loses the employee link.`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/employees/${e.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else { const j = await res.json(); setError(j.error ?? "Failed to delete employee"); }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          style={{ ...inp, maxWidth: 320 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, code, email, department…"
        />
        <div style={{ fontSize: 12, color: c.hint }}>{filtered.length} of {employees.length}</div>
        {canEdit && (
          <button
            type="button"
            onClick={() => open("new", emptyDraft())}
            style={{ marginLeft: "auto", padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: c.accent, color: "#fff", border: "none", cursor: "pointer" }}
          >
            + New Employee
          </button>
        )}
      </div>

      {error && !editing && (
        <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--err-ink)" }}>
          {error}
        </div>
      )}

      {editing !== null && (
        <section style={cardStyle}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 14px" }}>
            {editing === "new" ? "New Employee" : "Edit Employee"}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={lbl}>First name *</label><input style={inp} value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} /></div>
            <div><label style={lbl}>Last name</label><input style={inp} value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} /></div>
            <div><label style={lbl}>Employee code</label><input style={inp} value={draft.employee_code} onChange={(e) => setDraft({ ...draft, employee_code: e.target.value })} placeholder="e.g. EMP-0042" /></div>
            <div><label style={lbl}>Email</label><input style={inp} type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></div>
            <div><label style={lbl}>Phone</label><input style={inp} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></div>
            <div><label style={lbl}>Department</label><input style={inp} value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })} /></div>
            <div><label style={lbl}>Designation</label><input style={inp} value={draft.designation} onChange={(e) => setDraft({ ...draft, designation: e.target.value })} /></div>
            <div><label style={lbl}>Valid from</label><input style={inp} type="date" value={draft.valid_from} onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })} /></div>
            <div><label style={lbl}>Valid to</label><input style={inp} type="date" value={draft.valid_to} onChange={(e) => setDraft({ ...draft, valid_to: e.target.value })} /></div>
            <div>
              <label style={lbl}>Status</label>
              <select style={inp} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft["status"] })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          {error && (
            <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: "var(--err-ink)", marginBottom: 12 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={pending} onClick={save} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: c.accent, color: "#fff", border: "none", cursor: pending ? "wait" : "pointer" }}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(null)} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, background: "none", color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {employees.length === 0 && editing === null ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "44px 24px", color: c.muted }}>
          No employees yet.{canEdit ? " Create one above, or bulk-load an HR export via Data Workbench → Employees." : ""}
        </div>
      ) : (
        <div style={{ ...cardStyle, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, cursor: "pointer" }} onClick={() => toggleSort("name")}>Name{sortIndicator("name")}</th>
                <th style={{ ...th, cursor: "pointer" }} onClick={() => toggleSort("code")}>Code{sortIndicator("code")}</th>
                <th style={{ ...th, cursor: "pointer" }} onClick={() => toggleSort("email")}>Email{sortIndicator("email")}</th>
                <th style={{ ...th, cursor: "pointer" }} onClick={() => toggleSort("phone")}>Phone{sortIndicator("phone")}</th>
                <th style={{ ...th, cursor: "pointer" }} onClick={() => toggleSort("department")}>Department{sortIndicator("department")}</th>
                <th style={{ ...th, cursor: "pointer" }} onClick={() => toggleSort("designation")}>Designation{sortIndicator("designation")}</th>
                <th style={{ ...th, cursor: "pointer" }} onClick={() => toggleSort("validity")}>Validity{sortIndicator("validity")}</th>
                <th style={{ ...th, cursor: "pointer" }} onClick={() => toggleSort("status")}>Status{sortIndicator("status")}</th>
                {canEdit && <th style={th} />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{e.first_name} {e.last_name}</td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: 12, color: c.muted }}>{e.employee_code ?? "—"}</td>
                  <td style={{ ...td, color: c.muted }}>{e.email ?? "—"}</td>
                  <td style={{ ...td, color: c.muted }}>{e.phone ?? "—"}</td>
                  <td style={{ ...td, color: c.muted }}>{e.department ?? "—"}</td>
                  <td style={{ ...td, color: c.muted }}>{e.designation ?? "—"}</td>
                  <td style={{ ...td, color: c.muted, whiteSpace: "nowrap" }}>
                    {e.valid_from || e.valid_to ? `${fmtDate(e.valid_from)} → ${fmtDate(e.valid_to)}` : "—"}
                  </td>
                  <td style={td}>
                    <Pill label={e.status === "active" ? "Active" : "Inactive"} tone={e.status === "active" ? "green" : "red"} />
                  </td>
                  {canEdit && (
                    <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                      <button type="button" onClick={() => open(e.id, draftFrom(e))} style={{ background: "none", border: "none", color: c.accent, fontSize: 12, fontWeight: 600, cursor: "pointer", marginRight: 10 }}>
                        Edit
                      </button>
                      <button type="button" disabled={pending} onClick={() => remove(e)} style={{ background: "none", border: "none", color: "var(--red)", fontSize: 12, cursor: "pointer" }}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
