// Journey types (docs/marketing-platform-architecture.md 3.1, shell scope in docs/shells/journeys-shell.md).
// Pure and importable from client components: nothing here touches a database.

export const JOURNEY_STATUSES = ["draft", "live", "paused", "archived"] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

export const STEP_KINDS = ["wait", "send_newsletter", "create_task", "notify_owner", "end"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export type WaitUnit = "hours" | "days";

export type JourneyStep =
  | { id: string; kind: "wait"; amount: number; unit: WaitUnit }
  | {
      id: string;
      kind: "send_newsletter";
      /** A kept version from the Newsletter Studio. Null while the journey is a draft that has not picked one yet. */
      newsletter_version_id: string | null;
      /** A key from config.marketing.topics: what consent is checked against. */
      topic: string | null;
      /** Languages this step may send; empty = every language of the version that is ready. */
      languages: string[];
      fallback_language: string;
    }
  | { id: string; kind: "create_task"; title: string; due_in_days: number }
  | { id: string; kind: "notify_owner"; text: string }
  | { id: string; kind: "end" };

export const CONDITION_OPS = ["eq", "neq", "gte", "lte", "contains"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/** One simple check on the event that starts the journey. Never typed free-form: the builder offers plain choices. */
export type Condition = { field: string; op: ConditionOp; value: string | number } | null;

export type JourneyDefinition = {
  version: 1;
  trigger: { event: string; condition: Condition };
  entry: {
    /** Two people at one company do not both go through it. Default on. */
    one_per_account: boolean;
    /** Promotional steps wait while the company has a long-open case or an overdue invoice. Default on. */
    pause_when_in_trouble: boolean;
    /** When turned on, events from this many days back also enrol people (0 = only new events). */
    lookback_days: number;
  };
  steps: JourneyStep[];
};

export const MAX_STEPS = 12;
export const MAX_LOOKBACK_DAYS = 30;

/** The row the screens and the runner work with. */
export type JourneyRow = {
  id: string;
  tenant_id: string;
  ref: string | null;
  name: string;
  status: JourneyStatus;
  definition: JourneyDefinition;
  trigger_name: string | null;
  version: number;
  entry_from: string | null;
  went_live_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RunStatus = "active" | "done" | "exited" | "stalled";

export type RunRow = {
  id: string;
  tenant_id: string;
  journey_id: string;
  journey_version: number;
  subject_key: string;
  contact_id: string | null;
  account_id: string | null;
  trigger_event_id: string | null;
  trigger_event_name: string | null;
  trigger_payload: Record<string, unknown>;
  status: RunStatus;
  current_step_id: string | null;
  next_due_at: string | null;
  last_note: string | null;
  note_reason: string | null;
  exit_reason: string | null;
  entered_at: string;
  finished_at: string | null;
};

export type StepRow = {
  id: string;
  run_id: string;
  journey_id: string;
  step_id: string;
  step_kind: string;
  attempt: number;
  status: "done" | "skipped" | "failed";
  reason: string | null;
  detail: string | null;
  contact_id: string | null;
  recipient_id: string | null;
  sent: boolean;
  at: string;
};
