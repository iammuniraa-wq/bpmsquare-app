"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import Card from "@/components/ui/Card";
import StatTile, { StatStrip } from "@/components/ui/StatTile";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { useCurrency } from "@/lib/tenant-context";
import { formatMoney } from "@/lib/currency";
import { TENDER_TIPS } from "@/lib/tender/tips";
import { BOQ_TABLE_TIPS } from "@/lib/tender/boq/tips";
import { DEFAULT_MARKUP_PCT } from "@/lib/tender/boq/price";
import { BOQ_FILTERS, filterCounts, filterRows, pageOf, parseFilter, parseMarkup, pricedPercent, type BoqFilter } from "@/lib/tender/boq/table";
import { useFeel } from "@/components/FeelProvider";
import { WBS_PENDING, WBS_TIPS } from "@/lib/wbs/tips";
import { unassignedOf } from "@/lib/wbs/tree";
import type { WbsState } from "@/lib/tender/wbs/types";
import BoqMatch from "./BoqMatch";
import { useBoqUpload } from "./BoqUpload";
import { BoqCards, BoqTable, type BoqRow, type WbsColumn } from "./BoqRows";
import BoqRowPanel from "./BoqRowPanel";
import GroupIntoWbs from "./wbs/GroupIntoWbs";
import SplitPanel from "./wbs/SplitPanel";
import WbsTree from "./wbs/WbsTree";
import { call } from "./wbs/api";
import w from "./wbs/Wbs.module.css";
import { reloadAfterSave } from "./refreshAfterSave";
import type { EstimatesState } from "@/lib/tender/estimates/server";
import type { OpportunityLine } from "@/lib/types";
import DealLinesBoq from "./DealLinesBoq";
import { useCards } from "./useCards";

// The Bill of quantities of a tender deal (GCC tender deals, redesign 2026-10-27): ONE table, one row per line of the client's BOQ, that
// replaces the old BOQ tab and the Lines tab. The client's item number is always shown. A row opens a side panel; awarding a supplier is
// never done here (Costing's compare screen does it). The two downloads are not on this toolbar: the Bid tab mounts them (BoqDownloads).
// Writes go to /api/opportunities/[id]/boq/*; the workspace and the deal are the server's, not this component's.

type Line = BoqRow & { file_rate?: number | null };
type State = {
  pending: boolean;
  source: { file_name: string; sheet_name: string; version: number; uploaded_at: string; line_count: number; added_columns: boolean } | null;
  lines: Line[]; validity_days: number; today: string;
  /** The markup "Price all" starts from (the workspace's own, else 15). Absent in an older answer: 15. */
  default_markup_pct?: number;
  totals: { lines: number; priced: number; unpriced: number; stale: number; amount: number; no_product?: number };
  unpriced: { item: string; reason: string }[];
  /** The tender's WBS (migration 0243). Absent in an older answer: the screen has no WBS view. */
  wbs?: WbsState;
};

export type BoqScreenState = State;
type EstimatesWithRfq = EstimatesState & { rfq_enabled?: boolean };

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");
const FILTER_LABEL: Record<BoqFilter, string> = { all: "All", unpriced: "Unpriced", stale: "Stale" };
const markupKey = (opportunityId: string) => `boq-markup:${opportunityId}`;
const VIEWS = ["boq", "wbs"] as const;
const VIEW_LABEL = { boq: "BOQ", wbs: "WBS" } as const;

/** The first three reasons a line was left unpriced, then "+k", for the notice after Price all. */
export function leftText(left: { item: string; reason: string }[] | undefined): string {
  const list = left ?? [];
  const head = list.slice(0, 3).map((x) => `${x.item} ${x.reason}`).join("; ");
  return list.length > 3 ? `${head}; +${list.length - 3}` : head;
}

