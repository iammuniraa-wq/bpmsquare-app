// Process Design Studio vocabulary (docs/process-design-studio-architecture.md).
// Client-safe: no server imports, so the screens and the server share one set
// of words. The values below are the ones the database CHECK constraints in
// 0152_process_studio.sql allow.

export const STUDY_STATUSES = [
  "telling", "mapped", "fit_ready", "changes_ready", "plan_ready",
  "submitted", "reviewed", "accepted", "rescoped", "closed",
] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

export const STUDY_STATUS_LABEL: Record<StudyStatus, string> = {
  telling: "Telling us",
  mapped: "Mapped",
  fit_ready: "Fit ready",
  changes_ready: "Changes ready",
  plan_ready: "Plan ready",
  submitted: "Sent to BPMSquare",
  reviewed: "Reviewed by BPMSquare",
  accepted: "Accepted",
  rescoped: "Re-scoped",
  closed: "Closed",
};

/** The six steps, in order. Index + 1 is `process_studies.reached`. */
export const STEP_IDS = ["tell", "process", "fit", "changes", "plan", "talk"] as const;
export type StepId = (typeof STEP_IDS)[number];

export const STEP_LABEL: Record<StepId, string> = {
  tell: "Tell us",
  process: "Your process",
  fit: "How BPMSquare fits",
  changes: "What we'd change",
  plan: "Your plan",
  talk: "Talk to us",
};

/** The primary button label on each step: always "the next step". */
export const STEP_PRIMARY: Record<StepId, string> = {
  tell: "Build my process map",
  process: "Check the fit",
  fit: "See what we'd change",
  changes: "Build my plan",
  plan: "Send to BPMSquare",
  talk: "Send to BPMSquare",
};

// ── Areas of a business ──────────────────────────────────────────────────────

export const AREA_IDS = [
  "sales", "service", "production", "procurement", "workforce", "pricing", "marketing", "finance",
] as const;
export type AreaId = (typeof AREA_IDS)[number];

export const AREA_META: Record<AreaId, { label: string; blurb: string; questions: [string, string, string] }> = {
  sales: {
    label: "Sales", blurb: "Enquiries, quotes, deals, invoices",
    questions: ["How does a customer enquiry reach you, and who handles it first?", "How do you prepare and send a quote or a bid, and who approves it?", "What happens after the customer says yes, up to getting paid?"],
  },
  service: {
    label: "Service & repairs", blurb: "Jobs, inspections, repairs, site visits, contracts",
    questions: ["How does a repair or service job start, and how do you track it?", "Who goes to site or works in the workshop, and how do they report back?", "Do you hold yearly maintenance contracts, and how do you schedule their visits?"],
  },
  production: {
    label: "Production & delivery", blurb: "Making, planning, trucks, installing",
    questions: ["What do you make or build, and how is a job planned for the factory or yard?", "How do you plan deliveries and installation?", "Which of this runs in another system today?"],
  },
  procurement: {
    label: "Procurement", blurb: "Suppliers, prices, purchase orders, stock",
    questions: ["How do you ask suppliers for prices, and how do the replies come back?", "How do you raise and track purchase orders?", "Do you keep stock, and how do you know when to reorder?"],
  },
  workforce: {
    label: "Workforce", blurb: "Shifts, attendance, leave, overtime",
    questions: ["How many people work for you, and on which shifts or sites?", "How is attendance recorded today, and who checks it?", "How are leave and overtime requested and approved?"],
  },
  pricing: {
    label: "Pricing & estimating", blurb: "Price lists, costing, margins",
    questions: ["How do you work out what to charge for a job?", "Where do your prices and costs live today?", "Do prices differ by customer, volume or region?"],
  },
  marketing: {
    label: "Marketing", blurb: "Campaigns, leads, partners",
    questions: ["How do new customers find you?", "Do you send campaigns or newsletters, and to whom?", "Do partners or referrers send you work?"],
  },
  finance: {
    label: "Finance", blurb: "Handover to your accounting only",
    questions: ["Which accounting system do you use?", "What has to move from BPMSquare to it (invoices, payments)?", "Who needs reports on money, and how often?"],
  },
};

// ── Ratings ──────────────────────────────────────────────────────────────────

/** The four ratings the model may give. The two system states are set by code. */
export const MODEL_RATINGS = ["standard", "needs_setup", "partly", "not_covered"] as const;
export type ModelRating = (typeof MODEL_RATINGS)[number];

export const RATINGS = [...MODEL_RATINGS, "needs_review", "coming"] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_LABEL: Record<Rating, string> = {
  standard: "Standard",
  needs_setup: "Needs setup",
  partly: "Partly covered",
  not_covered: "Not covered",
  needs_review: "Needs review",
  coming: "Coming",
};

export const CONFIDENCES = ["sure", "likely", "check_with_us"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  sure: "We are sure",
  likely: "Likely, we confirm on the call",
  check_with_us: "Check with us",
};

