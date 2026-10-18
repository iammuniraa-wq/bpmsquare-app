"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { formatMoneyCompact, moneyFormatter } from "@/lib/currency";
import type { CurrencyDef } from "@/lib/currency";
import type { GeometryModel } from "@/lib/estimator/geometry";
import { densityFromRates } from "@/lib/estimator/geometry";
import { marksForRef } from "@/lib/estimator/pieceInfo";
import type { AllocLine } from "@/lib/estimator/pieceInfo";
import {
  buildCostModel, defaultTargetMargin, runRisk, scheduleQuantities, simulateSchedule, whatIf,
} from "@/lib/estimator/simulation";
import type { SimLine } from "@/lib/estimator/simulation";
import type { TemplateRate, TemplateRule } from "@/lib/estimator/types";
import ScheduleCard from "./ScheduleCard";
import RiskSection from "./RiskSection";

// three.js is only fetched when this tab is opened.
const BuildingViewer = dynamic(() => import("@/components/estimator/BuildingViewer"), {
  ssr: false,
  loading: () => <div className="bpm-t-help" style={{ padding: 16 }}>Loading the 3D view…</div>,
});

export type SimulationLine = SimLine & AllocLine;

export type SimulationProps = {
  model: GeometryModel | null;
  hasGeometry: boolean;
  lines: SimulationLine[];
  rules: Pick<TemplateRule, "code" | "qty" | "cost">[];
  rates: TemplateRate[];
  price: number;
  costTotal: number;
  marginPct: number;
  vatPct: number;
  currency: CurrencyDef;
  /** BOM line code whose pieces to light up (from the BOM tab's "Show in 3D"). */
  highlightCode?: string;
};

export default function SimulationTab(p: SimulationProps) {
  const money = useMemo(() => moneyFormatter(p.currency, { maximumFractionDigits: 0 }), [p.currency]);
  const compact = useMemo(() => (n: number) => formatMoneyCompact(n, p.currency, 1), [p.currency]);

  const model = useMemo(() => buildCostModel(p.lines, p.rules, p.rates), [p.lines, p.rules, p.rates]);
  const [mult, setMult] = useState<Record<string, number>>({});
  const [margin, setMargin] = useState(p.marginPct);
  const [target, setTarget] = useState(defaultTargetMargin(p.marginPct));

  const schedule = useMemo(() => {
    const q = scheduleQuantities(p.model?.pieces ?? [], p.lines, p.rates);
    return { sim: simulateSchedule({ ...q, rates: p.rates }), volume: q.volume_m3 };
  }, [p.model, p.lines, p.rates]);

  const result = useMemo(() => whatIf(model, mult, { margin_pct: margin, vat_pct: p.vatPct, base_price: p.price }), [model, mult, margin, p.vatPct, p.price]);
  const risk = useMemo(() => runRisk(model, { price: p.price, target_margin_pct: target, multipliers: mult }), [model, p.price, target, mult]);

  const highlight = useMemo(() => {
    if (!p.model || !p.highlightCode) return undefined;
    const line = p.lines.find((l) => l.code === p.highlightCode);
    return line ? marksForRef(line.element_ref, p.model.pieces) : undefined;
  }, [p.model, p.lines, p.highlightCode]);

  if (p.lines.length === 0) {
    return <Card padding={0}><EmptyState title="Calculate the estimate first" text="The simulation reads the estimate's lines and model. Open the Inputs tab and calculate." /></Card>;
  }

  return (
    <>
      <Card title="3D model" padding={18}>
        {p.hasGeometry ? (
          <BuildingViewer model={p.model} lines={p.lines} densityTm3={densityFromRates(p.rates)} money={money} highlightMarks={highlight} />
        ) : (
          <EmptyState title="This template has no 3D model" text="A template with a geometry module draws its pieces here. This one prices from formulas only; the schedule and risk sections below still work." />
        )}
        {p.highlightCode && highlight && highlight.length > 0 && (
          <div className="bpm-t-help" style={{ marginTop: 8 }}>Showing {highlight.length} pieces of the BOM line &quot;{p.highlightCode}&quot; highlighted.</div>
        )}
      </Card>

      <ScheduleCard schedule={schedule.sim} volume={schedule.volume} />

      <RiskSection
        model={model} risk={risk} result={result} money={money} compact={compact}
        mult={mult} margin={margin} baseMargin={p.marginPct} target={target} price={p.price}
        onMult={(k, v) => setMult((m) => ({ ...m, [k]: v }))} onMargin={setMargin} onTarget={setTarget}
        onReset={() => { setMult({}); setMargin(p.marginPct); setTarget(defaultTargetMargin(p.marginPct)); }}
      />
    </>
  );
}
