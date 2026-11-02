"use client";

import Pill from "@/components/Pill";
import MoreMenu from "@/components/ui/MoreMenu";
import type { Figures, Share } from "@/lib/wbs/tree";
import { partViews, trimPct, type PartView } from "@/lib/wbs/screen";
import s from "./Wbs.module.css";

// One item of the WBS tree (docs/design/wbs.md section 3a): code, name, owner, lines, client amount, cost, and one menu of actions. A branch
// folds; a leaf unfolds to the lines (and parts of split lines) it holds. On a phone the row is a card and the figures are label / value pairs.

export type TreeRowItem = { id: string; code: string; name: string; parent_id: string | null; owner_employee_id: string | null; owner_name: string | null; depth: number; is_leaf: boolean };
export type HeldLine = {
  id: string; item_no: string | null; row_no: number; description: string; uom: string | null; qty: number; amount: number; priced: boolean; removed: boolean;
  wbs_item_id: string | null; wbs_parts: readonly Share[];
};
export type RowAction = "rename" | "code" | "add" | "move" | "owner" | "remove";

export const fmtMoney = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qtyText = (n: number, uom: string | null) => `${n.toLocaleString("en-US", { maximumFractionDigits: 3 })}${uom ? ` ${uom}` : ""}`;
const label = (l: Pick<HeldLine, "item_no" | "row_no">) => (l.item_no && l.item_no.trim() ? l.item_no : `#${l.row_no}`);

/** `3 (1 shared)`, `1`, `–` */
export function linesText(f: Figures | undefined): string {
  if (!f || f.part_count === 0) return "–";
  return f.shared_count > 0 ? `${f.part_count} (${f.shared_count} shared)` : String(f.part_count);
}

export default function WbsRow({ item, figures, items, lines, branchOpen, leafOpen, hasContent, canEdit, onToggle, onAction, onOpenLine }: {
  item: TreeRowItem;
  figures: Figures | undefined;
  /** All items, to name a part's item. */
  items: readonly { id: string; code: string; name: string }[];
  /** The lines and parts this item holds directly (leaf only). */
  lines: readonly HeldLine[];
  branchOpen: boolean;
  leafOpen: boolean;
  hasContent: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onAction: (a: RowAction) => void;
  onOpenLine: (id: string) => void;
}) {
  const expandable = !item.is_leaf || hasContent;
  const open = item.is_leaf ? leafOpen : branchOpen;
  const flagged = lines.some((l) => l.removed);
  return (
    <li role="treeitem" aria-level={item.depth} aria-expanded={expandable ? open : undefined} data-guide="boq.wbs_item">
      <div className={s.row} data-flag={flagged ? "1" : undefined}>
        <div className={`${s.nameCell} ${s.cName}`} style={{ paddingLeft: (item.depth - 1) * 20 }}>
          {expandable ? (
            <button type="button" className={s.toggle} aria-label={`${open ? "Fold" : "Unfold"} ${item.code} ${item.name}`} aria-expanded={open} onClick={onToggle} data-guide="boq.wbs_toggle">{open ? "▾" : "▸"}</button>
          ) : <span className={s.spacer} aria-hidden="true" />}
          <span className={s.code}>{item.code}</span>
          <span className={s.name}>{item.name}</span>
        </div>
        <div className={`${s.cOwner} ${s.muted}`}><span className={s.label}>Owner</span><span>{item.owner_name ?? "–"}</span></div>
        <div className={`${s.cLines} ${s.num}`}><span className={s.label}>Lines</span><span>{linesText(figures)}</span></div>
        <div className={`${s.cClient} ${s.num}`}><span className={s.label}>Client amount</span><span>{fmtMoney(figures?.client_amount ?? 0)}</span></div>
        <div className={`${s.cCost} ${s.num} ${s.muted}`}><span className={s.label}>Cost</span><span>{fmtMoney(figures?.cost ?? null)}</span></div>
        <div className={`${s.cActions} bpm-tap`}>
          {canEdit && (
            <MoreMenu label={`Actions for ${item.code}`} items={[
              { label: "Rename", onSelect: () => onAction("rename") },
              { label: "Code", onSelect: () => onAction("code") },
              { label: "Add sub-item", onSelect: () => onAction("add"), hidden: item.depth >= 3 },
              { label: "Move to…", onSelect: () => onAction("move") },
              { label: "Set owner", onSelect: () => onAction("owner") },
              { label: "Remove", onSelect: () => onAction("remove"), danger: true },
            ]} />
          )}
        </div>
      </div>
      {item.is_leaf && leafOpen && lines.length > 0 && (
        <ul className={s.itemLines} data-guide="boq.wbs_lines">
          {lines.map((l) => {
            const part: PartView | undefined = l.wbs_parts.length > 0 ? partViews(l, items).find((p) => p.wbs_item_id === item.id) : undefined;
            return (
              <li key={l.id} className={s.itemLine} data-guide="boq.wbs_line">
                <button type="button" className={s.open} onClick={() => onOpenLine(l.id)} aria-label={`Open item ${label(l)}`}>{label(l)}</button>
                <span>{l.description}</span>
                {part ? (
                  <span className={s.muted} data-guide="boq.wbs_part">{trimPct(part.share_pct)} % of {qtyText(l.qty, l.uom)} · {qtyText(part.qty, l.uom)}{l.priced ? ` · ${fmtMoney(part.amount)}` : ""}</span>
                ) : (
                  <span className={s.muted}>{qtyText(l.qty, l.uom)} · {l.priced ? fmtMoney(l.amount) : "–"}</span>
                )}
                {l.removed && <Pill label="no longer in the file" tone="amber" />}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
