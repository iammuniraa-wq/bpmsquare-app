// Integration middleware -- shared, client-safe shapes (no server imports).
// Spec: docs/design/integration-middleware.md. Vocabulary on every surface is
// awarded / rejected; the Standard Quote statuses are not renamed
// (accepted = awarded, rejected = rejected).

export const OUTCOMES = ["awarded", "rejected"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = { awarded: "Quote awarded", rejected: "Quote rejected" };

/** Standard Quote status that means each outcome. */
export const STATUS_FOR_OUTCOME: Record<Outcome, string> = { awarded: "accepted", rejected: "rejected" };

export function outcomeForStatus(status: string | null | undefined): Outcome | null {
  if (status === "accepted") return "awarded";
  if (status === "rejected") return "rejected";
  return null;
}

export type RuleMode = "auto" | "manual";
export type OutcomeRule = { enabled: boolean; mode: RuleMode };

/** Which fence-project data leaves with the quote. Only applies to a quote
 *  that was made from a fence project. */
export const FENCE_PARTS = ["summary", "quantity_lines", "security_profile", "drawing_link", "notes_terms"] as const;
export type FencePart = (typeof FENCE_PARTS)[number];
export type FenceSelection = Record<FencePart, boolean>;

export const FENCE_PART_LABEL: Record<FencePart, string> = {
  summary: "Design summary in the description",
  quantity_lines: "Quantity lines (posts, fabric, gates)",
  security_profile: "Security profile",
  drawing_link: "Drawing link",
  notes_terms: "Notes and terms",
};

/** Which estimate data leaves with the quote that came from an estimate. */
export const ESTIMATE_PARTS = ["summary", "quote_lines", "bom", "wbs", "internal_costs"] as const;
export type EstimatePart = (typeof ESTIMATE_PARTS)[number];
export type EstimateSelection = Record<EstimatePart, boolean>;

export const ESTIMATE_PART_LABEL: Record<EstimatePart, string> = {
  summary: "Estimate summary in the description",
  quote_lines: "Quote lines (customer prices)",
  bom: "Bill of materials",
  wbs: "Project tasks (WBS) and casting schedule",
  internal_costs: "Internal cost breakdown",
};

/** What the connected product receives: a Quote (Dynamics Sales) carries
 *  prices only; a Project (F&O, Business Central, later SAP / ePROMIS) carries
 *  tasks and bill of materials. */
export type TargetKind = "quote" | "project";

export type OptionContract = { allowed: boolean; hint: string | null };
export type SelectionContract = {
  /** null when no ERP is connected yet: nothing is greyed out. */
  target: TargetKind | null;
  fence: Record<FencePart, OptionContract>;
  estimate: Record<EstimatePart, OptionContract>;
};

export type IntegrationMiddlewareConfig = {
  rules: { quote_awarded: OutcomeRule; quote_rejected: OutcomeRule };
  fence: FenceSelection;
  estimate: EstimateSelection;
  /** Keep (redacted) request and response bodies on the message log for 30
   *  days. Off unless an admin switches it on. */
  payload_capture: boolean;
};

// ── Messages ─────────────────────────────────────────────────────────────────

export const MESSAGE_DIRECTIONS = ["in", "out"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_CHANNELS = ["email", "whatsapp", "webhook", "connector", "api"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** Statuses a stored integration message can have. */
export const STORED_STATUSES = ["ok", "failed", "pending", "skipped", "redirected"] as const;
export type StoredStatus = (typeof STORED_STATUSES)[number];

/** Statuses the monitor shows (the stored ones plus the dry run of a demo send). */
export type MonitorStatus = StoredStatus | "dry_run";

export const MESSAGE_SOURCES = ["integration", "email", "rfq", "whatsapp", "webhook", "connector"] as const;
export type MessageSource = (typeof MESSAGE_SOURCES)[number];

/** One normalised row of the monitor, whichever table it came from. */
export type MonitorMessage = {
  /** `<source>:<uuid>` -- what the detail route takes. */
  id: string;
  source: MessageSource;
  at: string;
  direction: MessageDirection;
  channel: MessageChannel;
  counterpart: string | null;
  summary: string;
  status: MonitorStatus;
  /** The BPMSquare record it belongs to, when there is one. */
  record: { type: string; id: string | null; label: string | null } | null;
  duration_ms: number | null;
};

export type MessageFilters = {
  direction?: MessageDirection;
  channel?: MessageChannel;
  status?: MonitorStatus;
  from?: string;
  to?: string;
  /** Show only rows about one record. */
  object_id?: string;
  /** Free text over summary and counterpart (applied to the page after reading). */
  q?: string;
};

/** What a person sees when something failed: what happened, why, the one thing to do. */
export type PlainFailure = { headline: string; fix: string };

/** The SQL a pending database update needs, named for the owner. */
export const SQL_BUNDLES = {
  middleware: "scripts/run-bundle-10-middleware-2026-10-21.sql",
  connectors: "scripts/run-bundle-9-connectors-2026-10-21.sql",
} as const;
