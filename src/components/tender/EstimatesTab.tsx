"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import StatTile, { StatStrip } from "@/components/ui/StatTile";
import { ESTIMATE_TIPS } from "@/lib/tender/estimates/tips";
import MissingRfqButton from "./MissingRfqButton";
import type { EstimateListItem } from "@/lib/tender/estimates/server";

// The Estimates tab of a tender deal (GCC tender deals, slice 3c-1): the estimates made for this tender, with their template, status,
// cost, price and last change, a template picker to start a new one, and the two numbers that need a person (BOQ lines whose estimate
// changed, costs still missing). Costs shown here are internal; the tab is for people with the Estimates view. Everything it changes
// is the ordinary estimate screen: "New estimate" opens /estimates/new on the chosen template with this deal attached.

export type EstimatesTabData = {
  pending: boolean;
  estimates: EstimateListItem[];
  templates: { id: string; name: string; description: string | null }[];
  can_create: boolean;
  rfq_enabled: boolean;
  today?: string;
  valid_days?: number;
};

const money = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtDate = (s: string) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const STATUS: Record<string, string> = { draft: "Draft", quoted: "Quoted", won: "Won", lost: "Lost" };
const PAGE = 8;

export default function EstimatesTab({ opportunityId, canEdit, onError, initialData }: {
  opportunityId: string; canEdit: boolean; onError: (m: string) => void;
  /** Lets a server render (and its test) show the loaded tab without a fetch. The page never passes it. */
  initialData?: EstimatesTabData;
}) {
  const url = `/api/opportunities/${opportunityId}/tender/estimates`;
  const [data, setData] = useState<EstimatesTabData | null>(initialData ?? null);
  const [template, setTemplate] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(url, { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { onError(j.error ?? "Could not load the estimates"); return; }
    setData(j as EstimatesTabData);
  }, [url, onError]);
  useEffect(() => { if (!initialData) void load(); }, [load, initialData]);

  if (!data) return <div style={{ fontSize: 13, color: c.hint }}>Loading the estimates…</div>;
  if (data.pending) {
    return <div role="alert" data-guide="tender.estimates.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Estimates inside a tender need a database update (migration 0227). Ask your administrator to apply it.</div>;
  }

  const chosen = template || data.templates[0]?.id || "";
  const shown = showAll ? data.estimates : data.estimates.slice(0, PAGE);
  const costTotal = data.estimates.reduce((sum, e) => sum + (e.cost_total ?? 0), 0);
  const currencies = [...new Set(data.estimates.map((e) => e.currency).filter((x): x is string => !!x))];
  const linkedLines = data.estimates.reduce((sum, e) => sum + e.linked_boq_lines, 0);
  const staleLinks = data.estimates.reduce((sum, e) => sum + e.stale_links, 0);

  return (
    <div data-guide="tender.estimates" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data.estimates.length > 0 && (
        <StatStrip guide="tender.estimates.strip">
          <StatTile tone="context" label="Estimates linked" value={String(data.estimates.length)} sub="made for this tender" />
          <StatTile tone="info" label="Cost total" value={money(costTotal)} sub={currencies.length === 1 ? currencies[0] : "mixed currencies"} />
          <StatTile tone={linkedLines > 0 ? "good" : "neutral"} label="Lines priced from them" value={String(linkedLines)} sub={linkedLines === 1 ? "BOQ line" : "BOQ lines"} />
          <StatTile tone={staleLinks > 0 ? "warn" : "neutral"} label="Needs re-price" value={String(staleLinks)} sub={staleLinks > 0 ? "an estimate changed" : "all up to date"} />
        </StatStrip>
      )}
      <Card title="Estimates" info={ESTIMATE_TIPS.tab}>
        {data.can_create && canEdit && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
            {data.templates.length > 0 ? (
              <>
                <Select aria-label="Template for the new estimate" data-guide="tender.estimate.template" value={chosen} onChange={(e) => setTemplate(e.target.value)} style={{ flex: "1 1 220px", minHeight: 44, maxWidth: 360 }}>
                  {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <Button variant="primary" href={`/estimates/new?template=${encodeURIComponent(chosen)}&opportunity=${encodeURIComponent(opportunityId)}`} style={{ minHeight: 44 }} data-guide="tender.estimate.new">New estimate</Button>
                <InfoTip label="New estimate">{ESTIMATE_TIPS.newEstimate}</InfoTip>
              </>
            ) : (
              <Button variant="primary" href={`/estimates/new?opportunity=${encodeURIComponent(opportunityId)}`} style={{ minHeight: 44 }} data-guide="tender.estimate.new">New estimate</Button>
            )}
          </div>
        )}

        {data.estimates.length === 0 && (
          <div data-guide="tender.estimates.empty" style={{ fontSize: 13, color: c.muted }}>
            No estimate for this tender yet. Start one from a template, then price BOQ lines from it on the BOQ tab.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column" }}>
          {shown.map((e) => (
            <div key={e.id} data-guide="tender.estimate.row" style={{ borderTop: `1px solid ${c.line}`, padding: "10px 0", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline" }}>
                <Link href={`/estimates/${e.id}`} data-guide="tender.estimate.open" style={{ fontWeight: 700, fontSize: 13, color: c.ink, minHeight: 44, display: "inline-flex", alignItems: "center", overflowWrap: "anywhere" }}>{e.ref ? `${e.ref} · ` : ""}{e.name}</Link>
                <span style={{ fontSize: 12, color: c.muted }}>{[e.template_name, STATUS[e.status] ?? e.status].filter(Boolean).join(" · ")}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "center", fontSize: 12.5, color: c.ink }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Cost <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(e.cost_total)}</b> · Price <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(e.price)}</b> <InfoTip label="Cost and price">{ESTIMATE_TIPS.rowCost}</InfoTip></span>
                <span style={{ color: c.hint }}>Changed {fmtDate(e.updated_at)}</span>
                {e.linked_boq_lines > 0 && <span style={{ color: c.muted }}>{e.linked_boq_lines} BOQ line{e.linked_boq_lines === 1 ? "" : "s"} priced from it</span>}
                {e.stale_links > 0 && <span data-guide="tender.estimate.stale" style={{ color: "var(--amberink)", fontWeight: 700 }}>Estimate changed, re-price</span>}
              </div>
              {e.missing_count > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span data-guide="tender.estimate.missing" style={{ fontSize: 12.5, color: "var(--amberink)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {e.missing_count} cost{e.missing_count === 1 ? "" : "s"} missing <InfoTip label="Missing costs">{ESTIMATE_TIPS.missing}</InfoTip>
                  </span>
                  {data.rfq_enabled && canEdit && <MissingRfqButton opportunityId={opportunityId} estimateId={e.id} showTip={false} />}
                </div>
              )}
            </div>
          ))}
        </div>
        {data.estimates.length > PAGE && (
          <Button variant="quiet" onClick={() => setShowAll(!showAll)} style={{ minHeight: 44 }} data-guide="tender.estimates.show_all">{showAll ? "Show fewer" : `Show all ${data.estimates.length} estimates`}</Button>
        )}
      </Card>
    </div>
  );
}
