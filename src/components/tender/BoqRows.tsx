"use client";

import { Fragment } from "react";
import Pill from "@/components/Pill";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { BOQ_TABLE_TIPS, type BoqTableTipKey } from "@/lib/tender/boq/tips";
import type { PillarKey } from "@/lib/theme";
import { itemLabel, rowChips, sourceView, type Chip, type EstimateLinkLike } from "@/lib/tender/boq/table";
import type { PriceSource } from "@/lib/tender/boq/price";
import { partText, partViews, trimPct, wbsCell } from "@/lib/wbs/screen";
import type { Share } from "@/lib/wbs/tree";
import s from "./BoqRows.module.css";
import w from "./wbs/Wbs.module.css";

// The rows of the Bill of quantities (GCC tender deals): a table on a desktop, a stack of cards on a phone. One row per client BOQ line.
// The client's item number is always the first thing in a row, as written. A row opens the side panel; nothing is edited inline.

export type BoqRow = {
  id: string; line_id: string | null; row_no: number; item_no: string | null; cost_code: string | null; description: string; uom: string | null; qty: number;
  rate: number; amount: number; priced: boolean; linked: boolean; removed: boolean;
  price_source: PriceSource | null; price_source_ref: string | null; price_as_of: string | null;
  stale: boolean; stale_text: string | null; stale_accepted: boolean; unit_cost: number | null; markup_pct: number | null;
  /** The long Description kept next to the name (a Narration), and the client's other columns. Absent or null for a Description-only file. */
  details?: string | null; client_data?: Record<string, string> | null;
  /** The WBS item the line sits in, or its shares when it is split across items (0243). Absent when the tender has no WBS. */
  wbs_item_id?: string | null; wbs_parts?: readonly Share[];
};

/** What the WBS adds to the table (docs/design/wbs.md section 3a): a tick box per row, a WBS column, a Split button, and the parts of a split line. */
export type WbsColumn = {
  items: readonly { id: string; code: string; name: string }[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], on: boolean) => void;
  canEdit: boolean;
  /** Split lines whose parts are shown under the row. */
  expanded: ReadonlySet<string>;
  onExpand: (id: string) => void;
  onSplit: (id: string) => void;
  onUnsplit: (id: string) => void;
  /** Split lines whose quantity changed in the last revised upload: the shares were kept and the quantities re-derived. */
  respread: ReadonlySet<string>;
};

export const money = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qtyText = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

const CHIP_TONE: Record<Chip["kind"], PillarKey> = { estimate: "purple", rfq: "blue", unpriced: "red", stale: "amber", changed: "amber" };

/** `tips` is off inside a card: the whole card is a button and an "i" cannot sit inside another button. */
export function RowChips({ row, links, tips = true }: { row: BoqRow; links: readonly EstimateLinkLike[]; tips?: boolean }) {
  const chips = rowChips(row, links);
  if (chips.length === 0) return null;
  return (
    <span className={s.chips} data-guide="boq.chips">
      {chips.map((k) => (
        <span key={k.kind + k.label} data-chip={k.kind} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <Pill label={k.kind === "estimate" && !/^EST/i.test(k.label) ? `Estimate ${k.label}` : k.label} tone={CHIP_TONE[k.kind]} />
          {tips && k.kind === "stale" && <span onClick={(e) => e.stopPropagation()}><InfoTip label="Stale">{BOQ_TABLE_TIPS.stale}</InfoTip></span>}
        </span>
      ))}
    </span>
  );
}

function SourceCell({ row }: { row: BoqRow }) {
  const v = sourceView(row);
  return (
    <>
      <span data-guide="boq.source">{v.label}</span>
      {v.detail && <div className={s.muted}>{v.detail}</div>}
      {v.was && <div className={s.muted}>was {v.was}</div>}
    </>
  );
}

