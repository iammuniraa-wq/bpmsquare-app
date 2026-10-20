// Account-Based Marketing vocabulary and row shapes (docs/abm-architecture.md
// sections 2 and 3). Pure and client-safe: no server imports.

export const ABM_TIERS = ["one_to_one", "one_to_few", "one_to_many"] as const;
export type AbmTier = (typeof ABM_TIERS)[number];
export const TIER_LABEL: Record<AbmTier, string> = { one_to_one: "1:1", one_to_few: "1:few", one_to_many: "1:many" };
export const TIER_HINT: Record<AbmTier, string> = {
  one_to_one: "Its own plan, worked personally",
  one_to_few: "A small cluster sharing content",
  one_to_many: "The program's standard plays",
};

// Order matters: it is the order a target moves forward in.
export const ABM_PROGRESS = ["planned", "reached", "engaged", "in_talks", "deal_open", "won", "lost", "dropped"] as const;
export type AbmProgress = (typeof ABM_PROGRESS)[number];
export const PROGRESS_LABEL: Record<AbmProgress, string> = {
  planned: "Planned", reached: "Reached", engaged: "Engaged", in_talks: "In talks",
  deal_open: "Deal open", won: "Won", lost: "Lost", dropped: "Dropped",
};
export const PROGRESS_TONE: Record<AbmProgress, "blue" | "purple" | "teal" | "amber" | "red" | "green"> = {
  planned: "purple", reached: "blue", engaged: "teal", in_talks: "amber", deal_open: "amber", won: "green", lost: "red", dropped: "purple",
};

export const ABM_ROLES = ["decision_maker", "influencer", "user", "blocker", "unknown"] as const;
export type AbmRole = (typeof ABM_ROLES)[number];
export const ROLE_LABEL: Record<AbmRole, string> = {
  decision_maker: "Decision maker", influencer: "Influencer", user: "User", blocker: "Blocker", unknown: "Unknown",
};
/** Roles a program can require. Blocker and unknown are never "required". */
export const REQUIRABLE_ROLES: readonly AbmRole[] = ["decision_maker", "influencer", "user"];
export const DEFAULT_REQUIRED_ROLES: AbmRole[] = ["decision_maker", "influencer"];

export const PROGRAM_STATUSES = ["draft", "active", "paused", "completed", "archived"] as const;
export type AbmProgramStatus = (typeof PROGRAM_STATUSES)[number];
export const PROGRAM_STATUS_LABEL: Record<AbmProgramStatus, string> = {
  draft: "Draft", active: "Active", paused: "Paused", completed: "Completed", archived: "Archived",
};

export const PROGRAM_KINDS = ["new_business", "expansion"] as const;
export type AbmKind = (typeof PROGRAM_KINDS)[number];
export const KIND_LABEL: Record<AbmKind, string> = { new_business: "New business", expansion: "Expansion" };

export const GOAL_METRICS = ["deals_won", "deals_opened", "accounts_engaged", "revenue"] as const;
export type AbmGoalMetric = (typeof GOAL_METRICS)[number];
export const GOAL_METRIC_LABEL: Record<AbmGoalMetric, string> = {
  deals_won: "Deals won", deals_opened: "Deals opened", accounts_engaged: "Accounts engaged", revenue: "Revenue",
};

export type AbmProgram = {
  id: string;
  tenant_id: string;
  ref: string | null;
  name: string;
  kind: AbmKind;
  goal: string | null;
  goal_metric: AbmGoalMetric;
  goal_target: number | null;
  starts_on: string | null;
  ends_on: string | null;
  owner_user_id: string | null;
  status: AbmProgramStatus;
  default_tier: AbmTier;
  required_roles: AbmRole[];
  source_target_group_id: string | null;
  source_segment_id: string | null;
  source_snapshot_at: string | null;
  custom_data: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AbmTargetAccount = {
  id: string;
  tenant_id: string;
  program_id: string;
  account_id: string;
  tier: AbmTier;
  progress: AbmProgress;
  progress_source: "rule" | "manual";
  progress_reason: string | null;
  progress_changed_at: string;
  progress_changed_by: string | null;
  owner_user_id: string | null;
  owner_source: "coverage" | "program" | "manual";
  next_step: string | null;
  next_step_due: string | null;
  next_step_user_id: string | null;
  added_via: "segment" | "target_group" | "manual" | "import";
  added_by: string | null;
  dropped_reason: string | null;
  opportunity_id: string | null;
  notes: string | null;
  custom_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type AbmBuyingGroupMember = {
  id: string;
  tenant_id: string;
  target_account_id: string;
  contact_id: string;
  role: AbmRole;
  is_primary: boolean;
  /** Who on our side knows this person. */
  owner_user_id: string | null;
  /** A rep's private note: never returned by the v1 API, LIST_SOURCES or MCP. */
  notes: string | null;
  added_by: string | null;
  added_via: "manual" | "suggested" | "import";
  custom_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export const isTier = (v: unknown): v is AbmTier => typeof v === "string" && (ABM_TIERS as readonly string[]).includes(v);
export const isProgress = (v: unknown): v is AbmProgress => typeof v === "string" && (ABM_PROGRESS as readonly string[]).includes(v);
export const isRole = (v: unknown): v is AbmRole => typeof v === "string" && (ABM_ROLES as readonly string[]).includes(v);
export const isProgramStatus = (v: unknown): v is AbmProgramStatus => typeof v === "string" && (PROGRAM_STATUSES as readonly string[]).includes(v);
export const isKind = (v: unknown): v is AbmKind => typeof v === "string" && (PROGRAM_KINDS as readonly string[]).includes(v);
export const isGoalMetric = (v: unknown): v is AbmGoalMetric => typeof v === "string" && (GOAL_METRICS as readonly string[]).includes(v);
