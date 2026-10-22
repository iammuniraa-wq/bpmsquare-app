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

/** What the connected product receives: a Quote or a Sales Order (Dynamics
 *  Sales; F&O and Business Central take a Sales Order too, preset-only) carry
 *  customer prices only; a Project (F&O, Business Central, later SAP / ePROMIS)
 *  carries tasks and bill of materials. */
export const TARGET_KINDS = ["quote", "sales_order", "project", "webhook"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const TARGET_LABEL: Record<TargetKind, string> = { quote: "Quote", sales_order: "Sales Order", project: "Project", webhook: "Webhook" };

// ── The Quote document (redesign 2026-10-21, spec section 6) ────────────────
// One outbound document replaces the separate rules + fence + estimate options.
// `include` is ONE list of what leaves with the document; it maps onto the older
// fence and estimate selections (see documents.ts).

export const INCLUDE_KEYS = ["lines", "summary", "drawing_link", "notes_terms", "security_profile", "bom", "wbs", "internal_costs"] as const;
export type IncludeKey = (typeof INCLUDE_KEYS)[number];
export type IncludeSelection = Record<IncludeKey, boolean>;

export const INCLUDE_LABEL: Record<IncludeKey, string> = {
  summary: "Summary text",
  lines: "Customer prices",
  drawing_link: "Drawing link",
  notes_terms: "Notes and terms",
  security_profile: "Security profile",
  bom: "Materials list",
  wbs: "Project tasks",
  internal_costs: "Internal costs",
};

export type DocumentConfig = {
  enabled: boolean;
  when: { awarded: boolean; rejected: boolean };
  mode: RuleMode;
  /** Only present when a legacy /rules call set a different mode for rejected quotes. */
  mode_rejected?: RuleMode;
  /** What to create in the ERP; null = the connected system's default. */
  target: TargetKind | null;
  /** The Call webhook an awarded quote goes to when `target` is "webhook"; verified against the tenant when saved and again when fired. */
  webhook_id?: string | null;
  include: IncludeSelection;
  /** Set by the first successful save of the document panel. */
  confirmed_at: string | null;
};

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

/** What tenants.config.integration_middleware holds: the Quote document, plus the older
 *  rules / fence / estimate keys kept in step with it (so the older /rules API reads and
 *  writes the same data), plus payload capture. */
export type StoredMiddlewareConfig = Partial<IntegrationMiddlewareConfig> & { documents?: { quote?: DocumentConfig } };

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
  /** The document or entity this is about, in words ("Quote", "Customers"). */
  what: string;
  /** Restart can run it again: a failed or waiting document, a failed connector run. Never OK or by-design skipped. */
  restartable: boolean;
  /** The plain "what to do" line, from the stored summary (no extra read). */
  fix: string | null;
  /** The ERP's readable number (QUO-01002), never a GUID. */
  erpNumber: string | null;
  /** A request/response payload is stored for this message. */
  hasPayload: boolean;
};

export type MessageFilters = {
  direction?: MessageDirection;
  channel?: MessageChannel;
  status?: MonitorStatus;
  from?: string;
  to?: string;
  /** Show only rows about one record. */
  object_id?: string;
  /** Show only the runs and messages of one connector (the page sets it for every connector but the first). */
  connector?: string;
  /** Free text over summary and counterpart (applied to the page after reading). */
  q?: string;
};

/** What a person sees when something failed: what happened, why, the one thing to do. */
export type PlainFailure = { headline: string; fix: string };

/** The SQL a pending database update needs, named for the owner. */
export const SQL_BUNDLES = {
  middleware: "scripts/run-bundle-10-middleware-2026-10-21.sql",
  connectors: "scripts/run-bundle-9-connectors-2026-10-21.sql",
  webhooks: "scripts/run-bundle-11-webhooks-2026-10-21.sql",
  mapping: "scripts/run-bundle-12-mapping-2026-10-21.sql",
} as const;
