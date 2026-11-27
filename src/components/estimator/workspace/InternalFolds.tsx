"use client";

import { useMemo } from "react";
import { useCurrency } from "@/lib/tenant-context";
import { moneyFormatter } from "@/lib/currency";
import type { TemplateRate, TemplateRule } from "@/lib/estimator/types";
import { getGeometry } from "@/lib/estimator/geometry";
import Collapsible from "./Collapsible";
import { hasBuildSchedule } from "./layoutKind";
import PriceBuilt from "./PriceBuilt";
import ScheduleRiskSection from "../simulation/ScheduleRiskSection";
import type { ShownData } from "./types";

type Fold = { open: boolean; onToggle: (open: boolean) => void };

/** "How the price is built", closed under the price: cost by component, cost and margin, plus the AI review when the estimate is saved. */
export function PriceBuiltFold({ shown, fold, estimateId, canReview }: { shown: ShownData; fold: Fold; estimateId?: string; canReview?: boolean }) {
  const cur = useCurrency();
  const money = useMemo(() => moneyFormatter(cur, { maximumFractionDigits: 2 }), [cur]);
  return (
    <Collapsible id="price" title="How the price is built" hint="cost and margin, for your team" {...fold}>
      <PriceBuilt totals={shown.totals} money={money} estimateId={estimateId} canReview={canReview && shown.lines.length > 0} />
    </Collapsible>
  );
}

/** The "Schedule & risk" tab: how long the build takes and how the cost could move (the old Simulation tab's panels). */
export function ScheduleRiskPanel({ shown, rules, rates, geometry, record }: {
  shown: ShownData; rules: TemplateRule[]; rates: TemplateRate[]; geometry: string | null | undefined;
  record?: { id: string; canEdit: boolean; locked: boolean; hasQuote: boolean };
}) {
  const cur = useCurrency();
  const t = shown.totals;
  return (
    <ScheduleRiskSection
      key={t?.margin_pct ?? 0}
      model={shown.model} lines={shown.lines} rules={rules} rates={rates}
      hasLayout={hasBuildSchedule(geometry) && !!getGeometry(geometry)} record={record}
      price={t?.price ?? 0} marginPct={t?.margin_pct ?? 0} vatPct={t?.vat_pct ?? 0} currency={cur}
    />
  );
}
