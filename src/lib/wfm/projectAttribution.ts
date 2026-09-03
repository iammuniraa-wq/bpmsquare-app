// Which project does a punch's work belong to? See WFM_PROJECT_COSTING.md §4.
//
// The rule this file exists to enforce: attribution is DECLARED, never
// inferred from location. A geofence proves someone was at a place; it
// cannot say what they were working on. Every reference system agrees --
// including busybusy and ClockShark, which are GPS-native and still make
// the job a supervisor pre-assignment or an employee pick.
//
// The pure resolver is separated from the DB lookup so the precedence rules
// are unit-testable without a database, matching the rest of the WFM rules
// engine (hours.ts, punchRules.ts, geofence.ts).

/** A date-effective project↔site link, narrowed to what attribution needs. */
export type SiteProjectLink = {
  project_id: string;
  site_id: string;
  from_date: string;          // YYYY-MM-DD
  to_date: string | null;     // null = open-ended
  /** Only an 'active' project absorbs punches automatically -- see below. */
  project_status: string;
};

/** Inclusive on both ends: a link dated 2026-09-01→2026-09-30 covers both. */
export function linkCoversDate(link: SiteProjectLink, date: string): boolean {
  if (date < link.from_date) return false;
  return link.to_date === null || date <= link.to_date;
}

/**
 * The site-default fallback: a site with exactly ONE active project on that
 * date attributes automatically.
 *
 * Returns null when zero or several match. Ambiguity resolves to
 * "unassigned", never to a guess -- picking the first of two projects would
 * silently mis-bill a client, and the supervisor can see and fix an
 * unassigned day (§8) but cannot see a wrong one.
 *
 * Completed/cancelled/on-hold projects are excluded: a site whose project
 * finished should stop absorbing hours the day it does, without anyone
 * having to remember to unlink it.
 */
export function pickSiteDefaultProject(
  links: SiteProjectLink[],
  siteId: string,
  date: string
): string | null {
  const matches = links.filter(
    (l) => l.site_id === siteId && l.project_status === "active" && linkCoversDate(l, date)
  );
  // Two links to the SAME project (consecutive date ranges, a re-mobilisation)
  // is not ambiguity -- it's one answer recorded twice.
  const distinct = [...new Set(matches.map((l) => l.project_id))];
  return distinct.length === 1 ? distinct[0] : null;
}

/**
 * Full precedence, first hit wins:
 *   1. the roster row's explicit project (the supervisor said so)
 *   2. the site's sole active project on that date
 *   3. unassigned
 *
 * `rosterProjectId` is whatever the employee's roster row for this shift-day
 * carries; pass null when there is no roster row at all.
 */
export function resolveProject(
  rosterProjectId: string | null | undefined,
  links: SiteProjectLink[],
  siteId: string | null | undefined,
  date: string
): string | null {
  if (rosterProjectId) return rosterProjectId;
  if (!siteId) return null;
  return pickSiteDefaultProject(links, siteId, date);
}