/** The WBS cell of a row: the item's code, a "Split n" chip that opens the parts, and the amber flags. */
function WbsCellView({ row, wbs, controls }: { row: BoqRow; wbs: WbsColumn; controls?: string }) {
  const cell = wbsCell({ wbs_item_id: row.wbs_item_id ?? null, wbs_parts: row.wbs_parts ?? [] }, wbs.items);
  const open = wbs.expanded.has(row.id);
  const respread = wbs.respread.has(row.id);
  if (cell.kind === "none") return <span className={s.muted} data-guide="boq.wbs_col">—</span>;
  return (
    <span className={w.chipRow} data-guide="boq.wbs_col">
      {cell.kind === "whole" ? (
        <span title={cell.title}><Pill label={cell.label} tone="blue" /></span>
      ) : (
        <button type="button" className={w.chipBtn} title={cell.title} aria-expanded={open} aria-controls={controls} onClick={(e) => { e.stopPropagation(); wbs.onExpand(row.id); }} data-guide="boq.split_chip">
          <Pill label={`${cell.label} ${open ? "▾" : "▸"}`} tone="purple" />
        </button>
      )}
      {cell.kind === "split" && cell.remainder > 0 && <span data-chip="remainder"><Pill label={`${trimPct(cell.remainder)} % unassigned`} tone="amber" /></span>}
      {respread && <span data-chip="respread" title={BOQ_TABLE_TIPS.respread}><Pill label="shares re-spread" tone="amber" /></span>}
    </span>
  );
}

/** The parts of a split line, one line each, with Edit split and Unsplit. */
function SplitParts({ row, wbs, id }: { row: BoqRow; wbs: WbsColumn; id: string }) {
  const parts = partViews({ qty: row.qty, amount: row.priced ? row.amount : 0, wbs_item_id: row.wbs_item_id ?? null, wbs_parts: row.wbs_parts ?? [] }, wbs.items);
  return (
    <div id={id} className={w.parts} data-guide="boq.split_parts">
      {parts.map((p) => <div key={p.wbs_item_id} className={w.partsRow}>{partText(p, row.uom, money)}</div>)}
      {wbs.canEdit && (
        <div className={w.partsRow}>
          <Button variant="quiet" onClick={() => wbs.onSplit(row.id)} style={{ minHeight: 44 }} data-guide="boq.edit_split">Edit split</Button>
          <Button variant="quiet" onClick={() => wbs.onUnsplit(row.id)} style={{ minHeight: 44 }} data-guide="boq.unsplit">Unsplit</Button>
        </div>
      )}
    </div>
  );
}

function Head({ label, tip, num }: { label: string; tip: BoqTableTipKey; num?: boolean }) {
  return (
    <th scope="col" className={num ? s.num : undefined}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>{label}<InfoTip label={label}>{BOQ_TABLE_TIPS[tip]}</InfoTip></span>
    </th>
  );
}

