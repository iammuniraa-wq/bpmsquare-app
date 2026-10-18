import type { SimLine } from "@/lib/estimator/simulation";
import type { AllocLine } from "@/lib/estimator/pieceInfo";
import type { GeometryModel } from "@/lib/estimator/geometry";
import type { QuoteGranularity, TemplateInput, TemplateRate, TemplateRule } from "@/lib/estimator/types";
import type { EstimateTotals } from "@/lib/types";

/** The parts of a template the working page needs to compute in the browser. */
export type WorkspaceTemplate = {
  id: string;
  name: string;
  description: string | null;
  geometry: string | null;
  inputs: TemplateInput[];
  rates: TemplateRate[];
  rules: TemplateRule[];
  quote_granularity: QuoteGranularity;
};

/** A slim cost line: what the viewer, the schedule and the risk run read. */
export type WorkspaceLine = SimLine & AllocLine;

/** What the page is showing right now (the saved estimate, or the live preview of an edit). */
export type ShownData = {
  lines: WorkspaceLine[];
  model: GeometryModel | null;
  totals: EstimateTotals | null;
  /** True when this is the live preview of unsaved input, not the stored estimate. */
  live: boolean;
};
