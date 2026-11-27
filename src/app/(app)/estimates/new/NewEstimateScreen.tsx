"use client";

import { useState } from "react";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import EstimateWorkspace from "@/components/estimator/workspace/EstimateWorkspace";
import type { WorkspaceProps } from "@/components/estimator/workspace/EstimateWorkspace";
import { PriceBuiltFold, ScheduleRiskPanel } from "@/components/estimator/workspace/InternalFolds";
import { hasScheduleRiskTab } from "@/components/estimator/workspace/layoutKind";
import { ESTIMATE_TAB_IDS, estimateTabs, newEstimateTab } from "@/components/estimator/workspace/tabTargets";
import { ESTIMATE_TIPS } from "@/lib/estimator/tips";

/**
 * /estimates/new: the working page with nothing saved yet, on the same tabs as a saved estimate. "How the price is built" and the
 * schedule work from the live preview; the materials and the details belong to a saved estimate, so their tabs are shown but cannot
 * be chosen until the first save (the reason is behind their "i").
 */
export default function NewEstimateScreen(props: Omit<WorkspaceProps, "renderInternal" | "saved" | "tabs" | "onShowMain">) {
  const [priceOpen, setPriceOpen] = useState(false);
  const [tab, setTab] = useUrlTab(ESTIMATE_TAB_IDS);
  return (
    <EstimateWorkspace
      {...props}
      tabs={(tpl) => {
        const schedule = hasScheduleRiskTab(tpl);
        const active = newEstimateTab(tab, schedule);
        return {
          strip: <Tabs tabs={estimateTabs({ schedule, saved: false, needsSaveTip: ESTIMATE_TIPS.needsSave })} value={active} onChange={setTab} label="Estimate sections" />,
          main: active === "estimate",
        };
      }}
      renderInternal={(shown, tpl) => {
        if (!tpl) return null;
        const active = newEstimateTab(tab, hasScheduleRiskTab(tpl));
        if (active === "schedule") return <ScheduleRiskPanel shown={shown} rules={tpl.rules} rates={tpl.rates} geometry={tpl.geometry} />;
        return shown.totals ? <PriceBuiltFold shown={shown} fold={{ open: priceOpen, onToggle: setPriceOpen }} /> : null;
      }}
    />
  );
}
