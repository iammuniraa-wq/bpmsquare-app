"use client";

import dynamic from "next/dynamic";
import type { GeometryModel } from "@/lib/estimator/geometry";
import { getGeometry } from "@/lib/estimator/geometry";
import type { AllocLine } from "@/lib/estimator/pieceInfo";
import FloorPreview from "./viewer/FloorPreview";

// three.js is only fetched when a 3D model is drawn.
const BuildingViewer = dynamic(() => import("@/components/estimator/BuildingViewer"), {
  ssr: false,
  loading: () => <div className="bpm-t-help" style={{ padding: 16 }}>Loading the 3D view…</div>,
});

const TITLES: Readonly<Record<string, string>> = {
  precast_villa: "The villa",
  tiles_floor: "The floor",
  porta_cabin: "The cabin",
};

/** The card heading for a geometry key: "The villa", "The floor", "The cabin"; "The villa" while no model exists yet, else "The model". */
export function geometryCardTitle(key: string | null | undefined): string {
  if (!key) return TITLES.precast_villa;
  return TITLES[key] ?? "The model";
}

/**
 * Draws whatever a template's geometry module made: the 3D piece viewer for a
 * building, the 2D floor plan for a module that says `view: "floor_plan"`.
 * A page that already shows a model uses this instead of BuildingViewer so a
 * new module needs no change here beyond its `view` setting.
 */
export default function GeometryView({
  model, lines, densityTm3, money, highlightMarks, onUsePattern,
}: {
  model: GeometryModel | null;
  lines: readonly AllocLine[];
  densityTm3: number;
  money: (n: number) => string;
  highlightMarks?: readonly string[];
  /** Floor plan only: make the previewed pattern the estimate's own. */
  onUsePattern?: (pattern: number) => void;
}) {
  const mod = model ? getGeometry(model.geometry) : null;
  if (model && mod?.view === "floor_plan") return <FloorPreview model={model} onUsePattern={onUsePattern} />;
  return <BuildingViewer model={model} lines={lines} densityTm3={densityTm3} money={money} highlightMarks={highlightMarks} />;
}
