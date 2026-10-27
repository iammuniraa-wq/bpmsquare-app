"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import { Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SidePanel from "@/components/ui/SidePanel";
import StatTile, { StatStrip } from "@/components/ui/StatTile";
import { useFeel } from "@/components/FeelProvider";
import CreateRfqButton from "@/components/rfq/CreateRfqButton";
import { type CostingData } from "@/lib/tender/costing/rules";
import { COSTING_TIPS } from "@/lib/tender/costing/tips";
import { ESTIMATE_TIPS } from "@/lib/tender/estimates/tips";
import CostingRow from "./costing/CostingRow";
import CompareAward from "./costing/CompareAward";
import PriceRowsPanel from "./costing/PriceRowsPanel";
import { postReprice } from "./quantityGuard";

// The Costing tab of a tender deal (docs/design/gcc-tender-deals.md section 25): everything that gives a BOQ row its cost, in one list.
// Estimates and RFQs together, each with the BOQ rows it prices, its state, its total and its age; one "New RFQ" form; the compare-and-
// award screen where a supplier price becomes a row's cost plus markup. It replaces the Estimates tab and the RFQ card on the Related
// tab for a tender. Costs are internal: the tab is for people who may see Estimates or RFQs.

const PAGE = 8;
const PENDING_EST = "Estimates inside a tender need a database update (migration 0227). Ask your administrator to apply it.";
const PENDING_RFQ = "RFQs need a database update (migration 0128). Ask your administrator to apply it.";

