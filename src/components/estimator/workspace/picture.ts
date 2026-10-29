// What picture an estimate gets (docs/design/estimator-visual-for-every-estimate.md): the bespoke model of its geometry module when the
// template has one, else the massing built from its inputs, else none. Pure, so the choice is tested without a browser.

import { getGeometry, layoutGeneric, withGenericRefs } from "@/lib/estimator/geometry";
import type { GeometryModel } from "@/lib/estimator/geometry";
import { inferVolumeKey, resolveVisualMapping } from "@/lib/estimator/visual";
import { previewKindFor } from "./layoutKind";
import type { PreviewKind } from "./layoutKind";
import type { WorkspaceLine, WorkspaceTemplate } from "./types";

export type Picture = { kind: PreviewKind; model: GeometryModel | null; lines: WorkspaceLine[] };

const NONE: Picture = { kind: "none", model: null, lines: [] };

export function pictureFor(
  t: Pick<WorkspaceTemplate, "geometry" | "inputs" | "visual"> | null,
  bespoke: GeometryModel | null,
  params: Readonly<Record<string, unknown>>,
  lines: readonly WorkspaceLine[]
): Picture {
  if (!t) return NONE;
  if (t.geometry && getGeometry(t.geometry)) {
    return bespoke ? { kind: previewKindFor(t.geometry), model: bespoke, lines: [...lines] } : NONE;
  }
  if (t.visual?.picture === "none") return NONE;
  const model = layoutGeneric({ values: params, mapping: resolveVisualMapping(t.visual, t.inputs), volumeKey: inferVolumeKey(t.inputs), lines });
  if (model.pieces.length === 0) return NONE;
  return { kind: previewKindFor(null, true), model, lines: withGenericRefs(model, lines) };
}
