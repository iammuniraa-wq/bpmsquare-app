"use client";

import { useMemo, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import EmployeeLogin from "@/app/(app)/employees/EmployeeLogin";
import { PACKAGE_LIMITS } from "@/lib/contractProjects/allocation";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import type { BudgetLine, WorkPackageRow } from "@/lib/contractProjects/types";
import type { EmployeeChoice } from "@/lib/contractProjects/workPackagesServer";
import type { Employee } from "@/lib/types";

/**
 * One work package (the WBS): a code, a name, an owner and the BOQ lines it holds. The owner must be an employee WITH a login: choosing one
 * without shows "Create login" first and the package cannot be saved until the login exists (an assignment is a task, so no login means no
 * assignment). A line sits in one package: lines held by another are shown, not selectable.
 */
export default function WorkPackagePanel({ projectId, pkg, packages, lines, employees, locked, onClose, onSaved }: {
  projectId: string;
  /** null = a new package. */
  pkg: WorkPackageRow | null;
  packages: WorkPackageRow[];
  lines: BudgetLine[];
  employees: EmployeeChoice[];
  /** Why it cannot be changed (an approved or waiting budget, a view-only person), or null. */
  locked: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { confirm } = useFeel();
  const [code, setCode] = useState(pkg?.code ?? `WP-${packages.length + 1}`);
  const [name, setName] = useState(pkg?.name ?? "");
  const [owner, setOwner] = useState(pkg?.owner_employee_id ?? "");
  const [note, setNote] = useState(pkg?.note ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(pkg?.line_keys ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const holder = useMemo(() => new Map(packages.filter((p) => p.id !== pkg?.id).flatMap((p) => p.line_keys.map((k) => [k, p.code] as const))), [packages, pkg?.id]);
  const ordered = useMemo(() => [...lines].sort((a, b) => Number(holder.has(a.line_key)) - Number(holder.has(b.line_key)) || a.line_no - b.line_no), [lines, holder]);
  const chosen = employees.find((e) => e.id === owner) ?? null;
  const needsLogin = !!chosen && !chosen.has_login;
  const disabled = !!locked;

  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function save() {
    setBusy(true); setError("");
    try {
      const res = await fetch(pkg ? `/api/contract-projects/${projectId}/work-packages/${pkg.id}` : `/api/contract-projects/${projectId}/work-packages`, {
        method: pkg ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, owner_employee_id: owner || null, line_keys: [...picked], note: note.trim() || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save the work package"); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!pkg) return;
    if (!(await confirm({ title: `Remove ${pkg.code}?`, body: "Its lines are not deleted; they become unassigned. In package mode the cost allocated to it goes too.", confirmLabel: "Remove" }))) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/contract-projects/${projectId}/work-packages/${pkg.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not remove the work package"); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <SidePanel
      title={pkg ? `${pkg.code} ${pkg.name}` : "New work package"} onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" loading={busy} disabled={disabled || needsLogin || !code.trim() || !name.trim()} data-guide="cp.wbs.save" style={{ minHeight: 44 }} onClick={save}>Save work package</Button>
          {pkg && <Button variant="danger" disabled={disabled || busy} data-guide="cp.wbs.remove" style={{ minHeight: 44 }} onClick={remove}>Remove</Button>}
        </div>
      }
    >
      <div data-guide="cp.wbs.panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {locked && <div role="status" style={{ fontSize: 13, color: "var(--amberink)" }}>{locked}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(90px, 1fr) minmax(160px, 3fr)", gap: 10 }}>
          <Field label="Code"><Input value={code} maxLength={PACKAGE_LIMITS.codeMax} disabled={disabled} style={{ minHeight: 44 }} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label="Name"><Input value={name} maxLength={PACKAGE_LIMITS.nameMax} disabled={disabled} style={{ minHeight: 44 }} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <Field label="Owner" info={PROJECT_TIPS.packageOwner}>
          <Select value={owner} disabled={disabled} data-guide="cp.wbs.owner" style={{ minHeight: 44 }} onChange={(e) => setOwner(e.target.value)}>
            <option value="">— No owner —</option>
            <optgroup label="With a login">{employees.filter((e) => e.has_login).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</optgroup>
            <optgroup label="No login yet">{employees.filter((e) => !e.has_login).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</optgroup>
          </Select>
        </Field>
        {needsLogin && chosen && (
          <div role="status" data-guide="cp.wbs.needs_login" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, color: "var(--amberink)" }}>
            {chosen.name} has no login yet.
            <EmployeeLogin compact login={null} employee={{ id: chosen.id, first_name: chosen.name, last_name: "", email: chosen.email, employee_code: chosen.code, valid_from: null, valid_to: null } as unknown as Employee} />
          </div>
        )}
        <Field label="Lines">
          <div data-guide="cp.wbs.lines" style={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${c.line}`, borderRadius: 8 }}>
            {ordered.length === 0 && <div style={{ padding: 12, fontSize: 13, color: c.hint }}>There are no budget lines yet.</div>}
            {ordered.map((l) => {
              const taken = holder.get(l.line_key);
              return (
                <label key={l.line_key} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, padding: "0 12px", borderTop: `1px solid ${c.line}`, fontSize: 13, color: taken ? c.hint : c.ink }}>
                  <input type="checkbox" checked={picked.has(l.line_key)} disabled={disabled || !!taken} style={{ width: 20, height: 20, flexShrink: 0 }} onChange={() => toggle(l.line_key)} />
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{l.wbs ? `${l.wbs} ` : ""}{l.description}{taken ? ` · in ${taken}` : ""}</span>
                </label>
              );
            })}
          </div>
        </Field>
        <Field label="Note"><Textarea rows={2} value={note} maxLength={PACKAGE_LIMITS.noteMax} disabled={disabled} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
      </div>
    </SidePanel>
  );
}
