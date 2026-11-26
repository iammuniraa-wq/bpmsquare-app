import type { BuildingsPayload } from "./rows";
import type { ElementsSettings } from "./types";

// What GET .../buildings answers, as the screens read it (the project's and the tender's answers have this one shape). Client-safe: no server import.

export type ElementTypeOption = { code: string; name: string };

export type BuildingsData = BuildingsPayload & {
  enabled: true;
  scope: "project" | "tender";
  /** Migration 0253 is not applied: the Buildings view and the element fields are not there yet. */
  pending: boolean;
  settings: Pick<ElementsSettings, "pattern" | "code_max" | "qty_tolerance_pct" | "level_names">;
  pattern: string;
  pattern_frozen: boolean;
  types: ElementTypeOption[];
  revision: { id: string; rev_no: number; status: string } | null;
  /** Why nothing can change right now, in words; null when it can. */
  lock: string | null;
  /** Buildings can be added, renamed and removed (any revision of an open project; always on a tender). Elements follow `lock`. */
  structure_open: boolean;
  can_reissue: boolean;
  allocation_basis: "line" | "package";
  currency: string | null;
  /** Tender only: the deal already became a project. */
  has_project?: boolean;
};

export type BuildingsAnswer = BuildingsData | { enabled: false };

export type IssueAnswer = {
  plan: { assignments: { key: string; code: string; building: string; type: string }[]; skipped: { key: string; reason: string }[]; groups: { building: string; type: string; count: number; from: string; to: string }[]; summary: string[] };
  written: number;
  pattern: string;
};
