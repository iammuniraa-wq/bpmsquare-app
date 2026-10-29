"use client";

import Card from "@/components/ui/Card";
import EstimateVisualStrip from "@/components/estimator/EstimateVisualStrip";
import type { FenceView } from "@/lib/estimator/fenceView";
import type { CompositionStrip } from "@/lib/estimator/visualStrip";
import type { TemplateRate } from "@/lib/estimator/types";
import FenceCard from "./FenceCard";
import VillaCard from "./VillaCard";
import type { Picture } from "./picture";

/**
 * What the working page shows above the price: the picture (the bespoke model of the trade, else the massing drawn from the inputs)
 * and, for every estimate, the composition strip. Nothing here is a form: the person reads the estimate before touching a field.
 */
export default function VisualStack({
  picture, fenceView, strip, rates, money, highlightMarks, visuals, note, onUsePattern,
}: {
  picture: Picture;
  fenceView: FenceView | null;
  strip: CompositionStrip | null;
  rates: readonly TemplateRate[];
  money: (n: number) => string;
  highlightMarks?: readonly string[];
  visuals?: Readonly<Record<string, string>>;
  note?: string;
  onUsePattern?: (pattern: number) => void;
}) {
  return (
    <>
      {picture.kind === "fence" && picture.model && fenceView && (
        <FenceCard view={fenceView} model={picture.model} lines={picture.lines} rates={rates} money={money} highlightMarks={highlightMarks} visuals={visuals} />
      )}
      {(picture.kind === "pieces" || picture.kind === "generic") && picture.model && (
        <VillaCard model={picture.model} lines={picture.lines} rates={rates} money={money} highlightMarks={highlightMarks} visuals={visuals} note={note} onUsePattern={onUsePattern} />
      )}
      {strip && (
        <div id="cost-strip" style={{ scrollMarginTop: 80, minWidth: 0 }}>
          <Card padding={16}><EstimateVisualStrip strip={strip} money={money} /></Card>
        </div>
      )}
    </>
  );
}
