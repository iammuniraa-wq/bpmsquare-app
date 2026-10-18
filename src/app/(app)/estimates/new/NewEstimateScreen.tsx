"use client";

import { useState } from "react";
import EstimateWorkspace from "@/components/estimator/workspace/EstimateWorkspace";
import type { WorkspaceProps } from "@/components/estimator/workspace/EstimateWorkspace";
import { PriceBuiltFold, ScheduleRiskFold } from "@/components/estimator/workspace/InternalFolds";

type Open = { price: boolean; schedule: boolean };

/**
 * /estimates/new: the working page with nothing saved yet. The internal sections
 * that only need the figures (how the price is built, the build schedule and
 * risk) work from the live preview; the bill of materials, the ERP files and the
 * details belong to a saved estimate and are one click away after "Save as draft".
 */
export default function NewEstimateScreen(props: Omit<WorkspaceProps, "renderInternal" | "saved">) {
  const [open, setOpen] = useState<Open>({ price: false, schedule: false });
  const fold = (id: keyof Open) => ({ open: open[id], onToggle: (v: boolean) => setOpen((o) => ({ ...o, [id]: v })) });
  return (
    <EstimateWorkspace
      {...props}
      renderInternal={(shown, tpl) => (shown.totals && tpl ? (
        <>
          <PriceBuiltFold shown={shown} fold={fold("price")} />
          <ScheduleRiskFold shown={shown} rules={tpl.rules} rates={tpl.rates} fold={fold("schedule")} />
          <p className="bpm-t-help" style={{ margin: 0 }}>
            The bill of materials, the files for your ERP and the details appear once the estimate is saved: press Save as draft or Create quote.
          </p>
        </>
      ) : null)}
    />
  );
}
