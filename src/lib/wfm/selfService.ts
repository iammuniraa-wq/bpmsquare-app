import type { PresenceKind } from "@/lib/wfm/types";

/**
 * Whether one employee may punch from their own phone, and with which punches.
 *
 * `override` is employees.self_service_override (KAN-29): null/undefined
 * follows the workspace switch, true/false beats it. `undefined` is treated
 * exactly like null so the code keeps working while migration 0126 is still
 * unapplied and the column does not exist.
 */
export function effectiveSelfService(
  override: boolean | null | undefined,
  workspaceDefault: boolean
): boolean {
  return override ?? workspaceDefault;
}

/**
 * Which remote working an employee is allowed (employees.remote_mode, 0127):
 * Work from home, a Site visit, or both. Owner request 2026-10-11.
 */
export type RemoteMode = "wfh" | "site" | "both";

/** Anything that is not one of the three modes reads as "no mode" -- including a column that does not exist yet. */
export function normalizeRemoteMode(v: unknown): RemoteMode | null {
  return v === "wfh" || v === "site" || v === "both" ? v : null;
}

export const modeIncludesWfh = (m: RemoteMode | null) => m === "wfh" || m === "both";
export const modeIncludesSite = (m: RemoteMode | null) => m === "site" || m === "both";

/**
 * What the phone may do for this person.
 *
 *  - kiosk only      -- not allowed at all
 *  - everything      -- the workspace lets phones punch, or the person is
 *                       allowed with no mode set (the 0126 behaviour)
 *  - remote          -- allowed WITH a mode: only that mode's punches, plus
 *                       breaks and overtime
 *
 * One function, used by the punch route (the real gate) AND by the state the
 * punch screen is built from, so the screen cannot offer a button the gate
 * will refuse. They used to be two separate decisions, which is how the
 * Employees page and its API came to disagree about who may grant this.
 */
export type PhonePolicy =
  | { kind: "kiosk_only" }
  | { kind: "everything" }
  | { kind: "remote"; mode: RemoteMode; allowed: PresenceKind[] };

export function phonePolicy(
  override: boolean | null | undefined,
  workspaceDefault: boolean,
  remoteMode: unknown
): PhonePolicy {
  if (!effectiveSelfService(override, workspaceDefault)) return { kind: "kiosk_only" };

  // A mode only counts alongside an explicit allow. Anything else -- a stale
  // value left on a row, a person since set back to the workspace default --
  // must not quietly narrow what the workspace allows.
  const mode = override === true ? normalizeRemoteMode(remoteMode) : null;
  if (!mode) return { kind: "everything" };

  const allowed: PresenceKind[] = [];
  if (modeIncludesWfh(mode)) allowed.push("mobile_work_start", "mobile_work_end");
  if (modeIncludesSite(mode)) allowed.push("business_trip_start", "business_trip_end");
  // Breaks sit inside any session, so a remote day cannot work without them.
  // Overtime stays reachable because it is approved afterwards (wfm_ot_sessions)
  // and carries no claim about where the person is. What is withheld is the
  // plain check in / check out: those are office presence, and it is exactly
  // their absence that makes a remote day show up as remote.
  allowed.push("break_start", "break_end", "ot_in", "ot_out");
  return { kind: "remote", mode, allowed };
}

export function phoneAllows(policy: PhonePolicy, kind: PresenceKind): boolean {
  if (policy.kind === "kiosk_only") return false;
  if (policy.kind === "everything") return true;
  return policy.allowed.includes(kind);
}

/** Standing Work from home permission, which replaces asking for approval day by day. */
export function hasStandingWfh(policy: PhonePolicy): boolean {
  return policy.kind === "remote" && modeIncludesWfh(policy.mode);
}

/**
 * The words a blocked employee sees on the login page. Exact wording from BIM
 * (2026-10-11): "Your attendance is recorded at the office kiosk. Please speak
 * to your supervisor." Kept in one place so the layout and the login page
 * cannot drift.
 */
export const KIOSK_ONLY_LOGIN_MESSAGE =
  "Your attendance is recorded at the office kiosk. Please speak to your supervisor.";

/**
 * Should this person be refused the app altogether?
 *
 * Owner request 2026-10-11: with the workspace on kiosk-only, an employee who
 * has not been given phone access should not be able to sign in at all --
 * not "sign in and be shown nothing". Hiding the buttons was what shipped
 * first and was explicitly rejected.
 *
 * Deliberately narrow, because the cost of a wrong answer is a locked-out
 * workforce, and because the same rule has to be true on every page:
 *
 *  - only someone with an ACTIVE employee record (the caller checks this);
 *  - never a supervisor. That is tenant admins, employees with wfm_role =
 *    supervisor, and anyone whose Business Role grants edit on "wfm" -- the
 *    people who must be able to sign in to GRANT access. Locking them out
 *    would leave nobody able to undo it;
 *  - only a login that exists purely for WFM (`wfmOnly`). A person who also
 *    uses the CRM happens to have an employee record too, and kiosk-only
 *    punching says nothing about their access to quotes and accounts. When
 *    unsure this fails OPEN: a user with no Business Role at all counts as
 *    unrestricted, so is not blocked.
 */
export function blocksLogin(p: { policy: PhonePolicy; isSupervisor: boolean; wfmOnly: boolean }): boolean {
  return p.policy.kind === "kiosk_only" && !p.isSupervisor && p.wfmOnly;
}
