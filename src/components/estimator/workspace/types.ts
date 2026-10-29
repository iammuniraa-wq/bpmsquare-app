import type { SimLine } from "@/lib/estimator/simulation";
import type { AllocLine } from "@/lib/estimator/pieceInfo";
import type { GeometryModel } from "@/lib/estimator/geometry";
import type { QuoteGranularity, TemplateInput, TemplateRate, TemplateRule, TemplateVisual } from "@/lib/estimator/types";
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
  /** The picture built from the inputs (0235); absent = inferred from the inputs. */
  visual?: TemplateVisual | null;
  /** The template is offered to customers: the quote preview carries the composition strip (shares only). */
  customer_visible?: boolean;
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
