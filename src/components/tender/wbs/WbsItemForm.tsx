"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { WBS_TIPS } from "@/lib/wbs/tips";
import { WBS_LIMITS } from "@/lib/wbs/tree";
import { parentChoices, previewCode } from "@/lib/wbs/screen";
import { call } from "./api";

// One WBS item, new or edited (docs/design/wbs.md section 3a): name, code, parent, owner. A side panel on a desktop, a bottom sheet on a phone.
// A new item's code numbers itself (the preview shows what it will be); typing one keeps it through a renumbering. The owner is optional while
// bidding: the project asks for a login. The row menu's Rename / Code / Move to / Set owner all open this one form on the field they name.

type Item = { id: string; code: string; name: string; parent_id: string | null; sort_order: number; code_is_manual: boolean; owner_employee_id: string | null };
type Owner = { id: string; name: string; has_login: boolean };

export default function WbsItemForm({ base, mode, items, item, parentId, holders, focus, onClose, onDone, onError, initialOwners }: {
  /** /api/opportunities/[id]/tender/wbs */
  base: string;
  mode: "new" | "edit";
  items: readonly Item[];
  item?: Item;
  /** A new item starts under this parent (Add sub-item). */
  parentId?: string | null;
  /** The ids of the items that hold lines or parts: a moved item cannot go under one; a new item under one takes its lines. */
  holders: ReadonlySet<string>;
  /** Which field the menu entry that opened this form was about. */
  focus?: "name" | "code" | "parent" | "owner";
  onClose: () => void;
  onDone: (notice: string) => void;
  onError: (m: string) => void;
  /** Lets a server render (and its test) show the owners without a fetch. The page never passes it. */
  initialOwners?: Owner[];
}) {
  const editing = mode === "edit" && !!item;
  const [name, setName] = useState(item?.name ?? "");
  const [code, setCode] = useState(editing ? item!.code : "");
  const [parent, setParent] = useState<string>(editing ? item!.parent_id ?? "" : parentId ?? "");
  const [owner, setOwner] = useState(item?.owner_employee_id ?? "");
  const [owners, setOwners] = useState<Owner[] | null>(initialOwners ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (owners) return;
    let live = true;
    void call<{ employees: Owner[] }>(`${base}/owners`, "GET").then((r) => { if (live && r.ok) setOwners(r.data.employees); });
    return () => { live = false; };
  }, [base, owners]);

  const choices = parentChoices(items, editing ? item!.id : null, holders);
  const chosen = choices.find((c) => c.item.id === parent);
  const preview = previewCode(items, parent || null);
  const dirty = editing
    ? name.trim() !== item!.name || code.trim() !== item!.code || (parent || null) !== item!.parent_id || (owner || null) !== item!.owner_employee_id
    : name.trim() !== "";

  async function save() {
    setError(""); onError("");
    if (!name.trim()) { setError("Give the WBS item a name"); return; }
    setBusy(true);
    let out;
    if (editing) {
      const body: Record<string, unknown> = {};
      if (name.trim() !== item!.name) body.name = name.trim();
      if (code.trim() !== item!.code) body.code = code.trim();
      if ((parent || null) !== item!.parent_id) body.parent_id = parent || null;
      if ((owner || null) !== item!.owner_employee_id) body.owner_employee_id = owner || null;
      out = await call(`${base}/${item!.id}`, "PATCH", body);
    } else {
      out = await call<{ code: string; moved: number }>(base, "POST", { name: name.trim(), code: code.trim() || undefined, parent_id: parent || null, owner_employee_id: owner || null });
    }
    setBusy(false);
    if (!out.ok) { setError(out.error); onError(out.error); return; }
    onDone(editing ? `WBS ${item!.code} saved` : `WBS item ${(out.data as { code: string }).code} added`);
  }

  return (
    <SidePanel
      title={editing ? `WBS ${item!.code}` : "New WBS item"} label={editing ? `WBS item ${item!.code}` : "New WBS item"} onClose={onClose}
      footer={<Button variant="primary" loading={busy} disabled={!dirty} onClick={() => void save()} style={{ minHeight: 44 }} data-guide="wbs.item.save">Save</Button>}
    >
      <div className="bpm-tap" data-guide="wbs.item.form" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        <Field label="Name" guide="wbs.item.name">
          <Input value={name} maxLength={WBS_LIMITS.nameMax} onChange={(e) => setName(e.target.value)} autoFocus={focus !== "code" && focus !== "owner" && focus !== "parent"} style={{ minHeight: 44 }} />
        </Field>
        <Field label="Code" info={WBS_TIPS.code} guide="wbs.item.code">
          <Input value={code} maxLength={WBS_LIMITS.codeMax} placeholder={editing ? undefined : preview} onChange={(e) => setCode(e.target.value)} autoFocus={focus === "code"} style={{ minHeight: 44 }} />
        </Field>
        <Field label="Parent" info={WBS_TIPS.parent} guide="wbs.item.parent">
          <Select value={parent} onChange={(e) => setParent(e.target.value)} autoFocus={focus === "parent"} style={{ minHeight: 44 }}>
            <option value="">Top level</option>
            {choices.map((c) => (
              <option key={c.item.id} value={c.item.id} disabled={!c.allowed && c.item.id !== parent}>{"  ".repeat(c.depth - 1)}{c.item.code} {c.item.name}{c.holds && editing ? " (holds lines)" : ""}</option>
            ))}
          </Select>
        </Field>
        {!editing && chosen?.holds && (
          <div role="note" data-guide="wbs.item.moves_lines" style={{ fontSize: 12.5, color: "var(--amberink)" }}>{chosen.item.code} holds lines. They move into this new item.</div>
        )}
        <Field label="Owner" info={WBS_TIPS.ownerBid} guide="wbs.item.owner">
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} autoFocus={focus === "owner"} style={{ minHeight: 44 }}>
            <option value="">No owner yet</option>
            {(owners ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}{o.has_login ? "" : " · no login yet"}</option>)}
            {owner && !(owners ?? []).some((o) => o.id === owner) && <option value={owner}>Current owner</option>}
          </Select>
        </Field>
      </div>
    </SidePanel>
  );
}
