"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { WBS_TIPS } from "@/lib/wbs/tips";
import { addProblem } from "@/lib/wbs/tree";
import { leafItems, previewCode } from "@/lib/wbs/screen";
import { call } from "./api";
import s from "./Wbs.module.css";

// The selection bar of the Bill of quantities (docs/design/wbs.md section 3a): "3 selected · Group into WBS ▾ · Clear", plus Split… when exactly
// one line is ticked. The menu lists New WBS item… (name, parent, the code it will get) and every leaf item by code and name. Sticky at the
// bottom of the screen on a phone.

type Item = { id: string; code: string; name: string; parent_id: string | null; sort_order: number; code_is_manual: boolean; owner_employee_id: string | null };

export default function GroupIntoWbs({ base, ids, items, onClear, onDone, onError, onSplit }: {
  /** /api/opportunities/[id]/tender/wbs */
  base: string;
  /** The ticked BOQ line ids. */
  ids: readonly string[];
  items: readonly Item[];
  onClear: () => void;
  /** After the lines moved, with the notice to show. */
  onDone: (notice: string) => void;
  onError: (m: string) => void;
  /** Opens the split panel for the one ticked line. Absent = no Split… button. */
  onSplit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  if (ids.length === 0) return null;

  const leaves = leafItems(items);
  const parents = items.filter((i) => addProblem(items, i.id) === null);
  const n = ids.length;

  async function group(itemId: string, label: string) {
    setBusy(true); onError("");
    const out = await call<{ assigned: number; unsplit: number }>(`${base}/assign`, "PUT", { boq_ids: ids, wbs_item_id: itemId });
    setBusy(false);
    if (!out.ok) { onError(out.error); return; }
    setOpen(false);
    onDone(`${out.data.assigned} line${out.data.assigned === 1 ? "" : "s"} put in WBS ${label}${out.data.unsplit ? ` (${out.data.unsplit} split line${out.data.unsplit === 1 ? " is" : "s are"} no longer split)` : ""}`);
  }

  async function createAndGroup() {
    if (!name.trim()) return;
    setBusy(true); onError("");
    const out = await call<{ id: string; code: string }>(base, "POST", { name: name.trim(), parent_id: parent || null, boq_ids: ids });
    setBusy(false);
    if (!out.ok) { onError(out.error); return; }
    setName(""); setParent(""); setCreating(false); setOpen(false);
    onDone(`${n} line${n === 1 ? "" : "s"} put in the new WBS item ${out.data.code}`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className={s.bar} data-guide="boq.select_bar" data-sticky="1" role="region" aria-label="Selected lines">
        <span className={s.barCount}>{n} selected</span>
        <Button variant="primary" aria-haspopup="true" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)} style={{ minHeight: 44 }} data-guide="boq.group">Group into WBS ▾</Button>
        <InfoTip label="Group into WBS">{WBS_TIPS.group}</InfoTip>
        {onSplit && n === 1 && <Button variant="secondary" onClick={onSplit} style={{ minHeight: 44 }} data-guide="boq.split_selected">Split…</Button>}
        <span className={s.grow} />
        <Button variant="quiet" onClick={onClear} style={{ minHeight: 44 }} data-guide="boq.clear_selection">Clear</Button>
      </div>
      {open && (
        <div className={s.menu} role="menu" aria-label="Put the selected lines in" data-guide="boq.group_menu">
          {!creating ? (
            <button type="button" role="menuitem" className={s.menuItem} onClick={() => setCreating(true)} data-guide="boq.group_new"><b>New WBS item…</b></button>
          ) : (
            <div className={s.inline} data-guide="boq.group_new_form">
              <Input aria-label="Name of the new WBS item" placeholder="Name of the new WBS item" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void createAndGroup(); }} style={{ minHeight: 44 }} autoFocus />
              <Select aria-label="Parent (optional)" value={parent} onChange={(e) => setParent(e.target.value)} style={{ minHeight: 44 }}>
                <option value="">Top level</option>
                {parents.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
              </Select>
              <div style={{ fontSize: 12.5 }}>Code <b>{previewCode(items, parent || null)}</b></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void createAndGroup()} style={{ minHeight: 44 }} data-guide="boq.group_create">Create and group</Button>
                <Button variant="secondary" onClick={() => setCreating(false)} style={{ minHeight: 44 }}>Back</Button>
              </div>
            </div>
          )}
          {leaves.map((l) => (
            <button key={l.id} type="button" role="menuitem" className={s.menuItem} disabled={busy} onClick={() => void group(l.id, l.code)} data-guide="boq.group_item">
              <span className={s.menuCode}>{l.code}</span><span className={s.menuName}>{l.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
