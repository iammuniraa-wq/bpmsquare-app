"use client";

import Card from "@/components/ui/Card";
import GeometryView, { geometryCardTitle } from "@/components/estimator/GeometryView";
import type { GeometryModel } from "@/lib/estimator/geometry";
import { densityFromRates } from "@/lib/estimator/geometry";
import type { TemplateRate } from "@/lib/estimator/types";
import type { WorkspaceLine } from "./types";

/**
 * The exact model, drawn from the same pieces the price is added up from:
 * drag to turn it, click a piece for its size, weight and cost, "Watch it being
 * built" to see the order it goes up in. The highlight comes from the bill of
 * materials ("Show in 3D").
 */
export default function VillaCard({
  model, lines, rates, money, highlightMarks, note, onUsePattern,
}: {
  model: GeometryModel | null;
  lines: readonly WorkspaceLine[];
  rates: readonly TemplateRate[];
  money: (n: number) => string;
  highlightMarks?: readonly string[];
  note?: string;
  /** Floor plans: make the previewed tile pattern the estimate's own. */
  onUsePattern?: (pattern: number) => void;
}) {
  return (
    <div id="villa" style={{ scrollMarginTop: 80, minWidth: 0 }}>
      <Card title={geometryCardTitle(model?.geometry)} padding={16}>
      <GeometryView model={model} lines={lines} densityTm3={densityFromRates([...rates])} money={money} highlightMarks={highlightMarks} onUsePattern={onUsePattern} />
      {note && <div className="bpm-t-help" style={{ marginTop: 8 }}>{note}</div>}
      </Card>
    </div>
  );
}