export default function BoqTab({ opportunityId, canEdit, onError, onNotice, onLinesChanged, onOpenCosting, initialData, initialEstimates, layout, initialOpenRow, dealLines, dealLinesVersion, filterRequest }: {
  opportunityId: string; canEdit: boolean; onError: (m: string) => void; onNotice: (m: string) => void;
  /** The deal's own lines and their version. Shown (and editable) as rows only while no client file has been uploaded. */
  dealLines?: OpportunityLine[]; dealLinesVersion?: string;
  /** "N rows still need a cost" in Costing asks for a filter; each new `n` applies it, whatever the filter was before. */
  filterRequest?: { filter: BoqFilter; n: number };
  /** Called after anything that changed the deal's lines (create, re-upload, a price, a quantity), so the page can reload its header and totals. */
  onLinesChanged?: () => void;
  /** Opens the Costing tab for a row (the panel's "Open in Costing"). Absent = the button is not drawn. */
  onOpenCosting?: (rowId: string) => void;
  /** Lets a server render (and its test) show the loaded screen without a fetch. The page never passes these. */
  initialData?: State;
  initialEstimates?: EstimatesWithRfq;
  layout?: "table" | "cards";
  initialOpenRow?: string;
}) {
  const base = `/api/opportunities/${opportunityId}/boq`;
  // The estimate tools have their own folder (they are gated by the estimator as well as the tender BOQ).
  const estimatesBase = `/api/opportunities/${opportunityId}/tender/estimates`;
  const cur = useCurrency();
  const [data, setData] = useState<State | null>(initialData ?? null);
  const [busy, setBusy] = useState(false);
  const [filterRaw, setFilter] = useUrlTab(BOQ_FILTERS, "boqfilter", "all");
  const filter = parseFilter(filterRaw);
  const [shown, setShown] = useState(0);
  const [openId, setOpenId] = useState<string | null>(initialOpenRow ?? null);
  const [markup, setMarkup] = useState(String(initialData?.default_markup_pct ?? DEFAULT_MARKUP_PCT));
  const [markupSet, setMarkupSet] = useState(false);
  const cards = useCards(layout);
  const { confirm } = useFeel();
  const [viewRaw, setView] = useUrlTab(VIEWS, "boqview", "boq");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [splitFor, setSplitFor] = useState<string | null>(null);
  const [respread, setRespread] = useState<Set<string>>(new Set());
  const wbsBase = `/api/opportunities/${opportunityId}/tender/wbs`;
  const askedFilter = useRef(0);
  useEffect(() => {
    if (!filterRequest || filterRequest.n <= askedFilter.current) return;
    askedFilter.current = filterRequest.n;
    setFilter(filterRequest.filter); setShown(0);
  }, [filterRequest, setFilter]);

  // Estimates that price the lines. A 404 (no estimator, no view of it, migration pending) means the rows simply show no estimate chip.
  const [est, setEst] = useState<EstimatesWithRfq | null>(initialEstimates ?? null);

  const load = useCallback(async () => {
    const res = await fetch(base);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { onError(j.error ?? "Could not load the Bill of quantities"); return; }
    setData(j as State);
  }, [base, onError]);
  useEffect(() => { if (!initialData) void load(); }, [load, initialData]);

  const loadEstimates = useCallback(async () => {
    try {
      const res = await fetch(`${estimatesBase}/links`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      setEst(res.ok && !j.pending ? (j as EstimatesWithRfq) : null);
    } catch { setEst(null); }
  }, [estimatesBase]);
  useEffect(() => { if (!initialEstimates) void loadEstimates(); }, [loadEstimates, initialEstimates]);

  // The markup is the deal's: the workspace default until a person changes it, then what they typed (kept in this browser for the deal).
  useEffect(() => {
    if (markupSet) return;
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(markupKey(opportunityId)); } catch { /* a private window keeps nothing; the default stands */ }
    if (saved != null && saved !== "") setMarkup(String(parseMarkup(saved, DEFAULT_MARKUP_PCT)));
    else if (data?.default_markup_pct != null) setMarkup(String(data.default_markup_pct));
  }, [opportunityId, data?.default_markup_pct, markupSet]);
  function changeMarkup(v: string) {
    setMarkup(v); setMarkupSet(true);
    try { window.localStorage.setItem(markupKey(opportunityId), v); } catch { /* a convenience only */ }
  }
  const markupPct = parseMarkup(markup, DEFAULT_MARKUP_PCT);

  const changed = useCallback(() => {
    void reloadAfterSave<State>(base, setData, onLinesChanged);
    void loadEstimates();
  }, [base, loadEstimates, onLinesChanged]);

  const upload = useBoqUpload({ base, hasBoq: !!data?.source, onError, onNotice, onApplied: (r) => { setShown(0); setRespread(new Set(r.respread_ids)); changed(); } });

  const toggleSelect = useCallback((id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const toggleExpand = useCallback((id: string) => setExpanded((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  // What WBS changed: the table and the WBS view both reload, and the ticks are cleared.
  const wbsDone = useCallback((notice: string) => { onNotice(notice); setSelected(new Set()); setSplitFor(null); changed(); }, [onNotice, changed]);

  async function unsplit(rowId: string) {
    const line = data?.lines.find((l) => l.id === rowId);
    const first = line?.wbs_parts?.[0] ? data?.wbs?.items.find((i) => i.id === line.wbs_parts![0].wbs_item_id) : undefined;
    if (!(await confirm({ title: `Unsplit ${line?.item_no ?? "this line"}?`, body: first ? `The whole line goes to ${first.code} ${first.name}. You can change it after.` : "The whole line goes to its first WBS item. You can change it after.", confirmLabel: "Unsplit" }))) return;
    onError("");
    const out = await call(`${wbsBase}/split`, "DELETE", { boq_id: rowId });
    if (!out.ok) { onError(out.error); return; }
    setRespread((cur) => { const n = new Set(cur); n.delete(rowId); return n; });
    wbsDone("Line is no longer split");
  }

  const lineIds = useMemo(() => new Set((data?.lines ?? []).map((l) => l.id)), [data?.lines]);
  const ticked = useMemo(() => [...selected].filter((id) => lineIds.has(id)), [selected, lineIds]);

  async function priceAll() {
    setBusy(true); onError("");
    const res = await fetch(`${base}/price`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true, markup_pct: markupPct }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { onError(j.error ?? "Could not price the lines"); return; }
    onNotice(`${j.priced} line${j.priced === 1 ? "" : "s"} priced${j.left_count ? `, ${j.left_count} left: ${leftText(j.left)}` : ""}`);
    changed();
  }

  if (!data) return <div style={{ fontSize: 13, color: c.hint }}>Loading the Bill of quantities…</div>;
  if (data.pending) {
    return <div role="alert" data-guide="boq.pending_migration" style={{ fontSize: 13, color: "var(--amberink)" }}>The Bill of quantities needs a database update (migration 0223). Ask your administrator to apply it.</div>;
  }

  const hasBoq = !!data.source;
  const counts = filterCounts(data.lines);
  const rows = filterRows(data.lines, filter);
  const page = pageOf(rows, shown);
  const flagged = data.lines.filter((l) => l.removed);
  const links = est?.links ?? [];
  const openRow = openId ? data.lines.find((l) => l.id === openId && !l.removed) ?? null : null;
  const total = data.totals;
  const pct = pricedPercent(total.priced, total.lines);

  // The WBS (0243): a view switch, a tick box and a WBS column on the table, the tree. Off while the database has no WBS tables yet, and for an older answer.
  const wbsOn = hasBoq && !!data.wbs && !data.wbs.pending;
  const wbsPending = hasBoq && !!data.wbs?.pending;
  const view = wbsOn ? viewRaw : "boq";
  const wbsItems = data.wbs?.items ?? [];
  const unassignedCount = wbsOn ? unassignedOf(data.lines.map((l) => ({ ...l, wbs_item_id: l.wbs_item_id ?? null, parts: l.wbs_parts ?? [] }))).length : 0;
  const splitLine = splitFor ? data.lines.find((l) => l.id === splitFor && !l.removed) ?? null : null;
  const selectedSet = new Set(ticked);
  const wbsCol: WbsColumn | undefined = wbsOn ? {
    items: wbsItems, selected: selectedSet, onToggle: toggleSelect, canEdit, expanded, onExpand: toggleExpand, onSplit: setSplitFor, onUnsplit: (id) => void unsplit(id), respread,
    onToggleAll: (ids, on) => setSelected((cur) => { const n = new Set(cur); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; }),
  } : undefined;

  return (
    <div data-guide="boq.tab" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div data-guide="boq.toolbar" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {canEdit && upload.button}
        {canEdit && hasBoq && (
          <>
            <label data-guide="boq.markup" style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, fontSize: 13, color: c.ink }}>
              Markup on cost
              <Input type="number" min={0} step="0.5" inputMode="decimal" value={markup} onChange={(e) => changeMarkup(e.target.value)} style={{ width: 72, minHeight: 44 }} />
              %
              <InfoTip label="Markup">{BOQ_TABLE_TIPS.markup}</InfoTip>
            </label>
            <Button variant="primary" loading={busy} disabled={total.unpriced === 0} onClick={() => void priceAll()} style={{ minHeight: 44 }} data-guide="boq.price_all">Price all lines</Button>
            <InfoTip label="Price all">{TENDER_TIPS.boqPriceAll}</InfoTip>
          </>
        )}
        {canEdit && hasBoq && (
          <span data-guide="boq.price_all_note" style={{ marginLeft: "auto", fontSize: 12, color: c.muted }}>Price all uses supplier, then BOM, then past project. Fresh prices only.</span>
        )}
      </div>
      {upload.panel}

      {!hasBoq && !upload.open && (dealLines?.length ?? 0) === 0 && (
        <Card>
          <div data-guide="boq.empty" style={{ fontSize: 13, color: c.ink }}>
            {canEdit ? "No Bill of quantities yet. Upload the client's Excel to create the deal's lines, or add them by hand below." : "No Bill of quantities has been uploaded for this tender yet."}
          </div>
        </Card>
      )}

      {!hasBoq && !upload.open && dealLines && (
        <DealLinesBoq
          opportunityId={opportunityId} lines={dealLines} version={dealLinesVersion ?? ""} canEdit={canEdit} cards={cards}
          onError={onError} onNotice={onNotice} onChanged={() => onLinesChanged?.()}
        />
      )}

      {hasBoq && (
        <>
          <StatStrip guide="boq.summary">
            <StatTile tone="context" label="Lines" value={String(total.lines)} sub={view === "wbs" ? `${wbsItems.length} WBS item${wbsItems.length === 1 ? "" : "s"} · ${unassignedCount} unassigned` : data.source ? `${data.source.file_name} · v${data.source.version}` : undefined} />
            <StatTile tone={total.unpriced > 0 ? "warn" : "good"} label="Priced" value={`${pct}%`} info={BOQ_TABLE_TIPS.priced} sub={total.unpriced > 0 ? `${total.priced} of ${total.lines} · ${total.unpriced} to price` : "all lines priced"} />
            <StatTile tone="info" label="Total" info={BOQ_TABLE_TIPS.total} value={formatMoney(total.amount, cur, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sub="at cost + markup" />
          </StatStrip>

          <BoqMatch base={base} count={total.no_product ?? 0} canEdit={canEdit} onError={onError} onNotice={onNotice} onChanged={changed} />

          {wbsPending && <div role="note" data-guide="boq.wbs_pending" className={w.pending}>{WBS_PENDING}</div>}
          <div data-guide="boq.filters" role="group" aria-label="Filter the rows" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {wbsOn && (
              <>
                <span role="group" aria-label="View" className={w.switch} data-guide="boq.view">
                  {VIEWS.map((v) => (
                    <Button key={v} variant={view === v ? "primary" : "secondary"} aria-pressed={view === v} onClick={() => setView(v)} style={{ minHeight: 44 }} data-guide={`boq.view.${v}`}>{VIEW_LABEL[v]}</Button>
                  ))}
                </span>
                <InfoTip label="View">{WBS_TIPS.view}</InfoTip>
              </>
            )}
            {view === "boq" && BOQ_FILTERS.map((f) => (
              <Button key={f} variant={filter === f ? "primary" : "secondary"} aria-pressed={filter === f} onClick={() => { setFilter(f); setShown(0); }} style={{ minHeight: 44 }} data-guide={`boq.filter.${f}`}>
                {FILTER_LABEL[f]} {counts[f]}
              </Button>
            ))}
            {view === "boq" && <InfoTip label="Filters">{BOQ_TABLE_TIPS.filters}</InfoTip>}
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <InfoTip label="Bill of quantities">{BOQ_TABLE_TIPS.table}</InfoTip>
              <InfoTip label="Chips">{BOQ_TABLE_TIPS.chips}</InfoTip>
            </span>
          </div>

          {wbsOn && canEdit && ticked.length > 0 && (
            <GroupIntoWbs
              base={wbsBase} ids={ticked} items={wbsItems} onClear={() => setSelected(new Set())} onError={onError}
              onDone={wbsDone} onSplit={ticked.length === 1 ? () => setSplitFor(ticked[0]) : undefined}
            />
          )}

          {view === "wbs" && wbsOn ? (
            <WbsTree
              base={wbsBase} opportunityId={opportunityId} items={wbsItems} rollup={data.wbs!.rollup}
              lines={data.lines.map((l) => ({ id: l.id, item_no: l.item_no, row_no: l.row_no, description: l.description, uom: l.uom, qty: l.qty, amount: l.amount, priced: l.priced, removed: l.removed, wbs_item_id: l.wbs_item_id ?? null, wbs_parts: l.wbs_parts ?? [] }))}
              canEdit={canEdit} selected={selectedSet} onToggle={toggleSelect} onChanged={changed} onError={onError} onNotice={onNotice}
              onSplit={setSplitFor} onOpenLine={setOpenId}
            />
          ) : rows.length === 0 ? (
            <Card><div data-guide="boq.no_rows" style={{ fontSize: 13, color: c.ink }}>{filter === "all" ? "There are no rows." : `No ${FILTER_LABEL[filter].toLowerCase()} rows.`}</div></Card>
          ) : cards ? (
            <BoqCards rows={page.rows} links={links} openId={openId} onOpen={setOpenId} wbs={wbsCol} />
          ) : (
            <BoqTable rows={page.rows} links={links} openId={openId} onOpen={setOpenId} wbs={wbsCol} />
          )}
          {view === "boq" && page.hidden > 0 && (
            <div>
              <Button variant="quiet" onClick={() => setShown(page.rows.length + page.more)} style={{ minHeight: 44 }} data-guide="boq.show_more">Show {page.more} more ({page.hidden} not shown)</Button>
            </div>
          )}
          {flagged.length > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--amberink)" }} data-guide="boq.kept">
              {flagged.length} priced line{flagged.length === 1 ? " is" : "s are"} no longer in the latest file and kept: {flagged.slice(0, 5).map((f) => f.item_no ?? f.description.slice(0, 30)).join(", ")}
            </div>
          )}
          {data.source && <div style={{ fontSize: 11.5, color: c.hint }}>{data.source.file_name} · {data.source.sheet_name} · version {data.source.version} · {fmtDate(data.source.uploaded_at)}</div>}
        </>
      )}

      {openRow && (
        <BoqRowPanel
          key={openRow.id} base={base} row={openRow} links={links} opportunityId={opportunityId} estimates={est} canEdit={canEdit} markup={markupPct} validityDays={data.validity_days}
          onClose={() => setOpenId(null)} onChanged={changed} onError={onError} onNotice={onNotice} onOpenCosting={onOpenCosting}
          wbs={data.wbs ? { base: wbsBase, pending: data.wbs.pending, items: wbsItems } : undefined}
          onSplit={(id) => { setOpenId(null); setSplitFor(id); }}
        />
      )}

      {splitLine && wbsOn && (
        <SplitPanel
          key={splitLine.id} base={wbsBase} line={{ ...splitLine, priced: splitLine.priced }} items={wbsItems}
          onClose={() => setSplitFor(null)} onError={onError}
          onDone={(notice) => { setRespread((cur) => { const n = new Set(cur); n.delete(splitLine.id); return n; }); wbsDone(notice); }}
        />
      )}
    </div>
  );
}
