"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calculator, Clock, FileText, Pencil, Truck } from "@/components/Icons";
import Button from "@/components/ui/Button";
import { isSheetMode, placePopover } from "@/lib/infoTip";
import { PRICE_KIND_TIP, PRICE_SOURCE_LABEL, type PriceSource } from "@/lib/tender/boq/price";
import { SOURCE_GROUP_NAME, mixPartText, sourceChip, sourceMix, whyOf, type SourceChipView, type SourceGroup } from "@/lib/tender/boq/origin";
import { rfqRefOf, sourceView, type EstimateLinkLike } from "@/lib/tender/boq/table";
import s from "./SourceChip.module.css";

// Where a BOQ price came from, without making the row tall: one chip on the row (icon, short reference, a tone for cost or rate only),
// the detail in a card behind a click (the InfoTip's popover on a desktop, its bottom sheet on a phone), and one bar above the table
// that splits the BOQ amount by source and filters the rows.

/** A link in the row carries the estimate's id, so the card can open the estimate. */
export type SourceLink = EstimateLinkLike & { estimate_id?: string };

export type SourceRow = {
  id: string; price_source: PriceSource | null; price_source_ref: string | null; price_as_of: string | null; unit_cost: number | null;
  rate: number; priced: boolean; markup_pct: number | null; stale: boolean; stale_text: string | null; stale_accepted: boolean;
};

/** A price the sources offer for the line (GET boq/candidates), as the row panel reads it. */
export type SourceCandidate = { source: string; ref: string; label: string; price: number; kind: "cost" | "sell"; as_of: string | null };

const ICON = { supplier: Truck, estimate: Calculator, past: Clock, client: FileText, typed: Pencil } as const;
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateText = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "no date");

/** Where the reference of a price leads: the RFQ a supplier price was awarded under, the estimate that priced the row. Null = no record id is stored. */
export function sourceHref(row: Pick<SourceRow, "id" | "price_source" | "price_source_ref">, links: readonly SourceLink[]): string | null {
  const rfq = rfqRefOf(row);
  if (rfq) return `/rfqs?q=${encodeURIComponent(rfq)}`;
  if (row.price_source === "estimate") {
    const k = links.find((x) => x.boq_id === row.id && !x.broken && x.estimate_id);
    if (k?.estimate_id) return `/estimates/${k.estimate_id}`;
  }
  return null;
}

function ChipFace({ v }: { v: SourceChipView }) {
  const Icon = ICON[v.icon];
  return (
    <>
      <span aria-hidden="true" className={s.icon}><Icon size={13} /></span>
      <span className={s.text}>{v.text}</span>
    </>
  );
}

/** The card behind the chip. `cands` are the line's candidate prices once they are read (null = not read). */
export function SourceCard({ row, links = [], cands = null, onChoose }: { row: SourceRow; links?: readonly SourceLink[]; cands?: readonly SourceCandidate[] | null; onChoose?: () => void }) {
  const chip = sourceChip(row);
  if (!chip || !row.price_source) return null;
  const v = sourceView(row);
  const href = sourceHref(row, links);
  const used = cands?.find((x) => x.source === row.price_source && x.ref === row.price_source_ref);
  const why = used ? whyOf(used.label) : null;
  const others = row.price_source === "past_project" ? (cands ?? []).filter((x) => x.source === "past_project" && x.ref !== row.price_source_ref) : [];
  return (
    <div className={s.card} data-guide="boq.source.card">
      <div className={s.cardHead}>
        <b>{PRICE_SOURCE_LABEL[row.price_source] === "Past project" ? "Past bid" : PRICE_SOURCE_LABEL[row.price_source]}</b>
        <span className={s.tag} data-kind={chip.kind}>{chip.kind === "cost" ? "Cost" : "Rate only"}</span>
      </div>
      <dl className={s.facts}>
        {v.detail && (<><dt>Reference</dt><dd>{href ? <a href={href} data-guide="boq.source_link">{v.detail}</a> : v.detail}</dd></>)}
        {v.was && (<><dt>Replaced</dt><dd>{v.was}</dd></>)}
        {why && (<><dt>Matched on</dt><dd>{why}</dd></>)}
        <dt>Price dated</dt><dd>{dateText(row.price_as_of)}{row.stale && row.stale_text ? ` · ${row.stale_text}${row.stale_accepted ? ", accepted" : ""}` : ""}</dd>
        {row.unit_cost != null && row.unit_cost > 0 && (<><dt>Cost / unit</dt><dd>{money(row.unit_cost)}{row.markup_pct != null ? ` + ${row.markup_pct}%` : ""}</dd></>)}
        {row.priced && (<><dt>Rate / unit</dt><dd>{money(row.rate)}</dd></>)}
      </dl>
      <div className={s.note} data-kind={chip.kind}>{PRICE_KIND_TIP[chip.kind]}</div>
      {others.length > 0 && (
        <div data-guide="boq.source.others">
          <div className={s.sub}>Other past bids ({others.length})</div>
          <ul className={s.others}>
            {others.map((o) => <li key={o.ref}><span>{o.ref}</span><span>{dateText(o.as_of)}</span><span>{money(o.price)}</span></li>)}
          </ul>
        </div>
      )}
      {onChoose && <Button variant="secondary" onClick={onChoose} style={{ minHeight: 44 }} data-guide="boq.source.change">Use a different price</Button>}
    </div>
  );
}

