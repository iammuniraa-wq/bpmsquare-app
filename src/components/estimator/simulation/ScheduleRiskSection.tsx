"use client";

import { useMemo, useState } from "react";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { formatMoneyCompact, moneyFormatter } from "@/lib/currency";
import type { CurrencyDef } from "@/lib/currency";
import type { GeometryModel } from "@/lib/estimator/geometry";
import { buildCostModel, defaultTargetMargin, runRisk, scheduleQuantities, simulateSchedule, whatIf } from "@/lib/estimator/simulation";
import type { SimLine } from "@/lib/estimator/simulation";
import type { AllocLine } from "@/lib/estimator/pieceInfo";
import type { TemplateRate, TemplateRule } from "@/lib/estimator/types";
import ScheduleCard from "./ScheduleCard";
import RiskSection from "./RiskSection";

export type ScheduleRiskProps = {
  model: GeometryModel | null;
  lines: (SimLine & AllocLine)[];
  rules: Pick<TemplateRule, "code" | "qty" | "cost">[];
  rates: TemplateRate[];
  price: number;
  marginPct: number;
  vatPct: number;
  currency: CurrencyDef;
};

/**
 * "Build schedule and risk": how long the build takes from the model's volume and
 * the template's capacities, and how the cost could move. The same maths as the
 * old Simulation tab, minus the 3D model (that lives in the villa card now).
 * Nothing here is saved.
 */
export default function ScheduleRiskSection(p: ScheduleRiskProps) {
  const money = useMemo(() => moneyFormatter(p.currency, { maximumFractionDigits: 0 }), [p.currency]);
  const compact = useMemo(() => (n: number) => formatMoneyCompact(n, p.currency, 1), [p.currency]);

  const cost = useMemo(() => buildCostModel(p.lines, p.rules, p.rates), [p.lines, p.rules, p.rates]);
  const [mult, setMult] = useState<Record<string, number>>({});
  const [margin, setMargin] = useState(p.marginPct);
  const [target, setTarget] = useState(defaultTargetMargin(p.marginPct));

  const schedule = useMemo(() => {
    const q = scheduleQuantities(p.model?.pieces ?? [], p.lines, p.rates);
    return { sim: simulateSchedule({ ...q, rates: p.rates }), volume: q.volume_m3 };
  }, [p.model, p.lines, p.rates]);
  const result = useMemo(() => whatIf(cost, mult, { margin_pct: margin, vat_pct: p.vatPct, base_price: p.price }), [cost, mult, margin, p.vatPct, p.price]);
  const risk = useMemo(() => runRisk(cost, { price: p.price, target_margin_pct: target, multipliers: mult }), [cost, p.price, target, mult]);

  if (p.lines.length === 0) {
    return <Card padding={0}><EmptyState title="Nothing to schedule yet" text="The schedule and the risk run read the estimate's lines and model. Fill in the details above first." /></Card>;
  }
  return (
    <>
      <ScheduleCard schedule={schedule.sim} volume={schedule.volume} />
      <RiskSection
        model={cost} risk={risk} result={result} money={money} compact={compact}
        mult={mult} margin={margin} baseMargin={p.marginPct} target={target} price={p.price}
        onMult={(k, v) => setMult((m) => ({ ...m, [k]: v }))} onMargin={setMargin} onTarget={setTarget}
        onReset={() => { setMult({}); setMargin(p.marginPct); setTarget(defaultTargetMargin(p.marginPct)); }}
      />
    </>
  );
}
