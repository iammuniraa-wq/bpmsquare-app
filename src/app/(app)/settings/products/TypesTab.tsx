"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { Toggle } from "@/components/settings/generalShared";
import SettingsList, { ListBar } from "@/components/settings/SettingsList";
import type { ResolvedItemType } from "@/lib/products/itemTypes";
import { addItemType, BLANK_ITEM_TYPE, canRemoveItemType, flagsText, type NewItemType } from "./productsLogic";
import { PRODUCT_TIPS } from "./tips";
import s from "./products.module.css";

const FLAGS = [["stocked", "Stocked"], ["sellable", "Sold"], ["purchasable", "Bought"]] as const;

function Flags({ value, onChange }: { value: Pick<NewItemType, "stocked" | "sellable" | "purchasable">; onChange: (patch: Partial<NewItemType>) => void }) {
  return (
    <div>
      <span className="bpm-label-row"><span className="bpm-t-label">Used as</span><InfoTip label="Used as">{PRODUCT_TIPS.flags}</InfoTip></span>
      <div className={s.flags}>
        {FLAGS.map(([key, label]) => (
          <label key={key} className={s.flag}>
            <input type="checkbox" checked={value[key]} onChange={(e) => onChange({ [key]: e.target.checked })} /> {label}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function TypesTab({ rows, usage, accent, onChange }: {
  rows: ResolvedItemType[];
  usage: Record<string, number>;
  accent: string;
  onChange: (next: ResolvedItemType[]) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewItemType>(BLANK_ITEM_TYPE);
  const [error, setError] = useState("");
  const open = rows.find((r) => r.key === openKey) ?? null;

  const patch = (key: string, p: Partial<ResolvedItemType>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const confirmAdd = () => {
    const res = addItemType(rows, draft);
    if ("error" in res) { setError(res.error); return; }
    onChange(res.rows);
    setAdding(false);
  };

  return (
    <div className={s.shell}>
      <ListBar>
        <span className="bpm-label-row" style={{ marginInlineEnd: "auto" }}><span className="bpm-t-label">Item types</span><InfoTip label="Item types">{PRODUCT_TIPS.itemTypes}</InfoTip></span>
        <Button variant="primary" onClick={() => { setAdding(true); setOpenKey(null); setDraft(BLANK_ITEM_TYPE); setError(""); }}>+ New item type</Button>
      </ListBar>
      <SettingsList
        label="Item types"
        headers={["Used as", "Products"]}
        rows={rows.map((r) => ({
          key: r.key,
          title: <>{r.label}{r.hidden && <span className={s.pill}>Hidden</span>}{!r.isDefault && <span className={s.pill}>Custom</span>}</>,
          label: r.label,
          dim: r.hidden,
          cells: [flagsText(r), usage[r.key] ?? 0],
        }))}
        onOpen={(key) => { setOpenKey(key); setAdding(false); }}
      />

      {adding && (
        <SidePanel
          title="New item type"
          onClose={() => setAdding(false)}
          footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" onClick={confirmAdd}>Add item type</Button></>}
        >
          <Field label="Name"><Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Packaging" autoFocus /></Field>
          <Flags value={draft} onChange={(p) => setDraft({ ...draft, ...p })} />
          <details className={s.more}>
            <summary>More</summary>
            <div className={s.moreBody}>
              <Field label="What it means"><Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Cartons, pallets and wrap" /></Field>
            </div>
          </details>
          {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>}
        </SidePanel>
      )}

      {open && (
        <SidePanel
          title={open.label}
          subtitle={open.isDefault ? open.description : undefined}
          onClose={() => setOpenKey(null)}
          footer={
            <>
              {canRemoveItemType(open, usage) && <Button variant="danger" onClick={() => { onChange(rows.filter((r) => r.key !== open.key)); setOpenKey(null); }}>Remove</Button>}
              <Button variant="primary" onClick={() => setOpenKey(null)}>Done</Button>
            </>
          }
        >
          <Field label="Name"><Input value={open.label} onChange={(e) => patch(open.key, { label: e.target.value })} /></Field>
          <div className={s.switchRow}>
            <span className="bpm-label-row"><span className="bpm-t-label">Shown</span><InfoTip label="Shown">{PRODUCT_TIPS.hide}</InfoTip></span>
            <Toggle on={!open.hidden} onChange={(v) => patch(open.key, { hidden: !v })} accent={accent} label="Shown" />
          </div>
          {!open.isDefault && (
            <>
              <Flags value={open} onChange={(p) => patch(open.key, p)} />
              <Field label="What it means"><Input value={open.description} onChange={(e) => patch(open.key, { description: e.target.value })} /></Field>
            </>
          )}
        </SidePanel>
      )}
    </div>
  );
}
