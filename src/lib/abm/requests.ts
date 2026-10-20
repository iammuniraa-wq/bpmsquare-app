import {
  DEFAULT_REQUIRED_ROLES, isGoalMetric, isKind, isProgramStatus, isRole, isTier, type AbmGoalMetric, type AbmKind, type AbmProgramStatus, type AbmRole, type AbmTier,
} from "./types";
import { sanitizeRequiredRoles } from "./roles";
import { validateManualProgress } from "./progress";

// Request-body parsing for the ABM routes: pure, so the allowlists and the
// "reason is required" rule are tested without a database. Anything not named
// here is ignored, never passed through to an update.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const date = (v: unknown): string | null | undefined => (v === null || v === "" ? null : typeof v === "string" && DATE_RE.test(v) ? v : undefined);

/** Custom-field values only: keys must start with cf_ and values must be plain scalars. */
export function cfOnly(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!/^cf_[a-z0-9_]{1,60}$/.test(k)) continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[k] = typeof v === "string" ? v.slice(0, 2000) : v;
  }
  return out;
}

export type ProgramInput = {
  name?: string;
  kind?: AbmKind;
  goal?: string | null;
  goal_metric?: AbmGoalMetric;
  goal_target?: number | null;
  starts_on?: string | null;
  ends_on?: string | null;
  owner_user_id?: string | null;
  status?: AbmProgramStatus;
  default_tier?: AbmTier;
  required_roles?: AbmRole[];
  custom_data?: Record<string, unknown>;
};

export function parseProgram(body: unknown, creating: boolean): { ok: true; value: ProgramInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "A request body is required." };
  const b = body as Record<string, unknown>;
  const v: ProgramInput = {};

  if ("name" in b || creating) {
    const name = text(b.name, 160);
    if (!name) return { ok: false, error: "A program needs a name." };
    v.name = name;
  }
  if ("kind" in b) { if (!isKind(b.kind)) return { ok: false, error: "Kind must be new business or expansion." }; v.kind = b.kind; }
  if ("goal" in b) v.goal = text(b.goal, 400);
  if ("goal_metric" in b) { if (!isGoalMetric(b.goal_metric)) return { ok: false, error: "Choose what the goal is measured in." }; v.goal_metric = b.goal_metric; }
  if ("goal_target" in b) {
    if (b.goal_target === null || b.goal_target === "") v.goal_target = null;
    else {
      const n = Number(b.goal_target);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) return { ok: false, error: "The goal target must be a positive number." };
      v.goal_target = n;
    }
  }
  for (const k of ["starts_on", "ends_on"] as const) {
    if (k in b) { const d = date(b[k]); if (d === undefined) return { ok: false, error: "Dates must look like 2027-01-31." }; v[k] = d; }
  }
  if (v.starts_on && v.ends_on && v.ends_on < v.starts_on) return { ok: false, error: "The program cannot end before it starts." };
  if ("owner_user_id" in b) v.owner_user_id = typeof b.owner_user_id === "string" && b.owner_user_id ? b.owner_user_id : null;
  if ("status" in b) { if (!isProgramStatus(b.status)) return { ok: false, error: "Unknown status." }; v.status = b.status; }
  if ("default_tier" in b) { if (!isTier(b.default_tier)) return { ok: false, error: "Unknown tier." }; v.default_tier = b.default_tier; }
  if ("required_roles" in b) v.required_roles = sanitizeRequiredRoles(b.required_roles, DEFAULT_REQUIRED_ROLES);
  if ("custom_data" in b) { const cf = cfOnly(b.custom_data); if (cf) v.custom_data = cf; }
  return { ok: true, value: v };
}

export type TargetPatch = {
  tier?: AbmTier;
  owner_user_id?: string | null;
  next_step?: string | null;
  next_step_due?: string | null;
  next_step_user_id?: string | null;
  opportunity_id?: string | null;
  notes?: string | null;
  custom_data?: Record<string, unknown>;
  /** A person setting progress: validated, with its reason. */
  progress?: { to: string; reason: string };
  /** Ask the rules to look again. */
  check_progress?: boolean;
};

