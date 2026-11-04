// AI automation: the agent contract (docs/design/nova-crew-agents.md sections 2 and 3). Type-only and client-safe: nothing here
// imports server code, so the gallery, the runner, the adapters, the eval harness and each agent engine share one set of shapes.
//
// Deliberately NOT exposed anywhere else (design section 8.1): no v1 API endpoint, no MCP tool, no Data Workbench object, no
// OBJECT_FEATURE entry. Agent output about named employees must not be bulk-exportable, and nothing here is a form-edited record.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantFeatures } from "@/lib/constants";

// ── Keys ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The closed list of pre-built agents. Adding one = a key here + one entry in registry.ts + one definition. */
export type AgentKey = "tender_watch" | "attendance";

/** Rows of crew_agent_settings: one per agent plus the workspace row that carries "Pause all agents". */
export type SettingsKey = AgentKey | "_workspace";

export type ToolKey =
  | "tender_brief" | "tender_open_questions" | "tender_approvals" | "tender_rfq_status"
  | "tender_unpriced_by_cost_code" | "tender_next_steps" | "tender_people"
  | "attendance_site_digest" | "attendance_person_history" | "attendance_site_baseline"
  | "attendance_roster_context" | "attendance_punch_flags";

/** The only actions a proposal may ask a person to do (closed registry; the gate refuses anything else). */
export type ActionKey = "tender.nudge" | "wfm.recheck";

export type Sensitivity = "quiet" | "balanced" | "thorough";
export type Severity = "info" | "review" | "urgent";
export type RunTrigger = "schedule" | "event" | "manual";
export type ModelTier = "small" | "mid";

export type RunStatus = "queued" | "running" | "done" | "failed" | "skipped_budget" | "skipped_paused" | "cancelled";
export type FindingStatus = "open" | "seen" | "dismissed" | "not_an_issue" | "actioned" | "expired";
export type ProposalStatus = "pending" | "approved" | "rejected" | "expired" | "failed" | "done";
export type StepKind = "plan" | "prefetch" | "tool" | "model" | "validate" | "gate";

/** Every value `autonomy` may take in slices 1-5. Validation rejects anything else. */
export type Autonomy = "propose";

// ── Schedules and settings ─────────────────────────────────────────────────────────────────────────────────────────────

export type ScheduleDef = {
  /** Workspace-local "HH:MM". */
  time: string;
  /** 0 = Sunday ... 6 = Saturday. Absent = every day. No Friday/Saturday week-off is assumed anywhere. */
  days?: number[];
  /** Weekly pass (attendance): the day of the week, same numbering. */
  weeklyDay?: number;
};

/** What a workspace admin tunes for one agent (the drawer of design section 3.7). Stored in crew_agent_settings.config. */
export type AgentConfig = {
  schedule?: ScheduleDef;
  sensitivity?: Sensitivity;
  /** Tender Watch: "all" | "mine" ; Attendance: site ids. */
  scope?: { mode?: "all" | "mine"; site_ids?: string[] };
  /** Extra recipients besides the automatic ones (deal owner and team, supervisors by site). */
  recipient_ids?: string[];
  /** Tender Watch: days before the bid end date that count as "watch". */
  watch_window_days?: number;
  /** Attendance: per family on/off. Buddy-punch and holiday-bridging default off. */
  families?: Record<string, boolean>;
  /** User ids that opted in to the daily digest e-mail for themselves (internal members only, through resolveOutbound). */
  digest_optin?: string[];
};

export type AgentSettings = {
  agent_key: SettingsKey;
  enabled: boolean;
  paused: boolean;
  config: AgentConfig;
  /** Written only by the platform-admin route. Null = the agent definition's default. */
  monthly_token_cap: number | null;
  updated_at: string | null;
};

// ── Runs ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a run is about. Tender: one deal, or none for the daily pass. Attendance: a site and a shift-day range. */
export type RunScope = {
  deal_id?: string;
  deal_ids?: string[];
  site_id?: string;
  from?: string;
  to?: string;
};

/** What plan() returns: a run worth starting. The unique (tenant_id, dedupe_key) makes enqueueing idempotent. */
export type RunRequest = {
  agent_key: AgentKey;
  trigger: RunTrigger;
  /** Human-readable "Because": shown on the Runs tab ("Daily pass", "Bid decision proposed"). */
  trigger_ref: string;
  scope: RunScope;
  dedupe_key: string;
  /** Candidate ids (deals or alias keys) the model may ask about. A foreign id is a tool error, not data. */
  candidate_ids: string[];
};

export type PlanCtx = {
  admin: SupabaseClient;
  tenantId: string;
  now: Date;
  /** IANA zone from config.wfm.timezone. */
  timezone: string;
  settings: AgentSettings;
  features: Partial<TenantFeatures>;
  /** Present for an event wake-up: the deal the event is about. */
  eventDealId?: string | null;
  trigger: RunTrigger;
};

/** Everything an adapter or the runner knows about one run. The tenant is never an argument of a tool: it is here. */
export type RunContext = {
  admin: SupabaseClient;
  tenantId: string;
  runId: string;
  agentKey: AgentKey;
  scope: RunScope;
  now: Date;
  timezone: string;
  /** Ids the model may ask about. */
  candidateIds: ReadonlySet<string>;
  /** Attendance only: alias -> employee id, held per run and never shown to the model. Null for tender. */
  aliases: ReadonlyMap<string, string> | null;
  settings: AgentSettings;
};

// ── Tools ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type JSONSchema = Record<string, unknown>;

/** A link target the server builds from a type and id (never taken from the model). */
export type Ref = { type: string; id: string; label: string };

export type ToolResult =
  | { ok: true; data: Record<string, unknown>; refs?: Ref[] }
  | { ok: false; error: string };