export default function CostingTab({ opportunityId, canEdit, onError, onNotice, onOpenBoq, onChanged, initialData, initialCompareId }: {
  opportunityId: string;
  canEdit: boolean;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
  /** Opens the Bill of quantities tab, optionally filtered to the rows without a rate or with an old price. */
  onOpenBoq?: (filter?: "unpriced" | "stale") => void;
  /** After a change the rest of the page shows too (a row's rate). */
  onChanged?: () => void;
  /** Lets a server render (and its test) show the loaded tab. The page never passes it. */
  initialData?: CostingData;
  initialCompareId?: string;
}) {
  const { confirm } = useFeel();
  const url = `/api/opportunities/${opportunityId}/tender/costing`;
  const [data, setData] = useState<CostingData | null>(initialData ?? null);
  const [loadError, setLoadError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(initialCompareId ?? null);
  const [priceRowsFor, setPriceRowsFor] = useState<string | null>(null);
  const [newEstimate, setNewEstimate] = useState(false);
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const compareRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadError(j.error ?? "Could not load Costing"); return; }
      setLoadError("");
      setData(j as CostingData);
    } catch { setLoadError("Could not load Costing"); }
  }, [url]);
  useEffect(() => { if (!initialData) void load(); }, [initialData, load]);
  useEffect(() => { if (compareId) compareRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }, [compareId]);

  const afterChange = useCallback(() => { void load(); onChanged?.(); }, [load, onChanged]);

  if (!data) {
    return loadError
      ? <div role="alert" style={{ fontSize: 13, color: "var(--redink)" }}>{loadError}</div>
      : <div role="status" style={{ fontSize: 13, color: c.hint }}>Loading Costing…</div>;
  }

  const shown = showAll ? data.items : data.items.slice(0, PAGE);
  const estimates = data.items.filter((x) => x.kind === "estimate");
  const priceRowsEstimate = priceRowsFor ? estimates.find((x) => x.id === priceRowsFor) : null;
  const t = data.tiles;
  const chosenTemplate = template || data.templates[0]?.id || "";
  const showNewRfq = data.rfqs_on && !data.pending_rfqs && data.can_edit && canEdit;
  const newRfq = (label = "New RFQ", guide = "costing.rfq.new") => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <CreateRfqButton
        origin={{ type: "opportunity", id: opportunityId }} originLabel={data.rfq_origin_label} lines={data.rfq_lines} title="Supplier prices for the tender"
        label={label} supplierTypeFilter disabled={data.rfq_lines.length === 0} guideId={guide}
        buttonStyle={{ minHeight: 44, color: c.ink }}
        onCreated={() => { onNotice?.("RFQ created"); afterChange(); }}
      />
      {guide === "costing.rfq.new" && <InfoTip label="New RFQ">{COSTING_TIPS.newRfq}</InfoTip>}
    </span>
  );

  async function reprice(estimateId: string) {
    const item = estimates.find((x) => x.id === estimateId);
    if (!item || item.kind !== "estimate" || item.stale_link_ids.length === 0) return;
    if (data?.bid_locked && !(await confirm({ title: "The bid is already in", body: "Re-pricing changes the rate on the deal's rows. The submitted bid version is kept as it was.", confirmLabel: "Re-price" }))) return;
    setBusy(true); onError("");
    try {
      const out = await postReprice(`/api/opportunities/${opportunityId}/tender/estimates/reprice`, { link_ids: item.stale_link_ids }, [], confirm);
      if (!out) return;
      if (!out.ok) { onError(out.json.error ?? "Could not re-price"); return; }
      const failed = out.json.failed ?? [];
      const n = out.json.repriced?.length ?? 0;
      onNotice?.(`${n} row${n === 1 ? "" : "s"} re-priced${failed.length ? `, ${failed.length} could not be` : ""}`);
      if (failed.length) onError(`${failed[0].item}: ${failed[0].reason}`);
      afterChange();
    } catch { onError("Network error. Try again."); } finally { setBusy(false); }
  }

  const empty = data.items.length === 0;
  return (
    <div className="bpm-tap" data-guide="costing.tab" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {data.pending_estimates && <div role="alert" data-guide="costing.pending_estimates" style={{ fontSize: 13, color: "var(--amberink)" }}>{PENDING_EST}</div>}
      {data.pending_rfqs && <div role="alert" data-guide="costing.pending_rfqs" style={{ fontSize: 13, color: "var(--amberink)" }}>{PENDING_RFQ}</div>}
      {loadError && <div role="alert" style={{ fontSize: 13, color: "var(--redink)" }}>{loadError}</div>}

      <StatStrip guide="costing.strip">
        <StatTile tone={t.unpriced === 0 && data.boq.rows > 0 ? "good" : "info"} label="Rows priced" info={COSTING_TIPS.rowsPriced} value={String(t.priced)} sub={`of ${data.boq.rows} BOQ row${data.boq.rows === 1 ? "" : "s"}`} />
        <StatTile tone={t.unpriced > 0 ? "warn" : "neutral"} label="Still need a cost" info={COSTING_TIPS.needCost} value={String(t.unpriced)} sub={t.unpriced > 0 ? "rows without a rate" : "every row has a rate"} />
        <StatTile tone="info" label="RFQs out" info={COSTING_TIPS.rfqsOut} value={String(t.rfqs_out)} sub={t.rfqs_out > 0 ? "with suppliers" : "none waiting"} />
        <StatTile tone={t.replies_in > 0 ? "good" : "neutral"} label="Replies in" info={COSTING_TIPS.repliesIn} value={String(t.replies_in)} sub={t.replies_in > 0 ? "from suppliers" : "no reply yet"} />
      </StatStrip>

      {(t.unpriced > 0 || data.boq.stale > 0) && (
        <div data-guide="costing.unpriced" style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", alignItems: "center", fontSize: 13, color: c.ink }}>
          {t.unpriced > 0 && <b>{t.unpriced} row{t.unpriced === 1 ? "" : "s"} still need a cost</b>}
          {t.unpriced > 0 && onOpenBoq && <Button variant="secondary" size="sm" onClick={() => onOpenBoq("unpriced")} style={{ minHeight: 44 }} data-guide="costing.unpriced.open">Show them in the Bill of quantities</Button>}
          {data.boq.stale > 0 && <span style={{ color: "var(--amberink)" }}>{data.boq.stale} price{data.boq.stale === 1 ? " is" : "s are"} out of date</span>}
          {data.boq.stale > 0 && onOpenBoq && <Button variant="quiet" size="sm" onClick={() => onOpenBoq("stale")} style={{ minHeight: 44 }} data-guide="costing.stale.open">Show them</Button>}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="bpm-label-row"><h2 className="bpm-t-section">Estimates and RFQs</h2><InfoTip label="Costing">{COSTING_TIPS.tab}</InfoTip></span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {data.estimates_on && !data.pending_estimates && data.can_create_estimate && canEdit && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Button variant="secondary" size="sm" onClick={() => setNewEstimate(true)} style={{ minHeight: 44 }} data-guide="costing.estimate.new">New estimate</Button>
              <InfoTip label="New estimate">{COSTING_TIPS.newEstimate}</InfoTip>
            </span>
          )}
          {showNewRfq && newRfq("New RFQ")}
        </span>
      </div>

      {empty ? (
        <Card padding={0}>
          <EmptyState
            title="Nothing costed yet"
            text={t.unpriced > 0 ? "Build an estimate from a template or ask suppliers for prices, then they show here with the rows they price." : "Estimates and RFQs for this tender show here."}
            action={canEdit && data.can_edit ? (
              <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {data.estimates_on && !data.pending_estimates && data.can_create_estimate && <Button variant="secondary" style={{ minHeight: 44 }} onClick={() => setNewEstimate(true)} data-guide="costing.empty.estimate">New estimate</Button>}
                {showNewRfq && newRfq("New RFQ", "costing.empty.rfq")}
              </span>
            ) : undefined}
          />
        </Card>
      ) : (
        <Card padding={12}>
          <div data-guide="costing.list" style={{ display: "flex", flexDirection: "column" }}>
            {shown.map((item) => (
              <CostingRow
                key={`${item.kind}:${item.id}`} item={item} opportunityId={opportunityId} today={data.today}
                canEdit={canEdit && data.can_edit} canAward={canEdit && data.can_award} rfqsOn={data.rfqs_on && !data.pending_rfqs}
                onOpenBoq={onOpenBoq ? () => onOpenBoq() : undefined}
                onCompare={setCompareId} onPriceAwarded={setCompareId} onPriceRows={setPriceRowsFor} onReprice={(id) => void reprice(id)}
                onRfqCreated={() => { onNotice?.("RFQ created"); afterChange(); }}
                busy={busy} comparing={compareId === item.id}
              />
            ))}
          </div>
          {data.items.length > PAGE && (
            <Button variant="quiet" onClick={() => setShowAll(!showAll)} style={{ minHeight: 44 }} data-guide="costing.show_all">{showAll ? "Show fewer" : `Show all ${data.items.length}`}</Button>
          )}
        </Card>
      )}

      {compareId && (
        <div ref={compareRef} data-guide="costing.compare.wrap">
          <CompareAward
            key={compareId} opportunityId={opportunityId} rfqId={compareId} onClose={() => setCompareId(null)}
            onChanged={afterChange} onError={onError} onNotice={(m) => onNotice?.(m)}
          />
        </div>
      )}

      {priceRowsEstimate && (
        <PriceRowsPanel
          opportunityId={opportunityId} estimate={{ id: priceRowsEstimate.id, ref: priceRowsEstimate.kind === "estimate" ? priceRowsEstimate.ref : null, name: priceRowsEstimate.kind === "estimate" ? priceRowsEstimate.name : "" }}
          markupDefault={data.markup_default} bidLocked={data.bid_locked} onClose={() => setPriceRowsFor(null)} onError={onError}
          onDone={(m) => { setPriceRowsFor(null); onNotice?.(m); afterChange(); }}
        />
      )}

      {newEstimate && (
        <SidePanel
          title="New estimate" subtitle="Kept on this tender" onClose={() => setNewEstimate(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setNewEstimate(false)} style={{ minHeight: 44 }}>Cancel</Button>
              <Button variant="primary" style={{ minHeight: 44 }} data-guide="costing.estimate.start"
                href={`/estimates/new?${chosenTemplate ? `template=${encodeURIComponent(chosenTemplate)}&` : ""}opportunity=${encodeURIComponent(opportunityId)}`}>Start estimate</Button>
            </>
          }
        >
          <div className="bpm-tap" data-guide="costing.estimate.panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.templates.length > 0 ? (
              <Field label="Template" info={ESTIMATE_TIPS.newEstimate} guide="costing.estimate.template">
                <Select value={chosenTemplate} onChange={(e) => setTemplate(e.target.value)} style={{ minHeight: 44 }}>
                  {data.templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              </Field>
            ) : <div style={{ fontSize: 13, color: c.muted }}>No template yet. You can still start an empty estimate.</div>}
          </div>
        </SidePanel>
      )}
    </div>
  );
}
