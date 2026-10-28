"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { useFeel } from "@/components/FeelProvider";
import type { Employee } from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import RemoveEmployeeDialog from "./RemoveEmployeeDialog";
import EmployeeLogin, { type EmployeeLoginInfo } from "./EmployeeLogin";
import { restoreNote } from "@/lib/wfm/obsolete";

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

/** The create / edit dialog -- employees are small enough to live in a dialog, not on a page. */
function EmployeeDialog({ employee, login, onClose }: { employee: Employee | null; login?: EmployeeLoginInfo | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft>(employee ? draftFrom(employee) : emptyDraft());

  function save() {
    if (!draft.first_name.trim()) { setError("First name is required"); return; }
    setError("");
    startTransition(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { employee_code: _code, ...rest } = draft;
      const payload = {
        ...rest,
        email: draft.email || null,
        phone: draft.phone || null,
        department: draft.department || null,
        designation: draft.designation || null,
        valid_from: draft.valid_from || null,
        valid_to: draft.valid_to || null,
      };
      const res = employee
        ? await fetch(`/api/employees/${employee.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok) { onClose(); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save employee"); }
    });
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,32,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={employee ? "Edit employee" : "New employee"} style={{ width: 640, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto" }}>
        <Card title={employee ? "Edit Employee" : "New Employee"} padding={20}>
          {employee && <div style={{ marginBottom: 14 }}><EmployeeLogin employee={employee} login={login ?? null} /></div>}
          <div className="fg3">
            <Field label="First name" required><Input value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} autoFocus /></Field>
            <Field label="Last name"><Input value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} /></Field>
            <Field label="Employee code">
              <div style={{ fontSize: 12.5, color: draft.employee_code ? c.ink : c.hint, paddingTop: 9, fontFamily: draft.employee_code ? "monospace" : undefined }}>
                {draft.employee_code || "Assigned automatically (EMP-####)"}
              </div>
            </Field>
            <Field label="Email"><Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field>
            <Field label="Department"><Input value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })} /></Field>
            <Field label="Designation"><Input value={draft.designation} onChange={(e) => setDraft({ ...draft, designation: e.target.value })} /></Field>
            <Field label="Valid from"><Input type="date" value={draft.valid_from} onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })} /></Field>
            <Field label="Valid to"><Input type="date" value={draft.valid_to} onChange={(e) => setDraft({ ...draft, valid_to: e.target.value })} /></Field>
            <Field label="Status" info="Obsolete employees stay in reports up to their Valid to date, then drop out. Valid dates on an active employee are not enforced in reports.">
              <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft["status"] })}>
                <option value="active">Active</option>
                <option value="inactive">Obsolete</option>
              </Select>
            </Field>
          </div>
          {error && (
            <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: "var(--err-ink)", marginBottom: 12 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={save}>{pending ? "Saving…" : "Save"}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** "+ New Employee" in the list header. */
export function NewEmployeeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>+ New Employee</Button>
      {open && <EmployeeDialog employee={null} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Row actions. Plain buttons rather than a menu: the table scrolls sideways, which would clip a dropdown on the last rows. */
export function EmployeeRowActions({ employee, login }: { employee: Employee; login: EmployeeLoginInfo | null }) {
  const router = useRouter();
  const { confirm, toast } = useFeel();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const obsolete = employee.status === "inactive";

  async function reactivate() {
    const today = new Date().toLocaleDateString("en-CA");
    const note = restoreNote(employee.valid_to, today);
    if (!(await confirm({ title: `Make ${employee.first_name} ${employee.last_name} active again?`, body: note || undefined }))) return;
    const res = await fetch(`/api/employees/${employee.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }) });
    if (res.ok) router.refresh();
    else { const j = await res.json().catch(() => ({})); toast({ text: j.error ?? "Failed to update employee", tone: "error" }); }
  }

  return (
    <>
      <span style={{ display: "inline-flex", gap: 4, whiteSpace: "nowrap" }}>
        <Button variant="quiet" size="sm" onClick={() => setEditing(true)}>Edit</Button>
        {obsolete && <Button variant="quiet" size="sm" onClick={() => { void reactivate(); }}>Make active</Button>}
        <Button variant="quiet" size="sm" onClick={() => setRemoving(true)} style={{ color: "var(--err-ink)" }}>Delete</Button>
      </span>
      {editing && <EmployeeDialog employee={employee} login={login} onClose={() => setEditing(false)} />}
      {removing && <RemoveEmployeeDialog employee={employee} onClose={() => setRemoving(false)} />}
    </>
  );
}
