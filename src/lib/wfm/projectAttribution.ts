// Which project does a punch's work belong to? See WFM_PROJECT_COSTING.md §4.
//
// The rule this file exists to enforce: attribution is DECLARED, never
// inferred from location alone. A geofence proves someone was at a place; it
// cannot say what they were working on. Every reference system agrees --
// including busybusy and ClockShark, which are GPS-native and still make the
// job a supervisor pre-assignment or an employee pick.
//
// A project is a standalone record that can be linked to any combination of
// sites, people and shifts (0105). Those links are RANKED: the more specific
// a statement is about this particular punch, the more it is trusted.
//
// Pure, so the precedence rules are unit-testable without a database --
// matching the rest of the WFM rules engine (hours.ts, punchRules.ts,
// geofence.ts).

/** One row of wfm_project_links, joined to its project's status and window.
 *  Exactly one of site_id / employee_id / shift_id is set. */
export type ProjectLink = {
  project_id: string;
  project_status: string;
  /** null = open-ended at that end. */
  project_start: string | null;
  project_end: string | null;
  site_id: string | null;
  employee_id: string | null;
  shift_id: string | null;
};

/** Which rung of the ladder decided it — surfaced so a screen can explain
 *  itself rather than presenting an unexplained answer. */
export type AttributionSource = "roster" | "employee" | "shift" | "site" | "none";

export type Attribution = {
  project_id: string | null;
  source: AttributionSource;
  /** Set when a rung matched more than one project and therefore refused to
   *  choose. Resolution STOPS there rather than falling through: the specific
   *  signal named several jobs, and answering with a vaguer one would
   *  contradict it. */
  ambiguous: boolean;
};

const UNASSIGNED: Attribution = { project_id: null, source: "none", ambiguous: false };

/**
 * A project only collects on days it is actually running. Its own dates are
 * the window; either end may be open. Inclusive at both ends.
 */
export function projectCoversDate(link: ProjectLink, date: string): boolean {
  if (link.project_start && date < link.project_start) return false;
  if (link.project_end && date > link.project_end) return false;
  return true;
}

/** Only an Active project inside its date window can claim a punch. A job set
 *  to Completed stops collecting the day it is closed, with nothing to
 *  unlink; one that has not started yet does not collect early. */
function eligible(link: ProjectLink, date: string): boolean {
  return link.project_status === "active" && projectCoversDate(link, date);
}

/**
 * The distinct eligible projects reached by one rung.
 *
 * Two links to the SAME project (a person named individually who is also on
 * a linked site) is one answer recorded twice, not ambiguity -- hence the
 * de-duplication before counting.
 */
function candidates(links: ProjectLink[], date: string, pick: (l: ProjectLink) => boolean): string[] {
  return [...new Set(links.filter((l) => eligible(l, date) && pick(l)).map((l) => l.project_id))];
}

function rung(ids: string[], source: AttributionSource): Attribution | null {
  if (ids.length === 0) return null;
  if (ids.length > 1) return { project_id: null, source, ambiguous: true };
  return { project_id: ids[0], source, ambiguous: false };
}

export type PunchContext = {
  employeeId: string;
  /** The site the punch was matched to, or null when outside every geofence. */
  siteId: string | null;
  /** The shift the employee was actually on that day (roster-aware). */
  shiftId: string | null;
  /** Shift-day key, YYYY-MM-DD. */
  date: string;
};

/**
 * Resolve the project for one punch. First match wins, most specific first:
 *
 *   1. roster    -- the supervisor named a job for this employee on this date
 *   2. employee  -- this person is linked to a job, wherever they punch
 *   3. shift     -- their shift is linked to a job
 *   4. site      -- their site is linked to exactly one job
 *   5. none      -- unassigned, and visibly so
 *
 * Ambiguity anywhere resolves to unassigned rather than a guess. A supervisor
 * can see and fix a blank; they cannot see a wrong one.
 */
export function resolveAttribution(
  rosterProjectId: string | null | undefined,
  links: ProjectLink[],
  ctx: PunchContext
): Attribution {
  // The roster is an explicit instruction about this exact day. It is trusted
  // without checking the links at all -- a supervisor may legitimately roster
  // someone onto a job nothing else connects them to.
  if (rosterProjectId) return { project_id: rosterProjectId, source: "roster", ambiguous: false };

  const { date } = ctx;

  const byEmployee = rung(candidates(links, date, (l) => l.employee_id === ctx.employeeId), "employee");
  if (byEmployee) return byEmployee;

  if (ctx.shiftId) {
    const byShift = rung(candidates(links, date, (l) => l.shift_id === ctx.shiftId), "shift");
    if (byShift) return byShift;
  }

  if (ctx.siteId) {
    const bySite = rung(candidates(links, date, (l) => l.site_id === ctx.siteId), "site");
    if (bySite) return bySite;
  }

  return UNASSIGNED;
}

/** Convenience for callers that only need the id (the punch routes). */
export function resolveProjectId(
  rosterProjectId: string | null | undefined,
  links: ProjectLink[],
  ctx: PunchContext
): string | null {
  return resolveAttribution(rosterProjectId, links, ctx).project_id;
}
