"use client";

import Pill from "@/components/Pill";
import type { PillarKey } from "@/lib/theme";
import { itemLabel, rowChips, sourceView, type Chip, type EstimateLinkLike } from "@/lib/tender/boq/table";
import type { PriceSource } from "@/lib/tender/boq/price";
import s from "./BoqRows.module.css";

// The rows of the Bill of quantities (GCC tender deals): a table on a desktop, a stack of cards on a phone. One row per client BOQ line.
// The client's item number is always the first thing in a row, as written. A row opens the side panel; nothing is edited inline.

export type BoqRow = {
  id: string; line_id: string | null; row_no: number; item_no: string | null; cost_code: string | null; description: string; uom: string | null; qty: number;
  rate: number; amount: number; priced: boolean; linked: boolean; removed: boolean;
  price_source: PriceSource | null; price_source_ref: string | null; price_as_of: string | null;
  stale: boolean; stale_text: string | null; stale_accepted: boolean; unit_cost: number | null; markup_pct: number | null;
};

export const money = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qtyText = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

const CHIP_TONE: Record<Chip["kind"], PillarKey> = { estimate: "purple", rfq: "blue", unpriced: "red", stale: "amber", changed: "amber" };

export function RowChips({ row, links }: { row: BoqRow; links: readonly EstimateLinkLike[] }) {
  const chips = rowChips(row, links);
  if (chips.length === 0) return null;
  return (
    <span className={s.chips} data-guide="boq.chips">
      {chips.map((k) => (
        <span key={k.kind + k.label} data-chip={k.kind}><Pill label={k.kind === "estimate" && !/^EST/i.test(k.label) ? `Estimate ${k.label}` : k.label} tone={CHIP_TONE[k.kind]} /></span>
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

/** Desktop: one table. The first cell is a button, so the keyboard and a screen reader reach every row; a click anywhere on the row opens it too. */
export function BoqTable({ rows, links, openId, onOpen }: { rows: readonly BoqRow[]; links: readonly EstimateLinkLike[]; openId: string | null; onOpen: (id: string) => void }) {
  return (
    <div className={s.wrap} data-guide="boq.table">
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col">Item</th><th scope="col">Description</th><th scope="col" className={s.num}>Qty</th><th scope="col">Unit</th><th scope="col">Source</th>
            <th scope="col" className={s.num}>Cost</th><th scope="col" className={s.num}>Mk</th><th scope="col" className={s.num}>Rate</th><th scope="col" className={s.num}>Amount</th><th scope="col">Linked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} data-guide="boq.line" aria-selected={openId === l.id} onClick={() => onOpen(l.id)} style={{ cursor: "pointer" }}>
              <td className={s.item}>
                <button type="button" className={s.open} data-guide="boq.open_row" aria-label={`Open item ${itemLabel(l)}`} onClick={(e) => { e.stopPropagation(); onOpen(l.id); }} style={{ minHeight: 44 }}>{itemLabel(l)}</button>
              </td>
              <td className={s.desc}>{l.description}{l.cost_code ? <div className={s.muted}>{l.cost_code}</div> : null}</td>
              <td className={s.num}>{qtyText(l.qty)}</td>
              <td>{l.uom ?? ""}</td>
              <td><SourceCell row={l} /></td>
              <td className={s.num}>{l.unit_cost != null ? money(l.unit_cost) : "–"}</td>
              <td className={s.num}>{l.unit_cost != null && l.markup_pct != null ? `${l.markup_pct}%` : "–"}</td>
              <td className={s.num}><b>{l.priced ? money(l.rate) : "–"}</b></td>
              <td className={s.num}>{l.priced ? money(l.amount) : "–"}</td>
              <td><RowChips row={l} links={links} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Phone: a card per row, the whole card is the button. No table to scroll sideways. */
export function BoqCards({ rows, links, openId, onOpen }: { rows: readonly BoqRow[]; links: readonly EstimateLinkLike[]; openId: string | null; onOpen: (id: string) => void }) {
  return (
    <div className={s.cards} data-guide="boq.cards">
      {rows.map((l) => {
        const v = sourceView(l);
        return (
          <button key={l.id} type="button" className={s.card} data-guide="boq.line" aria-selected={openId === l.id} aria-label={`Open item ${itemLabel(l)}`} onClick={() => onOpen(l.id)} style={{ minHeight: 44 }}>
            <span className={s.cardTop}>
              <b className={s.item}>{itemLabel(l)}</b>
              <span className={s.desc}>{l.description}</span>
            </span>
            <span className={s.cardMid}>
              <span>{qtyText(l.qty)} {l.uom ?? ""}</span>
              <span>{v.label}{v.detail ? ` · ${v.detail}` : ""}{v.was ? ` (was ${v.was})` : ""}</span>
            </span>
            <RowChips row={l} links={links} />
            <span className={s.cardEnd}>
              <span>Rate {l.priced ? money(l.rate) : "–"}</span>
              <b>{l.priced ? money(l.amount) : "–"}</b>
            </span>
          </button>
        );
      })}
    </div>
  );
}