/**
 * The chip on a row. `base` (the BOQ API of the deal) lets the card read the line's candidate prices once, when it is opened, for
 * "matched on" and the other past bids. `interactive={false}` draws the chip as plain text (inside a card that is itself a button).
 */
export function SourceChip({ row, links = [], base, onChoose, interactive = true, initialOpen }: {
  row: SourceRow; links?: readonly SourceLink[]; base?: string; onChoose?: () => void; interactive?: boolean;
  /** Lets a server render (and its test) show the card. The screen never passes it. */
  initialOpen?: boolean;
}) {
  const chip = sourceChip(row);
  const id = `src-${useId()}`;
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [cands, setCands] = useState<SourceCandidate[] | null>(null);

  const close = useCallback((refocus = false) => { setOpen(false); setAt(null); if (refocus) btn.current?.focus(); }, []);
  const place = useCallback(() => {
    if (!btn.current || !pop.current) return;
    const p = pop.current.getBoundingClientRect();
    const r = placePopover(btn.current.getBoundingClientRect(), { width: p.width, height: p.height }, { width: window.innerWidth, height: window.innerHeight }, "below");
    setAt({ top: r.top, left: r.left });
  }, []);
  useLayoutEffect(() => {
    if (!open || sheet) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, sheet, place, cands]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(true); } };
    const onDown = (e: PointerEvent) => { const n = e.target as Node; if (!btn.current?.contains(n) && !pop.current?.contains(n)) close(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open, close]);
  // Read once, on the first opening, and only for a source that has candidates: nothing is fetched per row while the table draws.
  const wanted = open && !!base && cands === null && (row.price_source === "past_project" || row.price_source === "supplier" || row.price_source === "bom");
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    fetch(`${base}/candidates?line=${row.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) setCands(Array.isArray(j?.candidates) ? (j.candidates as SourceCandidate[]) : []); })
      .catch(() => { if (live) setCands([]); });
    return () => { live = false; };
  }, [wanted, base, row.id]);

  if (!chip) return <span className={s.none}>Not priced</span>;
  if (!interactive) return <span className={s.chip} data-kind={chip.kind} data-price-kind={chip.kind} title={chip.full}><ChipFace v={chip} /></span>;

  const card = <SourceCard row={row} links={links} cands={cands} onChoose={onChoose ? () => { close(); onChoose(); } : undefined} />;
  if (initialOpen) return <>{card}</>;
  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (open) { close(); return; }
    setSheet(isSheetMode(window.innerWidth, window.matchMedia("(pointer: coarse)").matches));
    setOpen(true);
  }
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button
        ref={btn} type="button" className={`${s.chip} ${s.chipBtn}`} data-kind={chip.kind} data-price-kind={chip.kind} data-guide="boq.source.chip"
        title={chip.full} aria-label={`${chip.full}. Show where this price came from`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}
      >
        <ChipFace v={chip} />
      </button>
      {open && !sheet && createPortal(
        <div ref={pop} id={id} role="dialog" aria-label="Where this price came from" className={`bpm-tip-pop ${s.pop}`} style={at ? { top: at.top, left: at.left } : { top: 0, left: 0, visibility: "hidden" }}>{card}</div>,
        document.body,
      )}
      {open && sheet && createPortal(
        <>
          <div className="bpm-sheet-backdrop" onClick={() => close()} />
          <div ref={pop} id={id} role="dialog" aria-modal="true" aria-label="Where this price came from" className="bpm-sheet">
            {card}
            <div className="bpm-sheet-acts"><button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" onClick={() => close(true)}>Close</button></div>
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}

type MixRow = Parameters<typeof sourceMix>[0][number];

/** The BOQ amount by price source: one thin bar and its legend. A segment or a legend item filters the table; again clears it. */
export function SourceBar({ lines, active, onPick }: { lines: readonly MixRow[]; active: SourceGroup | null; onPick: (g: SourceGroup | null) => void }) {
  const parts = sourceMix(lines);
  if (parts.length === 0) return null;
  const pick = (g: SourceGroup) => onPick(active === g ? null : g);
  return (
    <div className={s.mix} role="group" aria-label="BOQ amount by price source" data-guide="boq.source.bar">
      <div className={s.bar}>
        {parts.filter((p) => p.amount > 0).map((p) => (
          <button
            key={p.group} type="button" className={s.seg} data-group={p.group} data-dim={active != null && active !== p.group} style={{ flexGrow: p.amount }}
            aria-pressed={active === p.group} aria-label={`${SOURCE_GROUP_NAME[p.group]}: ${p.pct}% of the BOQ amount, ${p.rows} row${p.rows === 1 ? "" : "s"}. Filter the table`}
            title={`${SOURCE_GROUP_NAME[p.group]} ${p.pct}%`} onClick={() => pick(p.group)}
          />
        ))}
      </div>
      <div className={s.legend}>
        {parts.map((p) => (
          <button
            key={p.group} type="button" className={s.legendBtn} data-group={p.group} aria-pressed={active === p.group} data-guide={`boq.source.bar.${p.group}`}
            aria-label={`${SOURCE_GROUP_NAME[p.group]}: ${p.group === "unpriced" ? `${p.rows} row${p.rows === 1 ? "" : "s"}` : `${p.pct}%`}. Filter the table`} onClick={() => pick(p.group)}
          >
            <span aria-hidden="true" className={s.dot} data-group={p.group} />{mixPartText(p)}
          </button>
        ))}
      </div>
    </div>
  );
}