/** Desktop: one table. The first cell is a button, so the keyboard and a screen reader reach every row; a click anywhere on the row opens it too. */
export function BoqTable({ rows, links, openId, onOpen, wbs }: { rows: readonly BoqRow[]; links: readonly EstimateLinkLike[]; openId: string | null; onOpen: (id: string) => void; wbs?: WbsColumn }) {
  const tick = !!wbs?.canEdit;
  const ids = rows.map((r) => r.id);
  const allOn = ids.length > 0 && ids.every((i) => wbs?.selected.has(i));
  const cols = 10 + (tick ? 1 : 0) + (wbs ? 2 : 0);
  return (
    <div className={s.wrap} data-guide="boq.table">
      <table className={s.table}>
        <thead>
          <tr>
            {tick && (
              <th scope="col">
                <label className={w.check}><input type="checkbox" checked={allOn} onChange={() => wbs!.onToggleAll(ids, !allOn)} aria-label="Select all rows on this page" data-guide="boq.select_all" /></label>
              </th>
            )}
            <th scope="col">Item</th>{wbs && <Head label="WBS" tip="wbs" />}<th scope="col">Description</th><th scope="col" className={s.num}>Qty</th><th scope="col">Unit</th><Head label="Cost from" tip="source" />
            <Head label="Cost / unit" tip="cost" num /><Head label="Markup %" tip="markup" num /><Head label="Rate / unit" tip="rate" num /><th scope="col" className={s.num}>Amount</th><Head label="Product" tip="product" />{wbs && <th scope="col" aria-label="Split" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <Fragment key={l.id}>
            <tr data-guide="boq.line" aria-selected={openId === l.id} onClick={() => onOpen(l.id)} style={{ cursor: "pointer" }}>
              {tick && (
                <td onClick={(e) => e.stopPropagation()}>
                  <label className={w.check}><input type="checkbox" checked={wbs!.selected.has(l.id)} onChange={() => wbs!.onToggle(l.id)} aria-label={`Select item ${itemLabel(l)}`} data-guide="boq.select_row" /></label>
                </td>
              )}
              <td className={s.item}>
                <button type="button" className={s.open} data-guide="boq.open_row" aria-label={`Open item ${itemLabel(l)}`} onClick={(e) => { e.stopPropagation(); onOpen(l.id); }} style={{ minHeight: 44 }}>{itemLabel(l)}</button>
              </td>
              {wbs && <td onClick={(e) => e.stopPropagation()}><WbsCellView row={l} wbs={wbs} controls={`split-${l.id}`} /></td>}
              <td className={s.desc}>{l.description}{l.cost_code ? <div className={s.muted}>{l.cost_code}</div> : null}</td>
              <td className={s.num}>{qtyText(l.qty)}</td>
              <td>{l.uom ?? ""}</td>
              <td><SourceCell row={l} /></td>
              <td className={s.num}>{l.unit_cost != null ? money(l.unit_cost) : "–"}</td>
              <td className={s.num}>{l.unit_cost != null && l.markup_pct != null ? `${l.markup_pct}%` : "–"}</td>
              <td className={s.num}><b>{l.priced ? money(l.rate) : "–"}</b></td>
              <td className={s.num}>{l.priced ? money(l.amount) : "–"}</td>
              <td><RowChips row={l} links={links} /></td>
              {wbs && (
                <td onClick={(e) => e.stopPropagation()}>
                  {wbs.canEdit && !l.removed && <Button variant="quiet" onClick={() => wbs.onSplit(l.id)} style={{ minHeight: 44 }} data-guide="boq.split">{(l.wbs_parts?.length ?? 0) > 0 ? "Edit split" : "Split"}</Button>}
                </td>
              )}
            </tr>
            {wbs && (l.wbs_parts?.length ?? 0) > 0 && wbs.expanded.has(l.id) && (
              <tr data-guide="boq.split_row"><td colSpan={cols} className={w.splitCell}><SplitParts row={l} wbs={wbs} id={`split-${l.id}`} /></td></tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Phone: a card per row, the whole card is the button. No table to scroll sideways. */
export function BoqCards({ rows, links, openId, onOpen, wbs }: { rows: readonly BoqRow[]; links: readonly EstimateLinkLike[]; openId: string | null; onOpen: (id: string) => void; wbs?: WbsColumn }) {
  return (
    <div className={s.cards} data-guide="boq.cards">
      {rows.map((l) => {
        const v = sourceView(l);
        const card = (
          <button key={wbs ? undefined : l.id} type="button" className={s.card} data-guide="boq.line" aria-selected={openId === l.id} aria-label={`Open item ${itemLabel(l)}`} onClick={() => onOpen(l.id)} style={{ minHeight: 44 }}>
            <span className={s.cardTop}>
              <b className={s.item}>{itemLabel(l)}</b>
              <span className={s.desc}>{l.description}</span>
            </span>
            <span className={s.cardMid}>
              <span>{qtyText(l.qty)} {l.uom ?? ""}</span>
              <span>{v.label}{v.detail ? ` · ${v.detail}` : ""}{v.was ? ` (was ${v.was})` : ""}</span>
            </span>
            <RowChips row={l} links={links} tips={false} />
            <span className={s.cardEnd}>
              <span>Rate {l.priced ? money(l.rate) : "–"}</span>
              <b>{l.priced ? money(l.amount) : "–"}</b>
            </span>
          </button>
        );
        if (!wbs) return card;
        const split = (l.wbs_parts?.length ?? 0) > 0;
        return (
          <div key={l.id} data-guide="boq.card_wrap">
            <div className={w.cardRow}>
              {wbs.canEdit && (
                <label className={w.check}><input type="checkbox" checked={wbs.selected.has(l.id)} onChange={() => wbs.onToggle(l.id)} aria-label={`Select item ${itemLabel(l)}`} data-guide="boq.select_row" /></label>
              )}
              {card}
            </div>
            <div className={w.cardFoot}>
              <WbsCellView row={l} wbs={wbs} controls={`split-${l.id}`} />
              {wbs.canEdit && !l.removed && <Button variant="quiet" onClick={() => wbs.onSplit(l.id)} style={{ minHeight: 44 }} data-guide="boq.split">{split ? "Edit split" : "Split"}</Button>}
            </div>
            {split && wbs.expanded.has(l.id) && <SplitParts row={l} wbs={wbs} id={`split-${l.id}`} />}
          </div>
        );
      })}
    </div>
  );
}