/**
 * An allow-listed, read-only, tenant-scoped reader. It calls an EXISTING function that already takes (admin, tenantId, ...);
 * it contains no `.from(` of its own (src/lib/crew/adapters.test.ts greps for it). Results are size-capped (about 6k tokens)
 * and every result is stored as a crew_steps row and given a step id the model cites as evidence.
 */
export type ToolAdapter<Args = Record<string, unknown>> = {
  key: ToolKey;
  description: string;
  inputSchema: JSONSchema;
  run: (ctx: RunContext, args: Args) => Promise<ToolResult>;
};

// ── Findings and proposals ─────────────────────────────────────────────────────────────────────────────────────────────

/** An evidence entry: a step of THIS run and a path inside that step's output. The server resolves the value. */
export type EvidenceCite = { step: string; path: string; label?: string };

/** What the model submits through submit_findings. Nothing in it is executed. Digits appear only inside {{placeholders}}. */
export type DraftFinding = {
  kind: string;
  severity: Severity;
  subject: { type: string; id: string };
  title_tmpl: string;
  body_tmpl: string;
  evidence: EvidenceCite[];
  /** "I could not check X" (a tool errored, a table is pending, no data). Shown to the reader. */
  gaps: string[];
  proposal?: DraftProposal;
};

export type DraftProposal = {
  action_key: ActionKey;
  target_type: string;
  target_id: string;
  /** User ids the note is for. Checked against the permitted recipient set by the validator. */
  recipient_ids: string[];
  /** The drafted note. Same placeholder rule as a finding. */
  message_tmpl: string;
};

/** What submit_findings carries: findings, or an empty list with a one-line reason (a normal, successful run). */
export type SubmitFindings = {
  findings: DraftFinding[];
  nothing_to_report?: string;
};

export type EvidenceView = { step: string; path: string; label: string; href: string | null };

/** A persisted finding (crew_findings), already rendered from its templates. */
export type Finding = {
  id: string;
  run_id: string;
  agent_key: AgentKey;
  kind: string;
  severity: Severity;
  subject_type: string;
  subject_id: string;
  site_id: string | null;
  title: string;
  body: string;
  evidence: EvidenceView[];
  gaps: string[];
  fingerprint: string;
  recipient_ids: string[];
  status: FindingStatus;
  status_by: string | null;
  status_at: string | null;
  status_note: string | null;
  suppress_until: string | null;
  created_at: string;
};

/** A persisted proposal (crew_proposals): the approval gate's queue and its history. */
export type Proposal = {
  id: string;
  finding_id: string | null;
  run_id: string;
  agent_key: AgentKey;
  action_key: ActionKey;
  target_type: string;
  target_id: string;
  payload: Record<string, unknown>;
  edited_payload: Record<string, unknown> | null;
  status: ProposalStatus;
  approver_ids: string[];
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  executed_at: string | null;
  result: Record<string, unknown> | null;
  fingerprint: string;
  expires_at: string;
  created_at: string;
};

// ── The agent definition ───────────────────────────────────────────────────────────────────────────────────────────────

export type AgentLimits = { maxTurns: number; maxToolCalls: number; maxTokensPerRun: number; deadlineMs: number };

/**
 * An agent is a definition in code, not a row a customer edits. `plan` is plain code (the candidate gate): a quiet portfolio
 * returns [] and costs 0 tokens. The model only judges what plan() selected, through the allow-listed tools, and returns
 * findings through submit_findings.
 */
export type AgentDefinition = {
  key: AgentKey;
  title: string;
  /** The plain-words goal; becomes the head of the system prompt. */
  goal: string;
  requires: { features: (keyof TenantFeatures)[] };
  triggers: { schedule?: ScheduleDef; events?: string[] };
  plan: (ctx: PlanCtx) => Promise<RunRequest[]>;
  tools: ToolKey[];
  actions: ActionKey[];
  outputSchema: JSONSchema;
  limits: AgentLimits;
  tier: ModelTier;
  defaults: { schedule: ScheduleDef; sensitivity: Sensitivity; monthlyTokenCap: number; retentionDays: number };
  autonomy: Autonomy;
  /** Folder of the fixed evaluation cases (src/lib/crew/<agent>/eval). */
  evalSet: string;
  /** Bumped on every prompt change; stored on the run so a trace can be re-judged against a new prompt. */
  promptVersion: string;
};

// ── Evaluation ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type EvalTag = "flag_worthy" | "quiet" | "not_enough_data" | "adversarial" | "site_level" | "person_level" | "trainee" | "wording";

/** One fixed situation. The harness serves `tool_results` as the tools' answers (no database), calls the model, and scores it. */
export type EvalCase = {
  id: string;
  tags: EvalTag[];
  title: string;
  /** "Today" for the case, ISO date. */
  today: string;
  /** Candidate ids the plan step handed over. */
  candidates: string[];
  /** tool key -> (args-key | "*") -> the fixed snapshot returned as that tool's data. */
  tool_results: Partial<Record<ToolKey, Record<string, Record<string, unknown>>>>;
  expect: {
    must_flag: { kind: string; subject: string; must_cite?: string[] }[];
    must_not_flag: { kind?: string; subject?: string; why: string }[];
    must_gap?: string[];
    max_findings?: number;
    proposal_recipients?: { allowed?: string[]; forbidden?: string[] };
    /** Run must be recorded as a normal success with nothing to report. */
    nothing_to_report?: boolean;
  };
};

export type EvalScore = {
  caseId: string;
  recallHits: number;
  recallTotal: number;
  falsePositives: number;
  dropped: number;
  bannedHits: number;
  recipientViolations: number;
  tokens: number;
};
