import type { ProjectStatus } from "./types";

// The path of a contract project across the top of its record: Draft, Baseline waiting, Active, Handed over, Closed. PURE. "Handed over"
// is the step after Active: at least one buy-out package was handed over, or the budget file was downloaded (migration 0240 stamps that).
// Until 0240 is applied only the buy-out half can be known, so the step reads on buy-out alone.

export const PATH_STEPS = [
  { key: "draft", label: "Draft" },
  { key: "baseline_pending", label: "Baseline waiting" },
  { key: "active", label: "Active" },
  { key: "handed_over", label: "Handed over" },
  { key: "closed", label: "Closed" },
] as const;
export type PathKey = (typeof PATH_STEPS)[number]["key"];
export type PathStepState = "done" | "current" | "todo";
export type ProjectPath = { steps: { key: PathKey; label: string; state: PathStepState }[]; current: PathKey };

export function projectPath(project: { status: ProjectStatus; handover_sent_at: string | null }, anyPackageHandedOver: boolean): ProjectPath {
  const handedOver = anyPackageHandedOver || !!project.handover_sent_at;
  const current: PathKey =
    project.status === "closed" ? "closed"
    : project.status === "active" && handedOver ? "handed_over"
    : project.status === "active" ? "active"
    : project.status === "baseline_pending" ? "baseline_pending"
    : "draft";
  const at = PATH_STEPS.findIndex((s) => s.key === current);
  return { current, steps: PATH_STEPS.map((s, i) => ({ key: s.key, label: s.label, state: i < at ? "done" : i === at ? "current" : "todo" })) };
}
