// "How sensitive" is one control that maps to the detector thresholds here (design 3.7): a workspace never edits eight
// numbers. The table is tested (detectors.test.ts) so a change is a conscious one, and a change to it means a new eval run.

import type { Sensitivity } from "./facts";

export type Thresholds = {
  late: {
    /** Late marks by one person, on days the site did not show the same thing, within the window. */
    personCount: number;
    personWindowDays: number;
    /** A site-day counts as a cluster when at least this many people AND at least this share of those expected were late. */
    siteDayMinPeople: number;
    siteDayMinShare: number;
    /** Cluster site-days needed inside the window for a site candidate. */
    siteMinDays: number;
  };
  missingOut: {
    personCount: number;
    personWindowDays: number;
    siteDayMinPeople: number;
    siteDayMinShare: number;
    siteMinDays: number;
  };
  far: {
    /** Flagged punches (outside the geofence by 1.5x the radius or more) by one person within the window. */
    personCount: number;
    windowDays: number;
    /** A site candidate when this many different people, and this many punches in all, are flagged. */
    sitePeopleMin: number;
    siteTotalMin: number;
    /** A person candidate is dropped when more than this share of the flagged punches has a weak GPS fix. */
    maxLowAccuracyShare: number;
  };
  /** Candidates the model is shown at most (design 3.12: about 25). */
  maxCandidates: number;
};

export const THRESHOLDS: Record<Sensitivity, Thresholds> = {
  quiet: {
    late: { personCount: 5, personWindowDays: 10, siteDayMinPeople: 5, siteDayMinShare: 0.5, siteMinDays: 3 },
    missingOut: { personCount: 5, personWindowDays: 14, siteDayMinPeople: 5, siteDayMinShare: 0.5, siteMinDays: 1 },
    far: { personCount: 4, windowDays: 14, sitePeopleMin: 4, siteTotalMin: 8, maxLowAccuracyShare: 0.5 },
    maxCandidates: 25,
  },
  balanced: {
    late: { personCount: 4, personWindowDays: 10, siteDayMinPeople: 3, siteDayMinShare: 0.4, siteMinDays: 2 },
    missingOut: { personCount: 4, personWindowDays: 14, siteDayMinPeople: 3, siteDayMinShare: 0.4, siteMinDays: 1 },
    far: { personCount: 3, windowDays: 14, sitePeopleMin: 3, siteTotalMin: 6, maxLowAccuracyShare: 0.5 },
    maxCandidates: 25,
  },
  thorough: {
    late: { personCount: 3, personWindowDays: 10, siteDayMinPeople: 3, siteDayMinShare: 0.3, siteMinDays: 2 },
    missingOut: { personCount: 3, personWindowDays: 14, siteDayMinPeople: 3, siteDayMinShare: 0.3, siteMinDays: 1 },
    far: { personCount: 2, windowDays: 14, sitePeopleMin: 3, siteTotalMin: 5, maxLowAccuracyShare: 0.5 },
    maxCandidates: 25,
  },
};

export function thresholdsFor(s: Sensitivity | undefined): Thresholds {
  return THRESHOLDS[s ?? "balanced"] ?? THRESHOLDS.balanced;
}