// ── Changes ──────────────────────────────────────────────────────────────────

export const CHANGE_KINDS = ["setting", "own_fields", "extension", "new_build", "integration"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  setting: "Setting",
  own_fields: "Your own fields",
  extension: "Tenant extension",
  new_build: "New build",
  integration: "Integration",
};

export const CHANGE_KIND_HINT: Record<ChangeKind, string> = {
  setting: "A choice an admin makes in Settings.",
  own_fields: "Extra fields on an object.",
  extension: "A change only for your workspace.",
  new_build: "Something new in the product.",
  integration: "A connector, the API or a webhook.",
};

export const EFFORT_BANDS = ["small", "medium", "large"] as const;
export type EffortBand = (typeof EFFORT_BANDS)[number];

export const EFFORT_LABEL: Record<EffortBand, string> = { small: "Small", medium: "Medium", large: "Large" };

// ── Plan ─────────────────────────────────────────────────────────────────────

export const PHASES = [
  "foundations", "master_data", "sales", "service_production", "workforce", "customisations", "integrations", "go_live",
] as const;
export type PhaseId = (typeof PHASES)[number];

export const PHASE_LABEL: Record<PhaseId, string> = {
  foundations: "Foundations",
  master_data: "Master data",
  sales: "Sales and estimating",
  service_production: "Service and production",
  workforce: "Workforce",
  customisations: "Customisations",
  integrations: "Integrations",
  go_live: "Go-live and training",
};

export const TASK_OWNERS = ["client", "bpmsquare"] as const;
export type TaskOwner = (typeof TASK_OWNERS)[number];
export const OWNER_LABEL: Record<TaskOwner, string> = { client: "You", bpmsquare: "BPMSquare" };

export const WEEKENDS = ["fri_sat", "sat_sun", "sun"] as const;
export type Weekend = (typeof WEEKENDS)[number];
export const WEEKEND_LABEL: Record<Weekend, string> = {
  fri_sat: "Friday and Saturday", sat_sun: "Saturday and Sunday", sun: "Sunday only",
};

// ── Rows (what the screens receive) ──────────────────────────────────────────

export type Understood = { fact: string; kind: "stated" | "assumed" };

export type StudyRow = {
  id: string;
  ref: string | null;
  name: string;
  status: StudyStatus;
  reached: number;
  created_by: string;
  areas: Record<string, { off?: boolean }>;
  lanes: string[];
  language: string;
  follow_ups: boolean;
  summary: string | null;
  noticed: string[];
  plan_start_date: string | null;
  weekend: Weekend;
  contact_name: string | null;
  contact_email: string | null;
  current_version: number;
  reviewed_at: string | null;
  review_note: string | null;
  custom_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  role: "client" | "studio";
  area: string | null;
  text: string;
  understood: Understood[];
  questions: string[];
  created_at: string;
};

export type StepRow = {
  id: string;
  area: AreaId;
  lane: string;
  sort_order: number;
  name: string;
  what: string | null;
  how_today: string | null;
  frequency: string | null;
  assumed: boolean;
  hands_over: boolean;
};

export type FitRow = {
  id: string;
  step_id: string;
  rating: Rating;
  capability_ids: string[];
  why: string;
  confidence: Confidence;
  warnings: string[];
  reviewed: boolean;
};

export type ChangeRow = {
  id: string;
  kind: ChangeKind;
  title: string;
  plain: string;
  alternative: string | null;
  effort_band: EffortBand;
  step_ids: string[];
  extension_hook: string | null;
  connector: string | null;
  kept: boolean;
  client_added: boolean;
  sort_order: number;
};

export type TaskRow = {
  id: string;
  phase: PhaseId;
  sort_order: number;
  name: string;
  owner: TaskOwner;
  duration_days: number;
  milestone: boolean;
  from_template: boolean;
  client_added: boolean;
};

export type CommentRow = {
  id: string;
  phase: string;
  task_id: string | null;
  text: string | null;
  phase_ok: boolean | null;
  created_at: string;
};

export type RequestRow = {
  id: string;
  version: number;
  status: "new" | "contacted" | "accepted" | "rescoped" | "declined";
  email_status: "not_sent" | "sent" | "redirected" | "failed";
  created_at: string;
};

/** Everything one study screen needs, after the access check. */
export type StudyBundle = {
  study: StudyRow;
  messages: MessageRow[];
  steps: StepRow[];
  fit: FitRow[];
  changes: ChangeRow[];
  tasks: TaskRow[];
  comments: CommentRow[];
  requests: RequestRow[];
};

/** A capability as the client sees it in the "what covers it" dialog. */
export type CapabilityView = {
  id: string;
  kind: string;
  label: string;
  plain: string;
  module: string | null;
  where: string | null;
  source: string;
  status: string;
};
