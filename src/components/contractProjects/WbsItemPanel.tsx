"use client";

import { useMemo, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import InfoTip from "@/components/ui/InfoTip";
import { useFeel } from "@/components/FeelProvider";
import EmployeeLogin from "@/app/(app)/employees/EmployeeLogin";
import { PACKAGE_LIMITS, asTreeItem, lineMemberships } from "@/lib/contractProjects/allocation";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import type { BudgetLine, WorkPackageRow } from "@/lib/contractProjects/types";
import type { EmployeeChoice } from "@/lib/contractProjects/workPackagesServer";
import { parentChoices, previewCode, trimPct } from "@/lib/wbs/screen";
import { holdersOf } from "@/lib/wbs/tree";
import { WBS_TIPS } from "@/lib/wbs/tips";
import type { Employee } from "@/lib/types";

/**
 * One item of the project's WBS: code, name, parent, owner and the BOQ lines it holds (docs/design/wbs.md section 3c). The owner must be an
 * employee WITH a login: choosing one without shows "Create login" first and the item cannot be saved until the login exists (an assignment is a
 * task, so no login means no assignment). A line sits in one item or is split across several; lines are only held by bottom-level items. After the
 * baseline is approved the money is fixed: names, codes, parents and owners still save, the lines checklist does not (in the WBS basis).
 */
export default function WbsItemPanel({ projectId, pkg, parentId, packages, lines, employees, locked, linesLocked, basis, onClose, onSaved, onEditSplit, onMakeBuyout }: {
  projectId: string;
  /** null = a new item. */
  pkg: WorkPackageRow | null;
  /** A new item starts under this parent (Add sub-item). */
  parentId?: string | null;
  packages: WorkPackageRow[];
  lines: BudgetLine[];
  employees: EmployeeChoice[];
  /** Why nothing can change (a closed project, a view-only person), or null. */
  locked: string | null;
  /** Why the lines cannot move now (the baseline is waiting or approved in the WBS basis), or null. */
  linesLocked: string | null;
  basis: "line" | "package";
  onClose: () => void;
  onSaved: () => void;
  /** Opens the split panel for a split line. Absent = no Edit split link. */
  onEditSplit?: (lineKey: string) => void;
  /** Starts a buy-out package from this item. Absent = no button (the project has no Buy-out, or nothing can be changed). */
  onMakeBuyout?: (pkg: WorkPackageRow) => void;
}) {
  const { confirm } = useFeel();
  const [code, setCode] = useState(pkg?.code_is_manual ? pkg.code : "");
  const [name, setName] = useState(pkg?.name ?? "");
  const [parent, setParent] = useState(pkg ? pkg.parent_id ?? "" : parentId ?? "");
  const [owner, setOwner] = useState(pkg?.owner_employee_id ?? "");
  const [note, setNote] = useState(pkg?.note ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(pkg?.line_keys ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const items = useMemo(() => packages.map(asTreeItem), [packages]);
  const memberships = useMemo(() => lineMemberships(packages), [packages]);
  const holders = useMemo(() => holdersOf([...memberships.values()]), [memberships]);
  const choices = useMemo(() => parentChoices(items, pkg?.id ?? null, holders), [items, pkg?.id, holders]);
  const isBranch = !!pkg && packages.some((p) => p.parent_id === pkg.id);
  const holder = useMemo(() => new Map(packages.filter((p) => p.id !== pkg?.id).flatMap((p) => p.line_keys.map((k) => [k, p.code] as const))), [packages, pkg?.id]);
  const splitKeys = useMemo(() => new Set(packages.flatMap((p) => (p.line_parts ?? []).map((x) => x.line_key))), [packages]);
  const ordered = useMemo(() => [...lines].sort((a, b) => Number(holder.has(a.line_key) || splitKeys.has(a.line_key)) - Number(holder.has(b.line_key) || splitKeys.has(b.line_key)) || a.line_no - b.line_no), [lines, holder, splitKeys]);
  const chosen = employees.find((e) => e.id === owner) ?? null;
  const needsLogin = !!chosen && !chosen.has_login && chosen.id !== pkg?.owner_employee_id;
  const disabled = !!locked;
  const noLines = disabled || !!linesLocked || isBranch;
  const preview = previewCode(items, parent || null);
  const mine = pkg ? (pkg.line_parts ?? []) : [];
  const chosenParent = choices.find((x) => x.item.id === parent);

  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function save() {
    setBusy(true); setError("");
    try {
      const body: Record<string, unknown> = { name, owner_employee_id: owner || null, note: note.trim() || null, parent_id: parent || null };
      if (!pkg || code.trim() !== (pkg.code_is_manual ? pkg.code : "")) body.code = code.trim();
      if (!noLines) body.line_keys = [...picked];
      if (!pkg && !code.trim()) delete body.code;
      const res = await fetch(pkg ? `/api/contract-projects/${projectId}/work-packages/${pkg.id}` : `/api/contract-projects/${projectId}/work-packages`, {
        method: pkg ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save the WBS item"); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!pkg) return;
    const whole = pkg.line_keys.length, shared = mine.length, kids = packages.filter((p) => p.parent_id === pkg.id).length;
    const body = [
      whole > 0 ? `Its ${whole} line${whole === 1 ? "" : "s"} move to Unassigned.` : "",
      shared > 0 ? `${shared} share${shared === 1 ? "" : "s"} of split lines become${shared === 1 ? "s" : ""} an unassigned remainder.` : "",
      kids > 0 ? "Sub-items move up one level." : "",
      basis === "package" && pkg.allocated_cost !== null ? "The cost allocated to it goes too." : "",
    ].filter(Boolean).join(" ");
    if (!(await confirm({ title: `Remove ${pkg.code} ${pkg.name}?`, body: body || "Nothing is in it.", confirmLabel: "Remove", tone: "danger" }))) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/contract-projects/${projectId}/work-packages/${pkg.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not remove the WBS item"); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <SidePanel
      title={pkg ? `${pkg.code} ${pkg.name}` : "New WBS item"} label={pkg ? `WBS item ${pkg.code}` : "New WBS item"} onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" loading={busy} disabled={disabled || needsLogin || !name.trim()} data-guide="cp.wbs.save" style={{ minHeight: 44 }} onClick={save}>Save WBS item</Button>
          {pkg && <Button variant="danger" disabled={disabled || busy} data-guide="cp.wbs.remove" style={{ minHeight: 44 }} onClick={remove}>Remove</Button>}
        </div>
      }
    >
      <div data-guide="cp.wbs.panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {locked && <div role="status" style={{ fontSize: 13, color: "var(--amberink)" }}>{locked}</div>}
        {!locked && linesLocked && <div role="status" data-guide="cp.wbs.lines_locked" style={{ fontSize: 13, color: "var(--amberink)" }}>{linesLocked}</div>}
        {pkg?.source_wbs_item_id && (
          <div data-guide="cp.wbs.from_tender" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: c.muted }}>
            Copied from the tender WBS<InfoTip label="From tender">{WBS_TIPS.fromTender}</InfoTip>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(90px, 1fr) minmax(160px, 3fr)", gap: 10 }}>
          <Field label="Code" info={WBS_TIPS.code}><Input value={code} placeholder={pkg ? pkg.code : preview} maxLength={PACKAGE_LIMITS.codeMax} disabled={disabled} style={{ minHeight: 44 }} onChange={(e) => setCode(e.target.value)} data-guide="cp.wbs.code" /></Field>
          <Field label="Name"><Input value={name} maxLength={PACKAGE_LIMITS.nameMax} disabled={disabled} style={{ minHeight: 44 }} onChange={(e) => setName(e.target.value)} data-guide="cp.wbs.name" /></Field>
        </div>
        <Field label="Parent" info={WBS_TIPS.parent}>
          <Select value={parent} disabled={disabled} data-guide="cp.wbs.parent" style={{ minHeight: 44 }} onChange={(e) => setParent(e.target.value)}>
            <option value="">Top level</option>
            {choices.map((x) => (
              <option key={x.item.id} value={x.item.id} disabled={!x.allowed && x.item.id !== parent}>{"  ".repeat(x.depth - 1)}{x.item.code} {x.item.name}{x.holds && pkg ? " (holds lines)" : ""}</option>
            ))}
          </Select>
        </Field>
        {!pkg && chosenParent?.holds && <div role="note" data-guide="cp.wbs.moves_lines" style={{ fontSize: 12.5, color: "var(--amberink)" }}>{chosenParent.item.code} holds lines. They move into this new item.</div>}
        <Field label="Owner" info={PROJECT_TIPS.packageOwner}>
          <Select value={owner} disabled={disabled} data-guide="cp.wbs.owner" style={{ minHeight: 44 }} onChange={(e) => setOwner(e.target.value)}>
            <option value="">— No owner —</option>
            <optgroup label="With a login">{employees.filter((e) => e.has_login).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</optgroup>
            <optgroup label="No login yet">{employees.filter((e) => !e.has_login).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</optgroup>
          </Select>
        </Field>
        {!owner && pkg?.owner_name === null && <div style={{ fontSize: 12.5, color: c.hint }} data-guide="cp.wbs.no_owner">No owner</div>}
        {chosen && !chosen.has_login && (
          <div role="status" data-guide="cp.wbs.needs_login" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, color: "var(--amberink)" }}>
            {chosen.name} has no login yet.
            <EmployeeLogin compact login={null} employee={{ id: chosen.id, first_name: chosen.name, last_name: "", email: chosen.email, employee_code: chosen.code, valid_from: null, valid_to: null } as unknown as Employee} />
          </div>
        )}
        {isBranch ? (
          <div style={{ fontSize: 13, color: c.hint }} data-guide="cp.wbs.branch">{pkg?.code} has sub-items; the lines sit in them.</div>
        ) : (
          <Field label="Lines">
            <div data-guide="cp.wbs.lines" style={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${c.line}`, borderRadius: 8 }}>
              {ordered.length === 0 && <div style={{ padding: 12, fontSize: 13, color: c.hint }}>There are no budget lines yet.</div>}
              {ordered.map((l) => {
                const taken = holder.get(l.line_key);
                const split = splitKeys.has(l.line_key);
                const myPart = mine.find((x) => x.line_key === l.line_key);
                return (
                  <label key={l.line_key} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, padding: "0 12px", borderTop: `1px solid ${c.line}`, fontSize: 13, color: taken || (split && !myPart) ? c.hint : c.ink }}>
                    <input type="checkbox" checked={picked.has(l.line_key) || !!myPart} disabled={noLines || !!taken || split} style={{ width: 20, height: 20, flexShrink: 0 }} onChange={() => toggle(l.line_key)} />
                    <span style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
                      {l.wbs ? `${l.wbs} ` : ""}{l.description}{taken ? ` · in ${taken}` : ""}{myPart ? ` · ${pkg?.code} · ${trimPct(myPart.share_pct)} %` : split ? " · split across items" : ""}
                    </span>
                    {split && onEditSplit && !disabled && <Button variant="quiet" type="button" style={{ minHeight: 44 }} data-guide="cp.wbs.edit_split" onClick={(e) => { e.preventDefault(); onEditSplit(l.line_key); }}>Edit split</Button>}
                  </label>
                );
              })}
            </div>
          </Field>
        )}
        {pkg && onMakeBuyout && !locked && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Button variant="secondary" type="button" disabled={busy} data-guide="cp.wbs.make_buyout" style={{ minHeight: 44 }} onClick={() => onMakeBuyout(pkg)}>Make buy-out package</Button>
            <InfoTip label="Buy-out package">{WBS_TIPS.buyout}</InfoTip>
          </div>
        )}
        <Field label="Note"><Textarea rows={2} value={note} maxLength={PACKAGE_LIMITS.noteMax} disabled={disabled} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
      </div>
    </SidePanel>
  );
}
