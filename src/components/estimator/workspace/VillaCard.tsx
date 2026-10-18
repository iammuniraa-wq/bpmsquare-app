"use client";

import dynamic from "next/dynamic";
import Card from "@/components/ui/Card";
import type { GeometryModel } from "@/lib/estimator/geometry";
import { densityFromRates } from "@/lib/estimator/geometry";
import type { TemplateRate } from "@/lib/estimator/types";
import type { WorkspaceLine } from "./types";

// three.js is only fetched when a villa is drawn.
const BuildingViewer = dynamic(() => import("@/components/estimator/BuildingViewer"), {
  ssr: false,
  loading: () => <div className="bpm-t-help" style={{ padding: 16 }}>Loading the 3D view…</div>,
});

/**
 * The exact model, drawn from the same pieces the price is added up from:
 * drag to turn it, click a piece for its size, weight and cost, "Watch it being
 * built" to see the order it goes up in. The highlight comes from the bill of
 * materials ("Show in 3D").
 */
export default function VillaCard({
  model, lines, rates, money, highlightMarks, note,
}: {
  model: GeometryModel | null;
  lines: readonly WorkspaceLine[];
  rates: readonly TemplateRate[];
  money: (n: number) => string;
  highlightMarks?: readonly string[];
  note?: string;
}) {
  return (
    <div id="villa" style={{ scrollMarginTop: 80, minWidth: 0 }}>
      <Card title="The villa" padding={16}>
      <BuildingViewer model={model} lines={lines} densityTm3={densityFromRates([...rates])} money={money} highlightMarks={highlightMarks} />
      {note && <div className="bpm-t-help" style={{ marginTop: 8 }}>{note}</div>}
      </Card>
    </div>
  );
}
