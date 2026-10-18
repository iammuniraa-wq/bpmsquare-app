"use client";

import { useMemo } from "react";
import { useCurrency } from "@/lib/tenant-context";
import { moneyFormatter } from "@/lib/currency";
import type { TemplateRate, TemplateRule } from "@/lib/estimator/types";
import Collapsible from "./Collapsible";
import PriceBuilt from "./PriceBuilt";
import ScheduleRiskSection from "../simulation/ScheduleRiskSection";
import type { ShownData } from "./types";

type Fold = { open: boolean; onToggle: (open: boolean) => void };

/** "How the price is built": the old Costing, plus the AI review when the estimate is saved. */
export function PriceBuiltFold({ shown, fold, estimateId, canReview }: { shown: ShownData; fold: Fold; estimateId?: string; canReview?: boolean }) {
  const cur = useCurrency();
  const money = useMemo(() => moneyFormatter(cur, { maximumFractionDigits: 2 }), [cur]);
  return (
    <Collapsible id="price" title="How the price is built" hint="for your team" {...fold}>
      <PriceBuilt totals={shown.totals} money={money} estimateId={estimateId} canReview={canReview && shown.lines.length > 0} />
    </Collapsible>
  );
}

/** "Build schedule and risk": the old Simulation tab's schedule and risk panels. */
export function ScheduleRiskFold({ shown, rules, rates, fold }: { shown: ShownData; rules: TemplateRule[]; rates: TemplateRate[]; fold: Fold }) {
  const cur = useCurrency();
  const t = shown.totals;
  return (
    <Collapsible id="schedule" title="Build schedule and risk" hint="how long it takes, and how the cost could move" {...fold}>
      <ScheduleRiskSection
        key={t?.margin_pct ?? 0}
        model={shown.model} lines={shown.lines} rules={rules} rates={rates}
        price={t?.price ?? 0} marginPct={t?.margin_pct ?? 0} vatPct={t?.vat_pct ?? 0} currency={cur}
      />
    </Collapsible>
  );
}
