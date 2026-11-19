"use client";

import type { FenceView } from "@/lib/estimator/fenceView";
import type { TemplateRate } from "@/lib/estimator/types";
import FenceCard from "./FenceCard";
import VillaCard from "./VillaCard";
import type { Picture } from "./picture";

/**
 * What the working page shows above the price: the picture (the bespoke model of the trade, else the massing drawn from the inputs).
 * A template with no picture shows nothing here; the breakdown is the Price card's own list, shown once.
 */
export default function VisualStack({
  picture, fenceView, rates, money, highlightMarks, visuals, note, onUsePattern,
}: {
  picture: Picture;
  fenceView: FenceView | null;
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
    </>
  );
}