export function parseTargetPatch(body: unknown): { ok: true; value: TargetPatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "A request body is required." };
  const b = body as Record<string, unknown>;
  const v: TargetPatch = {};
  if ("tier" in b) { if (!isTier(b.tier)) return { ok: false, error: "Unknown tier." }; v.tier = b.tier; }
  if ("owner_user_id" in b) v.owner_user_id = typeof b.owner_user_id === "string" && b.owner_user_id ? b.owner_user_id : null;
  if ("next_step" in b) v.next_step = text(b.next_step, 300);
  if ("next_step_due" in b) { const d = date(b.next_step_due); if (d === undefined) return { ok: false, error: "The due date must look like 2027-01-31." }; v.next_step_due = d; }
  if ("next_step_user_id" in b) v.next_step_user_id = typeof b.next_step_user_id === "string" && b.next_step_user_id ? b.next_step_user_id : null;
  if ("opportunity_id" in b) v.opportunity_id = typeof b.opportunity_id === "string" && b.opportunity_id ? b.opportunity_id : null;
  if ("notes" in b) v.notes = text(b.notes, 2000);
  if ("custom_data" in b) { const cf = cfOnly(b.custom_data); if (cf) v.custom_data = cf; }
  if ("progress" in b) {
    const r = validateManualProgress(b.progress, b.progress_reason);
    if (!r.ok) return { ok: false, error: r.error };
    v.progress = { to: r.progress, reason: r.reason };
  }
  if (b.check_progress === true) v.check_progress = true;
  return { ok: true, value: v };
}

export type MemberInput = { contact_id?: string; role?: AbmRole; is_primary?: boolean; notes?: string | null; owner_user_id?: string | null };

export function parseMember(body: unknown, creating: boolean): { ok: true; value: MemberInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "A request body is required." };
  const b = body as Record<string, unknown>;
  const v: MemberInput = {};
  if (creating) {
    if (typeof b.contact_id !== "string" || !b.contact_id) return { ok: false, error: "Choose a person." };
    v.contact_id = b.contact_id;
  }
  if ("role" in b) { if (!isRole(b.role)) return { ok: false, error: "Unknown role." }; v.role = b.role; }
  if ("is_primary" in b) v.is_primary = b.is_primary === true;
  if ("notes" in b) v.notes = text(b.notes, 1000);
  if ("owner_user_id" in b) v.owner_user_id = typeof b.owner_user_id === "string" && b.owner_user_id ? b.owner_user_id : null;
  return { ok: true, value: v };
}

/** Body of POST /programs/[id]/targets: exactly one way of choosing accounts. */
export type AddAccountsInput = { account_ids?: string[]; target_group_id?: string; segment_id?: string; tier?: AbmTier; preview?: boolean };

export function parseAddAccounts(body: unknown): { ok: true; value: AddAccountsInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "A request body is required." };
  const b = body as Record<string, unknown>;
  const v: AddAccountsInput = {};
  if (Array.isArray(b.account_ids)) v.account_ids = b.account_ids.filter((x): x is string => typeof x === "string").slice(0, 500);
  if (typeof b.target_group_id === "string" && b.target_group_id) v.target_group_id = b.target_group_id;
  if (typeof b.segment_id === "string" && b.segment_id) v.segment_id = b.segment_id;
  const ways = [v.account_ids?.length ? 1 : 0, v.target_group_id ? 1 : 0, v.segment_id ? 1 : 0].reduce((a, c) => a + c, 0);
  if (ways !== 1) return { ok: false, error: "Choose accounts by name, or one target group, or one segment." };
  if ("tier" in b) { if (!isTier(b.tier)) return { ok: false, error: "Unknown tier." }; v.tier = b.tier; }
  if (b.preview === true) v.preview = true;
  return { ok: true, value: v };
}
